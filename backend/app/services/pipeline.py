"""Chat completion pipeline orchestration (BACKEND_CONTEXT §6-§12)."""
from __future__ import annotations

import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import errors
from ..catalog import ApiKey, Catalog, Provider, ProviderModel, get_catalog
from ..constants import (
    DEFAULT_MAX_TOKENS,
    EXPENSIVE_REQUEST_THRESHOLD,
    TIER_ORDER,
    WARNING_THRESHOLD,
)
from ..models import AuditRecord, RoutingConfig
from ..schemas import ChatCompletionRequest
from . import (
    alerts,
    budget,
    capabilities,
    category as category_svc,
    complexity,
    context_reduction,
    cost,
    messages as msg,
    rate_limit,
    repository,
    routing,
    semantic_cache,
    timeutil,
)


def _d(value: float | None) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


@dataclass
class PipelinePlan:
    """Signals computed before touching the provider (shared with streaming)."""

    messages: list[dict]
    request_body: dict[str, Any]
    requested_model: str
    is_explicit: bool
    category: str
    category_source: str
    rule_confidence: float
    classifier_confidence: float | None
    required_capabilities: list[str]
    complexity_score: float
    complexity_tier: str
    effective_max_tokens: int
    max_tokens_source: str
    estimated_prompt_tokens: int
    estimated_output_tokens: int
    baseline: ProviderModel
    routing_source: str
    routing_config_id: str | None
    decision: budget.BudgetDecision
    selected: ProviderModel
    provider: Provider
    budget_limit: float
    current_spend: float
    category_blocked: bool = False
    # Set when a restricted category was reclassified to a cheaper fallback
    # (soft policy) instead of hard-blocked.
    original_category: str | None = None
    context_reduced: bool = False
    context_tokens_saved: int = 0


def _resolve_explicit_model(
    catalog: Catalog,
    api_key: ApiKey,
    requested_model: str,
    *,
    category: str,
    tier: str,
) -> ProviderModel:
    if not api_key.can_select_model:
        raise errors.model_selection_not_allowed()
    parts = requested_model.split("/", 1)
    model = (
        catalog.provider_model_for_route(parts[0], parts[1], category, tier)
        if len(parts) == 2
        else None
    )
    if model is None:
        raise errors.no_compatible_model()
    return model


async def _configured_route(
    session: AsyncSession,
    catalog: Catalog,
    *,
    consumer: str,
    category: str,
    tier: str,
    required_capabilities: list[str],
) -> tuple[ProviderModel, str, str | None]:
    filters = [
        RoutingConfig.category == category,
        RoutingConfig.complexity_tier == tier,
        RoutingConfig.enabled.is_(True),
    ]
    team_stmt = select(RoutingConfig).where(
        RoutingConfig.consumer == consumer,
        *filters,
    )
    global_stmt = select(RoutingConfig).where(
        RoutingConfig.consumer.is_(None),
        *filters,
    )
    row = (await session.execute(team_stmt)).scalar_one_or_none()
    if row is None:
        row = (await session.execute(global_stmt)).scalar_one_or_none()
    if row is not None:
        model = catalog.provider_model_for_route(
            row.provider, row.model, category, tier
        )
        if model is None:
            raise errors.no_compatible_model()
        if not set(required_capabilities).issubset(set(model.capabilities)):
            raise errors.no_compatible_model()
        return model, "admin_config", row.id

    model = routing.select_baseline(
        catalog,
        category=category,
        tier=tier,
        required_capabilities=required_capabilities,
    )
    return model, "catalog", None


