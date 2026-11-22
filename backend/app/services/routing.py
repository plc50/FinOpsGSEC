"""Routing: provider model selection + capability filter (BACKEND_CONTEXT §7, §9)."""
from __future__ import annotations

from .. import errors
from ..catalog import Catalog, Provider, ProviderModel
from ..constants import TIER_ORDER
from . import cost


def compatible_models(
    catalog: Catalog, category: str, required_capabilities: list[str]
) -> list[ProviderModel]:
    """Models in a category that satisfy all required capabilities (§7)."""
    req = set(required_capabilities)
    out = [
        model
        for model in catalog.models_in_category(category)
        if req.issubset(set(model.capabilities))
    ]
    return sorted(out, key=lambda model: TIER_ORDER[model.tier])


def select_baseline(
    catalog: Catalog,
    *,
    category: str,
    tier: str,
    required_capabilities: list[str],
) -> ProviderModel:
    """Pick the baseline provider model for category + complexity tier (§9.1).

    Prefers the exact tier; if capability filtering removes it, prefer the
    nearest higher tier, otherwise the nearest lower tier. Raises
    no_compatible_model if nothing satisfies the capabilities.
    """
    candidates = compatible_models(catalog, category, required_capabilities)
    if not candidates:
        raise errors.no_compatible_model()

    exact = [model for model in candidates if model.tier == tier]
    if exact:
        return exact[0]

    target = TIER_ORDER[tier]
    higher = sorted(
        [model for model in candidates if TIER_ORDER[model.tier] > target],
        key=lambda model: TIER_ORDER[model.tier],
    )
    if higher:
        return higher[0]
    lower = sorted(
        [model for model in candidates if TIER_ORDER[model.tier] < target],
        key=lambda model: TIER_ORDER[model.tier],
        reverse=True,
    )
    return lower[0]


def one_tier_lower_candidate(
    catalog: Catalog,
    *,
    baseline: ProviderModel,
    required_capabilities: list[str],
    estimated_prompt_tokens: int,
    estimated_output_tokens: int,
) -> tuple[ProviderModel | None, float]:
    """Find the compatible model exactly one tier below the baseline (§10.5).

    Degradation is bounded to a single tier jump (high->medium, medium->low).
    Only the same category and capability-compatible models are considered.
    """
    baseline_cost = cost.model_cost(
        estimated_prompt_tokens,
        estimated_output_tokens,
        baseline.input_price_per_1m_tokens,
        baseline.output_price_per_1m_tokens,
    )
    if baseline_cost <= 0:
        return None, 0.0

    target_order = TIER_ORDER[baseline.tier] - 1
    if target_order < 0:
        return None, 0.0

    candidates = [
        model
        for model in compatible_models(catalog, baseline.category, required_capabilities)
        if TIER_ORDER[model.tier] == target_order
    ]
    if not candidates:
        return None, 0.0

    best = min(
        candidates,
        key=lambda model: cost.model_cost(
            estimated_prompt_tokens,
            estimated_output_tokens,
            model.input_price_per_1m_tokens,
            model.output_price_per_1m_tokens,
        ),
    )
    best_cost = cost.model_cost(
        estimated_prompt_tokens,
        estimated_output_tokens,
        best.input_price_per_1m_tokens,
        best.output_price_per_1m_tokens,
    )
    if best_cost >= baseline_cost:
        return None, 0.0

    ratio = (baseline_cost - best_cost) / baseline_cost
    return best, ratio


def provider_for(catalog: Catalog, model: ProviderModel) -> Provider:
    provider = catalog.provider(model.provider)
    if provider is None or not provider.supports_chat_completions:
        raise errors.no_compatible_model()
    return provider
