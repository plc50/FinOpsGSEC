"""Step 4 — /v1/chat/completions non-streaming (§2.2, §11)."""
import json
from collections.abc import AsyncIterator

import httpx
import pytest
import respx

from app.services import semantic_cache

from .conftest import HEADERS

pytestmark = pytest.mark.asyncio

TABBY_URL = "http://127.0.0.1:5000/v1/chat/completions"


def _sse(payload: dict) -> bytes:
    return f"data: {json.dumps(payload)}\n\n".encode()


class _Stream(httpx.AsyncByteStream):
    def __init__(self, chunks: list[bytes]):
        self._chunks = chunks

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for chunk in self._chunks:
            yield chunk

    async def aclose(self) -> None:
        return None


async def test_auto_completion_mock(client, mock_providers):
    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={
            "model": "auto",
            "messages": [{"role": "user", "content": "Resume esto en una frase."}],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["object"] == "chat.completion"
    assert "/" in body["model"]  # provider/model id
    assert body["usage"]["prompt_tokens"] >= 0


async def test_completion_persists_audit(client, mock_providers):
    await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={"model": "auto", "messages": [{"role": "user", "content": "hola"}]},
    )
    listing = await client.get(
        "/dashboard/usage/requests", headers=HEADERS["marketing"]
    )
    assert listing.status_code == 200
    items = listing.json()["items"]
    assert len(items) == 1
    row = items[0]
    assert row["consumer"] == "equipo-marketing"
    assert row["status"] == "completed"
    assert row["budget_action"] in ("allow", "warn_only")
    assert row["usage_source"] == "provider"
    assert row["actual_model_cost"] is not None
    assert row["backend_cost"] is not None


@respx.mock
async def test_semantic_cache_hit_skips_provider_and_audits_zero_cost(
    client, monkeypatch
):
    async def fake_lookup(session, *, consumer, plan):
        return semantic_cache.CacheHit(
            id="cache_1",
            response={
                "id": "chatcmpl_original",
                "object": "chat.completion",
                "created": 1,
                "model": plan.selected.id,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "cached answer"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 12,
                    "completion_tokens": 3,
                    "total_tokens": 15,
                },
            },
            prompt_tokens=12,
            completion_tokens=3,
            total_tokens=15,
            cost=0.0001,
            similarity=0.99,
        )

    monkeypatch.setattr(semantic_cache, "lookup", fake_lookup)
    route = respx.post("http://127.0.0.1:5000/v1/chat/completions").mock(
        return_value=httpx.Response(500, json={"error": "should not be called"})
    )

    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={
            "model": "auto",
            "messages": [{"role": "user", "content": "hola cache"}],
        },
    )

    assert resp.status_code == 200
    assert resp.json()["choices"][0]["message"]["content"] == "cached answer"
    assert not route.called

    listing = await client.get(
        "/dashboard/usage/requests", headers=HEADERS["marketing"]
    )
    row = listing.json()["items"][0]
    assert row["status"] == "semantic_cache_hit"
    assert row["usage_source"] == "semantic_cache"
    assert row["actual_model_cost"] == 0
    assert row["backend_cost"] == 0
    assert row["budget_charge"] == 0


@respx.mock
async def test_tool_calling_bypasses_semantic_cache(client, monkeypatch):
    async def fail_available(session):
        raise AssertionError("semantic cache availability should not be checked")

    monkeypatch.setattr(semantic_cache, "available", fail_available)
    route = respx.post("http://127.0.0.1:5000/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "chatcmpl_tools",
                "object": "chat.completion",
                "created": 1,
                "model": "gemma-4-12B-it-exl3",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "tool path"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 2,
                    "total_tokens": 12,
                },
            },
        )
    )

    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={
            "model": "auto",
            "messages": [{"role": "user", "content": "usa una herramienta"}],
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "lookup",
                        "description": "Lookup data",
                        "parameters": {"type": "object", "properties": {}},
                    },
                }
            ],
            "tool_choice": "required",
        },
    )

    assert resp.status_code == 200
    assert route.called


