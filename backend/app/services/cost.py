"""Cost calculations (BACKEND_CONTEXT §10.2-§10.4). Prices are per 1M tokens."""
from __future__ import annotations

_MILLION = 1_000_000


def model_cost(
    prompt_tokens: int,
    output_tokens: int,
    input_price_per_1m: float,
    output_price_per_1m: float,
) -> float:
    return (
        (prompt_tokens / _MILLION) * input_price_per_1m
        + (output_tokens / _MILLION) * output_price_per_1m
    )


def backend_cost(
    prompt_tokens: int,
    output_tokens: int,
    input_price_per_1m: float,
    output_price_per_1m: float,
) -> float:
    return model_cost(
        prompt_tokens, output_tokens, input_price_per_1m, output_price_per_1m
    )
