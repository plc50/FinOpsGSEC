# COMPLIANCE — AI FinOps Proxy vs `material/CHALLENGE.es.md`

> **Update (pre-demo):** since this audit, the stack moved from the two Ollama demo
> backends to **OpenRouter + Fireworks + TabbyAPI/ExLlamaV3** (all OpenAI-compatible),
> and gained: per-consumer **category policies** (soft `category_downgrades`, e.g.
> marketing code_generation served as `misc` with cheap models and audited via
> `original_category`; hard `blocked_categories` → 403 still available), **token
> reduction** for long contexts (`context_reduced` / `context_tokens_saved`),
> per-consumer **rate limiting** (429 `rate_limited`), **CSV/PDF cost reports**
> (`/dashboard/reports/costs.csv|pdf`), and a 7-day workday-patterned seed. Current
> suite: **116 pytest / 25 vitest / verify.sh 11 PASS**. See `DEMO_GUIDE.md` and
> `PRESENTACION.md`. Provider- and count-specific details below reflect the original
> audit snapshot.

Rigorous, line-by-line audit of the project against **every** acceptance gate and
rubric criterion, verified **live against the running stack in REAL provider mode**
(`MOCK_PROVIDERS=false`, both Ollama backends). Every claim below was produced by
actually running the system (`curl` / `scripts/verify.sh` / `pytest`), not assumed.

- **Backend mode during audit:** REAL (`make serve`, `MOCK_PROVIDERS=false`) on `:8000`.
- **Providers exercised:** `provider-a/llama3.2:3b` (`:11434`) **and** `provider-b/mistral:7b` (`:11435`) — both returned real text and a real `usage` object.
- **End-to-end acceptance test in real mode:** `scripts/verify.sh` → **10 passed, 0 failed** (re-run after the R1/R2/R3 changes below).
- **Backend suite:** **79 pytest PASS** (66 baseline → +1 §10.3 fallback → +10 for R1 one-tier degradation & R2 generalized auth → +2 for §11.3 streaming technical fallback).
- **Frontend suite:** **25 vitest PASS**; production build clean (700 modules).

> **Update (post-audit):** the three flagged items (R1 one-tier degradation, R2 generalized
> provider auth, R3 hybrid demo docs) have now been **implemented** per the user's decisions.
> See "Part E — Post-audit changes" at the bottom.

Status legend: **PASS** (code-verified live) · **PARTIAL** (works but has a caveat / depends on live narration) · **GAP** (missing) · **PRESENTATION** (not code-scorable; depends on the 10-min demo).

---

## Part A — Real-mode tracking evidence (the "prove it" section)

The backend was switched from mock to real (`kill` the mock uvicorn → `MOCK_PROVIDERS=false uv run uvicorn ...`). `GET /health` → `200 {"status":"ok",...}`. Completions now return **real model text**, not the `"[mock] ..."` string.

### Real completions routed across BOTH providers, BOTH consumers

| # | Consumer | Prompt kind | `logical_model` chosen | `demo_backend` (physical) | usage_source | latency |
|---|---|---|---|---|---|---|
| 1 | marketing | misc ("resume…") | `google/gemini-2.5-flash-lite…` | **provider-a/llama3.2:3b** | provider | ~2.0 s |
| 2 | marketing | code_generation (low) | `qwen/qwen3-coder-flash` | **provider-a/llama3.2:3b** | provider | ~12 s |
| 3 | producto | code_generation (medium) | `z-ai/glm-5.2` | **provider-b/mistral:7b** | provider | ~28 s |
| 4 | marketing | code_generation @ ≥80% budget | `qwen/qwen3-coder-flash` (degraded from `z-ai/glm-5.2`) | provider-a/llama3.2:3b | provider | ~11 s |

Real sample content (call 1): `"Un conejo (o zorro) pequeño ataca a un perro apuesto pero torpe."` — a genuine llama3.2 answer.

### Cost accuracy verified by hand against the catalog (Pilar 1.3)

Every audit row's cost matches `config/*.yaml` **exactly**:

- **Call 3** — `z-ai/glm-5.2` (logical $0.60/$2.20 per 1M), tokens 42/200 →
  `actual_logical_cost = 42/1e6·0.60 + 200/1e6·2.20 = $0.0004652` ✅ (row = `0.0004652`).
  Physical `provider-b/mistral:7b` ($0.24/$0.24) → `backend_cost = 242/1e6·0.24 = $0.00005808` ✅.
- **Call 2** — `qwen/qwen3-coder-flash` ($0.20/$0.60), tokens 49/200 → `$0.0001298` ✅; backend (llama $0.06) → `$0.00001494` ✅.
- **Call 1** — `gemini-2.5-flash-lite` ($0.10/$0.40), tokens 51/23 → `$0.0000143` ✅.

