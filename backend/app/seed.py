"""Seed several days of organic-looking demo data (BACKEND_CONTEXT §13).

Generates a realistic multi-day history in `audit_records`:

- Business-hours traffic pattern (morning/afternoon peaks, lunch dip, quiet
  nights and weekends) with a growing day-over-day trend so the forecast and
  projection charts look alive.
- Distinct consumer profiles (marketing, producto, atención al cliente) with
  their own category/tier mix, request volume and plausible ES/EN prompts.
- Realistic action mix: mostly allow, some warn_only, some degraded (with
  non-null savings), semantic cache hits, budget-blocked rows, marketing
  code_generation requests served as `misc` via category_downgrades
  (original_category preserved, category_source=policy_downgrade) and a
  couple of `rate_limited` rows.
- A few context-reduction rows (`context_reduced` + `context_tokens_saved`).
- Recent activity in the last 15 minutes so the weighted forecast has signal.

Budgets are auto-scaled from the seeded month spend so equipo-marketing lands
in its warning band (~86%) for the demo. Then usage_hourly is rebuilt and
projection alerts/recommendations are generated.

Run with:  uv run python -m app.seed
"""

from __future__ import annotations

import asyncio
import random
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import delete
from sqlmodel import SQLModel

from .catalog import get_catalog
from .db import get_engine, get_sessionmaker
from .models import Alert, AuditRecord, Budget, Recommendation, UsageHourly
from .services import aggregation, cost, maintenance, semantic_cache, timeutil

RANDOM_SEED = 42
HISTORY_DAYS = 7

# Relative traffic weight per hour of day (UTC-ish office pattern).
HOUR_WEIGHTS = [
    0.3,
    0.2,
    0.2,
    0.2,
    0.3,
    0.5,  # 00-05 quiet night
    1.0,
    2.2,
    4.5,
    6.5,
    7.0,
    6.0,  # 06-11 morning ramp + peak
    4.0,
    5.5,
    6.5,
    6.0,
    5.0,
    3.5,  # 12-17 lunch dip + afternoon peak
    2.0,
    1.2,
    0.8,
    0.6,
    0.5,
    0.4,  # 18-23 evening tail
]
WEEKEND_FACTOR = 0.25

PROMPTS = {
    "misc": [
        "Resume esta nota de prensa en tres frases para el blog corporativo.",
        "Traduce este párrafo al inglés para la newsletter de clientes.",
        "Dame 5 ideas de asunto para la campaña de email de julio.",
        "Reformula este mensaje para que suene más cercano en LinkedIn.",
        "Summarize this meeting recap for the weekly leadership update.",
        "Escribe una descripción de 50 palabras para la landing del evento.",
        "Brainstorm three taglines for the Q3 product launch.",
        "Corrige el tono de este correo para un cliente enfadado.",
    ],
    "qa_internal": [
        "¿Cuál es la política interna de gastos de viaje para eventos?",
        "Según la documentación interna, ¿cómo pido acceso al CRM?",
        "¿Qué procedimiento interno aplica para una baja de cliente enterprise?",
        "Resume el runbook interno de escalado de incidencias de pago.",
        "What does our internal data retention policy say about audit logs?",
        "¿Dónde está documentado el flujo de aprobación de descuentos?",
        "Busca en la política interna el límite de compra sin aprobación.",
        "How do I open a ticket for the procurement team?",
    ],
    "web_search": [
        "Busca las últimas noticias sobre regulación de IA en la UE.",
        "¿Cuál es el precio actual de las acciones de nuestros competidores?",
        "Latest news about automotive supply chain disruptions this week.",
        "Busca en internet benchmarks recientes de conversión en e-commerce.",
        "¿Qué dicen las fuentes actuales sobre tipos de interés del BCE?",
        "Search the web for the current pricing of the main CRM vendors.",
        "Últimas noticias del sector automoción en España.",
    ],
    "code_generation": [
        "Refactoriza esta consulta SQL para aprovechar el índice compuesto.",
        "Escribe un test de integración para el endpoint de pagos en FastAPI.",
        "Fix this stack trace from the billing service:\nTypeError line 42.",
        "Genera un script de migración Alembic para añadir la columna status.",
        "Review this Python function:\n```python\ndef parse(x): return x\n```",
        "Optimiza este componente React que re-renderiza en cada tecla.",
        "Write a Dockerfile for the analytics worker with a slim base image.",
        "Explica este error de build:\nnpm ERR! cannot find module 'vite'.",
    ],
}

