# VERIFICATION — AI FinOps Proxy

End-to-end verification snapshot for v0.3.0 after the provider/model routing
configuration work.

- Backend suite: **86 pytest PASS**.
- Frontend suite: **25 vitest PASS**.
- Frontend production build: **PASS**.
- Health: `GET /health` → `version="0.3.0"`.

## Acceptance Criteria

### AC1 — Interception + intelligent routing across providers

`POST /v1/chat/completions` with `model=auto` classifies category, complexity
tier and required capabilities, then selects a configured/catalog provider model.
Audit rows expose:

```text
selected_provider
selected_model
routing_source
routing_config_id
```

Configured providers are `openrouter`, `fireworks` and `tabbyapi`. The admin
routing API can change `consumer/global -> category -> tier -> provider/model`
without code changes.

### AC2 — Token usage + cost per request

Audit rows include provider or estimated usage:

```text
actual_prompt_tokens
actual_output_tokens
actual_model_cost
backend_cost
budget_charge
usage_source
```

Costs use the manually maintained provider/model catalog prices.

### AC3 — Multiple consumers with independent spend

Seed/config covers:

```text
equipo-marketing
equipo-producto
equipo-atencion-cliente
admin
```

Dashboard scoping and budgets remain per consumer; admin can view all.

### AC4 — Budget block / alert / degrade

Budget policy still supports:

```text
allow
warn_only
degraded
blocked
```

Blocked requests return `429 budget_exceeded` and create alerts. Warning-band
requests can degrade by one tier when savings are material.

### AC5 — Cost-saving criteria applied to real audit data

The two explicit criteria are:

1. Route to the configured/catalog provider model for the detected category and
   complexity tier, after capability validation.
2. Under warning-band budget pressure, degrade by exactly one tier only when the
   lower route is compatible and `estimated_savings_ratio >= 0.25`.

Degraded audit rows include:

```text
baseline_provider
baseline_model
baseline_model_cost
estimated_savings
estimated_savings_ratio
```

### AC6 — Live demo

The stack runs locally with backend `:8000`, dashboard `:5173`, and OpenAI-
compatible clients such as OpenWebUI/opencode pointing at `/v1/chat/completions`.
`MOCK_PROVIDERS=true` keeps the walkthrough deterministic; real provider mode
uses the configured OpenAI-compatible provider endpoints.

## Current Verification Commands

```bash
cd backend && uv run pytest -q
cd frontend && npm run test
cd frontend && npm run build
```

Latest observed results:

```text
backend:  86 passed
frontend: 25 passed
build:    vite build completed
```