async def _configured_lower_route(
    session: AsyncSession,
    catalog: Catalog,
    *,
    consumer: str,
    baseline: ProviderModel,
    required_capabilities: list[str],
) -> tuple[ProviderModel, str, str] | None:
    target_order = TIER_ORDER[baseline.tier] - 1
    if target_order < 0:
        return None
    target_tier = next(tier for tier, order in TIER_ORDER.items() if order == target_order)
    filters = [
        RoutingConfig.category == baseline.category,
        RoutingConfig.complexity_tier == target_tier,
        RoutingConfig.enabled.is_(True),
    ]
    statements = [
        select(RoutingConfig).where(RoutingConfig.consumer == consumer, *filters),
        select(RoutingConfig).where(RoutingConfig.consumer.is_(None), *filters),
    ]
    for stmt in statements:
        row = (await session.execute(stmt)).scalar_one_or_none()
        if row is None:
            continue
        model = catalog.provider_model_for_route(
            row.provider, row.model, baseline.category, target_tier
        )
        if model is None:
            continue
        if not set(required_capabilities).issubset(set(model.capabilities)):
            continue
        return model, "admin_config", row.id
    return None


async def build_plan(
    session: AsyncSession, api_key: ApiKey, request: ChatCompletionRequest
) -> PipelinePlan:
    catalog = get_catalog()
    messages = [m.model_dump() for m in request.messages]
    request_body = request.model_dump(exclude_none=True)
    requested_model = request.model
    is_explicit = requested_model != "auto"

    # --- Token reduction (context compaction) ---
    reduction = await context_reduction.maybe_reduce(catalog, messages)
    if reduction.reduced:
        messages = reduction.messages
        request_body["messages"] = reduction.messages

    # --- Category (§6) ---
    prompt_text = msg.all_text(messages)
    rule_result = category_svc.classify_rules(prompt_text)
    classifier_result = (
        await category_svc.classify_with_model(catalog, prompt_text)
        if rule_result.confidence < 0.95
        else None
    )
    decided = category_svc.decide_category(rule_result, classifier_result)
    category = decided.category
    category_source = decided.source
    rule_confidence = rule_result.confidence
    classifier_confidence = (
        classifier_result.confidence if classifier_result is not None else None
    )

    # --- Static policy: per-consumer category rules ---
    # Soft rule first: a restricted category is reclassified to a cheaper
    # fallback (e.g. marketing code_generation -> misc) instead of failing.
    original_category: str | None = None
    downgrade_to = catalog.category_downgrade_for(api_key.consumer, category)
    if downgrade_to is not None and downgrade_to != category:
        original_category = category
        category = downgrade_to
        category_source = "policy_downgrade"
    # Hard rule: category still blocked outright (403).
    category_blocked = category in catalog.blocked_categories(api_key.consumer)

    # --- Required capabilities (§7) ---
    req_caps = capabilities.required_capabilities(
        messages=messages,
        category=category,
        tools=request.tools,
        tool_choice=request.tool_choice,
        response_format=request.response_format,
    )

    # --- Complexity (§8) ---
    est_prompt_tokens = complexity.estimate_prompt_tokens(messages)
    consumer_score = catalog.consumer_score(api_key.consumer)
    cscore = complexity.complexity_score(
        estimated_prompt_tokens=est_prompt_tokens,
        category=category,
        messages=messages,
        consumer_score=consumer_score,
    )
    tier = complexity.tier_for_score(cscore)

    # --- Max tokens / estimated output (§10.1) ---
    if request.max_tokens is not None:
        effective_max_tokens = request.max_tokens
        max_tokens_source = "client"
    else:
        effective_max_tokens = DEFAULT_MAX_TOKENS[category]
        max_tokens_source = "proxy_default"
    est_output_tokens = effective_max_tokens

    # --- Baseline provider model (§9) ---
    if is_explicit:
        explicit_model = _resolve_explicit_model(
            catalog,
            api_key,
            requested_model,
            category=category,
            tier=tier,
        )
        # Validate required capabilities for the explicit model (§9.2).
        if not set(req_caps).issubset(set(explicit_model.capabilities)):
            raise errors.no_compatible_model()
        baseline = explicit_model
        routing_source = "catalog"
        routing_config_id = None
    else:
        baseline, routing_source, routing_config_id = await _configured_route(
            session,
            catalog,
            consumer=api_key.consumer,
            category=category,
            tier=tier,
            required_capabilities=req_caps,
        )

    # --- Budget policy (§10.5/§10.6) ---
    budget_row = await repository.get_or_create_budget(session, api_key.consumer)
    budget_limit = float(budget_row.budget)
    spend = await repository.current_spend(session, api_key.consumer)

    configured_lower = await _configured_lower_route(
        session,
        catalog,
        consumer=api_key.consumer,
        baseline=baseline,
        required_capabilities=req_caps,
    )

    decision = budget.evaluate(
        catalog,
        baseline=baseline,
        required_capabilities=req_caps,
        estimated_prompt_tokens=est_prompt_tokens,
        estimated_output_tokens=est_output_tokens,
        current_spend=spend,
        budget_limit=budget_limit,
        routing_overhead_cost=0.0,
        degradation_candidate=configured_lower[0] if configured_lower else None,
    )

    selected = decision.selected_model or baseline
    selected_routing_source = routing_source
    selected_routing_config_id = routing_config_id
    if configured_lower and selected.id == configured_lower[0].id:
        selected_routing_source = configured_lower[1]
        selected_routing_config_id = configured_lower[2]
    provider = routing.provider_for(catalog, selected)

    return PipelinePlan(
        messages=messages,
        request_body=request_body,
        requested_model=requested_model,
        is_explicit=is_explicit,
        category=category,
        category_source=category_source,
        rule_confidence=rule_confidence,
        classifier_confidence=classifier_confidence,
        required_capabilities=req_caps,
        complexity_score=round(cscore, 4),
        complexity_tier=tier,
        effective_max_tokens=effective_max_tokens,
        max_tokens_source=max_tokens_source,
        estimated_prompt_tokens=est_prompt_tokens,
        estimated_output_tokens=est_output_tokens,
        baseline=baseline,
        routing_source=selected_routing_source,
        routing_config_id=selected_routing_config_id,
        decision=decision,
        selected=selected,
        provider=provider,
        budget_limit=budget_limit,
        current_spend=spend,
        category_blocked=category_blocked,
        original_category=original_category,
        context_reduced=reduction.reduced,
        context_tokens_saved=reduction.tokens_saved,
    )


