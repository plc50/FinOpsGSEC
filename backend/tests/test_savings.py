"""Savings view (`GET /dashboard/savings`): per-mechanism aggregation + scoping.

Catalog prices used below (per 1M tokens):
- tabbyapi gemma-4-12B-it-exl3: in 0.06 / out 0.06
- fireworks glm-5p1 (misc medium): in 0.20 / out 0.20
- fireworks deepseek-v4-pro (code_generation medium): in 0.55 / out 2.20
- openrouter claude-sonnet-5 (misc high): in 3.00 / out 15.00
"""
from datetime import timedelta
from decimal import Decimal

import pytest

from app.models import AuditRecord
from app.services import timeutil

from .conftest import HEADERS

pytestmark = pytest.mark.asyncio


def _row(consumer: str, *, hours_ago: float = 1, **overrides) -> AuditRecord:
    started = timeutil.now_utc() - timedelta(hours=hours_ago)
    defaults = dict(
        timestamp_started=started,
        timestamp_completed=started,
        api_key_id=f"key_{consumer}",
        api_key_prefix="finops_key_...",
        consumer=consumer,
        role="consumer",
        requested_model="auto",
        category="misc",
        complexity_tier="low",
        selected_provider="tabbyapi",
        selected_model="gemma-4-12B-it-exl3",
        actual_prompt_tokens=1000,
        actual_output_tokens=1000,
        budget_charge=Decimal("0.00012"),
        budget_action="allow",
        status="completed",
        latency_ms=900,
    )
    defaults.update(overrides)
    return AuditRecord(**defaults)


async def _seed(session):
    # 1) plain completed request -> smart_routing only:
    #    misc high (claude 3/15) = 0.018 vs gemma = 0.00012 -> 0.01788
    session.add(_row("equipo-marketing"))
    # 2) semantic cache hit -> cache saves the gemma cost (0.00012)
    #    plus the same smart_routing delta as row 1.
    session.add(
        _row(
            "equipo-marketing",
            status="semantic_cache_hit",
            budget_charge=Decimal("0"),
            latency_ms=40,
        )
    )
    # 3) degraded request -> measured savings recorded at decision time
    #    (0.005); smart_routing compares high (0.018) vs baseline (0.006).
    session.add(
        _row(
            "equipo-marketing",
            budget_action="degraded",
            status="degraded",
            estimated_savings=Decimal("0.005"),
            baseline_model_cost=Decimal("0.006"),
            budget_charge=Decimal("0.001"),
        )
    )
    # 4) category downgrade code_generation->misc at medium tier:
    #    deepseek medium (0.55/2.20 -> 0.00275) vs glm-5p1 (0.0004) = 0.00235.
    #    No smart_routing on downgraded rows (counterfactual already used).
    session.add(
        _row(
            "equipo-marketing",
            category="misc",
            original_category="code_generation",
            complexity_tier="medium",
            selected_provider="fireworks",
            selected_model="accounts/fireworks/models/glm-5p1",
            budget_charge=Decimal("0.0004"),
        )
    )
    # 5) context reduction: 50k input tokens not sent at gemma input rate
    #    (0.06/1M) = 0.003; also accrues smart_routing like row 1.
    session.add(
        _row(
            "equipo-marketing",
            context_reduced=True,
            context_tokens_saved=50_000,
        )
    )
    # another consumer, to verify scoping
    session.add(_row("equipo-producto", budget_charge=Decimal("0.00012")))
    await session.commit()


def _mech(body: dict, name: str) -> dict:
    return next(m for m in body["mechanisms"] if m["mechanism"] == name)


async def test_savings_mechanism_breakdown(client, session):
    await _seed(session)
    resp = await client.get("/dashboard/savings", headers=HEADERS["marketing"])
    assert resp.status_code == 200
    body = resp.json()

    cache = _mech(body, "semantic_cache")
    assert cache["kind"] == "measured"
    assert cache["savings"] == pytest.approx(0.00012)
    assert cache["requests"] == 1
    assert cache["extra"]["hits"] == 1
    assert cache["extra"]["tokens_served"] == 2000
    assert cache["extra"]["avg_hit_latency_ms"] == 40

    degradation = _mech(body, "budget_degradation")
    assert degradation["kind"] == "measured"
    assert degradation["savings"] == pytest.approx(0.005)

    downgrade = _mech(body, "category_downgrade")
    assert downgrade["kind"] == "measured"
    assert downgrade["savings"] == pytest.approx(0.00235)

    reduction = _mech(body, "token_reduction")
    assert reduction["kind"] == "measured"
    assert reduction["savings"] == pytest.approx(0.003)
    assert reduction["extra"]["tokens_saved"] == 50_000

    routing = _mech(body, "smart_routing")
    assert routing["kind"] == "estimated"
    # rows 1, 2, 5: 0.018 - 0.00012 each; row 3: 0.018 - 0.006
    assert routing["savings"] == pytest.approx(0.01788 * 3 + 0.012)
    assert routing["requests"] == 4


async def test_savings_totals_and_series(client, session):
    await _seed(session)
    resp = await client.get("/dashboard/savings", headers=HEADERS["marketing"])
    body = resp.json()

    expected_savings = 0.00012 + 0.005 + 0.00235 + 0.003 + (0.01788 * 3 + 0.012)
    expected_spend = 0.00012 + 0 + 0.001 + 0.0004 + 0.00012

    assert body["currency"] == "USD"
    assert body["requests_analyzed"] == 5
    assert body["actual_spend"] == pytest.approx(expected_spend)
    assert body["total_savings"] == pytest.approx(expected_savings)
    assert body["baseline_spend"] == pytest.approx(expected_spend + expected_savings)
    assert 0 < body["savings_ratio"] < 1
    assert body["projected_monthly_savings"] == pytest.approx(expected_savings, rel=0.01)

    # all rows are ~1h old -> a single daily bucket carrying every mechanism
    assert len(body["series"]) >= 1
    day_total = sum(
        sum(v for k, v in bucket.items() if k != "date") for bucket in body["series"]
    )
    assert day_total == pytest.approx(expected_savings)


async def test_savings_scoping(client, session):
    await _seed(session)

    own = await client.get("/dashboard/savings", headers=HEADERS["marketing"])
    assert [c["consumer"] for c in own.json()["consumers"]] == ["equipo-marketing"]

    other = await client.get(
        "/dashboard/savings?consumer=equipo-producto", headers=HEADERS["marketing"]
    )
    assert other.status_code == 403

    admin = await client.get("/dashboard/savings", headers=HEADERS["admin"])
    consumers = {c["consumer"] for c in admin.json()["consumers"]}
    assert consumers == {"equipo-marketing", "equipo-producto"}
    marketing = next(
        c for c in admin.json()["consumers"] if c["consumer"] == "equipo-marketing"
    )
    assert marketing["top_mechanism"] == "smart_routing"
    assert marketing["savings"] > 0


async def test_savings_empty_range(client):
    resp = await client.get(
        "/dashboard/savings?start_date=2020-01-01&end_date=2020-01-02",
        headers=HEADERS["marketing"],
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_savings"] == 0
    assert body["savings_ratio"] == 0
    assert body["series"] == []
    assert body["consumers"] == []
