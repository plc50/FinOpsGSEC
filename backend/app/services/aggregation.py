"""usage_hourly aggregation from audit_records (BACKEND_CONTEXT §13).

Uses date_trunc for hourly buckets and percentile_cont(0.95) for p95 latency.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import Numeric, case, cast, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..constants import COST_SPIKE_MULTIPLIER
from ..models import AuditRecord, UsageHourly
from . import alerts, timeutil


async def rebuild_usage_hourly(session: AsyncSession) -> int:
    """Recompute the whole usage_hourly table from audit_records."""
    await session.execute(delete(UsageHourly))

    bucket = func.date_trunc("hour", AuditRecord.timestamp_started).label("bucket_start")
    degraded = case((AuditRecord.budget_action == "degraded", 1), else_=0)
    blocked = case((AuditRecord.status == "blocked", 1), else_=0)

    stmt = (
        select(
            bucket,
            AuditRecord.consumer,
            AuditRecord.category,
            AuditRecord.selected_provider,
            AuditRecord.selected_model,
            func.count().label("request_count"),
            func.coalesce(func.sum(AuditRecord.estimated_prompt_tokens), 0),
            func.coalesce(func.sum(AuditRecord.actual_prompt_tokens), 0),
            func.coalesce(func.sum(AuditRecord.estimated_output_tokens), 0),
            func.coalesce(func.sum(AuditRecord.actual_output_tokens), 0),
            func.coalesce(func.sum(AuditRecord.actual_model_cost), 0),
            func.coalesce(func.sum(AuditRecord.routing_overhead_cost), 0),
            func.coalesce(func.sum(AuditRecord.backend_cost), 0),
            func.coalesce(func.sum(AuditRecord.estimated_savings), 0),
            func.coalesce(func.sum(degraded), 0),
            func.coalesce(func.sum(blocked), 0),
            func.avg(AuditRecord.latency_ms),
            func.percentile_cont(0.95).within_group(
                cast(AuditRecord.latency_ms, Numeric)
            ),
        )
        .group_by(
            bucket,
            AuditRecord.consumer,
            AuditRecord.category,
            AuditRecord.selected_provider,
            AuditRecord.selected_model,
        )
    )

    rows = (await session.execute(stmt)).all()
    count = 0
    for r in rows:
        session.add(
            UsageHourly(
                bucket_start=r[0],
                consumer=r[1],
                category=r[2],
                selected_provider=r[3],
                selected_model=r[4],
                request_count=int(r[5]),
                estimated_input_tokens=int(r[6]),
                actual_input_tokens=int(r[7]),
                estimated_output_tokens=int(r[8]),
                actual_output_tokens=int(r[9]),
                model_cost=Decimal(str(r[10])),
                routing_overhead_cost=Decimal(str(r[11])),
                backend_cost=Decimal(str(r[12])),
                estimated_savings=Decimal(str(r[13])),
                degraded_requests=int(r[14]),
                blocked_requests=int(r[15]),
                avg_latency=float(r[16]) if r[16] is not None else None,
                p95_latency=float(r[17]) if r[17] is not None else None,
            )
        )
        count += 1
    await session.flush()

    await _detect_cost_spikes(session)
    await session.commit()
    return count


async def _detect_cost_spikes(session: AsyncSession) -> None:
    """cost_spike alert: current hourly rate >= 3x avg over last 24h (§16.1)."""
    now = timeutil.now_utc()
    since = now.replace(minute=0, second=0, microsecond=0)
    day_ago = since - timeutil.parse_time_range("24h")

    stmt = (
        select(
            UsageHourly.consumer,
            UsageHourly.bucket_start,
            func.sum(UsageHourly.model_cost),
        )
        .where(UsageHourly.bucket_start >= day_ago)
        .group_by(UsageHourly.consumer, UsageHourly.bucket_start)
    )
    rows = (await session.execute(stmt)).all()
    by_consumer: dict[str, list[tuple[datetime, float]]] = {}
    for consumer, bstart, total in rows:
        by_consumer.setdefault(consumer, []).append((bstart, float(total)))

    for consumer, series in by_consumer.items():
        if len(series) < 2:
            continue
        series.sort(key=lambda x: x[0])
        latest_bucket, latest_rate = series[-1]
        prior = [v for (b, v) in series[:-1]]
        if not prior:
            continue
        avg_rate = sum(prior) / len(prior)
        if avg_rate > 0 and latest_rate >= COST_SPIKE_MULTIPLIER * avg_rate:
            await alerts.create_alert(
                session,
                type="cost_spike",
                consumer=consumer,
                severity="warning",
                title="Cost spike detected",
                message=(
                    f"{consumer} hourly spend ${latest_rate:.6f} is over "
                    f"{COST_SPIKE_MULTIPLIER:.0f}x the 24h average."
                ),
                created_at=now,
            )