def _new_audit(api_key: ApiKey, plan: PipelinePlan, started: float) -> AuditRecord:
    dec = plan.decision
    is_degraded = dec.action == "degraded"
    return AuditRecord(
        timestamp_started=timeutil.now_utc(),
        api_key_id=api_key.api_key_id,
        api_key_prefix=api_key.api_key_prefix,
        consumer=api_key.consumer,
        role=api_key.role,
        requested_model=plan.requested_model,
        requested_model_allowed=(not plan.is_explicit) or api_key.can_select_model,
        category=plan.category,
        category_source=plan.category_source,
        original_category=plan.original_category,
        rule_confidence=plan.rule_confidence,
        classifier_confidence=plan.classifier_confidence,
        complexity_score=plan.complexity_score,
        complexity_tier=plan.complexity_tier,
        required_capabilities=list(plan.required_capabilities),
        selected_provider=plan.selected.provider,
        selected_model=plan.selected.model,
        routing_source=plan.routing_source,
        routing_config_id=plan.routing_config_id,
        backend_fallback_used=False,
        baseline_provider=dec.baseline_model.provider if is_degraded else None,
        baseline_model=dec.baseline_model.model if is_degraded else None,
        baseline_model_cost=_d(dec.baseline_model_cost) if is_degraded else None,
        estimated_savings=_d(dec.estimated_savings) if is_degraded else None,
        estimated_savings_ratio=dec.estimated_savings_ratio if is_degraded else None,
        max_tokens=plan.effective_max_tokens,
        max_tokens_source=plan.max_tokens_source,
        estimated_prompt_tokens=plan.estimated_prompt_tokens,
        estimated_output_tokens=plan.estimated_output_tokens,
        estimated_model_cost=_d(dec.estimated_model_cost),
        routing_overhead_cost=Decimal("0"),
        estimated_budget_charge=_d(dec.estimated_budget_charge),
        budget_action=dec.action,
        prompt_fingerprint=msg.prompt_fingerprint(plan.messages),
        prompt_preview=msg.prompt_preview(plan.messages),
        stream=False,
        context_reduced=plan.context_reduced,
        context_tokens_saved=(
            plan.context_tokens_saved if plan.context_reduced else None
        ),
    )


