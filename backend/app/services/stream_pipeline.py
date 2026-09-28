"""Streaming pass-through pipeline (BACKEND_CONTEXT §11)."""
from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from .. import errors
from ..catalog import ApiKey
from ..schemas import ChatCompletionRequest
from . import alerts, cost, pipeline, providers, rate_limit, semantic_cache, timeutil
from .pipeline import PipelinePlan, _d


async def prepare(
    session: AsyncSession, api_key: ApiKey, request: ChatCompletionRequest
) -> tuple[PipelinePlan, semantic_cache.CacheHit | None]:
    """Run all pre-checks before opening the backend stream (§11.1)."""
    started = time.perf_counter()
    plan = await pipeline.build_plan(session, api_key, request)
    await pipeline.enforce_blocked_category(
        session, api_key, plan, started, stream=True
    )
    cache_hit = await semantic_cache.lookup(session, consumer=api_key.consumer, plan=plan)
    if cache_hit is not None:
        return plan, cache_hit
    await pipeline.enforce_rate_limit(session, api_key, plan, started, stream=True)
    if plan.decision.action == "blocked":
        await _persist_blocked(session, api_key, plan)
        raise errors.budget_exceeded()
    return plan, None


async def _persist_blocked(
    session: AsyncSession, api_key: ApiKey, plan: PipelinePlan
) -> None:
    audit = pipeline._new_audit(api_key, plan, time.perf_counter())
    audit.stream = True
    audit.status = "blocked"
    audit.error_code = "budget_exceeded"
    audit.selected_provider = plan.baseline.provider
    audit.selected_model = plan.baseline.model
    audit.timestamp_completed = timeutil.now_utc()
    audit.latency_ms = 0
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


async def persist_provider_stream_error(
    session: AsyncSession, api_key: ApiKey, plan: PipelinePlan
) -> None:
    started = time.perf_counter()
    audit = pipeline._new_audit(api_key, plan, started)
    audit.stream = True
    await _finalize_stream_audit(
        session,
        audit,
        plan,
        usage={},
        accumulated="",
        cached_chunks=[],
        used_provider=plan.provider,
        fallback_used=False,
        status="provider_stream_error",
        started=started,
        consumer=api_key.consumer,
    )


def _sse(chunk: dict[str, Any]) -> str:
    return f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"