# Per-consumer generation profile.
PROFILES = {
    "equipo-marketing": {
        "api_key_id": "key_marketing",
        "requests_per_day": 85,
        # Marketing keeps trying code_generation, which policy downgrades to misc.
        "categories": {
            "misc": 0.52,
            "web_search": 0.28,
            "qa_internal": 0.14,
            "code_generation": 0.06,
        },
        "tiers": {"low": 0.55, "medium": 0.35, "high": 0.10},
        "tokens": (250, 2500, 120, 900),  # prompt min/max, output min/max
    },
    "equipo-producto": {
        "api_key_id": "key_producto",
        "requests_per_day": 60,
        "categories": {
            "code_generation": 0.50,
            "qa_internal": 0.25,
            "misc": 0.17,
            "web_search": 0.08,
        },
        "tiers": {"low": 0.15, "medium": 0.45, "high": 0.40},
        "tokens": (800, 9000, 400, 3500),
    },
    "equipo-atencion-cliente": {
        "api_key_id": "key_atencion",
        "requests_per_day": 110,
        "categories": {"qa_internal": 0.58, "misc": 0.38, "web_search": 0.04},
        "tiers": {"low": 0.70, "medium": 0.27, "high": 0.03},
        "tokens": (150, 1800, 80, 600),
    },
}

# Target budget usage after auto-scaling (marketing sits in the warning band).
BUDGET_USAGE_TARGETS = {
    "equipo-marketing": 0.86,
    "equipo-producto": 0.45,
    "equipo-atencion-cliente": 0.70,
}


def _weighted_choice(rng: random.Random, weights: dict[str, float]) -> str:
    return rng.choices(list(weights), weights=list(weights.values()), k=1)[0]


def _day_growth(day_offset: int) -> float:
    """Volume multiplier: oldest day ~0.65x, today ~1.30x (rising trend)."""
    if HISTORY_DAYS <= 1:
        return 1.0
    progress = 1.0 - (day_offset / (HISTORY_DAYS - 1))
    return 0.65 + 0.65 * progress


def _base_record(
    consumer: str, profile: dict, category: str, tier: str, started, rng: random.Random
) -> AuditRecord:
    p_min, p_max, o_min, o_max = profile["tokens"]
    scale = {"low": 0.6, "medium": 1.0, "high": 1.6}[tier]
    prompt_tokens = int(rng.randint(p_min, p_max) * scale)
    output_tokens = int(rng.randint(o_min, o_max) * scale)
    latency = int(rng.lognormvariate(0, 0.4) * {"low": 700, "medium": 1400, "high": 2600}[tier])
    return AuditRecord(
        timestamp_started=started,
        timestamp_completed=started + timedelta(milliseconds=latency),
        api_key_id=profile["api_key_id"],
        api_key_prefix="finops_key_...",
        consumer=consumer,
        role="consumer",
        requested_model="auto",
        category=category,
        category_source="rules" if rng.random() < 0.8 else "classifier",
        rule_confidence=round(rng.uniform(0.75, 0.99), 2),
        complexity_score=round(rng.uniform(0.15, 0.9), 3),
        complexity_tier=tier,
        required_capabilities=(["text", "web_search"] if category == "web_search" else ["text"]),
        routing_source="catalog",
        backend_fallback_used=False,
        max_tokens=output_tokens,
        max_tokens_source="client" if rng.random() < 0.5 else "proxy_default",
        estimated_prompt_tokens=prompt_tokens,
        actual_prompt_tokens=prompt_tokens,
        estimated_output_tokens=output_tokens,
        actual_output_tokens=output_tokens,
        usage_source="provider",
        routing_overhead_cost=Decimal("0"),
        latency_ms=latency,
        prompt_preview=rng.choice(PROMPTS[category])[:200],
        stream=rng.random() < 0.25,
    )


