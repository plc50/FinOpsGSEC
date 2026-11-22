"""Outbound provider client: real httpx pass-through + mock mode.

Real httpx pass-through is the default. When settings.mock_providers is true, a
realistic OpenAI-compatible completion (with a plausible usage object) is
returned instead of doing a network call, so the demo works without provider
network access.
"""
from __future__ import annotations

import json
import os
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx

from ..catalog import Provider, ProviderModel
from ..config import settings
from . import complexity


class ProviderError(Exception):
    """Raised when a backend call fails (mapped to provider_error, §4)."""

    def __init__(
        self,
        message: str = "Upstream provider error.",
        *,
        http_status: int = 502,
        error_type: str = "server_error",
        error_code: str = "provider_error",
        error_param: str | None = None,
    ) -> None:
        self.message = message
        self.http_status = http_status
        self.error_type = error_type
        self.error_code = error_code
        self.error_param = error_param
        super().__init__(message)


# Auth types that carry an OpenAI-style "Authorization: Bearer <key>" header.
_BEARER_AUTH_TYPES = {"bearer"}


def _client_timeout() -> httpx.Timeout:
    """Split outbound timeout: short connect, generous read.

    A short connect timeout means a dead/unreachable backend fails fast so the
    technical fallback (§9.3/§11) can take over quickly, while the longer read
    timeout gives a warm local model room to finish a longer generation without
    tripping ``provider_stream_error``.
    """
    return httpx.Timeout(
        settings.provider_read_timeout,
        connect=settings.provider_connect_timeout,
    )


def _provider_error_from_response(resp: httpx.Response) -> ProviderError:
    message = f"Upstream provider returned HTTP {resp.status_code}."
    error_type = "server_error"
    error_code = "provider_error"
    error_param: str | None = None

    try:
        body = resp.json()
    except ValueError:
        body = None

    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        error = body["error"]
        raw_message = error.get("message")
        raw_type = error.get("type")
        raw_code = error.get("code")
        raw_param = error.get("param")
        if isinstance(raw_message, str) and raw_message:
            message = raw_message
        if isinstance(raw_type, str) and raw_type:
            error_type = raw_type
        if isinstance(raw_code, str) and raw_code:
            error_code = raw_code
        if isinstance(raw_param, str):
            error_param = raw_param
    elif resp.text:
        message = resp.text[:500]

    return ProviderError(
        message,
        http_status=resp.status_code,
        error_type=error_type,
        error_code=error_code,
        error_param=error_param,
    )


def _resolve_api_key(provider: Provider) -> str | None:
    """Resolve the outbound credential for a provider from config/env only.

    Provider-agnostic: any provider may declare `api_key_env` (an env var name)
    and `auth: bearer`. Keys are read from environment/settings only — never
    from consumers, never logged.
    """
    if not provider.api_key_env:
        return None
    key = os.getenv(provider.api_key_env)
    if key:
        return key
    settings_key = provider.api_key_env.lower()
    settings_value = getattr(settings, settings_key, None)
    if isinstance(settings_value, str) and settings_value:
        return settings_value
    return None


def _auth_headers(provider: Provider) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if provider.auth in _BEARER_AUTH_TYPES:
        key = _resolve_api_key(provider)
        if key:
            headers["Authorization"] = f"Bearer {key}"
    return headers


def build_backend_payload(
    request_body: dict[str, Any], model: ProviderModel, effective_max_tokens: int
) -> dict[str, Any]:
    """Transform the incoming request into the provider request (§2.2).

    Substitutes the selected provider model, adds max_tokens, forwards the rest.
    Never modifies `messages`.
    """
    payload = dict(request_body)
    payload["model"] = model.model
    payload.setdefault("max_tokens", effective_max_tokens)
    # Do not forward proxy-only routing hint.
    payload.pop("stream", None)
    return payload


