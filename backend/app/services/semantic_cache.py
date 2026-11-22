"""Semantic response cache backed by pgvector when available."""
from __future__ import annotations

import copy
import hashlib
import json
import logging
import math
import re
import time
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from ..config import settings
from . import messages as msg, timeutil

logger = logging.getLogger(__name__)

EMBEDDING_DIMENSIONS = 384
_CACHEABLE_CAPABILITIES = {"text", "tool_calling", "web_search"}

_SCHEMA_AVAILABLE: bool | None = None
_TOKEN_RE = re.compile(r"\w+", re.UNICODE)
_LEADING_MARKDOWN_PREFIX_RE = re.compile(r"^[\s>*#•-]+", re.UNICODE)
_LEADING_GREETING_RE = re.compile(
    r"^(?:hola|buenas|buenos\s+dias|buenas\s+tardes|buenas\s+noches|"
    r"hi|hello|hey|oye)[\s,;:!¿?¡.-]+",
    re.IGNORECASE,
)


@dataclass
class CacheHit:
    id: str
    response: dict[str, Any]
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost: float
    similarity: float


async def ensure_schema(conn: AsyncConnection) -> bool:
    """Create pgvector cache objects when the connected Postgres supports them."""
    global _SCHEMA_AVAILABLE

    if not settings.semantic_cache_enabled or conn.dialect.name != "postgresql":
        _SCHEMA_AVAILABLE = False
        return False

    available = await conn.exec_driver_sql(
        "SELECT 1 FROM pg_available_extensions WHERE name = 'vector'"
    )
    if available.first() is None:
        logger.warning(
            "Semantic cache disabled: pgvector extension is not installed in Postgres."
        )
        _SCHEMA_AVAILABLE = False
        return False

    await conn.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")
    await conn.exec_driver_sql(
        f"""
        CREATE TABLE IF NOT EXISTS semantic_cache_entries (
            id TEXT PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL,
            last_hit_at TIMESTAMPTZ,
            hit_count INTEGER NOT NULL DEFAULT 0,
            consumer TEXT NOT NULL,
            selected_provider TEXT NOT NULL,
            selected_model TEXT NOT NULL,
            model_id TEXT NOT NULL,
            generation_fingerprint TEXT NOT NULL,
            prompt_fingerprint TEXT NOT NULL,
            prompt_text TEXT NOT NULL,
            embedding vector({EMBEDDING_DIMENSIONS}) NOT NULL,
            response JSONB NOT NULL,
            prompt_tokens INTEGER NOT NULL,
            completion_tokens INTEGER NOT NULL,
            total_tokens INTEGER NOT NULL,
            cost NUMERIC(24, 10) NOT NULL
        )
        """
    )
    await conn.exec_driver_sql(
        """
        CREATE INDEX IF NOT EXISTS ix_semantic_cache_lookup
        ON semantic_cache_entries (
            consumer,
            selected_provider,
            selected_model,
            generation_fingerprint,
            created_at
        )
        """
    )
    await conn.exec_driver_sql(
        """
        CREATE INDEX IF NOT EXISTS ix_semantic_cache_embedding
        ON semantic_cache_entries
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
        """
    )
    _SCHEMA_AVAILABLE = True
    return True


async def available(session: AsyncSession) -> bool:
    global _SCHEMA_AVAILABLE

    if not settings.semantic_cache_enabled:
        return False
    if _SCHEMA_AVAILABLE is not None:
        return _SCHEMA_AVAILABLE

    bind = session.get_bind()
    if bind is None or bind.dialect.name != "postgresql":
        _SCHEMA_AVAILABLE = False
        return False

    result = await session.execute(
        text(
            """
            SELECT
                to_regtype('vector') IS NOT NULL
                AND to_regclass('public.semantic_cache_entries') IS NOT NULL
            """
        )
    )
    _SCHEMA_AVAILABLE = bool(result.scalar_one())
    return _SCHEMA_AVAILABLE


def cacheable(plan: Any) -> bool:
    """Return whether this plan is safe to use as a semantic cache key."""
    if not settings.semantic_cache_enabled:
        return False
    if _has_actual_or_forced_tool_calling(plan):
        return False
    if any(cap not in _CACHEABLE_CAPABILITIES for cap in plan.required_capabilities):
        return False
    return bool(prompt_text(plan.messages).strip())


