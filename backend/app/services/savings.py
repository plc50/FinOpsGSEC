"""Savings analytics: what the proxy saved vs a "no proxy" baseline.

Aggregates per-request savings from `audit_records` into a single dashboard
payload. Two kinds of numbers, clearly separated:

Measured (deterministic, from audited data + catalog prices):
- budget_degradation: `estimated_savings` recorded when the budget policy
  degraded a request one tier (baseline model priced at decision time).
- semantic_cache: cache hits are charged $0; the avoided cost is the served
  tokens priced at the model that would have answered.
- category_downgrade: requests reclassified by policy (original_category set);
  avoided cost is the original category's route at the same tier minus what
  the fallback route actually cost.
- token_reduction: `context_tokens_saved` priced at the selected model's
  input rate.

Estimated (explicit counterfactual, labelled as such in the API):
- smart_routing: without classification+complexity routing every request
  would go to the high tier of its category; savings is that cost minus the
  baseline the router actually picked (pre-degradation, to avoid double
  counting with budget_degradation).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..catalog import Catalog, get_catalog
from ..models import AuditRecord
from . import cost, timeutil

SERVED_STATUSES = ("completed", "degraded", "warn_only", "semantic_cache_hit")

MECHANISMS: list[dict] = [
    {
        "mechanism": "smart_routing",
        "kind": "estimated",
        "label": "Smart routing",
        "description": (
            "Cost of sending every request to the high tier of its category "
            "minus the model the router actually picked."
        ),
    },
    {
        "mechanism": "semantic_cache",
        "kind": "measured",
        "label": "Semantic cache",
        "description": (
            "Cache hits are charged $0; avoided cost is the served tokens "
            "priced at the model that would have answered."
        ),
    },
    {
        "mechanism": "budget_degradation",
        "kind": "measured",
        "label": "Budget degradation",
        "description": (
            "Savings recorded when the budget policy degraded a request one "
            "tier (baseline priced at decision time)."
        ),
    },
    {
        "mechanism": "category_downgrade",
        "kind": "measured",
        "label": "Category downgrade",
        "description": (
            "Requests reclassified by policy to a cheaper category; avoided "
            "cost is the original category's route at the same tier."
        ),
    },
    {
        "mechanism": "token_reduction",
        "kind": "measured",
        "label": "Token reduction",
        "description": (
            "Context tokens not sent to the provider, priced at the selected "
            "model's input rate."
        ),
    },
]

MECHANISM_KEYS = [m["mechanism"] for m in MECHANISMS]


async def fetch_rows(
    session: AsyncSession,
    consumers: list[str],
    start: datetime,
    end: datetime,
) -> list[AuditRecord]:
    stmt = (
        select(AuditRecord)
        .where(
            AuditRecord.consumer.in_(consumers),
            AuditRecord.timestamp_started >= start,
            AuditRecord.timestamp_started <= end,
            AuditRecord.status.in_(SERVED_STATUSES),
        )
        .order_by(AuditRecord.timestamp_started.asc())
    )
    return list((await session.execute(stmt)).scalars().all())


def _tokens(record: AuditRecord) -> tuple[int, int]:
    prompt = record.actual_prompt_tokens or record.estimated_prompt_tokens or 0
    output = record.actual_output_tokens or record.estimated_output_tokens or 0
    return prompt, output


def _route_cost(
    catalog: Catalog, category: str | None, tier: str | None, prompt: int, output: int
) -> float | None:
    """Cost of the default route for category+tier at the given token volume."""
    if not category or not tier:
        return None
    model = catalog.model_for_route(category, tier)
    if model is None:
        return None
    return cost.model_cost(
        prompt, output, model.input_price_per_1m_tokens, model.output_price_per_1m_tokens
    )


def _selected_cost(catalog: Catalog, record: AuditRecord, prompt: int, output: int) -> float:
    """What the selected model costs (or would cost, for cache hits)."""
    meta = None
    if record.selected_provider and record.selected_model:
        meta = catalog.find_provider_model(record.selected_provider, record.selected_model)
    if meta is not None:
        return cost.model_cost(
            prompt, output, meta.input_price_per_1m_tokens, meta.output_price_per_1m_tokens
        )
    if record.actual_model_cost is not None:
        return float(record.actual_model_cost)
    return float(record.estimated_model_cost or 0)


def _row_savings(catalog: Catalog, record: AuditRecord) -> dict[str, float]:
    """Per-mechanism savings for one served request. Additive by design:
    each mechanism compares a different pair of points along the same
    counterfactual chain (high tier -> routed baseline -> degraded -> cached).
    """
    prompt, output = _tokens(record)
    out: dict[str, float] = dict.fromkeys(MECHANISM_KEYS, 0.0)

    selected_cost = _selected_cost(catalog, record, prompt, output)
    is_degraded = record.budget_action == "degraded"
    baseline_cost = (
        float(record.baseline_model_cost)
        if is_degraded and record.baseline_model_cost is not None
        else selected_cost
    )

    # --- semantic cache (measured): full selected-model cost avoided ---
    if record.status == "semantic_cache_hit":
        out["semantic_cache"] = selected_cost

    # --- budget degradation (measured): recorded at decision time ---
    if is_degraded and record.estimated_savings is not None:
        out["budget_degradation"] = float(record.estimated_savings)

    # --- category downgrade (measured vs original category's route) ---
    if record.original_category:
        original_cost = _route_cost(
            catalog, record.original_category, record.complexity_tier, prompt, output
        )
        if original_cost is not None:
            out["category_downgrade"] = max(0.0, original_cost - baseline_cost)
    else:
        # --- smart routing (estimated): high tier of the category vs the
        # baseline the router picked. Skipped for downgraded categories,
        # whose counterfactual is already the original category route. ---
        high_cost = _route_cost(catalog, record.category, "high", prompt, output)
        if high_cost is not None:
            out["smart_routing"] = max(0.0, high_cost - baseline_cost)

    # --- token reduction (measured): input tokens not sent ---
    if record.context_reduced and record.context_tokens_saved:
        meta = None
        if record.selected_provider and record.selected_model:
            meta = catalog.find_provider_model(
                record.selected_provider, record.selected_model
            )
        if meta is not None:
            out["token_reduction"] = (
                record.context_tokens_saved / 1_000_000
            ) * meta.input_price_per_1m_tokens

    return out


async def compute(
    session: AsyncSession,
    consumers: list[str],
    *,
    start: datetime,
    end: datetime,
) -> dict:
    catalog = get_catalog()
    rows = await fetch_rows(session, consumers, start, end)

    totals: dict[str, float] = dict.fromkeys(MECHANISM_KEYS, 0.0)
    counts: dict[str, int] = dict.fromkeys(MECHANISM_KEYS, 0)
    by_day: dict[str, dict[str, float]] = defaultdict(
        lambda: dict.fromkeys(MECHANISM_KEYS, 0.0)
    )
    by_consumer: dict[str, dict] = {}

    actual_spend = 0.0
    cache_hits = 0
    cache_tokens = 0
    cache_latency_sum = 0.0
    cache_latency_n = 0
    completed_latency_sum = 0.0
    completed_latency_n = 0
    reduced_requests = 0
    reduced_tokens = 0

    for record in rows:
        row = _row_savings(catalog, record)
        day = record.timestamp_started.strftime("%Y-%m-%d")
        charge = float(record.budget_charge or 0)
        actual_spend += charge

        entry = by_consumer.setdefault(
            record.consumer,
            {
                "consumer": record.consumer,
                "actual_spend": 0.0,
                "mechanisms": dict.fromkeys(MECHANISM_KEYS, 0.0),
            },
        )
        entry["actual_spend"] += charge

        for key, value in row.items():
            if value <= 0:
                continue
            totals[key] += value
            counts[key] += 1
            by_day[day][key] += value
            entry["mechanisms"][key] += value

        prompt, output = _tokens(record)
        if record.status == "semantic_cache_hit":
            cache_hits += 1
            cache_tokens += prompt + output
            if record.latency_ms is not None:
                cache_latency_sum += record.latency_ms
                cache_latency_n += 1
        elif record.latency_ms is not None:
            completed_latency_sum += record.latency_ms
            completed_latency_n += 1
        if record.context_reduced and record.context_tokens_saved:
            reduced_requests += 1
            reduced_tokens += record.context_tokens_saved

    total_savings = sum(totals.values())
    baseline_spend = actual_spend + total_savings
    savings_ratio = (total_savings / baseline_spend) if baseline_spend > 0 else 0.0

    # Monthly run-rate: average daily savings over the observed window x 30.
    window_days = max((end - start).total_seconds() / 86400.0, 1.0)
    projected_monthly_savings = (total_savings / window_days) * 30.0

    mechanisms = []
    for meta in MECHANISMS:
        key = meta["mechanism"]
        extra: dict = {}
        if key == "semantic_cache":
            extra = {
                "hits": cache_hits,
                "tokens_served": cache_tokens,
                "avg_hit_latency_ms": (
                    round(cache_latency_sum / cache_latency_n, 1)
                    if cache_latency_n
                    else None
                ),
                "avg_provider_latency_ms": (
                    round(completed_latency_sum / completed_latency_n, 1)
                    if completed_latency_n
                    else None
                ),
            }
        elif key == "token_reduction":
            extra = {"requests": reduced_requests, "tokens_saved": reduced_tokens}
        mechanisms.append(
            {
                **meta,
                "savings": round(totals[key], 10),
                "requests": counts[key],
                "share": round(totals[key] / total_savings, 6) if total_savings > 0 else 0.0,
                "extra": extra,
            }
        )

    series = [
        {"date": day, **{k: round(v, 10) for k, v in values.items()}}
        for day, values in sorted(by_day.items())
    ]

    consumer_items = []
    for entry in sorted(
        by_consumer.values(), key=lambda e: -sum(e["mechanisms"].values())
    ):
        mech = entry["mechanisms"]
        consumer_savings = sum(mech.values())
        consumer_baseline = entry["actual_spend"] + consumer_savings
        top = max(mech, key=lambda k: mech[k]) if consumer_savings > 0 else None
        consumer_items.append(
            {
                "consumer": entry["consumer"],
                "actual_spend": round(entry["actual_spend"], 10),
                "savings": round(consumer_savings, 10),
                "savings_ratio": (
                    round(consumer_savings / consumer_baseline, 6)
                    if consumer_baseline > 0
                    else 0.0
                ),
                "top_mechanism": top,
                "mechanisms": {k: round(v, 10) for k, v in mech.items()},
            }
        )

    return {
        "start": timeutil.format_utc_iso(start),
        "end": timeutil.format_utc_iso(end),
        "currency": "USD",
        "actual_spend": round(actual_spend, 10),
        "baseline_spend": round(baseline_spend, 10),
        "total_savings": round(total_savings, 10),
        "savings_ratio": round(savings_ratio, 6),
        "projected_monthly_savings": round(projected_monthly_savings, 10),
        "requests_analyzed": len(rows),
        "mechanisms": mechanisms,
        "series": series,
        "consumers": consumer_items,
    }
