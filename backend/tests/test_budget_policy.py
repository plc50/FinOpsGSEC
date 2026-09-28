"""Step 6/7 — model cost + budget warn/degrade/block + savings (§10)."""
from app.catalog import get_catalog
from app.services import budget, cost


def test_model_cost_formula():
    # 100 prompt, 700 output at 3.0 / 15.0 per 1M
    c = cost.model_cost(100, 700, 3.0, 15.0)
    assert abs(c - (100 / 1e6 * 3.0 + 700 / 1e6 * 15.0)) < 1e-12


def _baseline(category, tier):
    return get_catalog().model_for_route(category, tier)


def test_allow_when_spend_low():
    cat = get_catalog()
    decision = budget.evaluate(
        cat,
        baseline=_baseline("misc", "low"),
        required_capabilities=["text"],
        estimated_prompt_tokens=100,
        estimated_output_tokens=300,
        current_spend=0.0,
        budget_limit=10.0,
    )
    assert decision.action == "allow"


def test_block_when_over_budget():
    cat = get_catalog()
    decision = budget.evaluate(
        cat,
        baseline=_baseline("misc", "low"),
        required_capabilities=["text"],
        estimated_prompt_tokens=100,
        estimated_output_tokens=300,
        current_spend=10.0,
        budget_limit=10.0,
    )
    assert decision.action == "blocked"


def test_degrade_in_warning_band_is_bounded_to_one_tier():
    # R1: degradation is bounded to exactly ONE tier (high -> medium), never
    # skipping straight to low (BACKEND_CONTEXT §5.1 "acotada al salto de un tier").
    cat = get_catalog()
    decision = budget.evaluate(
        cat,
        baseline=_baseline("qa_internal", "high"),
        required_capabilities=["text"],
        estimated_prompt_tokens=100,
        estimated_output_tokens=700,
        current_spend=8.5,
        budget_limit=10.0,
    )
    assert decision.action == "degraded"
    assert decision.estimated_savings_ratio >= 0.25
    assert decision.estimated_savings > 0
    assert decision.baseline_model.tier == "high"
    assert decision.selected_model.tier == "medium"  # exactly one tier down


def test_degrade_medium_baseline_goes_to_low():
    # A medium baseline degrades one tier to low (medium -> low).
    cat = get_catalog()
    decision = budget.evaluate(
        cat,
        baseline=_baseline("code_generation", "medium"),
        required_capabilities=["text"],
        estimated_prompt_tokens=100,
        estimated_output_tokens=700,
        current_spend=8.5,
        budget_limit=10.0,
    )
    assert decision.action == "degraded"
    assert decision.baseline_model.tier == "medium"
    assert decision.selected_model.tier == "low"


def test_warn_only_when_no_cheaper_candidate():
    cat = get_catalog()
    decision = budget.evaluate(
        cat,
        baseline=_baseline("misc", "low"),  # already cheapest tier
        required_capabilities=["text"],
        estimated_prompt_tokens=100,
        estimated_output_tokens=300,
        current_spend=8.5,
        budget_limit=10.0,
    )
    assert decision.action == "warn_only"
    assert decision.estimated_savings is None


def test_savings_only_populated_on_degrade():
    cat = get_catalog()
    allow = budget.evaluate(
        cat,
        baseline=_baseline("qa_internal", "high"),
        required_capabilities=["text"],
        estimated_prompt_tokens=100,
        estimated_output_tokens=700,
        current_spend=0.0,
        budget_limit=10.0,
    )
    assert allow.action == "allow"
    assert allow.estimated_savings is None
    assert allow.baseline_model is None
