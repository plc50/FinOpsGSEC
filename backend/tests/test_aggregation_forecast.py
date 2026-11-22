"""Steps 9/10 — usage_hourly aggregation (§13) + forecast MVP (§14)."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.models import AuditRecord, Budget, UsageHourly
from app.services import aggregation, forecast
from sqlalchemy import select

pytestmark = pytest.mark.asyncio


def _audit(consumer, started, *, charge, latency, category="misc",
           selected_provider="tabbyapi",
           selected_model="gemma-4-12B-it-exl3",
           budget_action="allow", status="completed", savings=None):
    return AuditRecord(
        timestamp_started=started,
        timestamp_completed=started,
        api_key_id="k",
        api_key_prefix="finops_key_...",
        consumer=consumer,
        role="consumer",
        requested_model="auto",
        category=category,
        selected_provider=selected_provider,
        selected_model=selected_model,
        estimated_prompt_tokens=100,
        actual_prompt_tokens=100,
        estimated_output_tokens=200,
        actual_output_tokens=200,
        actual_model_cost=Decimal(str(charge)),
        routing_overhead_cost=Decimal("0"),
        backend_cost=Decimal(str(charge / 2)),
        budget_charge=Decimal(str(charge)),
        estimated_savings=Decimal(str(savings)) if savings is not None else None,
        budget_action=budget_action,
        status=status,
        latency_ms=latency,
    )


async def test_usage_hourly_aggregation(session):
    now = datetime.now(tz=timezone.utc).replace(minute=0, second=0, microsecond=0)
    hour = now - timedelta(hours=2)
    session.add_all([
        _audit("equipo-marketing", hour + timedelta(minutes=1), charge=0.01, latency=1000),
        _audit("equipo-marketing", hour + timedelta(minutes=2), charge=0.02, latency=2000),
        _audit("equipo-marketing", hour + timedelta(minutes=3), charge=0.03, latency=3000),
    ])
    await session.commit()

    count = await aggregation.rebuild_usage_hourly(session)
    assert count >= 1

    rows = (
        await session.execute(
            select(UsageHourly).where(UsageHourly.consumer == "equipo-marketing")
        )
    ).scalars().all()
    assert len(rows) == 1
    row = rows[0]
    assert row.request_count == 3
    assert float(row.model_cost) == pytest.approx(0.06)
    assert row.avg_latency == pytest.approx(2000)
    assert row.p95_latency is not None and row.p95_latency >= 2000


async def test_aggregation_counts_degraded_and_blocked(session):
    now = datetime.now(tz=timezone.utc).replace(minute=0, second=0, microsecond=0)
    hour = now - timedelta(hours=1)
    session.add_all([
        _audit("equipo-marketing", hour, charge=0.02, latency=500,
               budget_action="degraded", status="degraded", savings=0.05,
               category="qa_internal", selected_model="qwen/qwen-plus-2025-07-28"),
        _audit("equipo-marketing", hour + timedelta(minutes=1), charge=0.0,
               latency=10, budget_action="blocked", status="blocked",
               category="qa_internal", selected_model="qwen/qwen-plus-2025-07-28"),
    ])
    await session.commit()
    await aggregation.rebuild_usage_hourly(session)

    rows = (
        await session.execute(
            select(UsageHourly).where(UsageHourly.category == "qa_internal")
        )
    ).scalars().all()
    agg = rows[0]
    assert agg.degraded_requests == 1
    assert agg.blocked_requests == 1
    assert float(agg.estimated_savings) == pytest.approx(0.05)


async def test_forecast_projected_over_budget(session):
    now = datetime.now(tz=timezone.utc)
    session.add(Budget(consumer="equipo-marketing", budget=Decimal("0.10")))
    # High recent spend in last 15m => high hourly rate => projected over budget.
    for i in range(3):
        session.add(
            _audit("equipo-marketing", now - timedelta(minutes=i + 1),
                   charge=0.02, latency=1000)
        )
    await session.commit()

    fc = await forecast.forecast_for(
        session,
        consumer_label="equipo-marketing",
        consumers=["equipo-marketing"],
        budget_limit=0.10,
    )
    assert fc["weighted_hourly_rate"] > 0
    assert fc["forecast_status"] == "projected_over_budget"
    assert fc["budget_exhaustion_at"] is not None
    assert fc["forecast_confidence"] in ("high", "medium", "low")
    assert fc["budget_exhaustion_at"].endswith("Z")


async def test_forecast_on_track_with_large_budget(session):
    now = datetime.now(tz=timezone.utc)
    session.add(
        _audit("equipo-producto", now - timedelta(minutes=5), charge=0.001, latency=500)
    )
    await session.commit()
    fc = await forecast.forecast_for(
        session,
        consumer_label="equipo-producto",
        consumers=["equipo-producto"],
        budget_limit=1000.0,
    )
    assert fc["forecast_status"] == "on_track"


async def test_forecast_no_data_low_confidence(session):
    fc = await forecast.forecast_for(
        session,
        consumer_label="equipo-atencion-cliente",
        consumers=["equipo-atencion-cliente"],
        budget_limit=5.0,
    )
    assert fc["weighted_hourly_rate"] == 0.0
    assert fc["forecast_confidence"] == "low"
    assert fc["budget_exhaustion_at"] is None


async def test_forecast_detail_series_uses_contract_utc_timestamps(session):
    now = datetime.now(tz=timezone.utc).replace(minute=0, second=0, microsecond=0)
    session.add(
        _audit("equipo-marketing", now - timedelta(hours=1), charge=0.01, latency=500)
    )
    await session.commit()
    await aggregation.rebuild_usage_hourly(session)

    detail = await forecast.forecast_detail(
        session,
        consumer_label="equipo-marketing",
        consumers=["equipo-marketing"],
        budget_limit=10.0,
    )

    assert detail["series"]
    assert detail["series"][0]["bucket_start"].endswith("Z")
