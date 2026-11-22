"""Complexity score, prompt-token estimation and tier (BACKEND_CONTEXT §8)."""
from __future__ import annotations

import math

from ..constants import (
    CATEGORY_SCORE,
    WEIGHT_CATEGORY,
    WEIGHT_CONSUMER,
    WEIGHT_CONTEXT,
    WEIGHT_PROMPT_LENGTH,
)
from . import messages as msg

try:  # tiktoken is optional at runtime (§8.2 fallback to chars/4)
    import tiktoken

    _ENCODING = tiktoken.get_encoding("cl100k_base")
except Exception:  # pragma: no cover - fallback path
    _ENCODING = None


def estimate_prompt_tokens(messages: list[dict]) -> int:
    """estimated_prompt_tokens with tiktoken, else ceil(chars/4) (§8.2)."""
    text = msg.all_text(messages)
    if _ENCODING is not None:
        try:
            return len(_ENCODING.encode(text))
        except Exception:  # pragma: no cover
            pass
    return math.ceil(len(text) / 4) if text else 0


def prompt_length_score(estimated_prompt_tokens: int) -> float:
    t = estimated_prompt_tokens
    if t <= 250:
        return 0.10
    if t <= 1_000:
        return 0.35
    if t <= 4_000:
        return 0.65
    if t <= 12_000:
        return 0.85
    return 1.00


def category_score(category: str) -> float:
    return CATEGORY_SCORE.get(category, 0.10)


def context_score(messages: list[dict]) -> float:
    prior = msg.prior_message_count(messages)
    if prior == 0:
        return 0.00
    if prior <= 4:
        return 0.25
    if prior <= 12:
        return 0.50
    if prior <= 30:
        return 0.80
    return 1.00


def complexity_score(
    *,
    estimated_prompt_tokens: int,
    category: str,
    messages: list[dict],
    consumer_score: float,
) -> float:
    return (
        WEIGHT_PROMPT_LENGTH * prompt_length_score(estimated_prompt_tokens)
        + WEIGHT_CATEGORY * category_score(category)
        + WEIGHT_CONTEXT * context_score(messages)
        + WEIGHT_CONSUMER * consumer_score
    )


def tier_for_score(score: float) -> str:
    if score < 0.35:
        return "low"
    if score < 0.70:
        return "medium"
    return "high"
