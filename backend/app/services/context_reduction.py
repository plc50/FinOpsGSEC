"""Token reduction: smart compaction of long conversation context.

When the estimated context tokens exceed a configurable limit, the proxy keeps
system messages and the N most recent conversation messages, and replaces the
older middle of the conversation with a short summary. The summary is produced
by the cheapest text-capable model in the catalog (via the normal provider
pipeline); under MOCK_PROVIDERS (or on any provider failure) it falls back to a
naive truncated extract so the feature always works.

The reduction is recorded on the audit record (`context_reduced`,
`context_tokens_saved`) so it can be shown in the demo/dashboard.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from ..catalog import Catalog, ProviderModel
from ..config import settings
from . import complexity
from . import messages as msg

logger = logging.getLogger(__name__)

SUMMARY_PREFIX = "[Resumen de contexto previo generado por el proxy]"

SUMMARY_SYSTEM_PROMPT = (
    "You compress chat history. Summarize the following conversation in at "
    "most 6 short bullet points, keeping key facts, decisions and named "
    "entities. Answer in the conversation's language. Output only the summary."
)


@dataclass(frozen=True)
class ReductionResult:
    messages: list[dict]
    reduced: bool
    tokens_before: int
    tokens_after: int

    @property
    def tokens_saved(self) -> int:
        return max(0, self.tokens_before - self.tokens_after)


def _cheapest_text_model(catalog: Catalog) -> ProviderModel | None:
    candidates = [m for m in catalog.model_catalog.values() if "text" in m.capabilities]
    if not candidates:
        return None
    return min(
        candidates,
        key=lambda m: m.input_price_per_1m_tokens + m.output_price_per_1m_tokens,
    )


def _naive_summary(middle: list[dict]) -> str:
    """Truncated extract of the old conversation (mock/fallback path)."""
    parts: list[str] = []
    for m in middle:
        text = msg.message_text(m.get("content"))
        if text:
            parts.append(f"{m.get('role', 'user')}: {text}")
    joined = " | ".join(parts)
    limit = settings.token_reduction_summary_max_chars
    if len(joined) > limit:
        joined = joined[: limit - 3] + "..."
    return joined


async def _summarize(catalog: Catalog, middle: list[dict]) -> str:
    if settings.mock_providers:
        return _naive_summary(middle)

    from . import providers  # local import to ease respx patching in tests

    model = _cheapest_text_model(catalog)
    provider = catalog.provider(model.provider) if model else None
    if model is None or provider is None:
        return _naive_summary(middle)

    transcript = "\n".join(
        f"{m.get('role', 'user')}: {msg.message_text(m.get('content'))}"
        for m in middle
        if msg.message_text(m.get("content"))
    )
    payload = {
        "model": model.model,
        "messages": [
            {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
            {"role": "user", "content": transcript[:8000]},
        ],
        "temperature": 0,
        "max_tokens": settings.token_reduction_summary_max_tokens,
    }
    try:
        completion = await providers.call_backend(provider, payload, model.id)
        choices = completion.get("choices") or []
        message = choices[0].get("message") if choices else {}
        content = message.get("content") if isinstance(message, dict) else None
        if isinstance(content, str) and content.strip():
            return content.strip()
    except providers.ProviderError as exc:
        logger.info("Context summary model failed (%s); using naive summary.", exc.message)
    return _naive_summary(middle)


async def maybe_reduce(catalog: Catalog, messages: list[dict]) -> ReductionResult:
    """Compact old context when the conversation exceeds the token limit."""
    tokens_before = complexity.estimate_prompt_tokens(messages)
    unchanged = ReductionResult(messages, False, tokens_before, tokens_before)

    if not settings.token_reduction_enabled:
        return unchanged
    if tokens_before <= settings.token_reduction_max_context_tokens:
        return unchanged

    system_messages = [m for m in messages if m.get("role") == "system"]
    conversation = [m for m in messages if m.get("role") != "system"]
    keep_recent = max(1, settings.token_reduction_keep_recent_messages)
    if len(conversation) <= keep_recent:
        return unchanged  # nothing old enough to compact

    middle = conversation[:-keep_recent]
    recent = conversation[-keep_recent:]

    summary = await _summarize(catalog, middle)
    reduced_messages = [
        *system_messages,
        {"role": "system", "content": f"{SUMMARY_PREFIX} {summary}"},
        *recent,
    ]
    tokens_after = complexity.estimate_prompt_tokens(reduced_messages)
    if tokens_after >= tokens_before:
        return unchanged  # compaction did not help; keep the original context

    return ReductionResult(reduced_messages, True, tokens_before, tokens_after)