async def _finalize_alerts(
    session: AsyncSession,
    audit: AuditRecord,
    plan: PipelinePlan,
    *,
    budget_charge: float,
) -> None:
    consumer = audit.consumer
    # category_downgraded: soft policy reclassified the request to a cheaper
    # category (deduplicated hourly per consumer).
    if plan.original_category is not None:
        await alerts.create_alert(
            session,
            type="category_downgraded",
            consumer=consumer,
            severity="info",
            title="Category downgraded by policy",
            message=(
                f"{consumer} requests classified as '{plan.original_category}' "
                f"are being served as '{plan.category}' (cheaper models) by policy."
            ),
            related_audit_record_id=audit.id,
        )
    # model_degraded (§16.1)
    if audit.budget_action == "degraded":
        await alerts.create_alert(
            session,
            type="model_degraded",
            consumer=consumer,
            severity="warning",
            title="Model degraded to save budget",
            message=(
                f"{consumer} request degraded from {audit.baseline_model} "
                f"to {audit.selected_model}."
            ),
            related_audit_record_id=audit.id,
        )
    # expensive_request (§16.1)
    if budget_charge >= EXPENSIVE_REQUEST_THRESHOLD:
        await alerts.create_alert(
            session,
            type="expensive_request",
            consumer=consumer,
            severity="warning",
            title="Expensive request",
            message=f"A single request cost ${budget_charge:.6f}.",
            related_audit_record_id=audit.id,
        )
    # budget_warning (§16.1) — post-request spend in warning band, below 1.0
    if plan.budget_limit > 0:
        post_spend = plan.current_spend + budget_charge
        ratio = post_spend / plan.budget_limit
        if WARNING_THRESHOLD <= ratio < 1.0:
            await alerts.create_alert(
                session,
                type="budget_warning",
                consumer=consumer,
                severity="warning",
                title="Budget warning threshold reached",
                message=(
                    f"{consumer} has used {ratio*100:.0f}% of its "
                    f"${plan.budget_limit:.2f} budget."
                ),
                related_audit_record_id=audit.id,
            )


async def persist_semantic_cache_hit(
    session: AsyncSession,
    api_key: ApiKey,
    plan: PipelinePlan,
    hit: semantic_cache.CacheHit,
    started: float,
    *,
    stream: bool = False,
) -> AuditRecord:
    audit = _new_audit(api_key, plan, started)
    audit.stream = stream
    audit.usage_source = "semantic_cache"
    audit.actual_prompt_tokens = hit.prompt_tokens
    audit.actual_output_tokens = hit.completion_tokens
    audit.actual_model_cost = Decimal("0")
    audit.backend_cost = Decimal("0")
    audit.budget_charge = Decimal("0")
    audit.status = "semantic_cache_hit"
    audit.timestamp_completed = timeutil.now_utc()
    audit.latency_ms = int((time.perf_counter() - started) * 1000)

    session.add(audit)
    await session.flush()
    await session.commit()
    return audit


