"""Budget policy: allow / warn / degrade / block + estimated savings.

BACKEND_CONTEXT §10.5 (policy) and §10.6 (estimated savings on degradation).
"""
from __future__ import annotations

from dataclasses import dataclass

from ..catalog import Catalog, ProviderModel
from ..constants import MIN_DEGRADATION_SAVINGS, WARNING_THRESHOLD
from . import cost, routing


@dataclass
class BudgetDecision:
    action: str  # allow | warn_only | degraded | blocked
    selected_model: ProviderModel | None
    baseline_model: ProviderModel | None = None
    baseline_model_cost: float | None = None
    estimated_model_cost: float | None = None
    estimated_savings: float | None = None
    estimated_savings_ratio: float | None = None
    estimated_budget_charge: float | None = None


def evaluate(
    catalog: Catalog,
    *,
    baseline: ProviderModel,
    required_capabilities: list[str],
    estimated_prompt_tokens: int,
    estimated_output_tokens: int,
    current_spend: float,
    budget_limit: float,
    routing_overhead_cost: float = 0.0,
    degradation_candidate: ProviderModel | None = None,
) -> BudgetDecision:
    baseline_cost = cost.model_cost(
        estimated_prompt_tokens,
        estimated_output_tokens,
        baseline.input_price_per_1m_tokens,
        baseline.output_price_per_1m_tokens,
    )
    estimated_budget_charge = baseline_cost + routing_overhead_cost

    # --- Block (§10.5) ---
    if budget_limit > 0 and current_spend + estimated_budget_charge > budget_limit:
        return BudgetDecision(
            action="blocked",
            selected_model=None,
            estimated_model_cost=baseline_cost,
            estimated_budget_charge=estimated_budget_charge,
        )

    used_ratio = current_spend / budget_limit if budget_limit > 0 else 0.0

    # --- Warning zone: try to degrade one tier (§10.5 + §10.6) ---
    if used_ratio >= WARNING_THRESHOLD:
        if degradation_candidate is None:
            candidate, savings_ratio = routing.one_tier_lower_candidate(
                catalog,
                baseline=baseline,
                required_capabilities=required_capabilities,
                estimated_prompt_tokens=estimated_prompt_tokens,
                estimated_output_tokens=estimated_output_tokens,
            )
        else:
            baseline_cost_for_ratio = baseline_cost
            candidate_cost = cost.model_cost(
                estimated_prompt_tokens,
                estimated_output_tokens,
                degradation_candidate.input_price_per_1m_tokens,
                degradation_candidate.output_price_per_1m_tokens,
            )
            candidate = degradation_candidate if candidate_cost < baseline_cost else None
            savings_ratio = (
                (baseline_cost_for_ratio - candidate_cost) / baseline_cost_for_ratio
                if candidate is not None and baseline_cost_for_ratio > 0
                else 0.0
            )
        if candidate is not None and savings_ratio >= MIN_DEGRADATION_SAVINGS:
            degraded_cost = cost.model_cost(
                estimated_prompt_tokens,
                estimated_output_tokens,
                candidate.input_price_per_1m_tokens,
                candidate.output_price_per_1m_tokens,
            )
            savings = baseline_cost - degraded_cost
            return BudgetDecision(
                action="degraded",
                selected_model=candidate,
                baseline_model=baseline,
                baseline_model_cost=baseline_cost,
                estimated_model_cost=degraded_cost,
                estimated_savings=savings,
                estimated_savings_ratio=savings_ratio,
                estimated_budget_charge=degraded_cost + routing_overhead_cost,
            )
        return BudgetDecision(
            action="warn_only",
            selected_model=baseline,
            estimated_model_cost=baseline_cost,
            estimated_budget_charge=estimated_budget_charge,
        )

    # --- Allow ---
    return BudgetDecision(
        action="allow",
        selected_model=baseline,
        estimated_model_cost=baseline_cost,
        estimated_budget_charge=estimated_budget_charge,
    )
