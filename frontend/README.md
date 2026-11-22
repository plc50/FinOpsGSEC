# AI FinOps Console — Frontend

Operational cost-control dashboard for the **AI FinOps Proxy**. It visualizes,
explains and controls AI spend per internal consumer: current & projected spend,
budgets, routing/degradation savings, audit trail, forecasts, alerts and
recommendations.

Built to the shared `API_CONTRACT.md` and `FRONTEND_CONTEXT.md` specs. Operational-console
design on a light theme: mono accents, 1px borders, signal colors, dense tables, live
polling on the Requests page and provider icons throughout.

## Stack

- **TypeScript + React 18 + Vite** (pnpm)
- **Apache ECharts** via `echarts-for-react` (tree-shaken modules, custom
  industrial theme, `ResizeObserver`-driven responsiveness)
- **Tailwind CSS v4** + CSS variables (industrial design tokens)
- **TanStack Query** (loading/empty/error/ready states) and **TanStack Table**
  (dense audit table)
- **React Router** (role-aware app shell, mobile drawer)
- **Vitest + React Testing Library**

## Prerequisites

- Node.js 20+ (developed on Node 26)
- pnpm 11+

## Run

```bash
cd frontend
pnpm install
pnpm dev          # http://localhost:5173
```

### Build & test

```bash
pnpm build        # tsc -b && vite build  (type-checks + production build)
pnpm test         # vitest run
pnpm preview      # serve the production build
```

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8000` | Backend base URL (used for production builds). |
| `VITE_USE_MOCKS` | `false` | When `true`, serve all data from the local typed fixture layer — no backend needed. |
| `VITE_ENABLE_DEMO_KEYS` | `false` | Opt in to known demo-key shortcuts outside Vite development. Leave off in normal production. |

### Talking to the backend

- **Dev:** the app calls **relative paths** (`/dashboard/*`, `/v1/*`) and Vite
  proxies them to `VITE_API_BASE_URL` (see `vite.config.ts`), so there are no
  CORS issues even though the backend also enables CORS.
- **Prod:** requests go directly to `VITE_API_BASE_URL`.

### Demo without a live backend

```bash
VITE_USE_MOCKS=true pnpm dev
```

The mock layer (`src/api/mocks.ts`) mirrors the exact example payloads from the
contract and enforces the same auth/scope rules (401 for bad keys, 403
`forbidden_scope` when a consumer tries to reach another consumer, admin-only
budget mutations, budget validation). It uses only the real demo consumers.

## Authentication

Sign in with a FinOps API key on the entry screen. Demo bearer keys (quick-pick
buttons):

| Key | Consumer | Role |
|---|---|---|
| `finops_key_marketing` | equipo-marketing | consumer |
| `finops_key_producto` | equipo-producto | consumer |
| `finops_key_atencion` | equipo-atencion-cliente | consumer |
| `finops_key_admin` | admin | admin |

Security notes (per spec §10):

- Keys are held **in memory** (React context), with optional **sessionStorage**
  for reload persistence — **never** `localStorage`.
- Only the **key prefix** from `/dashboard/me` is displayed, never the full key.
- **Role and `visible_consumers` come from `/dashboard/me`** — permissions are
  never inferred client-side. Admin pages are also route-guarded.
- On `403`, the UI shows an explicit **access denied** (never fails silently).

## Pages

| Route | Who | Contents |
|---|---|---|
| `/overview` | all | KPI cards (spend, budget used, projected, requests, degraded, blocked, alerts, routing savings), spend-over-time + forecast-vs-budget charts, latest audit + alerts. Admin adds a consumer filter and per-consumer comparison. |
| `/requests` | all | Filters (consumer/category/provider/model/budget_action/status/usage_source/time_range), dense TanStack table, degraded rows marked amber with estimated savings, expandable row detail. |
| `/routing` | admin | Configure provider/model per equipo/global, category and complexity tier. |
| `/forecast` | all | ECharts actual+projected lines with budget `markLine`, status color, exhaustion date, category/model breakdown. Admin: per-consumer summaries + selector. |
| `/alerts` | all | Newest-first, severity colors, full alert fields. |
| `/recommendations` | all | Backend `message` rendered verbatim (no generated text). |
| `/consumers` | admin | Full comparison table (§7.2) + view/edit-budget actions. |
| `/budgets` | admin | Budgets table + edit modal (validates `budget > 0`, `0.1 ≤ warning ≤ 0.99`). Consumers see a read-only summary. |
| `/models` | admin | `/v1/models` — id / owned_by / whether `auto` only (MVP restriction). |
| `/pitch` | admin | Fullscreen 8-slide hackathon pitch with live routing, budget, cache and savings demos; rendered outside `AppShell`. Use `/pitch?setup=1` for preflight. |

## Formatting (spec §9)

- Currency: `$12.34` (≥ 1) / `$0.000041` (< 1)
- Percent: `0.84 → 84%`
- Latency: `1840 → 1.84s`, `450 → 450ms`
- Scores: 2 decimals; local time in display, ISO kept in detail views.

## Responsiveness (priority, §1.1.2)

Mobile-first. ECharts containers have defined heights and `resize()` via
`ResizeObserver` (never fixed px in the option). Tables collapse to stacked
cards on narrow screens; navigation collapses to a drawer. Verified at ~360px,
~768px and ~1280px.

## Project layout

```
src/
  api/        types, fetch client (+ ApiError), endpoints, React Query hooks, mocks
  auth/       AuthContext (in-memory key), LoginScreen
  app/        AppShell (nav + drawer), role-aware nav config, route guard
  components/ ui/ primitives, charts/ (ECharts), RequestDetail, BudgetEditModal
  lib/        formatting, signals (tones/colors), ECharts theme + module registration
  pages/      one file per route
  test/       Vitest setup
```

## Notes / default decisions

- The admin Overview "global" charts aggregate per-consumer forecasts by bucket
  (there is no dedicated global time-series endpoint).
- `esbuild`'s build script is approved in `pnpm-workspace.yaml`
  (`allowBuilds`, the pnpm 11 replacement for `onlyBuiltDependencies`) so
  `pnpm install` completes cleanly.
