"""Streaming provider error handling (BACKEND_CONTEXT §11.3).

Rules under test:
- The proxy never changes provider/model during a streaming provider failure.
- If a provider fails before or after chunks, the audit records
  provider_stream_error without backend_fallback_used.
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx
import pytest
import respx
from sqlalchemy import select

from app.models import AuditRecord

from .conftest import HEADERS

pytestmark = pytest.mark.asyncio

PRIMARY_URL = "https://openrouter.ai/api/v1/chat/completions"


def _sse_bytes(content: str, *, final: bool = False) -> bytes:
    if final:
        chunk = {
            "id": "c",
            "object": "chat.completion.chunk",
            "created": 1,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7},
        }
    else:
        chunk = {
            "id": "c",
            "object": "chat.completion.chunk",
            "created": 1,
            "choices": [
                {"index": 0, "delta": {"content": content}, "finish_reason": None}
            ],
        }
    return f"data: {json.dumps(chunk)}\n\n".encode()


class _Stream(httpx.AsyncByteStream):
    """Yields byte chunks, then either ends cleanly or raises (mid-stream drop)."""

    def __init__(self, chunks: list[bytes], exc: Exception | None = None):
        self._chunks = chunks
        self._exc = exc

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for chunk in self._chunks:
            yield chunk
        if self._exc is not None:
            raise self._exc

    async def aclose(self) -> None:
        return None


async def _consume_stream(client) -> list[dict]:
    chunks: list[dict] = []
    async with client.stream(
        "POST",
        "/v1/chat/completions",
        headers=HEADERS["admin"],
        json={
            "model": "openrouter/anthropic/claude-sonnet-5",
            "messages": [{"role": "user", "content": "hola"}],
            "stream": True,
        },
    ) as resp:
        assert resp.status_code == 200
        async for line in resp.aiter_lines():
            if line.startswith("data:"):
                payload = line[len("data:"):].strip()
                if payload and payload != "[DONE]":
                    chunks.append(json.loads(payload))
    return chunks


@respx.mock
async def test_stream_provider_http_error_before_first_chunk_returns_json_error(
    client, session
):
    provider_error = {
        "error": {
            "message": "No auth credentials found",
            "type": "invalid_request_error",
            "param": None,
            "code": "invalid_api_key",
        }
    }
    primary = respx.post(PRIMARY_URL).mock(
        return_value=httpx.Response(401, json=provider_error)
    )

    resp = await client.post(
        "/v1/chat/completions",
        headers=HEADERS["admin"],
        json={
            "model": "openrouter/anthropic/claude-sonnet-5",
            "messages": [{"role": "user", "content": "hola"}],
            "stream": True,
        },
    )

    assert primary.called
    assert resp.status_code == 401
    assert resp.json() == provider_error

    row = (
        await session.execute(
            select(AuditRecord).order_by(AuditRecord.timestamp_started.desc())
        )
    ).scalars().first()
    assert row is not None
    assert row.stream is True
    assert row.status == "provider_stream_error"
    assert row.backend_fallback_used is False
    assert row.selected_provider == "openrouter"
    assert row.selected_model == "anthropic/claude-sonnet-5"


@respx.mock
async def test_no_fallback_after_chunks_streamed(client, session):
    # Primary streams ONE real chunk, then the connection drops.
    primary = respx.post(PRIMARY_URL).mock(
        return_value=httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            stream=_Stream([_sse_bytes("partial ")], httpx.ReadError("stream dropped")),
        )
    )
    chunks = await _consume_stream(client)

    # At least the first partial chunk reached the client...
    text = "".join(
        c["choices"][0]["delta"].get("content", "")
        for c in chunks
        if c.get("choices")
    )
    assert "partial" in text
    assert primary.called

    row = (
        await session.execute(
            select(AuditRecord).order_by(AuditRecord.timestamp_started.desc())
        )
    ).scalars().first()
    assert row is not None
    assert row.stream is True
    assert row.status == "provider_stream_error"
    assert row.backend_fallback_used is False
    assert row.selected_provider == "openrouter"
    assert row.selected_model == "anthropic/claude-sonnet-5"