def _completed_record(
    catalog, consumer, profile, category, tier, started, rng, *, degraded: bool
) -> AuditRecord:
    rec = _base_record(consumer, profile, category, tier, started, rng)

    selected_tier = tier
    baseline = None
    if degraded:
        baseline = catalog.model_for_route(category, tier)
        lower = {"high": "medium", "medium": "low"}.get(tier)
        selected_tier = lower or tier
    model = catalog.model_for_route(category, selected_tier)

    actual_model = cost.model_cost(
        rec.actual_prompt_tokens,
        rec.actual_output_tokens,
        model.input_price_per_1m_tokens,
        model.output_price_per_1m_tokens,
    )
    b_cost = cost.backend_cost(
        rec.actual_prompt_tokens,
        rec.actual_output_tokens,
        model.input_price_per_1m_tokens,
        model.output_price_per_1m_tokens,
    )
    rec.selected_provider = model.provider
    rec.selected_model = model.model
    rec.estimated_model_cost = Decimal(str(actual_model))
    rec.actual_model_cost = Decimal(str(actual_model))
    rec.backend_cost = Decimal(str(b_cost))
    rec.budget_charge = Decimal(str(actual_model))
    rec.estimated_budget_charge = Decimal(str(actual_model))
    rec.budget_action = "allow"
    rec.status = "completed"

    if degraded and baseline is not None and baseline.id != model.id:
        baseline_cost = cost.model_cost(
            rec.actual_prompt_tokens,
            rec.actual_output_tokens,
            baseline.input_price_per_1m_tokens,
            baseline.output_price_per_1m_tokens,
        )
        if baseline_cost > actual_model:
            savings = baseline_cost - actual_model
            rec.baseline_provider = baseline.provider
            rec.baseline_model = baseline.model
            rec.baseline_model_cost = Decimal(str(baseline_cost))
            rec.estimated_savings = Decimal(str(savings))
            rec.estimated_savings_ratio = round(savings / baseline_cost, 4)
            rec.budget_action = "degraded"
            rec.status = "degraded"

    # Occasional long conversation compacted by the token reducer.
    if rec.actual_prompt_tokens > 2500 and rng.random() < 0.30:
        rec.context_reduced = True
        rec.context_tokens_saved = int(rec.actual_prompt_tokens * rng.uniform(0.8, 2.4))

    if rec.budget_action == "allow" and rng.random() < 0.04:
        rec.budget_action = "warn_only"
        rec.status = "warn_only"
    return rec


def _cache_hit_record(catalog, consumer, profile, category, tier, started, rng):
    rec = _base_record(consumer, profile, category, tier, started, rng)
    model = catalog.model_for_route(category, tier)
    rec.selected_provider = model.provider
    rec.selected_model = model.model
    rec.usage_source = "semantic_cache"
    rec.status = "semantic_cache_hit"
    rec.budget_action = "allow"
    rec.actual_model_cost = Decimal("0")
    rec.backend_cost = Decimal("0")
    rec.budget_charge = Decimal("0")
    rec.estimated_budget_charge = Decimal("0")
    rec.latency_ms = rng.randint(25, 140)
    return rec


def _apply_downgrade(
    rec: AuditRecord, original_category: str | None, rng: random.Random
) -> None:
    """Mark a record as served under a category policy downgrade."""
    if original_category is None:
        return
    rec.original_category = original_category
    rec.category_source = "policy_downgrade"
    # The prompt the user actually sent belongs to the original category.
    rec.prompt_preview = rng.choice(PROMPTS[original_category])[:200]


def _policy_block_record(
    catalog, consumer, profile, category, tier, started, rng, *, error_code: str
) -> AuditRecord:
    rec = _base_record(consumer, profile, category, tier, started, rng)
    model = catalog.model_for_route(category, tier)
    rec.selected_provider = model.provider
    rec.selected_model = model.model
    rec.usage_source = None
    rec.status = "blocked"
    rec.budget_action = "blocked"
    rec.error_code = error_code
    rec.actual_model_cost = Decimal("0")
    rec.backend_cost = Decimal("0")
    rec.budget_charge = Decimal("0")
    rec.latency_ms = rng.randint(5, 30)
    return rec