**Logical price vs. backend cost — the coherent story:** the *consumer is billed at the
logical-model price* (`actual_logical_cost`, what a real OpenAI/Anthropic/etc. tier would
cost), while `backend_cost` records what the *physical demo provider* actually costs. Both
are on every audit row and both are shown in the UI (`RequestDetail.tsx:63-64`). A judge
asking "how much did that call cost?" gets both numbers, reconciled.

### Before → after (admin scope, `/dashboard/summary`)

| Metric | Before | After (real traffic + verify.sh) |
|---|---|---|
| `requests_count` | 245 | 249 → 135+ marketing rows after verify |
| admin `current_spend` | $2.56113534 | $2.56179324 (+ real rows) |
| producto `current_spend` | $1.28040628 | $1.28087148 (**+$0.0004652 = exactly call 3**) |
| `total_savings` | $1.06879936 | $1.06912336 |

### Part A "watch-outs" — resolved

- **Does the category "small classifier" (§6.3) call a provider in real mode?** **No.**
  `pipeline.build_plan` calls `category_svc.decide_category(rule_result, None)` — the
  classifier arg is always `None`, so classification is 100% deterministic rules
  (`category.py:75-114`). No extra network hop, no slowdown, no error path. It degrades to
  `misc` by design (§6.4).
- **Do real Ollama responses include `usage`?** **Yes** — verified directly against both
  `:11434` and `:11435` (`{"prompt_tokens":…,"completion_tokens":…}`), so `usage_source =
  "provider"` on every real row.
- **Estimated fallback (§10.3):** if a provider ever omits `usage`, the proxy falls back to
  its pre-call token estimates and sets `usage_source = "estimated"`
  (`pipeline.py:363-373`). This is now **locked by a new test**
  (`test_estimated_usage_fallback_when_provider_omits_usage`), since Ollama never omits
  usage and the path could not otherwise be shown live.
- **Latency trade-off:** provider-a (llama3.2:3b) is snappy (2–12 s); provider-b
  (mistral:7b) is ~28 s for 200 tokens, and a full 1500-token `code_generation` default can
  take ~60–90 s. See "Final recommendation" at the bottom.

---

## Part B — Acceptance criteria (6 mandatory gates)

| Gate | Status | Evidence |
|---|---|---|
| Proxy intercepts + routes/balances intelligently across ≥2 providers, choosing best model by cost/quality | **PASS** | `openai_api.py` → `pipeline.build_plan` (category→tier→capability filter→budget). `verify.sh` AC1: 4 categories → 4 different logical models; marketing providers = `["provider-a/llama3.2:3b","provider-b/mistral:7b"]` = **2**. |
| Token usage + cost recorded per request | **PASS** | Every call writes an `AuditRecord` with real `actual_prompt/output_tokens`, `actual_logical_cost`, `backend_cost`, `budget_charge` (see Part A arithmetic). |
| ≥2 distinct consumers, each with own history + accumulated spend | **PASS** | `/dashboard/usage/consumers`: marketing $1.13, producto $1.28, atención $0.15 — separate budgets, audit trails, forecasts. |
| Configurable budget limit; on exceed → visible response (block/alert/degrade) | **PASS** | `POST /dashboard/budgets/{consumer}` (admin only). Lowered marketing → next call `HTTP 429 budget_exceeded`; alerts `budget_exceeded`+`request_blocked` raised. In the 80% band, eligible requests **degrade** instead (live degraded row captured, 70% savings). |
| Team articulates ≥2 explicit cost-saving criteria | **PASS** | README "Cost-saving decision criteria": (1) cheapest compatible tier per complexity; (2) degrade to cheapest compatible in-category under budget pressure with ≥25% savings. Implemented in `routing.py` + `budget.py`. |
| Live demo | **PASS / PRESENTATION** | Full stack live (`:5173`/`:8000`/`:8080` OpenWebUI); `verify.sh` re-proves on demand. Actual 10-min narration is the team's job. |

---

## Part B — Rubric pillars (110 pts + 5 bonus)

### Pilar 1 — Cost Visibility (25) → **est. 25/25**

