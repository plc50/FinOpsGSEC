<div align="center">

# FinOpsGSEC · AI FinOps Proxy

**An OpenAI-compatible proxy that keeps every AI request under budget: it sends each call to the cheapest model that can do the job and warns, degrades or blocks before a team overspends.**

Teams call AI models from several providers and nobody knows who spends what, or whether it was worth it. This proxy answers that on every request.

![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white) ![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?logo=postgresql&logoColor=white) ![React](https://img.shields.io/badge/React-TypeScript-61DAFB?logo=react&logoColor=black) ![OpenAI compatible](https://img.shields.io/badge/API-OpenAI_compatible-412991) ![License: MIT](https://img.shields.io/badge/license-MIT-green)

<sub>Built in two days for the <b>AI FinOps challenge</b> of the <b>Mercedes-Benz</b> hackathon · July 2026</sub>

<br>

![Every AI request is a financial decision: the application calls FinOpsGSEC, which picks the best provider and model](docs/images/hero.png)

</div>

---

## What it does

Point any OpenAI client at the proxy instead of the provider. Nothing else changes for the team that calls it.

| | On every request | Why it matters |
|---|---|---|
| 🧭 | **Routes** `model=auto` by task category, complexity and required capabilities | Easy prompts stop paying premium-model prices |
| 💾 | **Reuses** equivalent prompts through a pgvector semantic cache | The same question is not paid twice |
| 🧾 | **Records** the exact tokens and cost, per team | Answers *who* spends and *what* each call costs |
| 🚦 | **Enforces** per-team budgets: warn and degrade from 80 %, block a request that would exceed it | Overspending is stopped before the invoice, not after |
| 📈 | **Forecasts** spend and raises alerts | Answers *when* to intervene |
| 🔐 | **Keeps provider keys inside the proxy** | Teams never see or send a provider credential |

<div align="center">

![The FinOps console overview: spend, budget used, projected spend, degraded and blocked requests, and the comparison between teams](docs/images/dashboard-overview.png)

<sub>The operations console, here with its built-in sample data (`VITE_USE_MOCKS=true`).</sub>

</div>

---

## How it decides

Every `model="auto"` request goes through the same pipeline:

```mermaid
flowchart TD
  A["Team app · any OpenAI client"] -->|"POST /v1/chat/completions"| B["Auth: team key + role"]
  B --> C["Classify: category · complexity · capabilities"]
  C --> D["Route: cheapest compatible model"]
  D --> E{"Budget policy"}
  E -->|"under 80 %"| F["Semantic cache"]
  E -->|"80 – 100 %"| G["Degrade one tier"]
  G --> F
  E -->|"would exceed budget"| X["429 budget_exceeded"]
  F -->|"miss"| P["OpenRouter · Fireworks · TabbyAPI"]
  F -->|"hit"| R["Audit record: tokens · cost · savings"]
  P --> R
```

Two explicit cost-saving rules, both recorded on every audit row:

1. **Cheapest compatible tier.** Low-complexity tasks go to the cheapest model that still has the capabilities the request needs (tool calling, structured output, web search, vision). If none fits, the proxy answers `400 no_compatible_model` instead of guessing.
2. **Degrade by exactly one tier, only when it pays off.** Above 80 % of the budget, the proxy drops one tier within the same category, and only if that saves at least 25 %. Otherwise it keeps the baseline and only warns.

The full criteria and the cost/quality trade-off are [below](#cost-saving-decision-criteria).

<div align="center">

![The Requests page: every intercepted call with its team, category, tier, provider, model, cost and estimated savings](docs/images/dashboard-requests.png)

</div>

---

## Run it

You need Docker, [uv](https://docs.astral.sh/uv/), Node 20+ with pnpm, [go-task](https://taskfile.dev) (or `make`) and `jq`.

```bash
cp backend/.env.example backend/.env    # add your OpenRouter, Fireworks and TabbyAPI keys
MOCK_PROVIDERS=true go-task demo-up     # or: make demo-up · drop MOCK_PROVIDERS to call real providers
```

That one target starts Postgres, applies the migrations, seeds a week of multi-team traffic and starts the proxy (`:8000`), the console (`:5173`) and two OpenWebUI instances. With `MOCK_PROVIDERS=true`, routing, budgets, cache and audit are real; only the provider answers are simulated.

| Open | What |
|---|---|
| http://localhost:5173 | Console. Sign in with `finops_key_admin` (or a team key below) |
| http://localhost:5173/pitch | The 5-minute product presentation, built into the app |
| http://localhost:8000/docs | OpenAPI docs of the proxy |

| Demo key | Team | Role |
|---|---|---|
| `finops_key_marketing` | equipo-marketing | consumer |
| `finops_key_producto` | equipo-producto | consumer |
| `finops_key_atencion` | equipo-atencion-cliente | consumer |
| `finops_key_admin` | admin | admin (sees everything) |

```bash
curl localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer finops_key_marketing" \
  -H "Content-Type: application/json" \
  -d '{"model": "auto", "messages": [{"role": "user", "content": "Three subject lines for a launch email"}]}'
```

`go-task verify` re-proves every acceptance criterion against the running stack, and `go-task demo-down` stops it. To try only the console, run `cd frontend && VITE_USE_MOCKS=true pnpm dev`.

---

## Cost-saving decision criteria

Pipeline: `category → complexity tier → configured provider model → capability filter → budget policy → selected provider + model`.

**Criterion 1: route each task to the cheapest *compatible* tier for its complexity.**
A request is classified into a category (`qa_internal`, `web_search`, `code_generation`, `misc`) and a complexity tier (`low`, `medium`, `high`) from prompt length, category, conversation depth and consumer. Low-complexity `misc` and `qa` tasks land on the cheapest compatible model, while high-complexity `code_generation` and `qa_internal` keep a high-quality tier. A capability filter guarantees that the chosen model can still do the job; if nothing fits, the answer is `no_compatible_model` (400).

**Criterion 2: degrade by exactly one tier, only under budget pressure *and* with material savings.**
When `current_spend / budget ≥ 0.80`, the proxy looks for the model one tier below the baseline in the same category that still meets the required capabilities, and degrades only if `estimated_savings_ratio ≥ 25 %`. It never skips more than one tier: if that model does not exist, is not compatible or saves too little, it falls back to `warn_only`. If the request itself would break the budget, it is blocked with `429 budget_exceeded`.

Constants: `WARNING_THRESHOLD = 0.80`, `MIN_DEGRADATION_SAVINGS = 0.25`, `EXPENSIVE_REQUEST_THRESHOLD = $0.01`, `COST_SPIKE_MULTIPLIER = 3.0`.

**Cost/quality trade-off.** Degradation drops at most one tier and never leaves the task category or drops a required capability, so the quality loss is bounded and the task can always still be done. Every degradation stores `baseline_model`, `baseline_model_cost`, `estimated_savings` and `estimated_savings_ratio`, and the console adds them up as `total_savings`.

## Security

- **Provider keys never leave the proxy.** Teams authenticate with an internal FinOps key; provider credentials live in server config and are injected per request.
- **Scope isolation is enforced server-side.** A team key reads only its own data (`403 forbidden_scope` otherwise). Only `admin` sees every team or changes budgets.
- The admin session lives in memory or `sessionStorage`, never `localStorage`; the presentation's team key lives in memory only.

---

## Architecture

![The proxy control plane: classification, routing policy, budget policy, semantic cache and audit between the client and OpenRouter, Fireworks and TabbyAPI](docs/images/architecture.png)

Three layers: **proxy** (interception, routing, control), **storage** (audit records and hourly aggregates) and **reporting** (console API, forecast, alerts). Providers are OpenAI-compatible endpoints declared in `backend/config/providers.yaml`; models, prices and capabilities live in `backend/config/provider_models.yaml`, so adding a provider is configuration, not code.

```
.
├── backend/              FastAPI proxy + Postgres (see backend/README.md)
├── frontend/             React console and the built-in presentation (see frontend/README.md)
├── scripts/verify.sh     end-to-end acceptance smoke test
├── material/             the challenge statement and starter kit from the organizers
├── Taskfile.yml          demo orchestration (Makefile = same commands without go-task)
└── docker-compose.yml    local Postgres with pgvector
```

## Documentation

| Document | What it covers |
|---|---|
| [docs/DEMO.md](docs/DEMO.md) | The live demo step by step, the presentation and the OpenWebUI setup |
| [VERIFICATION.md](VERIFICATION.md) | Each acceptance criterion with its evidence |
| [API_CONTRACT.md](API_CONTRACT.md) | The contract between backend and console |
| [BACKEND_CONTEXT.md](BACKEND_CONTEXT.md) · [FRONTEND_CONTEXT.md](FRONTEND_CONTEXT.md) | Functional specs of each side |
| [COMPLIANCE.md](COMPLIANCE.md) | How the build maps to the challenge rubric |
| [material/CHALLENGE.es.md](material/CHALLENGE.es.md) | The original challenge (Spanish) |

## Team

Built as a team by [plc50](https://github.com/plc50), [r0zh](https://github.com/r0zh) and [juandiego-bmu](https://github.com/juandiego-bmu).

## License

Released under the [MIT License](LICENSE).
