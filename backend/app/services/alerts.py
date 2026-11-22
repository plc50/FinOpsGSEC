"""Alert + recommendation generation (BACKEND_CONTEXT §16 / API_CONTRACT §6.9)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Alert, Recommendation
from . import timeutil

# Per-request alert types are emitted once per audit record; recurring types are
# deduplicated per consumer within an hourly window (§16.1).
DEDUP_TYPES = {
    "budget_warning",
    "projection_exceeded",
    "cost_spike",
    "category_downgraded",
}


def _hour_key(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H")


async def create_alert(
    session: AsyncSession,
    *,
    type: str,
    consumer: str,
    severity: str,
    title: str,
    message: str,
    related_audit_record_id: str | None = None,
    created_at: datetime | None = None,
) -> Alert | None:
    created_at = created_at or timeutil.now_utc()

    dedup_key = None
    if type in DEDUP_TYPES:
        dedup_key = f"{type}:{consumer}:{_hour_key(created_at)}"
        existing = await session.execute(
            select(Alert.id).where(Alert.dedup_key == dedup_key)
        )
        if existing.first() is not None:
            return None

    alert = Alert(
        type=type,
        consumer=consumer,
        severity=severity,
        title=title,
        message=message,
        related_audit_record_id=related_audit_record_id,
        created_at=created_at,
        dedup_key=dedup_key,
    )
    session.add(alert)
    await session.flush()
    return alert


async def create_recommendation(
    session: AsyncSession,
    *,
    type: str,
    consumer: str,
    severity: str,
    message: str,
    created_at: datetime | None = None,
) -> Recommendation:
    rec = Recommendation(
        type=type,
        consumer=consumer,
        severity=severity,
        message=message,
        created_at=created_at or timeutil.now_utc(),
    )
    session.add(rec)
    await session.flush()
    return rec