async def test_semantic_cache_uses_latest_user_prompt_across_chat_history(
    client, mock_providers
):
    prompt = "What is under a rock but has two legs"
    first = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={"model": "auto", "messages": [{"role": "user", "content": prompt}]},
    )
    assert first.status_code == 200

    second = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={
            "model": "auto",
            "messages": [
                {"role": "user", "content": prompt},
                first.json()["choices"][0]["message"],
                {"role": "user", "content": "Are you sure?"},
                {"role": "assistant", "content": "I should clarify the answer."},
                {"role": "user", "content": prompt},
            ],
        },
    )
    assert second.status_code == 200

    listing = await client.get(
        "/dashboard/usage/requests", headers=HEADERS["marketing"]
    )
    items = listing.json()["items"]
    assert items[0]["prompt_preview"] == prompt
    assert items[0]["status"] == "semantic_cache_hit"
    assert items[0]["usage_source"] == "semantic_cache"


async def test_semantic_cache_allows_openwebui_available_tools_auto_choice(
    client, mock_providers
):
    prompt = "Hola, como funciona un motor?"
    for _ in range(2):
        resp = await client.post(
            "/v1/chat/completions",
            headers=HEADERS["marketing"],
            json={
                "model": "auto",
                "messages": [{"role": "user", "content": prompt}],
                "tools": [
                    {
                        "type": "function",
                        "function": {
                            "name": "web_search",
                            "description": "Search the web",
                            "parameters": {"type": "object", "properties": {}},
                        },
                    }
                ],
                "tool_choice": "auto",
            },
        )
        assert resp.status_code == 200

    listing = await client.get(
        "/dashboard/usage/requests", headers=HEADERS["marketing"]
    )
    items = listing.json()["items"]
    assert items[0]["prompt_preview"] == prompt
    assert items[0]["status"] == "semantic_cache_hit"
    assert items[0]["usage_source"] == "semantic_cache"


async def test_semantic_cache_runs_for_web_search_category(client, mock_providers):
    prompt = "Busca en internet el precio actual del litio"
    for _ in range(2):
        resp = await client.post(
            "/v1/chat/completions",
            headers=HEADERS["marketing"],
            json={
                "model": "auto",
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        assert resp.status_code == 200

    listing = await client.get(
        "/dashboard/usage/requests", headers=HEADERS["marketing"]
    )
    items = listing.json()["items"]
    assert items[0]["category"] == "web_search"
    assert items[0]["required_capabilities"] == ["text", "web_search"]
    assert items[0]["status"] == "semantic_cache_hit"
    assert items[0]["usage_source"] == "semantic_cache"


async def test_semantic_cache_normalizes_greetings_and_accents(client, mock_providers):
    first = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={
            "model": "auto",
            "messages": [
                {"role": "user", "content": "*   Hola, cómo funciona un motor?"}
            ],
        },
    )
    assert first.status_code == 200

    second = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={
            "model": "auto",
            "messages": [{"role": "user", "content": "Como funciona un motor?"}],
        },
    )
    assert second.status_code == 200

    listing = await client.get(
        "/dashboard/usage/requests", headers=HEADERS["marketing"]
    )
    items = listing.json()["items"]
    assert items[0]["prompt_preview"] == "Como funciona un motor?"
    assert items[0]["status"] == "semantic_cache_hit"
    assert items[0]["usage_source"] == "semantic_cache"


@respx.mock
async def test_stream_semantic_cache_stores_choice_text_chunks(client):
    prompt = "Hola, como funciona un motor?"
    route = respx.post(TABBY_URL).mock(
        return_value=httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            stream=_Stream(
                [
                    _sse(
                        {
                            "id": "chunk_1",
                            "object": "chat.completion.chunk",
                            "created": 1,
                            "choices": [
                                {
                                    "index": 0,
                                    "text": "Un motor convierte energia en movimiento.",
                                    "finish_reason": None,
                                }
                            ],
                        }
                    ),
                    _sse(
                        {
                            "id": "chunk_1",
                            "object": "chat.completion.chunk",
                            "created": 1,
                            "choices": [
                                {
                                    "index": 0,
                                    "delta": {},
                                    "finish_reason": "stop",
                                }
                            ],
                            "usage": {
                                "prompt_tokens": 10,
                                "completion_tokens": 7,
                                "total_tokens": 17,
                            },
                        }
                    ),
                    b"data: [DONE]\n\n",
                ]
            ),
        )
    )

    for _ in range(2):
        resp = await client.post(
            "/v1/chat/completions",
            headers=HEADERS["marketing"],
            json={
                "model": "auto",
                "messages": [{"role": "user", "content": prompt}],
                "stream": True,
                "tools": [],
                "tool_choice": "auto",
            },
        )
        assert resp.status_code == 200

    assert route.call_count == 1
    listing = await client.get(
        "/dashboard/usage/requests", headers=HEADERS["marketing"]
    )
    items = listing.json()["items"]
    assert items[0]["status"] == "semantic_cache_hit"
    assert items[0]["usage_source"] == "semantic_cache"
    assert "Un motor convierte" in resp.text


