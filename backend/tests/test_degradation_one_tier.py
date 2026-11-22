"""R1 — degradation bounded to exactly one tier (§5.1 / §10.5).

Uses small synthetic catalogs to exercise edge cases that the real catalog's
price spread cannot reproduce: the <25% savings gate on the one-tier-lower model,
and capability filtering that must NOT cause a skip to a further tier.
"""
from app.catalog import Catalog, ProviderModel
from app.services import budget, routing


def _lm(tier, in_price, out_price, caps=("text",), category="x"):
    return ProviderModel(
        provider="demo",
        model=f"{category}-{tier}",
        display_name=f"{category}-{tier}",
        category=category,
        tier=tier,
        input_price_per_1m_tokens=in_price,
        output_price_per_1m_tokens=out_price,
        capabilities=tuple(caps),
    )


def _catalog(models):
    return Catalog(
        api_keys={},
        consumer_scores={},
        providers={},
        provider_models={(m.category, m.tier): m for m in models},
        budgets={},
    )


def test_one_tier_candidate_picks_medium_not_low():
    # high -> medium (one tier), never straight to the cheaper low.
    cat = _catalog([
        _lm("high", 10.0, 10.0),
        _lm("medium", 4.0, 4.0),
        _lm("low", 0.1, 0.1),
    ])
    cand, ratio = routing.one_tier_lower_candidate(
        cat,
        baseline=cat.model_for_route("x", "high"),
        required_capabilities=["text"],
        estimated_prompt_tokens=100,
        estimated_output_tokens=100,
    )
    assert cand.tier == "medium"
    assert abs(ratio - 0.6) < 1e-9  # (10-4)/10


def test_warn_only_when_one_tier_lower_fails_savings_gate():
    # Adjacent tiers priced within <25% -> savings gate not met -> warn_only.
    # A much cheaper low tier exists but must NOT be selected (no skip).
    cat = _catalog([
        _lm("high", 10.0, 10.0),
        _lm("medium", 9.0, 9.0),   # only 10% cheaper than high
        _lm("low", 1.0, 1.0),      # 90% cheaper, but two tiers down
    ])
    decision = budget.evaluate(
        cat,
        baseline=cat.model_for_route("x", "high"),
        required_capabilities=["text"],
        estimated_prompt_tokens=100,
        estimated_output_tokens=100,
        current_spend=8.5,
        budget_limit=10.0,
    )
    assert decision.action == "warn_only"
    assert decision.selected_model.tier == "high"  # unchanged baseline
    assert decision.estimated_savings is None


def test_capability_filter_blocks_skip_to_further_tier():
    # One-tier-lower (medium) lacks a required capability -> filtered out.
    # The compatible+cheaper low is TWO tiers down and must NOT be used -> warn_only.
    cat = _catalog([
        _lm("high", 10.0, 10.0, caps=("text", "tool_calling")),
        _lm("medium", 4.0, 4.0, caps=("text",)),               # no tool_calling
        _lm("low", 0.5, 0.5, caps=("text", "tool_calling")),   # compatible but 2 tiers
    ])
    decision = budget.evaluate(
        cat,
        baseline=cat.model_for_route("x", "high"),
        required_capabilities=["text", "tool_calling"],
        estimated_prompt_tokens=100,
        estimated_output_tokens=100,
        current_spend=8.5,
        budget_limit=10.0,
    )
    assert decision.action == "warn_only"
    assert decision.selected_model.tier == "high"


def test_no_candidate_when_baseline_is_lowest_tier():
    cat = _catalog([_lm("low", 1.0, 1.0)])
    cand, ratio = routing.one_tier_lower_candidate(
        cat,
        baseline=cat.model_for_route("x", "low"),
        required_capabilities=["text"],
        estimated_prompt_tokens=100,
        estimated_output_tokens=100,
    )
    assert cand is None
    assert ratio == 0.0