async def persist_policy_block(
    session: AsyncSession,
    api_key: ApiKey,
    plan: PipelinePlan,
    started: float,
    *,
    error_code: str,
    alert_type: str,
    alert_title: str,
    alert_message: str,
    stream: bool = False,
) -> AuditRecord:
    """Audit + alert for a request rejected by a static policy rule
    (blocked category or rate limit)."""
    audit = _new_audit(api_key, plan, started)
    audit.stream = stream
    audit.status = "blocked"
    audit.budget_action = "blocked"
    audit.error_code = error_code
    audit.selected_provider = plan.baseline.provider
    audit.selected_model = plan.baseline.model
    audit.actual_model_cost = Decimal("0")
    audit.backend_cost = Decimal("0")
    audit.budget_charge = Decimal("0")
    audit.timestamp_completed = timeutil.now_utc()
    audit.latency_ms = int((time.perf_counter() - started) * 1000)
    session.add(audit)
    await session.flush()
    await alerts.create_alert(
        session,
        type=alert_type,
        consumer=api_key.consumer,
        severity="warning",
        title=alert_title,
        message=alert_message,
        related_audit_record_id=audit.id,
    )
    await session.commit()
    return audit


async def enforce_blocked_category(
    session: AsyncSession,
    api_key: ApiKey,
    plan: PipelinePlan,
    started: float,
    *,
    stream: bool = False,
) -> None:
    """Static per-consumer category block. Runs before any provider/cache work."""
    if plan.category_blocked:
        await persist_policy_block(
            session,
            api_key,
            plan,
            started,
            error_code="blocked_category",
            alert_type="blocked_category",
            alert_title="Blocked category",
            alert_message=(
                f"{api_key.consumer} request classified as '{plan.category}' "
                f"was blocked by policy (blocked_categories)."
            ),
            stream=stream,
        )
        raise errors.category_blocked(plan.category, api_key.consumer)


async def enforce_rate_limit(
    session: AsyncSession,
    api_key: ApiKey,
    plan: PipelinePlan,
    started: float,
    *,
    stream: bool = False,
) -> None:
    """Sliding-window token rate limit. Runs after cache lookup (hits are free)."""
    status = rate_limit.check(
        api_key.consumer,
        plan.estimated_prompt_tokens + plan.estimated_output_tokens,
    )
    if status.exceeded:
        await persist_policy_block(
            session,
            api_key,
            plan,
            started,
            error_code="rate_limited",
            alert_type="rate_limited",
            alert_title="Rate limit exceeded",
            alert_message=(
                f"{api_key.consumer} exceeded its token rate limit "
                f"({status.used_tokens} tokens used in the last "
                f"{int(status.window_seconds)}s, limit {status.limit})."
            ),
            stream=stream,
        )
        raise errors.rate_limited(
            api_key.consumer,
            used=status.used_tokens,
            limit=status.limit,
            window_seconds=status.window_seconds,
        )