async def lookup(session: AsyncSession, *, consumer: str, plan: Any) -> CacheHit | None:
    if not cacheable(plan) or not await available(session):
        return None

    embedding = _vector_literal(embed_prompt(plan.messages))
    cutoff = timeutil.now_utc() - timedelta(
        seconds=settings.semantic_cache_max_age_seconds
    )
    stmt = text(
        """
        SELECT
            id,
            response::text AS response_json,
            prompt_tokens,
            completion_tokens,
            total_tokens,
            cost::text AS cost,
            1 - (embedding <=> CAST(:embedding AS vector)) AS similarity
        FROM semantic_cache_entries
        WHERE consumer = :consumer
          AND selected_provider = :selected_provider
          AND selected_model = :selected_model
          AND generation_fingerprint = :generation_fingerprint
          AND created_at >= :cutoff
          AND 1 - (embedding <=> CAST(:embedding AS vector)) >= :threshold
        ORDER BY embedding <=> CAST(:embedding AS vector), created_at DESC
        LIMIT 1
        """
    )
    row = (
        await session.execute(
            stmt,
            {
                "embedding": embedding,
                "consumer": consumer,
                "selected_provider": plan.selected.provider,
                "selected_model": plan.selected.model,
                "generation_fingerprint": generation_fingerprint(plan),
                "cutoff": cutoff,
                "threshold": settings.semantic_cache_similarity_threshold,
            },
        )
    ).mappings().first()
    if row is None:
        return None

    await session.execute(
        text(
            """
            UPDATE semantic_cache_entries
            SET hit_count = hit_count + 1, last_hit_at = :now
            WHERE id = :id
            """
        ),
        {"id": row["id"], "now": timeutil.now_utc()},
    )
    return CacheHit(
        id=row["id"],
        response=json.loads(row["response_json"]),
        prompt_tokens=int(row["prompt_tokens"]),
        completion_tokens=int(row["completion_tokens"]),
        total_tokens=int(row["total_tokens"]),
        cost=float(Decimal(row["cost"])),
        similarity=float(row["similarity"]),
    )


async def store(
    session: AsyncSession,
    *,
    consumer: str,
    plan: Any,
    completion: dict[str, Any],
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
    cost: float,
) -> None:
    if (
        not cacheable(plan)
        or not response_cacheable(completion)
        or not await available(session)
    ):
        return

    await session.execute(
        text(
            """
            INSERT INTO semantic_cache_entries (
                id,
                created_at,
                consumer,
                selected_provider,
                selected_model,
                model_id,
                generation_fingerprint,
                prompt_fingerprint,
                prompt_text,
                embedding,
                response,
                prompt_tokens,
                completion_tokens,
                total_tokens,
                cost
            )
            VALUES (
                :id,
                :created_at,
                :consumer,
                :selected_provider,
                :selected_model,
                :model_id,
                :generation_fingerprint,
                :prompt_fingerprint,
                :prompt_text,
                CAST(:embedding AS vector),
                CAST(:response AS jsonb),
                :prompt_tokens,
                :completion_tokens,
                :total_tokens,
                :cost
            )
            """
        ),
        {
            "id": str(uuid.uuid4()),
            "created_at": timeutil.now_utc(),
            "consumer": consumer,
            "selected_provider": plan.selected.provider,
            "selected_model": plan.selected.model,
            "model_id": plan.selected.id,
            "generation_fingerprint": generation_fingerprint(plan),
            "prompt_fingerprint": msg.prompt_fingerprint(plan.messages),
            "prompt_text": prompt_text(plan.messages),
            "embedding": _vector_literal(embed_prompt(plan.messages)),
            "response": json.dumps(completion, ensure_ascii=False),
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "cost": str(Decimal(str(cost))),
        },
    )


def response_for_hit(hit: CacheHit, model_id: str) -> dict[str, Any]:
    response = copy.deepcopy(hit.response)
    response["id"] = f"chatcmpl_cache_{int(time.time() * 1000)}"
    response["created"] = int(time.time())
    response["model"] = model_id
    if not _completion_text(response):
        text = chunks_text(response.get("cached_stream_chunks") or [])
        if text:
            response["choices"] = [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": text},
                    "finish_reason": "stop",
                }
            ]
    return response


