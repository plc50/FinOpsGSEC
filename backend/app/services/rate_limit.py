"""In-memory sliding-window token rate limiting per consumer.

Each consumer has a token budget over a sliding window (default: tokens per
minute). Before calling a provider, the pipeline checks whether the estimated
tokens for the request would exceed the window budget; after a completed call
the actual tokens are recorded. Per-consumer limits come from
config/budgets.yaml (`rate_limit_tokens_per_minute`) with a global default in
settings. In-memory storage is intentional (single-process demo).
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass

from ..catalog import get_catalog
from ..config import settings

# consumer -> deque of (monotonic timestamp, tokens)
_events: dict[str, deque[tuple[float, int]]] = defaultdict(deque)


@dataclass(frozen=True)
class RateLimitStatus:
    exceeded: bool
    used_tokens: int
    limit: int
    window_seconds: float


def reset() -> None:
    """Clear all windows (used by tests)."""
    _events.clear()


def limit_for(consumer: str) -> int | None:
    """Effective token limit for a consumer, or None when unlimited/disabled."""
    if not settings.rate_limit_enabled:
        return None
    per_consumer = get_catalog().rate_limit_tokens_per_minute(consumer)
    limit = (
        per_consumer if per_consumer is not None else settings.rate_limit_default_tokens_per_minute
    )
    if limit is None or limit <= 0:
        return None
    return int(limit)


def _prune(consumer: str, now: float) -> None:
    window = settings.rate_limit_window_seconds
    events = _events[consumer]
    while events and now - events[0][0] > window:
        events.popleft()


def window_usage(consumer: str) -> int:
    now = time.monotonic()
    _prune(consumer, now)
    return sum(tokens for _, tokens in _events[consumer])


def check(consumer: str, estimated_tokens: int) -> RateLimitStatus:
    """Return the rate-limit status if this request were admitted."""
    limit = limit_for(consumer)
    if limit is None:
        return RateLimitStatus(False, 0, 0, settings.rate_limit_window_seconds)
    used = window_usage(consumer)
    exceeded = used + max(0, estimated_tokens) > limit
    return RateLimitStatus(exceeded, used, limit, settings.rate_limit_window_seconds)


def record(consumer: str, tokens: int) -> None:
    """Record tokens actually consumed by a completed request."""
    if tokens <= 0 or limit_for(consumer) is None:
        return
    now = time.monotonic()
    _prune(consumer, now)
    _events[consumer].append((now, tokens))