def _stream_error_chunks(plan: PipelinePlan, message: str) -> list[str]:
    created = int(time.time())
    chunk_id = f"chatcmpl_error_{int(time.time() * 1000)}"
    error = {
        "message": message,
        "type": "server_error",
        "param": None,
        "code": "provider_error",
    }
    return [
        _sse(
            {
                "id": chunk_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": plan.selected.id,
                "choices": [
                    {
                        "index": 0,
                        "delta": {"content": f"Provider error: {message}"},
                        "finish_reason": None,
                    }
                ],
                "error": error,
            }
        ),
        _sse(
            {
                "id": chunk_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": plan.selected.id,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
        ),
    ]


async def stream_cache_hit(
    session: AsyncSession,
    api_key: ApiKey,
    plan: PipelinePlan,
    hit: semantic_cache.CacheHit,
) -> AsyncIterator[str]:
    started = time.perf_counter()
    response = semantic_cache.response_for_hit(hit, plan.selected.id)
    choices = response.get("choices") or []
    message = choices[0].get("message") if choices else {}
    content = message.get("content") if isinstance(message, dict) else None
    chunk_id = response.get("id", f"chatcmpl_cache_{int(time.time() * 1000)}")
    created = int(response.get("created", time.time()))
    cached_chunks = response.get("cached_stream_chunks") or []

    if isinstance(cached_chunks, list) and cached_chunks:
        for chunk in cached_chunks:
            if not isinstance(chunk, dict):
                continue
            replay = json.loads(json.dumps(chunk))
            replay["id"] = chunk_id
            replay["created"] = created
            replay["model"] = plan.selected.id
            yield _sse(replay)
        yield "data: [DONE]\n\n"
        await pipeline.persist_semantic_cache_hit(
            session, api_key, plan, hit, started, stream=True
        )
        return

    if isinstance(content, str) and content:
        yield _sse(
            {
                "id": chunk_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": plan.selected.id,
                "choices": [
                    {
                        "index": 0,
                        "delta": {"content": content},
                        "finish_reason": None,
                    }
                ],
            }
        )
    yield _sse(
        {
            "id": chunk_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": plan.selected.id,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": response.get("usage"),
        }
    )
    yield "data: [DONE]\n\n"

    await pipeline.persist_semantic_cache_hit(
        session, api_key, plan, hit, started, stream=True
    )


async def stream_with_plan(
    session: AsyncSession,
    api_key: ApiKey,
    request: ChatCompletionRequest,
    plan: PipelinePlan,
    http_request: Request | None = None,
    opened_stream: providers.OpenedBackendStream | None = None,
) -> AsyncIterator[str]:
    started = time.perf_counter()

    audit = pipeline._new_audit(api_key, plan, started)
    audit.stream = True

    accumulated: list[str] = []
    cached_chunks: list[dict[str, Any]] = []
    usage: dict[str, Any] = {}
    chunks_sent = 0
    used_provider = plan.provider
    fallback_used = False
    status = "completed"

    async def _drain() -> AsyncIterator[str]:
        nonlocal usage, chunks_sent, used_provider, fallback_used, status
        last_error: Exception | None = None
        try:
            stream = opened_stream
            if stream is None:
                payload = providers.build_backend_payload(
                    plan.request_body, plan.selected, plan.effective_max_tokens
                )
                stream = await providers.open_backend_stream(
                    plan.provider, payload, plan.selected.id
                )
            async for chunk in stream:
                used_provider = plan.provider
                cached_chunks.append(chunk)
                if chunk.get("usage"):
                    usage = chunk["usage"]
                for choice in chunk.get("choices", []):
                    content = semantic_cache.choice_text(choice)
                    if content:
                        accumulated.append(content)
                chunks_sent += 1
                yield _sse(chunk)
            last_error = None
        except providers.ProviderError as exc:
            last_error = exc
            status = "provider_stream_error"
        if last_error is not None and chunks_sent == 0:
            status = "provider_stream_error"
            message = "Upstream provider failed before returning a streamed response."
            for sse in _stream_error_chunks(plan, message):
                yield sse

    try:
        async for sse in _drain():
            yield sse
    except Exception:  # client disconnect or unexpected error
        status = "cancelled_by_client"

    yield "data: [DONE]\n\n"

    await _finalize_stream_audit(
        session,
        audit,
        plan,
        usage=usage,
        accumulated="".join(accumulated),
        cached_chunks=cached_chunks,
        used_provider=used_provider,
        fallback_used=fallback_used,
        status=status,
        started=started,
        consumer=api_key.consumer,
    )


async def _finalize_stream_audit(
    session: AsyncSession,
    audit,
    plan: PipelinePlan,
    *,
    usage: dict[str, Any],
    accumulated: str,
    cached_chunks: list[dict[str, Any]],
    used_provider,
    fallback_used: bool,
    status: str,
    started: float,
    consumer: str,
) -> None:
    if usage:
        usage_source = "provider"
        actual_prompt = int(usage.get("prompt_tokens", plan.estimated_prompt_tokens))
        actual_output = int(usage.get("completion_tokens", plan.estimated_output_tokens))
    else:
        usage_source = "estimated"
        actual_prompt = plan.estimated_prompt_tokens
        # token fallback from accumulated text (§11.4)
        actual_output = (
            max(1, len(accumulated) // 4)
            if accumulated
            else plan.estimated_output_tokens
        )

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
    budget_charge = actual_model

    audit.backend_fallback_used = fallback_used
    audit.usage_source = usage_source
    audit.actual_prompt_tokens = actual_prompt
    audit.actual_output_tokens = actual_output
    audit.actual_model_cost = _d(actual_model)
    audit.backend_cost = _d(b_cost)
    audit.budget_charge = _d(budget_charge)
    audit.timestamp_completed = timeutil.now_utc()
    audit.latency_ms = int((time.perf_counter() - started) * 1000)

    # Post-stream budget overrun (§11).
    overrun = False
    if (
        status == "completed"
        and plan.budget_limit > 0
        and plan.current_spend + budget_charge > plan.budget_limit
    ):
        overrun = True
    audit.post_stream_budget_overrun = overrun

    if status == "provider_stream_error":
        audit.status = "provider_stream_error"
        audit.error_code = "provider_error"
    elif status == "cancelled_by_client":
        audit.status = "cancelled_by_client"
    else:
        audit.status = "degraded" if plan.decision.action == "degraded" else "completed"

    if audit.status in ("completed", "degraded"):
        rate_limit.record(consumer, actual_prompt + actual_output)

    session.add(audit)
    await session.flush()

    if audit.status in ("completed", "degraded"):
        await pipeline._finalize_alerts(
            session, audit, plan, budget_charge=budget_charge
        )
        completion = semantic_cache.completion_from_stream(
            plan, accumulated, usage, chunks=cached_chunks
        )
        await semantic_cache.store(
            session,
            consumer=consumer,
            plan=plan,
            completion=completion,
            prompt_tokens=actual_prompt,
            completion_tokens=actual_output,
            total_tokens=actual_prompt + actual_output,
            cost=actual_model,
        )
    if overrun:
        await alerts.create_alert(
            session,
            type="post_stream_budget_overrun",
            consumer=consumer,
            severity="critical",
            title="Post-stream budget overrun",
            message=f"{consumer} exceeded budget after a streamed response completed.",
            related_audit_record_id=audit.id,
        )
    if status == "provider_stream_error":
        await alerts.create_alert(
            session,
            type="provider_error",
            consumer=consumer,
            severity="critical",
            title="Provider stream error",
            message="Backend stream failed.",
            related_audit_record_id=audit.id,
        )
    await session.commit()
