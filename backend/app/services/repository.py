"""Database queries for spend, budgets, audit and aggregates."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..catalog import get_catalog
from ..models import AuditRecord, Budget
from . import timeutil


async def get_or_create_budget(session: AsyncSession, consumer: str) -> Budget:
    budget = await session.get(Budget, consumer)
    if budget is not None:
        return budget
    cfg = get_catalog().budget(consumer)
    budget = Budget(
        consumer=consumer,
        budget=Decimal(str(cfg.budget)) if cfg else Decimal("10"),
        warning_threshold=cfg.warning_threshold if cfg else 0.8,
        currency="USD",
    )
    session.add(budget)
    await session.flush()
    return budget


async def current_spend(
    session: AsyncSession, consumer: str, since: datetime | None = None
) -> float:
    """Sum of budget_charge for a consumer since period start (default month)."""
    since = since or timeutil.month_start()
    stmt = select(func.coalesce(func.sum(AuditRecord.budget_charge), 0)).where(
        AuditRecord.consumer == consumer,
        AuditRecord.timestamp_started >= since,
        AuditRecord.budget_charge.is_not(None),
    )
    result = await session.execute(stmt)
    value = result.scalar_one()
    return float(value or 0)


async def total_spend(
    session: AsyncSession, consumers: list[str], since: datetime | None = None
) -> float:
    since = since or timeutil.month_start()
    stmt = select(func.coalesce(func.sum(AuditRecord.budget_charge), 0)).where(
        AuditRecord.consumer.in_(consumers),
        AuditRecord.timestamp_started >= since,
        AuditRecord.budget_charge.is_not(None),
    )
    result = await session.execute(stmt)
    return float(result.scalar_one() or 0)
