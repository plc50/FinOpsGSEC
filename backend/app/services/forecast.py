"""Forecast MVP (BACKEND_CONTEXT §14)."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..constants import FORECAST_W_1H, FORECAST_W_15M, FORECAST_W_24H
from ..models import AuditRecord, UsageHourly
from . import repository, timeutil


async def _window_spend(
    session: AsyncSession, consumers: list[str], hours: float
) -> tuple[float, int]:
    now = timeutil.now_utc()
    since = now - timedelta(hours=hours)
    stmt = select(
        func.coalesce(func.sum(AuditRecord.budget_charge), 0),
        func.count(),
    ).where(
        AuditRecord.consumer.in_(consumers),
        AuditRecord.timestamp_started >= since,
        AuditRecord.budget_charge.is_not(None),
    )
    total, count = (await session.execute(stmt)).one()
    return float(total or 0), int(count or 0)


async def weighted_hourly_rate(
    session: AsyncSession, consumers: list[str]
) -> tuple[float, str]:
    """Return (weighted_hourly_rate, forecast_confidence) per §14."""
    spend_15m, n15 = await _window_spend(session, consumers, 0.25)
    spend_1h, n1h = await _window_spend(session, consumers, 1.0)
    spend_24h, n24 = await _window_spend(session, consumers, 24.0)

    rate_15m = spend_15m / 0.25 if n15 > 0 else None
    rate_1h = spend_1h / 1.0 if n1h > 0 else None
    rate_24h = spend_24h / 24.0 if n24 > 0 else None

    # If a window has no data, use the nearest larger populated window (§14).
    eff_15m = rate_15m if rate_15m is not None else (
        rate_1h if rate_1h is not None else rate_24h
    )
    eff_1h = rate_1h if rate_1h is not None else rate_24h
    eff_24h = rate_24h

    if eff_24h is None:
        # No window has data.
        return 0.0, "low"

    eff_15m = eff_15m if eff_15m is not None else eff_24h
    eff_1h = eff_1h if eff_1h is not None else eff_24h

    rate = (
        FORECAST_W_15M * eff_15m
        + FORECAST_W_1H * eff_1h
        + FORECAST_W_24H * eff_24h
    )

    if n15 > 0:
        confidence = "high"
    elif n1h > 0:
        confidence = "medium"
    else:
        confidence = "low" if n24 == 0 else "medium"
    return rate, confidence


def _status(projected: float, budget_limit: float) -> str:
    if budget_limit <= 0:
        return "on_track"
    if projected <= 0.80 * budget_limit:
        return "on_track"
    if projected <= budget_limit:
        return "at_risk"
    return "projected_over_budget"


async def forecast_for(
    session: AsyncSession,
    *,
    consumer_label: str,
    consumers: list[str],
    budget_limit: float,
) -> dict:
    spend_so_far = await repository.total_spend(session, consumers)
    rate, confidence = await weighted_hourly_rate(session, consumers)
    remaining = timeutil.remaining_hours_in_month()
    projected = spend_so_far + rate * remaining
    status = _status(projected, budget_limit)

    if rate > 0:
        hours_left = (budget_limit - spend_so_far) / rate
        exhaustion = (
            timeutil.format_utc_iso(timeutil.now_utc() + timedelta(hours=hours_left))
            if hours_left > 0
            else timeutil.format_utc_iso(timeutil.now_utc())
        )
    else:
        exhaustion = None

    return {
        "consumer": consumer_label,
        "period": "monthly",
        "currency": "USD",
        "spend_so_far": round(spend_so_far, 10),
        "budget": budget_limit,
        "projected_spend": round(projected, 10),
        "forecast_status": status,
        "forecast_confidence": confidence,
        "weighted_hourly_rate": round(rate, 10),
        "budget_exhaustion_at": exhaustion,
    }


async def forecast_detail(
    session: AsyncSession,
    *,
    consumer_label: str,
    consumers: list[str],
    budget_limit: float,
) -> dict:
    base = await forecast_for(
        session,
        consumer_label=consumer_label,
        consumers=consumers,
        budget_limit=budget_limit,
    )

    # Series from usage_hourly buckets.
    stmt = (
        select(UsageHourly.bucket_start, func.sum(UsageHourly.model_cost))
        .where(UsageHourly.consumer.in_(consumers))
        .group_by(UsageHourly.bucket_start)
        .order_by(UsageHourly.bucket_start)
    )
    rows = (await session.execute(stmt)).all()
    series = [
        {
            "bucket_start": timeutil.format_utc_iso(b),
            "actual_cost": float(c or 0),
            "projected_cost": None,
        }
        for b, c in rows
    ]

    total = base["spend_so_far"] or 0.0
    projected_total = base["projected_spend"]

    async def _breakdown(column):
        s = (
            select(column, func.sum(UsageHourly.model_cost))
            .where(UsageHourly.consumer.in_(consumers))
            .group_by(column)
        )
        result = (await session.execute(s)).all()
        out = []
        for key, spend in result:
            spend = float(spend or 0)
            share = (spend / total) if total > 0 else 0.0
            out.append((key, spend, round(projected_total * share, 10)))
        return out

    cat_rows = await _breakdown(UsageHourly.category)
    model_rows = await _breakdown(UsageHourly.selected_model)

    base["series"] = series
    base["breakdown_by_category"] = [
        {"category": k, "spend_so_far": s, "projected_spend": p}
        for k, s, p in cat_rows
    ]
    base["breakdown_by_model"] = [
        {"selected_model": k, "spend_so_far": s, "projected_spend": p}
        for k, s, p in model_rows
    ]
    return base
