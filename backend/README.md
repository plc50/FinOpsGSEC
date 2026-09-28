# AI FinOps Proxy — Backend

OpenAI-compatible proxy that intercepts LLM traffic, tracks token usage and cost
per consumer, enforces budgets (warn / degrade / block), audits every request,
aggregates hourly usage, forecasts spend, and serves a dashboard API.

Implements `BACKEND_CONTEXT.md` (§1–§17) and `API_CONTRACT.md` (v0.3.0).

- **Stack:** Python 3.11 · FastAPI + Uvicorn (async) · httpx · Pydantic v2 ·
  PostgreSQL 16 + pgvector (SQLModel/SQLAlchemy async + asyncpg) · Alembic ·
  tiktoken · uv.
- **Methodology:** TDD (pytest + pytest-asyncio + respx) against a **real**
  Postgres test DB (`finops_test`).

---

## Architecture (separation of concerns, §1.1)

```
Proxy layer      auth → category → capabilities → complexity → routing → budget
Storage layer    audit_records → usage_hourly
Reporting layer  forecast · dashboard API · alerts + recommendations
```

Provider API keys live only in the proxy; consumers never see them.

```
app/
  main.py            FastAPI app, CORS, error handlers, routers
  config.py          pydantic-settings (DATABASE_URL, MOCK_PROVIDERS, provider env keys)
  constants.py       thresholds & score tables (§8, §10, §16)
  catalog.py         loads config/*.yaml (keys, providers, provider models, budgets)
  models.py          SQLModel tables (NUMERIC costs)
  errors.py          OpenAI-compatible error contract (§4)
  auth.py            API-key auth + role/scope resolution (§3, §15)
  services/
    category.py      deterministic rules + best-effort small classifier + §6.4 decision
    capabilities.py  required capabilities (§7)
    complexity.py    tokens, complexity score, tier (§8)
    cost.py          logical / backend cost (§10.2–§10.4)
    routing.py       capability filter + baseline + degradation candidate (§7,§9)
    budget.py        allow / warn / degrade / block + savings (§10.5/§10.6)
    providers.py     httpx pass-through + MOCK_PROVIDERS mode
    semantic_cache.py  pgvector semantic cache (skips real/forced tool calling)
    pipeline.py      non-stream orchestration + audit + alerts
    stream_pipeline.py  SSE streaming pass-through (§11)
    aggregation.py   usage_hourly (date_trunc, percentile_cont) + cost_spike (§13)
    forecast.py      weighted forecast MVP (§14)
    alerts.py        alert/recommendation creation + dedup (§16)
    maintenance.py   projection_exceeded + budget_degradation recommendations
  routers/openai_api.py   GET /v1/models, POST /v1/chat/completions
  routers/dashboard.py    /dashboard/* (§15)
  seed.py            ~24h multi-provider demo data (§13)
config/              api_keys.yaml, providers.yaml, provider_models.yaml, budgets.yaml
alembic/             async migrations (initial schema)
tests/               pytest suite (100 tests)
```

---

## Quickstart

Prerequisites: `uv` and Docker.

```bash
cd backend
cp .env.example .env
# edit .env with OPENROUTER_API_KEY, FIREWORKS_API_KEY and TABBY_API_KEY

# 1. Start Postgres 16 (creates finops + finops_test databases)
make db-up            # docker compose up -d

# 2. Apply migrations
make migrate          # uv run alembic upgrade head

# 3. Seed ~24h of demo data across configured providers
make seed             # uv run python -m app.seed

# 4a. Run the API (real providers — OpenAI-compatible endpoints)
make serve            # :8000

# 4b. Or run WITHOUT any providers (live-demo safe): realistic mock completions
make serve-mock       # MOCK_PROVIDERS=true, :8000
```

Server: `http://localhost:8000` · docs at `/docs` · health at `/health`.
CORS is fully permissive so the frontend dev server (`http://localhost:5173`)
can call it directly.

### Tests

```bash
make test             # uv run pytest  (uses finops_test, real Postgres)
```

The suite must be run with a reachable Postgres (`make db-up` first). Each test
truncates all tables for isolation and validates real `NUMERIC`,
`percentile_cont(0.95)` and `date_trunc` behaviour.

---

## API keys (demo)

The bearer token value **is** the config key (`BACKEND_CONTEXT §3.2`):

| Bearer token | Consumer | Role | Explicit model? |
|---|---|---|---|
| `finops_key_marketing` | equipo-marketing | consumer | no |
| `finops_key_producto` | equipo-producto | consumer | no |
| `finops_key_atencion` | equipo-atencion-cliente | consumer | no |
| `finops_key_admin` | admin | admin | yes |

```bash
# Auto routing (mock-safe)
curl localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer finops_key_marketing" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Resume esto en una frase."}]}'

# Dashboard
curl localhost:8000/dashboard/me      -H "Authorization: Bearer finops_key_marketing"
curl localhost:8000/dashboard/summary -H "Authorization: Bearer finops_key_admin"
```

---

## Providers (multi-provider, agnostic)

Providers live in `config/providers.yaml`:

| Provider | Base URL | Auth |
|---|---|---|
| `openrouter` | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| `fireworks` | `https://api.fireworks.ai/inference/v1` | `FIREWORKS_API_KEY` |
| `tabbyapi` | `http://127.0.0.1:5000/v1` | `TABBY_API_KEY` |