def _mock_completion(payload: dict[str, Any], model_id: str) -> dict[str, Any]:
    messages = payload.get("messages", [])
    prompt_tokens = complexity.estimate_prompt_tokens(messages)
    max_tokens = payload.get("max_tokens", 300)
    completion_tokens = max(8, min(int(max_tokens * 0.4), max_tokens))
    content = (
        "[mock] Respuesta simulada del backend de demo. "
        "Este texto sustituye la llamada real al proveedor para la demo."
    )
    return {
        "id": f"chatcmpl_mock_{int(time.time()*1000)}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model_id,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    }


async def call_backend(
    provider: Provider, payload: dict[str, Any], model_id: str
) -> dict[str, Any]:
    """Non-streaming call. Returns an OpenAI-compatible completion dict."""
    if settings.mock_providers:
        return _mock_completion(payload, model_id)

    url = f"{provider.base_url.rstrip('/')}/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=_client_timeout()) as client:
            resp = await client.post(url, json=payload, headers=_auth_headers(provider))
            if resp.is_error:
                raise _provider_error_from_response(resp)
            data = resp.json()
    except ProviderError:
        raise
    except Exception as exc:  # network / http error
        raise ProviderError(str(exc), http_status=502) from exc

    # Report the proxy-visible provider/model id to the client (§5.2).
    data["model"] = model_id
    return data


class OpenedBackendStream:
    def __init__(
        self,
        *,
        client: httpx.AsyncClient | None,
        stream_cm: Any | None,
        response: httpx.Response | None,
        model_id: str,
        mock_payload: dict[str, Any] | None = None,
    ) -> None:
        self._client = client
        self._stream_cm = stream_cm
        self._response = response
        self._model_id = model_id
        self._mock_payload = mock_payload

    async def aclose(self) -> None:
        if self._stream_cm is not None:
            await self._stream_cm.__aexit__(None, None, None)
            self._stream_cm = None
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def __aiter__(self) -> AsyncIterator[dict[str, Any]]:
        if self._mock_payload is not None:
            async for chunk in _mock_stream(self._mock_payload, self._model_id):
                yield chunk
            return

        if self._response is None:
            return

        try:
            async for line in self._response.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[len("data:") :].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                chunk["model"] = self._model_id
                yield chunk
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError(str(exc), http_status=502) from exc
        finally:
            await self.aclose()


async def open_backend_stream(
    provider: Provider, payload: dict[str, Any], model_id: str
) -> OpenedBackendStream:
    """Open a provider stream and validate its HTTP status before proxying SSE."""
    stream_payload = dict(payload)
    stream_payload["stream"] = True
    stream_payload.setdefault("stream_options", {"include_usage": True})

    if settings.mock_providers:
        return OpenedBackendStream(
            client=None,
            stream_cm=None,
            response=None,
            model_id=model_id,
            mock_payload=stream_payload,
        )

    url = f"{provider.base_url.rstrip('/')}/chat/completions"
    client = httpx.AsyncClient(timeout=_client_timeout())
    stream_cm = client.stream(
        "POST", url, json=stream_payload, headers=_auth_headers(provider)
    )
    try:
        resp = await stream_cm.__aenter__()
        if resp.is_error:
            await resp.aread()
            raise _provider_error_from_response(resp)
        return OpenedBackendStream(
            client=client,
            stream_cm=stream_cm,
            response=resp,
            model_id=model_id,
        )
    except ProviderError:
        await stream_cm.__aexit__(None, None, None)
        await client.aclose()
        raise
    except Exception as exc:
        await client.aclose()
        raise ProviderError(str(exc), http_status=502) from exc


async def stream_backend(
    provider: Provider, payload: dict[str, Any], model_id: str
) -> AsyncIterator[dict[str, Any]]:
    """Yield OpenAI-compatible streaming chunks as dicts (without the leading
    'data: ' framing). The final usage chunk is included when available."""
    opened = await open_backend_stream(provider, payload, model_id)
    async for chunk in opened:
        yield chunk


async def _mock_stream(payload: dict[str, Any], model_id: str) -> AsyncIterator[dict[str, Any]]:
    messages = payload.get("messages", [])
    prompt_tokens = complexity.estimate_prompt_tokens(messages)
    words = ["[mock]", "respuesta", "simulada", "en", "streaming", "para", "la", "demo."]
    created = int(time.time())
    cid = f"chatcmpl_mock_{int(time.time()*1000)}"
    for i, word in enumerate(words):
        yield {
            "id": cid,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model_id,
            "choices": [
                {
                    "index": 0,
                    "delta": {"content": (word + " ") if i else word + " "},
                    "finish_reason": None,
                }
            ],
        }
    yield {
        "id": cid,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model_id,
        "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": len(words),
            "total_tokens": prompt_tokens + len(words),
        },
    }