async def test_auto_completion_uses_global_routing_config(client, mock_providers):
    config = await client.put(
        "/dashboard/routing-config/global/misc/low",
        headers=HEADERS["admin"],
        json={
            "provider": "fireworks",
            "model": "accounts/fireworks/models/glm-5p1",
            "enabled": True,
        },
    )
    assert config.status_code == 200

    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={"model": "auto", "messages": [{"role": "user", "content": "hola"}]},
    )
    assert resp.status_code == 200

    listing = await client.get(
        "/dashboard/usage/requests", headers=HEADERS["marketing"]
    )
    row = listing.json()["items"][0]
    assert row["selected_provider"] == "fireworks"
    assert row["selected_model"] == "accounts/fireworks/models/glm-5p1"
    assert row["routing_source"] == "admin_config"
    assert row["routing_config_id"] == config.json()["id"]


@respx.mock
async def test_real_passthrough_with_respx(client):
    # Real path (mock_providers disabled): respx intercepts the outbound call.
    route = respx.post("http://127.0.0.1:5000/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "chatcmpl_x",
                "object": "chat.completion",
                "created": 1,
                "model": "gemma-4-12B-it-exl3",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "hi"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 5,
                    "total_tokens": 15,
                },
            },
        )
    )
    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={"model": "auto", "messages": [{"role": "user", "content": "hola"}]},
    )
    assert resp.status_code == 200
    assert route.called
    # Response model must be the proxy provider/model id, not the raw provider model.
    assert resp.json()["model"] != "gemma-4-12B-it-exl3"
    assert "/" in resp.json()["model"]


@respx.mock
async def test_provider_http_error_is_forwarded_as_openai_error(client):
    provider_error = {
        "error": {
            "message": "No auth credentials found",
            "type": "invalid_request_error",
            "param": None,
            "code": "invalid_api_key",
        }
    }
    respx.post("http://127.0.0.1:5000/v1/chat/completions").mock(
        return_value=httpx.Response(401, json=provider_error)
    )

    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={"model": "auto", "messages": [{"role": "user", "content": "hola"}]},
    )

    assert resp.status_code == 401
    assert resp.json() == provider_error


@respx.mock
async def test_estimated_usage_fallback_when_provider_omits_usage(client):
    # §10.3: if the upstream provider returns no `usage` object, the proxy must
    # fall back to its own token estimates and mark usage_source = "estimated".
    respx.post("http://127.0.0.1:5000/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "chatcmpl_no_usage",
                "object": "chat.completion",
                "created": 1,
                "model": "gemma-4-12B-it-exl3",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "hi"},
                        "finish_reason": "stop",
                    }
                ],
                # NOTE: no "usage" key on purpose.
            },
        )
    )
    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={"model": "auto", "messages": [{"role": "user", "content": "hola"}]},
    )
    assert resp.status_code == 200

    listing = await client.get(
        "/dashboard/usage/requests", headers=HEADERS["marketing"]
    )
    row = listing.json()["items"][0]
    assert row["usage_source"] == "estimated"
    # Actual tokens fall back to the pre-call estimates.
    assert row["actual_prompt_tokens"] == row["estimated_prompt_tokens"]
    assert row["actual_output_tokens"] == row["estimated_output_tokens"]
    assert row["actual_model_cost"] is not None