| Criterion | Pts | Status | Evidence |
|---|---|---|---|
| Token capture per request for **both** providers | 10 | **PASS** | Real rows with `usage_source="provider"` on `provider-a` (calls 1,2) and `provider-b` (call 3). |
| Cost breakdown per consumer/team | 10 | **PASS** | `/dashboard/usage/consumers` + `/summary?consumer=…`; 3 differentiated consumers; `ConsumersPage.tsx`. |
| Data accurate vs provider prices | 5 | **PASS** | Costs match `config/logical_models.yaml` + `demo_backends.yaml` exactly (hand-checked). Physical prices `llama3.2:3b $0.06/$0.06`, `mistral:7b $0.24/$0.24` reproduced in `backend_cost`. |

### Pilar 2 — Governance / Budget (25) → **est. 25/25**

| Criterion | Pts | Status | Evidence |
|---|---|---|---|
| Budget limits per consumer/team | 5 | **PASS** | `budgets` table + `POST /dashboard/budgets/{consumer}` (validates `budget>0`, `0.1≤warning≤0.99`); admin-only (consumer → 403). |
| Alerts on threshold crossing | 5 | **PASS** | Live alert types seen: `budget_warning`, `budget_exceeded`, `request_blocked`, `model_degraded`, `expensive_request`, `cost_spike`, `projection_exceeded`. `/dashboard/alerts`, `AlertsPage.tsx`. |
| Audit log of all AI calls | 5 | **PASS** | `/dashboard/usage/requests` paginated + filterable (category, model, budget_action, status, usage_source). |
| Future-cost prediction w/ chart | 10 | **PASS** (chart = PRESENTATION) | `/dashboard/forecast/{consumer}`: 25 series points, per-category/model breakdown, `budget_exhaustion_at`, weighted 15m/1h/24h rate. `ForecastChart.tsx` + `SpendOverTimeChart.tsx`. |

### Pilar 3 — Cost-saving decision criteria (30) → **est. 27/30**

| Criterion | Pts | Status | Evidence |
|---|---|---|---|
| Explicit criteria for routing to a cheaper model | 10 | **PASS** | Two documented + coded criteria (README + `routing.select_baseline` / `routing.one_tier_lower_candidate` / `budget.evaluate`). |
| Justify cost/quality trade-offs (quality signals + acceptable degradation) | 10 | **PARTIAL / PRESENTATION** | Each model has a `quality_score`; degradation is now bounded to **exactly one tier** (R1) and by **two hard invariants** (never changes category, never drops a required capability), so the accepted quality loss is a single-tier `quality_score` gap and the task stays performable. Caveat: `quality_score` is an *assigned* score, not an empirically *measured* one — the "quality signals we measured" narrative is a presentation task. |
| Criteria demonstrated on **real** usage data + savings | 10 | **PASS** | Live **real** one-tier degraded rows: `z-ai/glm-5.2 (medium) → qwen/qwen3-coder-flash (low)`, `ratio=0.70`; and a high baseline `anthropic/claude-fable-5 (high) → z-ai/glm-5.2 (medium)`, `ratio=0.80` (recorded on the audit row — the physical inference on that 24 KB prompt timed out on local mistral, but the routing decision + savings are correct). Aggregate `total_savings≈$1.07` on `/summary`; `RequestsPage` filter `budget_action=degraded`; `RequestDetail.tsx` shows baseline vs chosen + savings. |

### Pilar 4 — Architecture / Design (20) → **est. 20/20**

| Criterion | Pts | Status | Evidence |
|---|---|---|---|
| Provider-agnostic design | 10 | **PASS** | Logical models → interchangeable `demo_backends` via YAML; adding a provider = config change. Real proof: same code path hits Ollama-a, Ollama-b (and Groq if `GROQ_API_KEY` set). **R2 done:** outbound auth is now generalized — any backend with `auth: bearer` + `api_key_env: <ENV>` gets a server-side `Authorization: Bearer` header (`providers._auth_headers`/`_resolve_api_key`); Groq mapped onto the same mechanism. Commented drop-in OpenAI/Anthropic examples in `demo_backends.yaml`. Adding a real provider is now pure config + one env var. |
| Separation of concerns + architecture diagram | 5 | **PASS** | 3 layers (proxy / storage / reporting) in code; Mermaid diagram in `README.md`. |
| Security: API keys never exposed to consumers | 5 | **PASS** | Provider keys server-side only; consumer key masked to `finops_key_...` (`catalog.ApiKey.api_key_prefix`); scope isolation `403 forbidden_scope`, missing/invalid `401`; frontend keeps key in memory only. |

### Pilar 5 — Presentation (10) → **PRESENTATION (est. 9–10/10 if narrated well)**

Not code-scorable. The tooling strongly supports a non-technical narrative: dashboard with
Overview/Requests/Consumers/Budgets/Forecast/Alerts/Recommendations, plus `verify.sh` as a
live "prove-it" script on a second screen, plus OpenWebUI (`:8080`) to chat and watch spend
move. **Recommendation:** demo in mock mode OR pre-warm the models (see below) so latency
doesn't stall the story.

