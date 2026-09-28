"""Dashboard API (BACKEND_CONTEXT §15 / API_CONTRACT §6)."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy import Numeric, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import errors
from ..auth import authenticate, resolve_scope, visible_consumers
from ..catalog import get_catalog
from ..constants import CATEGORIES, TIERS
from ..db import get_session
from ..models import Alert, AuditRecord, Recommendation, RoutingConfig
from ..schemas import BudgetUpdateRequest, RoutingConfigUpdateRequest
from ..services import forecast, reports, repository, savings, timeutil

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
async def _counts(session: AsyncSession, consumers: list[str], since: datetime):
    degraded = case((AuditRecord.budget_action == "degraded", 1), else_=0)
    blocked = case((AuditRecord.status == "blocked", 1), else_=0)
    stmt = select(
        func.count(),
        func.coalesce(func.sum(degraded), 0),
        func.coalesce(func.sum(blocked), 0),
        func.coalesce(func.sum(AuditRecord.estimated_savings), 0),
    ).where(
        AuditRecord.consumer.in_(consumers),
        AuditRecord.timestamp_started >= since,
    )
    total, deg, blk, savings = (await session.execute(stmt)).one()
    return int(total), int(deg), int(blk), float(savings or 0)


async def _latency(session: AsyncSession, consumers: list[str], since: datetime):
    stmt = select(
        func.avg(AuditRecord.latency_ms),
        func.percentile_cont(0.95).within_group(
            cast(AuditRecord.latency_ms, Numeric)
        ),
    ).where(
        AuditRecord.consumer.in_(consumers),
        AuditRecord.timestamp_started >= since,
        AuditRecord.latency_ms.is_not(None),
    )
    avg_ms, p95 = (await session.execute(stmt)).one()
    return (
        float(avg_ms) if avg_ms is not None else None,
        float(p95) if p95 is not None else None,
    )


async def _alerts_count(session: AsyncSession, consumers: list[str], since: datetime):
    stmt = select(func.count()).where(
        Alert.consumer.in_(consumers), Alert.created_at >= since
    )
    return int((await session.execute(stmt)).scalar_one() or 0)


async def _budget_for_scope(session: AsyncSession, consumers: list[str], is_admin: bool):
    """Return the aggregate budget limit for a scope."""
    if is_admin:
        admin_cfg = get_catalog().budget("admin")
        return float(admin_cfg.budget) if admin_cfg else 100.0
    total = 0.0
    for c in consumers:
        row = await repository.get_or_create_budget(session, c)
        total += float(row.budget)
    return total


# --------------------------------------------------------------------------- #
# endpoints
# --------------------------------------------------------------------------- #
@router.get("/me")
async def dashboard_me(request: Request):
    api_key = authenticate(request)
    return {
        "api_key_id": api_key.api_key_id,
        "api_key_prefix": api_key.api_key_prefix,
        "consumer": api_key.consumer,
        "role": api_key.role,
        "can_select_model": api_key.can_select_model,
        "visible_consumers": visible_consumers(api_key),
    }


@router.get("/summary")
async def dashboard_summary(
    request: Request,
    consumer: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    api_key = authenticate(request)
    is_admin = api_key.role == "admin"
    scope_consumers = resolve_scope(api_key, consumer)
    since = timeutil.month_start()

    if is_admin and not consumer:
        scope_label = "admin"
        budget_limit = await _budget_for_scope(session, scope_consumers, True)
        fc = await forecast.forecast_for(
            session,
            consumer_label="admin",
            consumers=scope_consumers,
            budget_limit=budget_limit,
        )
        current_spend = await repository.total_spend(session, scope_consumers, since)
        response_consumer = None
    else:
        target = consumer or api_key.consumer
        scope_label = "consumer"
        budget_row = await repository.get_or_create_budget(session, target)
        budget_limit = float(budget_row.budget)
        fc = await forecast.forecast_for(
            session,
            consumer_label=target,
            consumers=[target],
            budget_limit=budget_limit,
        )
        current_spend = await repository.current_spend(session, target, since)
        scope_consumers = [target]
        response_consumer = target

    total, deg, blk, savings = await _counts(session, scope_consumers, since)
    alerts_count = await _alerts_count(session, scope_consumers, since)
    used_pct = (current_spend / budget_limit) if budget_limit > 0 else 0.0

    return {
        "scope": scope_label,
        "consumer": response_consumer,
        "current_spend": round(current_spend, 10),
        "budget": budget_limit,
        "budget_used_pct": round(used_pct, 6),
        "projected_spend": fc["projected_spend"],
        "forecast_status": fc["forecast_status"],
        "requests_count": total,
        "degraded_requests": deg,
        "blocked_requests": blk,
        "alerts_count": alerts_count,
        "total_savings": round(savings, 10),
        "currency": "USD",
    }


@router.get("/usage/consumers")
async def usage_consumers(
    request: Request,
    time_range: str | None = Query(default="24h"),
    session: AsyncSession = Depends(get_session),
):
    api_key = authenticate(request)
    consumers = resolve_scope(api_key, None)
    since = timeutil.now_utc() - timeutil.parse_time_range(time_range)
    month = timeutil.month_start()

    items = []
    for c in consumers:
        budget_row = await repository.get_or_create_budget(session, c)
        budget_limit = float(budget_row.budget)
        current_spend = await repository.current_spend(session, c, month)
        total, deg, blk, savings = await _counts(session, [c], since)
        avg_ms, p95 = await _latency(session, [c], since)
        fc = await forecast.forecast_for(
            session, consumer_label=c, consumers=[c], budget_limit=budget_limit
        )
        items.append(
            {
                "consumer": c,
                "current_spend": round(current_spend, 10),
                "budget": budget_limit,
                "budget_used_pct": round(
                    (current_spend / budget_limit) if budget_limit > 0 else 0.0, 6
                ),
                "projected_spend": fc["projected_spend"],
                "forecast_status": fc["forecast_status"],
                "requests_count": total,
                "degraded_requests": deg,
                "blocked_requests": blk,
                "total_savings": round(savings, 10),
                "avg_latency_ms": avg_ms,
                "p95_latency_ms": p95,
            }
        )
    return {"items": items}


@router.get("/usage/requests")
async def usage_requests(
    request: Request,
    consumer: str | None = Query(default=None),
    category: str | None = Query(default=None),
    provider: str | None = Query(default=None),
    model: str | None = Query(default=None),
    routing_source: str | None = Query(default=None),
    budget_action: str | None = Query(default=None),
    status: str | None = Query(default=None),
    usage_source: str | None = Query(default=None),
    time_range: str | None = Query(default="24h"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
):
    api_key = authenticate(request)
    consumers = resolve_scope(api_key, consumer)
    since = timeutil.now_utc() - timeutil.parse_time_range(time_range)

    filters = [
        AuditRecord.consumer.in_(consumers),
        AuditRecord.timestamp_started >= since,
    ]
    if category:
        filters.append(AuditRecord.category == category)
    if provider:
        filters.append(AuditRecord.selected_provider == provider)
    if model:
        filters.append(AuditRecord.selected_model == model)
    if routing_source:
        filters.append(AuditRecord.routing_source == routing_source)
    if budget_action:
        filters.append(AuditRecord.budget_action == budget_action)
    if status:
        filters.append(AuditRecord.status == status)
    if usage_source:
        filters.append(AuditRecord.usage_source == usage_source)

    total = (
        await session.execute(select(func.count()).select_from(AuditRecord).where(*filters))
    ).scalar_one()

    stmt = (
        select(AuditRecord)
        .where(*filters)
        .order_by(AuditRecord.timestamp_started.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    records = (await session.execute(stmt)).scalars().all()

    return {
        "items": [_audit_to_item(r) for r in records],
        "page": page,
        "page_size": page_size,
        "total": int(total),
    }


def _f(value) -> float | None:
    if value is None:
        return None
    return float(value)


def _audit_to_item(r: AuditRecord) -> dict:
    return {
        "id": r.id,
        "timestamp_started": timeutil.format_utc_iso(r.timestamp_started)
        if r.timestamp_started
        else None,
        "timestamp_completed": timeutil.format_utc_iso(r.timestamp_completed)
        if r.timestamp_completed
        else None,
        "consumer": r.consumer,
        "requested_model": r.requested_model,
        "selected_provider": r.selected_provider,
        "selected_model": r.selected_model,
        "baseline_provider": r.baseline_provider,
        "baseline_model": r.baseline_model,
        "routing_source": r.routing_source,
        "routing_config_id": r.routing_config_id,
        "category": r.category,
        "original_category": r.original_category,
        "category_source": r.category_source,
        "complexity_score": r.complexity_score,
        "complexity_tier": r.complexity_tier,
        "required_capabilities": r.required_capabilities,
        "usage_source": r.usage_source,
        "estimated_prompt_tokens": r.estimated_prompt_tokens,
        "actual_prompt_tokens": r.actual_prompt_tokens,
        "estimated_output_tokens": r.estimated_output_tokens,
        "actual_output_tokens": r.actual_output_tokens,
        "estimated_model_cost": _f(r.estimated_model_cost),
        "actual_model_cost": _f(r.actual_model_cost),
        "baseline_model_cost": _f(r.baseline_model_cost),
        "estimated_savings": _f(r.estimated_savings),
        "estimated_savings_ratio": r.estimated_savings_ratio,
        "routing_overhead_cost": _f(r.routing_overhead_cost),
        "backend_cost": _f(r.backend_cost),
        "budget_charge": _f(r.budget_charge),
        "budget_action": r.budget_action,
        "status": r.status,
        "error_code": r.error_code,
        "latency_ms": r.latency_ms,
        "prompt_preview": r.prompt_preview,
        "stream": r.stream,
        "post_stream_budget_overrun": r.post_stream_budget_overrun,
        "context_reduced": r.context_reduced,
        "context_tokens_saved": r.context_tokens_saved,
    }


def _require_admin(request: Request):
    api_key = authenticate(request)
    if api_key.role != "admin":
        raise errors.forbidden_scope()
    return api_key


def _routing_consumer_value(catalog, consumer: str) -> str | None:
    if consumer == "global":
        return None
    if consumer == "admin" or consumer not in catalog.known_consumers:
        raise errors.validation_error("Unknown routing consumer.", "consumer")
    return consumer


def _routing_consumer_label(consumer: str | None) -> str:
    return consumer if consumer is not None else "global"


def _validate_route_dimensions(category: str, complexity_tier: str) -> None:
    if category not in CATEGORIES:
        raise errors.validation_error("Unknown routing category.", "category")
    if complexity_tier not in TIERS:
        raise errors.validation_error(
            "Unknown routing complexity tier.", "complexity_tier"
        )


def _routing_config_filters(consumer: str | None, category: str, tier: str):
    filters = [
        RoutingConfig.category == category,
        RoutingConfig.complexity_tier == tier,
    ]
    if consumer is None:
        filters.append(RoutingConfig.consumer.is_(None))
    else:
        filters.append(RoutingConfig.consumer == consumer)
    return filters


def _routing_config_item(catalog, config: RoutingConfig) -> dict:
    default = catalog.model_for_route(config.category, config.complexity_tier)
    configured = catalog.find_provider_model(config.provider, config.model)
    return {
        "id": config.id,
        "consumer": _routing_consumer_label(config.consumer),
        "category": config.category,
        "complexity_tier": config.complexity_tier,
        "default_provider": default.provider if default else None,
        "default_model": default.model if default else None,
        "configured_provider": config.provider,
        "configured_model": config.model,
        "routing_source": "admin_config",
        "enabled": config.enabled,
        "model_capabilities": list(configured.capabilities) if configured else [],
        "input_price_per_1m_tokens": (
            configured.input_price_per_1m_tokens if configured else None
        ),
        "output_price_per_1m_tokens": (
            configured.output_price_per_1m_tokens if configured else None
        ),
        "updated_at": timeutil.format_utc_iso(config.updated_at),
        "updated_by_api_key_id": config.updated_by_api_key_id,
    }


def _routing_default_item(catalog, consumer: str | None, category: str, tier: str) -> dict:
    default = catalog.model_for_route(category, tier)
    return {
        "id": None,
        "consumer": _routing_consumer_label(consumer),
        "category": category,
        "complexity_tier": tier,
        "default_provider": default.provider if default else None,
        "default_model": default.model if default else None,
        "configured_provider": None,
        "configured_model": None,
        "routing_source": "catalog",
        "enabled": True,
        "model_capabilities": list(default.capabilities) if default else [],
        "input_price_per_1m_tokens": (
            default.input_price_per_1m_tokens if default else None
        ),
        "output_price_per_1m_tokens": (
            default.output_price_per_1m_tokens if default else None
        ),
        "updated_at": None,
        "updated_by_api_key_id": None,
    }


@router.get("/routing-catalog")
async def routing_catalog(request: Request):
    _require_admin(request)

    catalog = get_catalog()
    providers = [
        {
            "id": provider.id,
            "display_name": provider.display_name,
            "base_url": provider.base_url,
            "supports_chat_completions": provider.supports_chat_completions,
            "supports_streaming": provider.supports_streaming,
        }
        for provider in sorted(catalog.providers.values(), key=lambda p: p.id)
    ]

    seen_models: set[tuple[str, str]] = set()
    models = []
    for provider_model in catalog.model_catalog.values():
        key = (provider_model.provider, provider_model.model)
        if key in seen_models:
            continue
        seen_models.add(key)
        models.append(
            {
                "provider": provider_model.provider,
                "model": provider_model.model,
                "display_name": provider_model.display_name,
                "capabilities": list(provider_model.capabilities),
                "input_price_per_1m_tokens": provider_model.input_price_per_1m_tokens,
                "output_price_per_1m_tokens": provider_model.output_price_per_1m_tokens,
            }
        )

    return {
        "providers": providers,
        "models": models,
        "categories": list(CATEGORIES),
        "complexity_tiers": list(TIERS),
    }


@router.get("/routing-config")
async def get_routing_config(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    _require_admin(request)
    catalog = get_catalog()
    stmt = select(RoutingConfig).order_by(
        RoutingConfig.consumer.asc().nullsfirst(),
        RoutingConfig.category.asc(),
        RoutingConfig.complexity_tier.asc(),
    )
    rows = (await session.execute(stmt)).scalars().all()
    configured = {
        (_routing_consumer_label(row.consumer), row.category, row.complexity_tier): row
        for row in rows
    }
    items = []
    for consumer in ["global", *catalog.known_consumers]:
        stored_consumer = None if consumer == "global" else consumer
        for category in CATEGORIES:
            for tier in TIERS:
                row = configured.get((consumer, category, tier))
                if row is None:
                    items.append(
                        _routing_default_item(catalog, stored_consumer, category, tier)
                    )
                else:
                    items.append(_routing_config_item(catalog, row))
    return {"items": items}


@router.put("/routing-config/{consumer}/{category}/{complexity_tier}")
async def put_routing_config(
    consumer: str,
    category: str,
    complexity_tier: str,
    body: RoutingConfigUpdateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    api_key = _require_admin(request)
    catalog = get_catalog()
    stored_consumer = _routing_consumer_value(catalog, consumer)
    _validate_route_dimensions(category, complexity_tier)

    if catalog.provider(body.provider) is None:
        raise errors.validation_error("Unknown provider.", "provider")
    if catalog.find_provider_model(body.provider, body.model) is None:
        raise errors.validation_error("Unknown provider model.", "model")

    stmt = select(RoutingConfig).where(
        *_routing_config_filters(stored_consumer, category, complexity_tier)
    )
    row = (await session.execute(stmt)).scalar_one_or_none()
    now = timeutil.now_utc()
    if row is None:
        row = RoutingConfig(
            consumer=stored_consumer,
            category=category,
            complexity_tier=complexity_tier,
            provider=body.provider,
            model=body.model,
            enabled=body.enabled,
            created_at=now,
            updated_at=now,
            updated_by_api_key_id=api_key.api_key_id,
        )
    else:
        row.provider = body.provider
        row.model = body.model
        row.enabled = body.enabled
        row.updated_at = now
        row.updated_by_api_key_id = api_key.api_key_id
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _routing_config_item(catalog, row)


@router.delete("/routing-config/{consumer}/{category}/{complexity_tier}")
async def delete_routing_config(
    consumer: str,
    category: str,
    complexity_tier: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    _require_admin(request)
    catalog = get_catalog()
    stored_consumer = _routing_consumer_value(catalog, consumer)
    _validate_route_dimensions(category, complexity_tier)

    stmt = select(RoutingConfig).where(
        *_routing_config_filters(stored_consumer, category, complexity_tier)
    )
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is not None:
        await session.delete(row)
        await session.commit()
    return _routing_default_item(catalog, stored_consumer, category, complexity_tier)


# --------------------------------------------------------------------------- #
# savings view
# --------------------------------------------------------------------------- #
@router.get("/savings")
async def dashboard_savings(
    request: Request,
    consumer: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    """Aggregated savings attributable to the proxy (measured + estimated).

    Same auth/scoping as the rest of the dashboard: consumer keys see their
    own savings, admin sees everything (optionally filtered by consumer).
    """
    api_key = authenticate(request)
    consumers = resolve_scope(api_key, consumer)
    start, end = reports.parse_date_range(start_date, end_date, default_days=30)
    return await savings.compute(session, consumers, start=start, end=end)


# --------------------------------------------------------------------------- #
# cost report exports (CSV / PDF)
# --------------------------------------------------------------------------- #
@router.get("/reports/costs.csv")
async def export_costs_csv(
    request: Request,
    consumer: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    """Download the per-request cost report as a CSV attachment.

    Respects dashboard auth/scoping: a consumer key only exports its own data;
    admin may filter by any consumer or export everything.
    """
    api_key = authenticate(request)
    consumers = resolve_scope(api_key, consumer)
    start, end = reports.parse_date_range(start_date, end_date)
    rows = await reports.fetch_rows(session, consumers, start, end)
    filename = f"finops_cost_report_{start:%Y%m%d}_{end:%Y%m%d}.csv"
    return Response(
        content=reports.build_csv(rows),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/reports/costs.pdf")
async def export_costs_pdf(
    request: Request,
    consumer: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    """Download a simple executive cost report (totals + detail) as PDF."""
    api_key = authenticate(request)
    consumers = resolve_scope(api_key, consumer)
    start, end = reports.parse_date_range(start_date, end_date)
    rows = await reports.fetch_rows(session, consumers, start, end)
    filename = f"finops_cost_report_{start:%Y%m%d}_{end:%Y%m%d}.pdf"
    return Response(
        content=reports.build_pdf(rows, start=start, end=end),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/budgets")
async def get_budgets(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    api_key = authenticate(request)
    consumers = resolve_scope(api_key, None)
    month = timeutil.month_start()
    items = []
    for c in consumers:
        row = await repository.get_or_create_budget(session, c)
        budget_limit = float(row.budget)
        current_spend = await repository.current_spend(session, c, month)
        items.append(
            {
                "consumer": c,
                "budget": budget_limit,
                "current_spend": round(current_spend, 10),
                "budget_used_pct": round(
                    (current_spend / budget_limit) if budget_limit > 0 else 0.0, 6
                ),
                "warning_threshold": row.warning_threshold,
                "currency": "USD",
            }
        )
    return {"items": items}


@router.post("/budgets/{consumer}")
async def update_budget(
    consumer: str,
    body: BudgetUpdateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    api_key = authenticate(request)
    if api_key.role != "admin":
        raise errors.forbidden_scope()

    row = await repository.get_or_create_budget(session, consumer)
    row.budget = Decimal(str(body.budget))
    row.warning_threshold = body.warning_threshold
    session.add(row)
    await session.commit()
    return {
        "consumer": consumer,
        "budget": float(row.budget),
        "warning_threshold": row.warning_threshold,
        "currency": "USD",
    }


@router.get("/forecast")
async def get_forecast(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    api_key = authenticate(request)
    consumers = resolve_scope(api_key, None)
    items = []
    for c in consumers:
        row = await repository.get_or_create_budget(session, c)
        fc = await forecast.forecast_for(
            session, consumer_label=c, consumers=[c], budget_limit=float(row.budget)
        )
        items.append(fc)
    return {"items": items}


@router.get("/forecast/{consumer}")
async def get_forecast_consumer(
    consumer: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    api_key = authenticate(request)
    resolve_scope(api_key, consumer)  # raises forbidden_scope if not allowed
    row = await repository.get_or_create_budget(session, consumer)
    return await forecast.forecast_detail(
        session,
        consumer_label=consumer,
        consumers=[consumer],
        budget_limit=float(row.budget),
    )


@router.get("/alerts")
async def get_alerts(
    request: Request,
    consumer: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    type: str | None = Query(default=None),
    time_range: str | None = Query(default="24h"),
    session: AsyncSession = Depends(get_session),
):
    api_key = authenticate(request)
    consumers = resolve_scope(api_key, consumer)
    since = timeutil.now_utc() - timeutil.parse_time_range(time_range)

    filters = [Alert.consumer.in_(consumers), Alert.created_at >= since]
    if severity:
        filters.append(Alert.severity == severity)
    if type:
        filters.append(Alert.type == type)

    stmt = select(Alert).where(*filters).order_by(Alert.created_at.desc())
    rows = (await session.execute(stmt)).scalars().all()
    return {
        "items": [
            {
                "id": a.id,
                "type": a.type,
                "consumer": a.consumer,
                "severity": a.severity,
                "title": a.title,
                "message": a.message,
                "created_at": timeutil.format_utc_iso(a.created_at),
                "related_audit_record_id": a.related_audit_record_id,
            }
            for a in rows
        ]
    }


@router.get("/recommendations")
async def get_recommendations(
    request: Request,
    consumer: str | None = Query(default=None),
    type: str | None = Query(default=None),
    severity: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    api_key = authenticate(request)
    consumers = resolve_scope(api_key, consumer)

    filters = [Recommendation.consumer.in_(consumers)]
    if type:
        filters.append(Recommendation.type == type)
    if severity:
        filters.append(Recommendation.severity == severity)

    stmt = select(Recommendation).where(*filters).order_by(
        Recommendation.created_at.desc()
    )
    rows = (await session.execute(stmt)).scalars().all()
    return {
        "items": [
            {
                "id": r.id,
                "type": r.type,
                "consumer": r.consumer,
                "severity": r.severity,
                "message": r.message,
                "created_at": timeutil.format_utc_iso(r.created_at),
            }
            for r in rows
        ]
    }