async def run_chat_completion(
    session: AsyncSession, api_key: ApiKey, request: ChatCompletionRequest
) -> tuple[dict[str, Any], AuditRecord]:
    from . import providers  # local import to ease respx patching in tests

    started = time.perf_counter()
    plan = await build_plan(session, api_key, request)
    audit = _new_audit(api_key, plan, started)

    await enforce_blocked_category(session, api_key, plan, started)

    cache_hit = await semantic_cache.lookup(session, consumer=api_key.consumer, plan=plan)
    if cache_hit is not None:
        completion = semantic_cache.response_for_hit(cache_hit, plan.selected.id)
        audit = await persist_semantic_cache_hit(
            session, api_key, plan, cache_hit, started
        )
        return completion, audit

    await enforce_rate_limit(session, api_key, plan, started)

    # --- Blocked (§10.5) ---
    if plan.decision.action == "blocked":
        audit.status = "blocked"
        audit.error_code = "budget_exceeded"
        audit.selected_provider = plan.baseline.provider
        audit.selected_model = plan.baseline.model
        audit.timestamp_completed = timeutil.now_utc()
        audit.latency_ms = int((time.perf_counter() - started) * 1000)
        session.add(audit)
        await session.flush()
        await alerts.create_alert(
            session,
            type="budget_exceeded",
            consumer=api_key.consumer,
            severity="critical",
            title="Budget exceeded",
            message=f"{api_key.consumer} would exceed its budget; request blocked.",
            related_audit_record_id=audit.id,
        )
        await alerts.create_alert(
            session,
            type="request_blocked",
            consumer=api_key.consumer,
            severity="critical",
            title="Request blocked",
            message=f"{api_key.consumer} request blocked due to budget limit.",
            related_audit_record_id=audit.id,
        )
        await session.commit()
        raise errors.budget_exceeded()

    # --- Provider call with technical fallback (§9.3) ---
    completion: dict[str, Any] | None = None
    fallback_used = False
    last_error: Exception | None = None

    try:
        payload = providers.build_backend_payload(
            plan.request_body, plan.selected, plan.effective_max_tokens
        )
        completion = await providers.call_backend(
            plan.provider, payload, plan.selected.id
        )
    except providers.ProviderError as exc:
        last_error = exc

    if completion is None:
        audit.status = "provider_error"
        audit.error_code = "provider_error"
        audit.timestamp_completed = timeutil.now_utc()
        audit.latency_ms = int((time.perf_counter() - started) * 1000)
        session.add(audit)
        await session.flush()
        await alerts.create_alert(
            session,
            type="provider_error",
            consumer=api_key.consumer,
            severity="critical",
            title="Provider error",
            message="Upstream provider failed with no available fallback.",
            related_audit_record_id=audit.id,
        )
        await session.commit()
        if isinstance(last_error, providers.ProviderError):
            raise errors.provider_error(
                last_error.message,
                http_status=last_error.http_status,
                type=last_error.error_type,
                code=last_error.error_code,
                param=last_error.error_param,
            )
        raise errors.provider_error("provider error")

    # --- Post-call cost (§10.3/§10.4) ---
    usage = completion.get("usage") or {}
    if usage:
        usage_source = "provider"
        actual_prompt = int(usage.get("prompt_tokens", plan.estimated_prompt_tokens))
        actual_output = int(
            usage.get("completion_tokens", plan.estimated_output_tokens)
        )
    else:
        usage_source = "estimated"
        actual_prompt = plan.estimated_prompt_tokens
        actual_output = plan.estimated_output_tokens

    actual_model = cost.model_cost(
        actual_prompt,
        actual_output,
        plan.selected.input_price_per_1m_tokens,
        plan.selected.output_price_per_1m_tokens,
    )
    b_cost = cost.backend_cost(
        actual_prompt,
        actual_output,
        plan.selected.input_price_per_1m_tokens,
        plan.selected.output_price_per_1m_tokens,
    )
    budget_charge = actual_model + 0.0  # routing_overhead_cost = 0

    audit.backend_fallback_used = fallback_used
    audit.usage_source = usage_source
    audit.actual_prompt_tokens = actual_prompt
    audit.actual_output_tokens = actual_output
    audit.actual_model_cost = _d(actual_model)
    audit.backend_cost = _d(b_cost)
    audit.budget_charge = _d(budget_charge)
    audit.status = "degraded" if plan.decision.action == "degraded" else "completed"
    audit.timestamp_completed = timeutil.now_utc()
    audit.latency_ms = int((time.perf_counter() - started) * 1000)

    rate_limit.record(api_key.consumer, actual_prompt + actual_output)

    session.add(audit)
    await session.flush()

    await _finalize_alerts(session, audit, plan, budget_charge=budget_charge)
    await semantic_cache.store(
        session,
        consumer=api_key.consumer,
        plan=plan,
        completion=completion,
        prompt_tokens=actual_prompt,
        completion_tokens=actual_output,
        total_tokens=actual_prompt + actual_output,
        cost=actual_model,
    )
    await session.commit()

    return completion, audit