def completion_from_stream(
    plan: Any,
    content: str,
    usage: dict[str, Any],
    chunks: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    cached_chunks = copy.deepcopy(chunks or [])
    content = content or chunks_text(cached_chunks)
    usage_payload = usage or {
        "prompt_tokens": plan.estimated_prompt_tokens,
        "completion_tokens": max(1, len(content) // 4) if content else 0,
        "total_tokens": plan.estimated_prompt_tokens
        + (max(1, len(content) // 4) if content else 0),
    }
    completion = {
        "id": f"chatcmpl_stream_cache_{int(time.time() * 1000)}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": plan.selected.id,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": usage_payload,
    }
    if cached_chunks:
        completion["cached_stream_chunks"] = cached_chunks
    return completion


def response_cacheable(completion: dict[str, Any]) -> bool:
    if chunks_have_tool_calls(completion.get("cached_stream_chunks") or []):
        return False
    if chunks_text(completion.get("cached_stream_chunks") or []):
        return True
    for choice in completion.get("choices", []):
        message = choice.get("message") or {}
        if message.get("tool_calls") or message.get("function_call"):
            return False
        if isinstance(message.get("content"), str) and message["content"].strip():
            return True
    return False


def chunks_have_tool_calls(chunks: list[dict[str, Any]]) -> bool:
    for chunk in chunks:
        for choice in chunk.get("choices", []):
            delta = choice.get("delta")
            if isinstance(delta, dict) and (
                delta.get("tool_calls") or delta.get("function_call")
            ):
                return True
            message = choice.get("message")
            if isinstance(message, dict) and (
                message.get("tool_calls") or message.get("function_call")
            ):
                return True
    return False


def chunks_text(chunks: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for chunk in chunks:
        for choice in chunk.get("choices", []):
            text = choice_text(choice)
            if text:
                parts.append(text)
    return "".join(parts)


def choice_text(choice: dict[str, Any]) -> str:
    delta = choice.get("delta")
    if isinstance(delta, dict) and isinstance(delta.get("content"), str):
        return delta["content"]
    if isinstance(delta, str):
        return delta

    message = choice.get("message")
    if isinstance(message, dict) and isinstance(message.get("content"), str):
        return message["content"]

    for key in ("content", "text"):
        value = choice.get(key)
        if isinstance(value, str):
            return value
    return ""


def _completion_text(completion: dict[str, Any]) -> str:
    parts: list[str] = []
    for choice in completion.get("choices", []):
        message = choice.get("message") or {}
        if isinstance(message.get("content"), str):
            parts.append(message["content"])
    return "".join(parts)


def prompt_text(messages: list[dict[str, Any]]) -> str:
    text = msg.last_user_text(messages).strip()
    return text or msg.all_text(messages).strip()


def embedding_text(messages: list[dict[str, Any]]) -> str:
    text = _strip_accents(prompt_text(messages).lower()).strip()
    normalized = _LEADING_MARKDOWN_PREFIX_RE.sub("", text).strip()
    normalized = _LEADING_GREETING_RE.sub("", normalized).strip()
    normalized = _LEADING_MARKDOWN_PREFIX_RE.sub("", normalized).strip()
    return normalized or text


def generation_fingerprint(plan: Any) -> str:
    body = plan.request_body
    payload = {
        "selected_provider": plan.selected.provider,
        "selected_model": plan.selected.model,
        "max_tokens": plan.effective_max_tokens,
        "tools": body.get("tools"),
        "tool_choice": body.get("tool_choice"),
        "response_format": body.get("response_format"),
        "temperature": body.get("temperature"),
        "top_p": body.get("top_p"),
        "stop": body.get("stop"),
        "presence_penalty": body.get("presence_penalty"),
        "frequency_penalty": body.get("frequency_penalty"),
        "seed": body.get("seed"),
    }
    normalized = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def embed_prompt(messages: list[dict[str, Any]]) -> list[float]:
    text_value = embedding_text(messages)
    tokens = _TOKEN_RE.findall(text_value)
    features = list(tokens)
    features.extend(f"{a} {b}" for a, b in zip(tokens, tokens[1:]))

    vector = [0.0] * EMBEDDING_DIMENSIONS
    for feature in features:
        digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
        bucket = int.from_bytes(digest[:4], "big") % EMBEDDING_DIMENSIONS
        sign = 1.0 if digest[4] & 1 else -1.0
        vector[bucket] += sign

    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [value / norm for value in vector]


def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(char for char in normalized if not unicodedata.combining(char))


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in values) + "]"


def _has_actual_or_forced_tool_calling(plan: Any) -> bool:
    body = plan.request_body
    tool_choice = body.get("tool_choice")

    if isinstance(tool_choice, str) and tool_choice not in ("auto", "none"):
        return True
    if isinstance(tool_choice, dict):
        choice_type = tool_choice.get("type")
        if choice_type not in (None, "auto", "none"):
            return True
        if tool_choice.get("function"):
            return True
    elif tool_choice not in (None, "auto", "none"):
        return True

    for message in plan.messages:
        if message.get("role") in ("tool", "function"):
            return True
        if message.get("tool_calls") or message.get("function_call"):
            return True
    return False