async def test_budget_block_returns_429(client, mock_providers):
    # Admin lowers marketing budget to a tiny value → next request is blocked.
    await client.post(
        "/dashboard/budgets/equipo-marketing",
        headers=HEADERS["admin"],
        json={"budget": 0.00001, "warning_threshold": 0.8},
    )
    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["marketing"],
        json={"model": "auto", "messages": [{"role": "user", "content": "hola"}]},
    )
    assert resp.status_code == 429
    body = resp.json()
    assert body["error"]["code"] == "budget_exceeded"
    assert body["error"]["type"] == "insufficient_quota"

    # A blocked audit row exists.
    listing = await client.get(
        "/dashboard/usage/requests?status=blocked", headers=HEADERS["admin"]
    )
    assert any(i["status"] == "blocked" for i in listing.json()["items"])


async def test_degradation_end_to_end(client, mock_providers, session):
    # Seed producto into the warning band (spend 0.85 of a 1.0 budget) so a
    # high-complexity request degrades (baseline cost still fits under budget).
    from datetime import datetime, timezone
    from decimal import Decimal

    from app.models import AuditRecord, Budget

    session.add(Budget(consumer="equipo-producto", budget=Decimal("1.0")))
    session.add(
        AuditRecord(
            timestamp_started=datetime.now(tz=timezone.utc),
            api_key_id="key_producto",
            api_key_prefix="finops_key_...",
            consumer="equipo-producto",
            role="consumer",
            requested_model="auto",
            budget_charge=Decimal("0.85"),
            status="completed",
            budget_action="allow",
        )
    )
    await session.commit()

    # High-complexity code_generation request: code fence + many prior messages.
    prior = [
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i}"}
        for i in range(14)
    ]
    code = "```python\n" + "\n".join(f"x{i} = {i}" for i in range(60)) + "\n```"
    messages = prior + [{"role": "user", "content": f"Refactor this code:\n{code}"}]

    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["producto"],
        json={"model": "auto", "messages": messages},
    )
    assert resp.status_code == 200

    listing = await client.get(
        "/dashboard/usage/requests?consumer=equipo-producto&budget_action=degraded",
        headers=HEADERS["admin"],
    )
    items = listing.json()["items"]
    assert len(items) >= 1
    row = items[0]
    assert row["status"] == "degraded"
    assert row["baseline_model"] is not None
    assert row["estimated_savings"] is not None
    assert row["estimated_savings_ratio"] >= 0.25


async def test_degradation_uses_configured_lower_tier_route(
    client, mock_providers, session
):
    from datetime import datetime, timezone
    from decimal import Decimal

    from app.models import AuditRecord, Budget

    baseline_config = await client.put(
        "/dashboard/routing-config/global/code_generation/medium",
        headers=HEADERS["admin"],
        json={
            "provider": "openrouter",
            "model": "anthropic/claude-sonnet-5",
            "enabled": True,
        },
    )
    assert baseline_config.status_code == 200
    lower_config = await client.put(
        "/dashboard/routing-config/global/code_generation/low",
        headers=HEADERS["admin"],
        json={
            "provider": "fireworks",
            "model": "accounts/fireworks/models/glm-5p1",
            "enabled": True,
        },
    )
    assert lower_config.status_code == 200

    session.add(Budget(consumer="equipo-producto", budget=Decimal("1.0")))
    session.add(
        AuditRecord(
            timestamp_started=datetime.now(tz=timezone.utc),
            api_key_id="key_producto",
            api_key_prefix="finops_key_...",
            consumer="equipo-producto",
            role="consumer",
            requested_model="auto",
            budget_charge=Decimal("0.85"),
            status="completed",
            budget_action="allow",
        )
    )
    await session.commit()

    messages = [
        {
            "role": "user",
            "content": "Refactor this code:\n```python\n"
            + ("x = 1\n" * 2000)
            + "\n```",
        }
    ]

    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["producto"],
        json={"model": "auto", "messages": messages},
    )
    assert resp.status_code == 200

    listing = await client.get(
        "/dashboard/usage/requests?consumer=equipo-producto&budget_action=degraded",
        headers=HEADERS["admin"],
    )
    row = listing.json()["items"][0]
    assert row["baseline_provider"] == "openrouter"
    assert row["baseline_model"] == "anthropic/claude-sonnet-5"
    assert row["selected_provider"] == "fireworks"
    assert row["selected_model"] == "accounts/fireworks/models/glm-5p1"