**Estimated total (code-verifiable): ~105–110 / 110** (Pilar 4 now full after R2), with
Pilar 5 and the "quality signals measured" half-criterion depending on the live presentation.

---

## Part C — Gaps found & fixes applied

| # | Finding | Severity | Action |
|---|---|---|---|
| 1 | **README over-claimed** degradation as "degrade exactly one tier" while the code degraded to the cheapest compatible model (could skip a tier). | Doc/behaviour mismatch (Pilar 3) | **RESOLVED via R1** (below): the *code* is now bounded to one tier, and the docs match it. |
| 2 | **§10.3 estimated-usage fallback had no test.** | Test coverage | **FIXED:** added `test_estimated_usage_fallback_when_provider_omits_usage`. |

### Recommendations — now IMPLEMENTED per the user's decisions (see Part E)

- **R1 — one-tier degradation:** DONE.
- **R2 — generalized provider auth:** DONE.
- **R3 — hybrid demo docs:** DONE.

---

## Part D — Test / build results (after R1/R2/R3)

- `cd backend && make test` → **77 passed** (66 baseline +1 §10.3 +10 for R1/R2). No regressions.
- `cd frontend && pnpm test` → **25 passed**; `pnpm build` → **clean** (700 modules).
- `bash scripts/verify.sh` (real mode, new code) → **10 passed, 0 failed**.

## Remaining presentation tasks (not failures)

1. Rehearse the 10-min story for a non-technical judge (Pilar 5).
2. Articulate the *quality signals* narrative behind `quality_score` and the (now single-tier) "acceptable degradation" (Pilar 3.2).
3. Show the forecast **chart** and the degraded (amber) rows on screen, not just JSON.
4. Run the **hybrid** demo (mock walk-through → one real-mode moment) — see README.

## Final run state / recommendation

- Backend left **RUNNING in REAL mode** on `:8000` (`MOCK_PROVIDERS=false`), so OpenWebUI
  (`:8080`) chats hit real models and move real spend. Frontend `:5173`, Postgres `:5432`,
  Ollama `:11434`/`:11435` all up.
- **Demo mode = HYBRID (R3):** scripted walk-through in `make serve-mock`, then flip to
  `make serve` for one real-model moment via OpenWebUI. **Pre-warm both models once** with
  `make providers-warm` (sets Ollama `keep_alive=1h`) so there is no cold start; warm,
  provider-a (llama3.2:3b) answers in ~2–3 s and provider-b (mistral:7b) in ~5–20 s.
  `verify.sh` passes identically in both modes.
- **OpenWebUI quieted (R4):** the `:8080` container is recreated with the auxiliary
  generations disabled (title / follow-up / tags / autocomplete / search+retrieval query),
  so **one chat message == exactly one proxy request** instead of 3–5. Exact `docker run`,
  the persistent named volume, and the admin bootstrap are documented in the README
  ("OpenWebUI demo setup").

---

## Part E — Post-audit changes (R1 / R2 / R3)

### R1 — Degradation bounded to exactly ONE tier

- **`backend/app/services/routing.py`** — replaced `cheaper_degradation_candidate` (picked
  the *cheapest* compatible lower model, could skip tiers) with **`one_tier_lower_candidate`**:
  considers only capability-compatible models **exactly one tier below** the baseline
  (`high→medium`, `medium→low`). Returns `(None, 0.0)` when that model doesn't exist, isn't
  capability-compatible, or isn't cheaper — the caller then `warn_only`s (no skip).
- **`backend/app/services/budget.py`** — `evaluate` now calls `one_tier_lower_candidate`; the
  `≥25%` savings gate (§10.5) is unchanged, so a one-tier drop that doesn't clear 25% →
  `warn_only`. §10.6 baseline vs degraded savings recompute correctly.
- **Tests:** updated `test_budget_policy.py` (`high→medium`, plus `medium→low`); new
  `test_degradation_one_tier.py` covers (a) one-tier pick not skipping to low, (b) `warn_only`
  when the one-tier-lower model fails the 25% gate *and* a cheaper 2-tier model exists (proves
  no-skip), (c) capability filter blocking a skip, (d) lowest-tier → no candidate.
- **Behaviour confirmed on real data:** audit row `code_generation/high` degraded
  `anthropic/claude-fable-5 → z-ai/glm-5.2` (exactly one tier, ratio 0.80) — previously this
  would have jumped to `qwen/qwen3-coder-flash` (low). A completed real one-tier row
  (`medium→low`, ratio 0.70) is also present.

