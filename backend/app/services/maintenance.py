"""Forecast-driven signals: projection_exceeded alerts + recommendations (§16)."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from ..catalog import get_catalog
from . import alerts, forecast, repository


async def generate_projection_signals(session: AsyncSession) -> None:
    """Recompute forecast per consumer and emit projection_exceeded alerts and
    budget_degradation recommendations when projected over budget (§14/§16)."""
    catalog = get_catalog()
    for consumer in catalog.known_consumers:
        budget_row = await repository.get_or_create_budget(session, consumer)
        fc = await forecast.forecast_for(
            session,
            consumer_label=consumer,
            consumers=[consumer],
            budget_limit=float(budget_row.budget),
        )
        if fc["forecast_status"] == "projected_over_budget":
            await alerts.create_alert(
                session,
                type="projection_exceeded",
                consumer=consumer,
                severity="warning",
                title="Projected spend exceeds budget",
                message=(
                    f"{consumer} is projected to spend "
                    f"${fc['projected_spend']:.2f} against a "
                    f"${fc['budget']:.2f} budget."
                ),
                related_audit_record_id=None,
            )
            await alerts.create_recommendation(
                session,
                type="budget_degradation_recommendation",
                consumer=consumer,
                severity="warning",
                message=(
                    f"{consumer} está proyectado por encima del presupuesto. "
                    "Degradar tareas misc de baja complejidad al modelo más "
                    "barato compatible reduciría el gasto."
                ),
            )
    await session.commit()