Routeable exact model names, prices and capabilities live in
`config/provider_models.yaml`. `MOCK_PROVIDERS=true` returns realistic
OpenAI-compatible completions so the live demo works even when no provider is running.

---

## Routing & cost-saving decision criteria (Challenge Pilar 3)

Every `model="auto"` request flows through:

```
category (§6) → complexity tier (§8) → configured/catalog provider model
→ capability filter (§7) → budget policy (§10.5) → selected_provider + selected_model
```

**Constants (§10.5):** `WARNING_THRESHOLD = 0.80`,
`MIN_DEGRADATION_SAVINGS = 0.25`, `EXPENSIVE_REQUEST_THRESHOLD = 0.01 USD`,
`COST_SPIKE_MULTIPLIER = 3.0`.

### Criterion 1 — Route each task to the cheapest *compatible* tier for its complexity
A request is classified into a **category** (`qa_internal`, `web_search`,
`code_generation`, `misc`) and a **complexity tier** (`low`/`medium`/`high`,
from prompt length, category, conversation depth and consumer). Low-complexity
`misc`/`qa` tasks land on the cheapest compatible provider/model, while
high-complexity `code_generation`/`qa_internal` keep a high-quality tier.
Capability filtering guarantees the
model can still do the job (`tool_calling`, `structured_outputs`, `web_search`,
vision, …); if nothing fits → `no_compatible_model` (400).

### Criterion 2 — Degrade one tier only under budget pressure *and* with material savings
When `current_spend / budget_limit >= 0.80` (warning band) the proxy looks for a
cheaper compatible model **in the same category** and only degrades if
`estimated_savings_ratio >= 25%` (`MIN_DEGRADATION_SAVINGS`). Degradation never
changes the task/category and never violates required capabilities. If no
material saving exists it only warns (`warn_only`). If the request itself would
break the budget (`current_spend + estimated_budget_charge > budget_limit`) it is
**blocked** (`429 budget_exceeded`).

**Cost/quality trade-off:** tier (`low`, `medium`, `high`) is the local routing
signal for cost/quality. Degradation drops at most one tier, so the accepted
quality loss is bounded. `code_generation`/`qa_internal` `high` are the most
quality-sensitive and are only degraded under budget pressure, never by default.
On degradation the audit row records
`baseline_model`, `baseline_model_cost`, `estimated_savings` and
`estimated_savings_ratio` (null otherwise), and `total_savings` is surfaced on
`/dashboard/summary` and `/dashboard/usage/consumers` — the “applied to real
usage data” evidence the rubric asks for.

---

## Budget policy (§10.5)

```
if current_spend + estimated_budget_charge > budget_limit:      → blocked (429)
elif current_spend / budget_limit >= 0.80:
    if cheaper compatible model in same category
       and estimated_savings_ratio >= 0.25:                     → degraded
    else:                                                       → warn_only
else:                                                           → allow
```

## Forecast (§14) & alerts (§16)

- Weighted hourly rate = `0.5·(15m) + 0.3·(1h) + 0.2·(24h)`; empty windows fall
  back to the nearest larger populated window. `projected_spend = spend_so_far +
  rate · remaining_hours_in_period`; status `on_track` / `at_risk` /
  `projected_over_budget`; `budget_exhaustion_at` when rate > 0.
- Alerts: `budget_warning`, `budget_exceeded`, `request_blocked`,
  `model_degraded`, `expensive_request`, `cost_spike`, `projection_exceeded`,
  `post_stream_budget_overrun`, `provider_error`. Recurring alerts
  (`budget_warning`, `projection_exceeded`, `cost_spike`) are deduplicated per
  consumer per hour; per-request alerts are emitted once per audit record.

## Error contract (§4)

`{ "error": { "message", "type", "param", "code" } }` with the exact HTTP
statuses / codes from `API_CONTRACT §4` (`missing_api_key`, `invalid_api_key`,
`model_selection_not_allowed`, `no_compatible_model`, `budget_exceeded`,
`provider_error`, `forbidden_scope`, `validation_error`).

---

## Notable default decisions

- Demo budgets are auto-scaled by the seed so `equipo-marketing` sits ~86% of its
  budget (warning band) for the demo; base values live in `config/budgets.yaml`.
- Budget period for spend/forecast is the **calendar month**.
- The §6.3 classifier is best-effort and runs only when deterministic rules are
  not strong enough. Default internal model:
  `fireworks/accounts/fireworks/models/deepseek-v4-flash`. If the classifier
  fails or returns invalid JSON, routing falls back to `misc`; the pipeline is
  never blocked on that external call.
- The provider/model catalog is keyed by exact `(provider, model)`. Category/tier
  defaults live separately in `routing_defaults`, and the same model can be
  assigned to many routes.
- Semantic cache uses `semantic_cache_entries` (`embedding vector(384)`) when
  pgvector is available. Hits are limited by consumer, selected provider/model,
  generation parameters, latest user prompt similarity threshold (`0.95`) and
  max age (`604800s`, seven days). Prompt embeddings normalize leading markdown
  prefixes, greetings and accents. Forced or actual tool-calling requests never
  read from or write to this cache; available tools with `tool_choice: "auto"`
  can still be cached when the response is normal assistant text.
- `app` startup and the seed run `create_all` (idempotent); Alembic remains the
  source of truth for schema versioning (`alembic upgrade head`).
```