async def seed() -> None:
    rng = random.Random(RANDOM_SEED)
    catalog = get_catalog()
    engine = get_engine()

    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
        await semantic_cache.ensure_schema(conn)

    maker = get_sessionmaker()
    async with maker() as session:
        # Clean slate.
        for model in (Alert, Recommendation, UsageHourly, AuditRecord, Budget):
            await session.execute(delete(model))
        await session.commit()

        now = timeutil.now_utc()
        month = timeutil.month_start()
        month_spend: dict[str, float] = {c: 0.0 for c in PROFILES}
        counts = {"total": 0, "degraded": 0, "cached": 0, "blocked": 0}

        def _add(rec: AuditRecord) -> None:
            session.add(rec)
            counts["total"] += 1
            if rec.status == "degraded":
                counts["degraded"] += 1
            elif rec.status == "semantic_cache_hit":
                counts["cached"] += 1
            elif rec.status == "blocked":
                counts["blocked"] += 1
            if rec.budget_charge is not None and rec.timestamp_started >= month:
                month_spend[rec.consumer] += float(rec.budget_charge)

        total_hour_weight = sum(HOUR_WEIGHTS)
        for consumer, profile in PROFILES.items():
            blocked_cats = set(catalog.blocked_categories(consumer))
            for day_offset in range(HISTORY_DAYS - 1, -1, -1):
                day_start = (now - timedelta(days=day_offset)).replace(
                    hour=0, minute=0, second=0, microsecond=0
                )
                is_weekend = day_start.weekday() >= 5
                volume = profile["requests_per_day"] * _day_growth(day_offset)
                if is_weekend:
                    volume *= WEEKEND_FACTOR

                for hour, weight in enumerate(HOUR_WEIGHTS):
                    expected = volume * weight / total_hour_weight
                    n_requests = int(expected) + (1 if rng.random() < expected % 1 else 0)
                    for _ in range(n_requests):
                        started = day_start + timedelta(
                            hours=hour,
                            minutes=rng.randint(0, 59),
                            seconds=rng.randint(0, 59),
                        )
                        if started > now:
                            continue
                        category = _weighted_choice(rng, profile["categories"])
                        tier = _weighted_choice(rng, profile["tiers"])

                        if category in blocked_cats:
                            _add(
                                _policy_block_record(
                                    catalog,
                                    consumer,
                                    profile,
                                    category,
                                    tier,
                                    started,
                                    rng,
                                    error_code="blocked_category",
                                )
                            )
                            continue
                        # Soft policy: restricted category served via fallback.
                        original_category = None
                        downgrade_to = catalog.category_downgrade_for(consumer, category)
                        if downgrade_to is not None and downgrade_to != category:
                            original_category = category
                            category = downgrade_to
                        roll = rng.random()
                        if roll < 0.08:
                            rec = _cache_hit_record(
                                catalog,
                                consumer,
                                profile,
                                category,
                                tier,
                                started,
                                rng,
                            )
                            _apply_downgrade(rec, original_category, rng)
                            _add(rec)
                            continue
                        degraded = tier in ("high", "medium") and rng.random() < 0.14
                        rec = _completed_record(
                            catalog,
                            consumer,
                            profile,
                            category,
                            tier,
                            started,
                            rng,
                            degraded=degraded,
                        )
                        _apply_downgrade(rec, original_category, rng)
                        _add(rec)

            # Fresh activity in the last 15 minutes (forecast signal §14).
            for _ in range(4):
                started = now - timedelta(minutes=rng.randint(1, 14))
                category = _weighted_choice(rng, profile["categories"])
                original_category = None
                downgrade_to = catalog.category_downgrade_for(consumer, category)
                if category in blocked_cats:
                    category = "misc"
                elif downgrade_to is not None and downgrade_to != category:
                    original_category = category
                    category = downgrade_to
                rec = _completed_record(
                    catalog,
                    consumer,
                    profile,
                    category,
                    _weighted_choice(rng, profile["tiers"]),
                    started,
                    rng,
                    degraded=False,
                )
                _apply_downgrade(rec, original_category, rng)
                _add(rec)

        # A couple of budget-blocked rows (atención hits its low budget) and a
        # rate-limited burst from producto during yesterday's peak.
        atencion = PROFILES["equipo-atencion-cliente"]
        for hours_ago in (2, 27):
            _add(
                _policy_block_record(
                    catalog,
                    "equipo-atencion-cliente",
                    atencion,
                    "qa_internal",
                    "high",
                    now - timedelta(hours=hours_ago),
                    rng,
                    error_code="budget_exceeded",
                )
            )
        producto = PROFILES["equipo-producto"]
        peak = (now - timedelta(days=1)).replace(hour=10, minute=30)
        for i in range(2):
            _add(
                _policy_block_record(
                    catalog,
                    "equipo-producto",
                    producto,
                    "code_generation",
                    "medium",
                    peak + timedelta(minutes=3 * i),
                    rng,
                    error_code="rate_limited",
                )
            )
        await session.commit()

        # Budgets scaled so each consumer lands on its demo usage target.
        budgets: dict[str, float] = {}
        for consumer, target in BUDGET_USAGE_TARGETS.items():
            spend = max(month_spend.get(consumer, 0.0), 0.01)
            budgets[consumer] = round(spend / target, 2)
        budgets["admin"] = round(sum(month_spend.values()) / 0.60, 2)
        for consumer, limit in budgets.items():
            row = await session.get(Budget, consumer)
            if row is None:
                row = Budget(consumer=consumer, budget=Decimal(str(limit)))
            else:
                row.budget = Decimal(str(limit))
            row.warning_threshold = 0.8
            session.add(row)
        await session.commit()

        # Build aggregates + projection signals.
        await aggregation.rebuild_usage_hourly(session)
        await maintenance.generate_projection_signals(session)

    await engine.dispose()

    print(
        f"Seed complete: {counts['total']} requests over {HISTORY_DAYS} days "
        f"({counts['degraded']} degraded, {counts['cached']} cache hits, "
        f"{counts['blocked']} blocked)."
    )
    for consumer in PROFILES:
        print(
            f"  {consumer}: month spend ~${month_spend[consumer]:.4f}, budget ${budgets[consumer]}"
        )


if __name__ == "__main__":
    asyncio.run(seed())
