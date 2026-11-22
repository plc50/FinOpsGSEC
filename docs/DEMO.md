# Running the demo

Everything you need to run the live demo: the integrated presentation, the real-provider mode, the OpenWebUI setup and the script that maps each step to the six acceptance criteria of the challenge.

Start the stack first with the [quickstart](../README.md#run-it).

## Integrated hackathon presentation

`/pitch` is a fullscreen React route inside the existing frontend, rendered outside the
dashboard `AppShell`. Sign in with an **admin key** (for the local seed,
`finops_key_admin`) and open `http://localhost:5173/pitch?setup=1`. The administrative
session continues to read summary, requests, budgets, alerts and savings. A separate
**consumer key** is entered in preflight and is used only for `POST /v1/chat/completions`;
it remains in React memory, is masked after validation and is never written to
`localStorage` or `sessionStorage`.

The presentation offers three explicit levels:

- **Safe backend (recommended):** start with
  `MOCK_PROVIDERS=true go-task demo-up`. Routing, budgets, Postgres audit, alerts,
  savings and semantic cache remain real; only upstream provider completions are
  simulated.
- **Live:** use `go-task demo-up` with the provider credentials from `backend/.env`.
- **Frontend rehearsal:** run `VITE_USE_MOCKS=true go-task demo-up` (or, for the
  frontend alone, `cd frontend && VITE_USE_MOCKS=true pnpm dev`). Routing, budget and
  cache demos use deterministic mutable in-memory fixtures and are labelled **DEMO DATA**.

Known consumer-key shortcuts are visible automatically in Vite development. For a
non-development rehearsal build, opt in explicitly with `VITE_ENABLE_DEMO_KEYS=true`.
Normal production builds do not reveal these shortcuts. If Internet access fails, use
Safe backend mode; if the backend itself is unavailable, restart the frontend with
`VITE_USE_MOCKS=true` and use Frontend rehearsal.

Run preflight before presenting. It verifies the admin session, backend health,
summary, audit, budgets, savings, alerts, the consumer key and `/v1/models`, and reports
whether backend providers are simulated. Budget-demo changes are never automatic. A
bright **Restore original budget** control returns the exact captured limit and warning
threshold; restore it before leaving the slide. Preflight also exposes any pending
restore.

Keyboard controls: `→`, `Page Down` or `Space` advances; `←` or `Page Up` goes back;
`Home`/`End` jumps to the first/last slide; `N` toggles presenter notes; `Esc` closes a
panel, exits fullscreen or returns to the dashboard; the fullscreen control is in the
bottom toolbar. Navigation keys are ignored while focus is in a form control. Horizontal
swipe provides basic touch navigation, and the active slide is restored from
`#slide-N`.

A five-minute sequence is: opening (0:20), problem (0:25), architecture (0:30), routing
demo (1:00), budget demo including restore (1:05), cache demo with exact replay (0:55),
live savings (0:30), close (0:15). Presenter notes include a failure fallback for every
slide.

> No `go-task` installed? The Makefile is a minimal fallback with the same public commands:
> `make demo-up`, `make demo-down`, `make status`, `make logs`, `make verify`.

## Demo mode

```bash
go-task demo-up
```

The demo runs the backend with `MOCK_PROVIDERS=false` so OpenWebUI can show genuine model
text and the dashboard can show the real request cost. Put provider credentials in
`backend/.env` as `OPENROUTER_API_KEY`, `FIREWORKS_API_KEY` and `TABBY_API_KEY`. For local
real-model demos, point `tabbyapi` at `http://127.0.0.1:5000/v1` and load the exact model
configured in `provider_models.yaml` (for example `gemma-4-12B-it-exl3`).

## Recommended flow

1. **Start everything** with `go-task demo-up`.
2. **Dashboard walk-through** at `http://localhost:5173`: cover routing, per-consumer spend,
   budgets, alerts, forecast and degradation.
3. **Authenticity path**: send
   a real chat via **marketing OpenWebUI (`:8081`)** — the judges see genuine model text
   *and* watch the real cost land in the dashboard (`/dashboard/usage/requests`, `/summary`).

## OpenWebUI demo setup (`:8080` / `:8081`) — 1 message = 1 proxy request

OpenWebUI, by default, fires **several extra LLM calls per user message** (chat-title
generation, follow-up suggestions, tag generation, autocomplete, and search/retrieval
query rewriting). Each of those hits the proxy as its own `/v1/chat/completions`, inflating
the audit trail so a single question shows up as 3–5 billed rows. For a clean demo we
disable them so **one OpenWebUI message == exactly one proxy request**.

OpenWebUI uses one OpenAI API key per instance, not per OpenWebUI login. The demo therefore
uses two isolated instances with separate named volumes. `go-task demo-up` starts both:

Both instances point OpenWebUI at the
proxy through `http://host.docker.internal:8000/v1`, mount a named volume, and disable the
auxiliary generations via environment variables.

```text
Admin instance:
  http://localhost:8080
  admin@finops.local / finops1234

Marketing instance:
  http://localhost:8081
  marketing@finops.local / finops1234
```

In the admin instance, `/v1/models` exposes `auto` plus the full provider/model catalog. In
the marketing instance, `/v1/models` exposes only `auto`, and every request is recorded under
`equipo-marketing`.

Verify the quieting worked — one message should add exactly one row to
`GET /dashboard/usage/requests?consumer=equipo-marketing` when using the marketing instance.
You can confirm the flags are off via `GET /api/v1/tasks/config`
(all `ENABLE_*_GENERATION` should be `false`).

> The `ENABLE_*_GENERATION` flags are OpenWebUI *PersistentConfig* values: the env vars set
> the initial value on a **fresh** data volume. If you reuse an existing volume where they
> were already enabled, toggle them off in **Admin Settings → Interface** (or via
> `POST /api/v1/tasks/config/update`) instead.

## Demo script (map to the 6 acceptance criteria)

Sign in at http://localhost:5173. Have `go-task verify` output on a second screen — it proves
every point below with live numbers.

1. **Interception + intelligent routing across ≥2 providers.**
   In the app (as `finops_key_marketing`) send prompts of different kinds via **Overview →
   playground / or** show the **Requests** page. Point out that `model=auto` requests are
   classified by *category* (`misc`, `code_generation`, `web_search`, `qa_internal`) and
   *complexity tier*, and land on different `selected_provider` / `selected_model`
   combinations. Evidence in Requests: provider/model columns differ per row.

2. **Token usage + cost recorded per request.**
   Open any row on **Requests** → the detail shows `actual_prompt_tokens`,
   `actual_output_tokens` and `actual_model_cost`.
   When a judge asks "how much did that cost?", expand the row.

3. **≥2 consumers, each with its own spend history.**
   On **Consumers** (admin) show the three seeded teams with *differentiated* spend.
   The seed auto-scales budgets so marketing sits in the ~84% warning band; producto
   and atención sit lower. Each has its own audit trail and budget.

4. **Configurable budget → visible block / alert / degrade.**
   On **Budgets** (admin) lower `equipo-marketing` below its current spend and save. Send a
   marketing request → the proxy returns **HTTP 429 `budget_exceeded`** and the **Alerts**
   page shows `request_blocked` + `budget_exceeded` (critical). Above the 80% warning band,
   eligible requests are instead **degraded by exactly one tier** to a cheaper model (amber
   rows on Requests).

5. **The 2 explicit cost-saving criteria (Pilar 3).**
   On **Requests**, filter `budget_action = degraded`: the row shows the chosen cheaper
   model vs the `baseline_model` and the `estimated_savings` / ratio. **Overview**
   and **Consumers** surface the aggregate `total_savings`. See the two
   criteria and the cost/quality trade-off below.

6. **Live demo.** Everything above is against the running stack; `go-task verify` re-proves it
   on demand.