### R2 — Generalized, provider-agnostic outbound auth

- **`backend/app/services/providers.py`** — new `_resolve_api_key` + generalized
  `_auth_headers`: any backend with `auth: bearer` (or the legacy `groq`) gets
  `Authorization: Bearer <key>`, where the key is read from the backend's `api_key_env`
  environment variable (Groq falls back to `settings.groq_api_key`). No-auth backends
  (Ollama) get no header. Keys come from env/settings only, are never logged, never reach
  consumers.
- **`backend/app/catalog.py`** — `DemoBackend` gains an optional `api_key_env` field; loader
  reads it from YAML.
- **`backend/config/demo_backends.yaml`** — added **commented, disabled** drop-in examples
  for OpenAI (`gpt-4o-mini`) and Anthropic (`claude-3-5-haiku`) using `auth: bearer` +
  `api_key_env`, so judges can see provider-agnosticism concretely without needing keys.
- **Tests:** new `test_provider_auth.py` — bearer header attached from env, omitted when the
  env var is missing, omitted for no-auth backends, and the legacy Groq path still works.

### R3 — Hybrid demo documented

- **`README.md`** — replaced the "mock recommended" note with a **⭐ Recommended demo mode —
  HYBRID** section (scripted mock walk-through → one real-mode authenticity moment via
  OpenWebUI), documented `make serve` vs `make serve-mock` cleanly, noted `verify.sh` passes
  identically in both, and the pre-warm / short-prompt latency tip.

### R4 — Live OpenWebUI demo hardening (1 message = 1 request + answer always appears)

- **Root cause (verified in the audit log):** (1) OpenWebUI issued 3–5 auxiliary
  `/v1/chat/completions` per message (title / tags / follow-up / autocomplete / query
  generation), inflating the audit trail; (2) streaming requests that required
  `tool_calling` were upgraded to `anthropic/claude-sonnet-5` → `provider-b/mistral:7b`
  and, on a **cold start**, the primary *and* its llama fallback each hit the 60 s provider
  timeout (2×60 s ≈ 120 s) → `provider_stream_error`, so OpenWebUI showed no text.
- **Quieting:** OpenWebUI container recreated with `ENABLE_TITLE_GENERATION`,
  `ENABLE_FOLLOW_UP_GENERATION`, `ENABLE_TAGS_GENERATION`, `ENABLE_AUTOCOMPLETE_GENERATION`,
  `ENABLE_RETRIEVAL_QUERY_GENERATION`, `ENABLE_SEARCH_QUERY_GENERATION` = `False`, on a
  persistent named volume (`finops-openwebui-data`). Verified: **1 message → +1 audit row**
  (was 4). Confirmed off via `GET /api/v1/tasks/config`.
- **Streaming technical fallback (§11.3) confirmed correct, now locked by tests:**
  `backend/tests/test_stream_fallback.py` (respx) proves (a) a primary stream error *before*
  the first chunk → fallback backend used, `status=completed`, `backend_fallback_used=true`;
  (b) an error *after* chunks were sent → **no** fallback, `status=provider_stream_error`.
- **Timeout made configurable + demo-safe:** `backend/app/config.py` adds
  `provider_connect_timeout` (default 5 s — a dead backend fails fast so the fallback kicks
  in) and `provider_read_timeout` (default 120 s — a warm model can finish a long
  generation). `providers.py` builds an `httpx.Timeout` from these.
- **Pre-warm:** `scripts/warm-providers.sh` + `make providers-warm` / `task providers-warm`
  send a tiny generation to each model with Ollama `keep_alive=1h`.
- **Proven fixed on real data:** the exact original failing case (marketing, stream, tools →
  `claude-sonnet-5`/`provider-b/mistral:7b`) now returns `status=completed` (~23 s) instead
  of `provider_stream_error` at ~120 s. A plain OpenWebUI message returns a real answer as a
  single `completed` audit row.

### Still weak / honest notes

- "Quality signals measured" (Pilar 3.2) remains a **presentation** point — `quality_score`
  is assigned, not empirically measured.
- With warm models the 120 s read timeout is comfortable; if **both** a primary and its
  fallback were cold at once the worst case is 2×120 s, so **always run `make providers-warm`
  before the live real moment** (the whole point of the pre-warm step).
- `equipo-marketing` sits at ~84% of its budget, so medium-tier `auto` requests **degrade
  one tier to provider-a** — expected Pilar-3 behaviour, not a bug. provider-b is exercised
  live by capability-driven routes (e.g. `tool_calling`) and across the historical audit
  trail (`verify.sh` AC1 still sees ≥2 providers).
