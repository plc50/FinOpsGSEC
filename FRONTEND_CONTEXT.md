# Frontend Implementation Context — AI FinOps Dashboard

Este documento define el contexto de implementacion del frontend para el dashboard del AI FinOps Proxy. Debe permitir trabajar en paralelo con backend sin asumir datos, permisos o estados no definidos.

## 1. Proposito

Construir un dashboard operativo para visualizar, explicar y controlar el gasto de IA por consumidor interno.

El frontend debe mostrar:

- Gasto actual y proyectado.
- Presupuesto y porcentaje usado.
- Requests auditadas.
- Routing de modelos.
- Degradaciones, bloqueos y alertas.
- Forecast de gasto.
- Recomendaciones MVP.
- Diferencia entre vista admin y vista consumidor.

El frontend no llama directamente a proveedores de IA. Solo consume APIs del backend FinOps.

## 1.1 Stack tecnologico

Libreria de graficas fijada: **Apache ECharts**. El resto del stack se elige
para integrarse limpiamente con ECharts y para priorizar **responsividad**.

| Capa | Eleccion | Motivo |
|---|---|---|
| Lenguaje | TypeScript | Tipado del contrato API (enums §6), menos errores |
| Framework UI | React 18 | Wrapper oficial-ish para ECharts, ecosistema maduro |
| Build/dev | Vite | Dev server rapido, build ligero |
| Package manager | pnpm | Instalacion rapida y determinista |
| Graficas | Apache ECharts + `echarts-for-react` | Requisito fijado; canvas performante y responsive |
| Estilos | Tailwind CSS v4 + CSS variables | Utilidades responsive (breakpoints) + tokens industriales (§2) |
| Data fetching | TanStack Query (React Query) | Cache, y estados loading/empty/error/ready (§8) de serie |
| Routing | React Router | App shell con navegacion segun rol (§4) |
| Tablas | TanStack Table (headless) | Tablas densas de auditoria con filtros/paginacion (§7.3) |
| Estado UI | React Context + hooks (Zustand si hace falta) | Auth context de `/dashboard/me`; filtros locales |
| HTTP | fetch nativo envuelto en cliente con Bearer | Adjunta `Authorization` (§5); nunca headers de identidad custom |
| Tests | Vitest + React Testing Library | Coherente con el enfoque TDD del backend |

Reglas de arquitectura frontend:

- Cliente API unico que inyecta `Authorization: Bearer <key>` y centraliza el
  manejo de errores del contrato (§8, mostrar `code` del backend).
- El rol y `visible_consumers` vienen de `/dashboard/me`; nunca se infieren
  permisos en el cliente (§3).
- Componentes de grafica desacoplados: reciben datos ya normalizados del backend
  y solo construyen la `option` de ECharts.

### 1.1.1 Apache ECharts

- Integracion via `echarts-for-react` (o wrapper propio delgado sobre la
  instancia de ECharts).
- **Tema industrial**: registrar un tema ECharts derivado de los tokens de §2:
  - `backgroundColor: transparent` (el surface lo pone el contenedor).
  - Paleta de series alineada a las senales: verde `#00E676`, amber `#FFB800`,
    rojo `#FF3B30`; texto `#F2F2F2`/`#9CA3AF`.
  - `textStyle.fontFamily`: la mono de §2 (IBM Plex Mono / JetBrains Mono).
  - Ejes y `splitLine` con color de linea `#2A2D2A`, sin sombras.
  - Numeros con tabular-nums en tooltips/labels.
- **Graficas requeridas** (mapear a las secciones existentes):
  - Forecast: line chart con `actual_cost`, `projected_cost` y linea horizontal
    de `budget` (`markLine`); color del estado segun `forecast_status`
    (`on_track` verde, `at_risk` amber, `projected_over_budget` rojo) — ver §6.5.
  - Overview: spend over time y forecast contra presupuesto — ver §7.1.
- **Carga**: importar solo los modulos de ECharts usados (tree-shaking:
  `LineChart`, `BarChart`, `GridComponent`, `TooltipComponent`,
  `MarkLineComponent`, etc.) para no inflar el bundle.

### 1.1.2 Responsividad (prioritaria)

- Enfoque **mobile-first**; layout fluido con CSS Grid/Flex y breakpoints de
  Tailwind (`sm`, `md`, `lg`, `xl`).
- **Graficas ECharts responsive**:
  - Contenedor con altura definida (o `aspect-ratio`); la instancia hace
    `resize()` ante cambios de tamano usando `ResizeObserver` (o `autoResize`
    del wrapper). Nunca fijar `width`/`height` en pixeles en la `option`.
  - Usar la propiedad `media` de ECharts (responsive options) para ajustar
    `grid`, tamano de fuente y visibilidad de labels en pantallas pequenas.
  - En movil: simplificar ejes/leyendas y priorizar la linea principal.
- **Tablas responsive** (auditoria §7.3, consumers §7.2): en desktop tabla
  densa; en pantallas estrechas, scroll horizontal contenido o colapsar a
  tarjetas apiladas (una fila = una card con pares label/valor). Nunca romper
  el layout ni desbordar el viewport.
- **App shell**: navegacion (§4) colapsa a menu/drawer en movil; el contenido
  principal usa contenedores fluidos, no anchos fijos.
- **Sin layout shift**: los skeletons de carga (§8) mantienen la altura final
  de cards, graficas y tablas.
- Verificar en breakpoints ~360px, ~768px y ~1280px como minimo.

## 2. Direccion visual

Anchor elegido: **Industrial**.

Motivo: el producto es una consola operativa de control de coste, auditoria y routing. Debe sentirse como una herramienta de infraestructura, no como una landing ni una app comercial decorativa.

Tokens obligatorios:

```text
background: #000000 or #0B0C0A
font: IBM Plex Mono, JetBrains Mono, or Berkeley Mono
signal green: #00E676
signal amber: #FFB800
signal red: #FF3B30
line color: #2A2D2A
text primary: #F2F2F2
text secondary: #9CA3AF
surface: #0B0C0A
border: 1px solid #2A2D2A
border-radius: 0-4px
shadow: none
font-variant-numeric: tabular-nums
```

Rules:

- Use mono typography for display and body.
- Use 1px borders, no decorative shadows.
- Use dense but readable layouts.
- Use tables for audit data.
- Use charts only where they explain cost or forecast.
- Do not create a marketing hero.
- Do not use fake personas, fake emails or fabricated telemetry.

## 3. Roles and access

Frontend gets role and scope from backend. It must not infer permissions locally.

### Roles

```text
admin
consumer
```

### Admin view

Admin can see:

- All consumers.
- All API keys metadata, never full keys.
- All budgets.
- All forecasts.
- All alerts.
- All audit records.
- All model decisions.

Admin can do:

- Update budgets.
- Inspect degraded/blocked requests.
- Select explicit provider/model entries in API usage examples.

### Consumer view

Consumer can see only:

- Own consumer/team spend.
- Own consumer/team budget.
- Own forecast.
- Own alerts.
- Own audit records.
- Own recommendations.

Consumer must not see:

- Other consumers' costs.
- Other consumers' forecasts.
- Other consumers' audit rows.
- Other consumers' prompt previews.
- Global admin controls.

If backend returns `403`, show an access error. Do not hide the failure silently.

## 4. Navigation

Single app shell with role-aware navigation.

### Admin navigation

```text
Overview
Consumers
Requests
Forecast
Alerts
Models
Routing
Budgets
Recommendations
```

### Consumer navigation

```text
Overview
Requests
Forecast
Alerts
Recommendations
```

## 5. Backend API contract

All dashboard endpoints require:

```http
Authorization: Bearer <consumer_api_key>
```

Frontend must not send `X-Consumer-ID` or any custom identity header.

Base endpoints:

```text
GET /dashboard/me
GET /dashboard/summary
GET /dashboard/usage/requests
GET /dashboard/usage/consumers
GET /dashboard/budgets
POST /dashboard/budgets/{consumer}
GET /dashboard/forecast
GET /dashboard/forecast/{consumer}
GET /dashboard/recommendations
GET /dashboard/alerts
GET /dashboard/routing-catalog
GET /dashboard/routing-config
PUT /dashboard/routing-config/{consumer}/{category}/{complexity_tier}
DELETE /dashboard/routing-config/{consumer}/{category}/{complexity_tier}
GET /v1/models
POST /v1/chat/completions
```

`POST /v1/chat/completions` is not used by dashboard screens directly. It is listed here because the frontend may show API usage examples and because `/v1/models` and chat completions share the same auth/model contract.

## 6. Common response types

### 6.1 Auth context

Endpoint:

```text
GET /dashboard/me
```

Response:

```json
{
  "api_key_id": "key_marketing",
  "api_key_prefix": "finops_key_...",
  "consumer": "equipo-marketing",
  "role": "consumer",
  "can_select_model": false,
  "visible_consumers": ["equipo-marketing"]
}
```

Admin response:

```json
{
  "api_key_id": "key_admin",
  "api_key_prefix": "finops_key_...",
  "consumer": "admin",
  "role": "admin",
  "can_select_model": true,
  "visible_consumers": [
    "equipo-marketing",
    "equipo-producto",
    "equipo-atencion-cliente"
  ]
}
```

Frontend rule:

- Use `role` to render navigation.
- Use `visible_consumers` for filters.
- Never render admin controls unless `role = admin`.

### 6.2 Summary

Endpoint:

```text
GET /dashboard/summary
```

Response:

```json
{
  "scope": "consumer",
  "consumer": "equipo-marketing",
  "current_spend": 8.4,
  "budget": 10.0,
  "budget_used_pct": 0.84,
  "projected_spend": 12.8,
  "forecast_status": "projected_over_budget",
  "requests_count": 41,
  "degraded_requests": 6,
  "blocked_requests": 1,
  "alerts_count": 2,
  "total_savings": 0.0049,
  "currency": "USD"
}
```

`total_savings` is the accumulated routing/degradation savings in scope. Render
it as currency (see Overview "Savings from routing" card).

Allowed `forecast_status`:

```text
on_track
at_risk
projected_over_budget
```

### 6.3 Audit request row

Endpoint:

```text
GET /dashboard/usage/requests
```

Response:

```json
{
  "items": [
    {
      "id": "audit_001",
      "timestamp_started": "2026-07-01T10:00:00Z",
      "timestamp_completed": "2026-07-01T10:00:02Z",
      "consumer": "equipo-marketing",
      "requested_model": "auto",
      "selected_provider": "tabbyapi",
      "selected_model": "gemma-4-12B-it-exl3",
      "baseline_provider": null,
      "baseline_model": null,
      "routing_source": "admin_config",
      "routing_config_id": "route_001",
      "category": "misc",
      "complexity_score": 0.22,
      "complexity_tier": "low",
      "required_capabilities": ["text"],
      "usage_source": "provider",
      "estimated_prompt_tokens": 120,
      "actual_prompt_tokens": 118,
      "estimated_output_tokens": 300,
      "actual_output_tokens": 72,
      "estimated_model_cost": 0.000132,
      "actual_model_cost": 0.000041,
      "baseline_model_cost": null,
      "estimated_savings": null,
      "estimated_savings_ratio": null,
      "routing_overhead_cost": 0.0,
      "backend_cost": 0.000011,
      "budget_charge": 0.000041,
      "budget_action": "allow",
      "status": "completed",
      "error_code": null,
      "latency_ms": 1840,
      "prompt_preview": "Resume este texto en una frase...",
      "stream": false,
      "post_stream_budget_overrun": false
    }
  ],
  "page": 1,
  "page_size": 25,
  "total": 41
}
```

Allowed `category`:

```text
qa_internal
web_search
code_generation
misc
```

Allowed `complexity_tier`:

```text
low
medium
high
```

Allowed `budget_action`:

```text
allow
warn_only
degraded
blocked
```

Allowed `status`:

```text
completed
degraded
blocked
warn_only
cancelled_by_client
provider_error
provider_stream_error
```

Allowed `usage_source`:

```text
provider
estimated
```

Savings fields (`baseline_provider`, `baseline_model`, `baseline_model_cost`,
`estimated_savings`, `estimated_savings_ratio`) are non-null only when
`budget_action = "degraded"`. Render them only for degraded rows; show a dash
for other rows.

### 6.4 Consumers usage

Endpoint:

```text
GET /dashboard/usage/consumers
```

Admin response includes all visible consumers. Consumer response includes only own consumer.

```json
{
  "items": [
    {
      "consumer": "equipo-marketing",
      "current_spend": 8.4,
      "budget": 10.0,
      "budget_used_pct": 0.84,
      "projected_spend": 12.8,
      "forecast_status": "projected_over_budget",
      "requests_count": 41,
      "degraded_requests": 6,
      "blocked_requests": 1,
      "total_savings": 0.0049,
      "avg_latency_ms": 1840,
      "p95_latency_ms": 3100
    }
  ]
}
```

`total_savings` is the accumulated routing/degradation savings for that consumer
(render as currency).

### 6.5 Forecast

Endpoint:

```text
GET /dashboard/forecast/{consumer}
```

Response:

```json
{
  "consumer": "equipo-marketing",
  "period": "monthly",
  "currency": "USD",
  "spend_so_far": 8.4,
  "budget": 10.0,
  "projected_spend": 12.8,
  "forecast_status": "projected_over_budget",
  "forecast_confidence": "medium",
  "weighted_hourly_rate": 0.18,
  "budget_exhaustion_at": "2026-07-23T18:00:00Z",
  "series": [
    {
      "bucket_start": "2026-07-01T09:00:00Z",
      "actual_cost": 0.42,
      "projected_cost": null
    },
    {
      "bucket_start": "2026-07-01T10:00:00Z",
      "actual_cost": 0.61,
      "projected_cost": 0.74
    }
  ],
  "breakdown_by_category": [
    {
      "category": "misc",
      "spend_so_far": 6.1,
      "projected_spend": 9.4
    }
  ],
  "breakdown_by_model": [
    {
      "provider": "tabbyapi",
      "model": "gemma-4-12B-it-exl3",
      "spend_so_far": 4.8,
      "projected_spend": 7.2
    }
  ]
}
```

Allowed `forecast_confidence`:

```text
low
medium
high
```

Frontend chart requirements (implement with Apache ECharts, see §1.1.1):

- Line chart with actual spend and projected spend.
- Budget line (ECharts `markLine`).
- Status color:
  - `on_track`: green
  - `at_risk`: amber
  - `projected_over_budget`: red
- Chart container must be responsive and call `resize()` on layout changes (§1.1.2).

### 6.6 Alerts

Endpoint:

```text
GET /dashboard/alerts
```

Response:

```json
{
  "items": [
    {
      "id": "alert_001",
      "type": "projection_exceeded",
      "consumer": "equipo-marketing",
      "severity": "warning",
      "title": "Projected spend exceeds budget",
      "message": "equipo-marketing is projected to spend $12.80 against a $10.00 budget.",
      "created_at": "2026-07-01T10:00:00Z",
      "related_audit_record_id": null
    }
  ]
}
```

Allowed alert `type`:

```text
budget_warning
budget_exceeded
expensive_request
cost_spike
projection_exceeded
model_degraded
request_blocked
post_stream_budget_overrun
provider_error
```

Allowed `severity`:

```text
info
warning
critical
```

### 6.7 Recommendations

Endpoint:

```text
GET /dashboard/recommendations
```

Response:

```json
{
  "items": [
    {
      "id": "rec_001",
      "type": "budget_degradation_recommendation",
      "consumer": "equipo-marketing",
      "severity": "warning",
      "message": "Marketing esta proyectado por encima del presupuesto. Degradar tareas misc de baja complejidad reduciria el gasto.",
      "created_at": "2026-07-01T10:00:00Z"
    }
  ]
}
```

Allowed recommendation `type`:

```text
projected_over_budget
budget_degradation_recommendation
```

### 6.8 Budgets

Endpoint:

```text
GET /dashboard/budgets
```

Response:

```json
{
  "items": [
    {
      "consumer": "equipo-marketing",
      "budget": 10.0,
      "current_spend": 8.4,
      "budget_used_pct": 0.84,
      "warning_threshold": 0.8,
      "currency": "USD"
    }
  ]
}
```

Admin update:

```text
POST /dashboard/budgets/{consumer}
```

Request:

```json
{
  "budget": 15.0,
  "warning_threshold": 0.8
}
```

Consumer must not render this mutation.

## 7. Page definitions

## 7.1 Overview

Visible to admin and consumer.

Cards:

- Current spend.
- Budget used.
- Projected spend.
- Requests count.
- Degraded requests.
- Blocked requests.
- Active alerts.
- Savings from routing (`total_savings`).

Charts:

- Spend over time.
- Forecast line against budget.

Tables:

- Latest audit records.
- Latest alerts.

Admin variant:

- Show all consumers.
- Include consumer filter.
- Include comparison table by consumer.

Consumer variant:

- Scope fixed to own consumer.
- Do not render a consumer selector.

## 7.2 Consumers

Admin only.

Table columns:

```text
consumer
current_spend
budget
budget_used_pct
projected_spend
forecast_status
requests_count
degraded_requests
blocked_requests
total_savings
avg_latency_ms
p95_latency_ms
```

Actions:

- View details.
- Edit budget.

## 7.3 Requests

Admin sees all visible consumers. Consumer sees own consumer only.

Filters:

```text
consumer
category
provider
model
routing_source
budget_action
status
usage_source
time_range
```

Table columns:

```text
timestamp
consumer
category
complexity_tier
requested_model
selected_provider
selected_model
routing_source
actual_model_cost
routing_overhead_cost
estimated_savings
budget_action
status
latency_ms
prompt_preview
```

Rows with `budget_action = degraded` must be visually marked (e.g. amber tag)
and show their `estimated_savings`. Non-degraded rows show a dash in the
savings column.

Row detail panel:

- Estimated vs actual tokens.
- Model cost vs backend cost.
- Baseline provider/model vs selected provider/model with estimated savings
  (degraded rows only).
- Required capabilities.
- Prompt preview.
- Error code if blocked/failed.
- Budget action reason if provided.

## 7.4 Forecast

Admin:

- Global forecast summary.
- Per-consumer forecast cards.
- Consumer selector.

Consumer:

- Own forecast only.

Required visuals:

- Actual spend line.
- Projected spend line.
- Budget horizontal line.
- Budget exhaustion date when available.
- Category/model breakdown.

## 7.5 Alerts

List alerts ordered newest first.

Required fields:

```text
severity
type
consumer
message
created_at
related_audit_record_id
```

Severity color:

```text
info -> signal green or text secondary
warning -> amber
critical -> red
```

## 7.6 Models

Admin only.

Data source:

```text
GET /v1/models
```

Display:

- Model id.
- Owned by.
- Whether model is `auto`.

MVP restriction:

Do not render category, tier, capabilities or routing prices on this page in the MVP.

Relationship to Routing page:

- Models remains a read-only catalog view.
- Routing becomes the mutable admin configuration surface for assigning models to
  consumers/categories/complexity tiers.

## 7.7 Budgets

Admin:

- Table of all budgets.
- Edit budget modal/form.

Consumer:

- Read-only own budget summary.

Form validation:

- `budget` must be greater than `0`.
- `warning_threshold` must be between `0.1` and `0.99`.

## 7.8 Recommendations

List MVP recommendations.

Required fields:

```text
type
consumer
severity
message
created_at
```

No generated explanation text on frontend. Render backend `message` as-is.

## 7.9 Routing

Admin only.

Purpose:

- Let an admin inspect and change which model/backend is used for each
  `equipo -> category -> complexity_tier` route.
- Make routing decisions explainable before traffic is sent.
- Preserve backend-enforced validation; the frontend never assumes a change is
  valid until the backend accepts it.

Data source:

```text
GET /dashboard/routing-catalog
GET /dashboard/routing-config
```

`routing-catalog.models` is the manually maintained list of assignable
provider/model options with prices and capabilities. It is not the same thing
as the category/tier defaults shown in each `routing-config` row.

Routing rows may use `consumer: "global"` to represent the global fallback
configuration. This is a reserved UI/API alias for the backend's nullable
global route, not a real team id.

Mutation:

```text
PUT /dashboard/routing-config/{consumer}/{category}/{complexity_tier}
DELETE /dashboard/routing-config/{consumer}/{category}/{complexity_tier}
```

Layout:

- Dense matrix grouped by consumer/equipo.
- Columns: category, complexity tier, default provider, default model,
  configured provider, configured model, routing source, capabilities,
  input/output price, updated at, updated by.
- Filters: consumer, category, complexity tier, routing source.
- Inline edit or modal edit for one route at a time.

Edit controls:

- Provider select constrained by backend response.
- Model select filtered by selected provider and constrained by backend response.
- Enabled toggle.
- Reset to catalog default action.

Validation/error behavior:

- Show backend `validation_error`, `no_compatible_model` or `forbidden_scope`
  messages directly.
- Do not let consumer role see this navigation item or route.
- Do not fabricate prices/capabilities; render manually maintained backend
  catalog metadata.

Expected states:

- Loading skeleton matrix.
- Empty state: "No routing configuration changes."
- Error state with backend `code`.
- Dirty state for edited row before save.
- Saved state after backend accepts the configuration.

## 8. UI states

Every page must handle:

```text
loading
empty
error
ready
```

### Loading

Use skeleton rows/cards with fixed height. Do not shift layout after data loads.

### Empty

Use specific empty state:

- "No requests in this period."
- "No active alerts."
- "No recommendations."

### Error

Show backend error message and code.

Example:

```text
Unable to load forecast
code: invalid_api_key
```

### Ready

Render data from backend only. Do not fabricate missing values.

## 9. Formatting rules

Currency:

```text
USD with 2-6 decimals depending magnitude
```

Rules:

- If amount >= 1: `$12.34`
- If amount < 1: `$0.000041`

Percent:

```text
budget_used_pct = 0.84 -> 84%
```

Latency:

```text
1840 -> 1.84s
450 -> 450ms
```

Timestamps:

- Display local time.
- Keep ISO timestamp in detail view.

Scores:

```text
complexity_score = 0.224 -> 0.22
```

## 10. Security and privacy

Frontend must not:

- Store API keys in localStorage.
- Display full API keys.
- Display full prompts.
- Let consumer scope access other consumers by changing query params.
- Render admin controls based only on frontend state.

Frontend may display:

- API key prefix.
- Prompt preview.
- Prompt fingerprint only in detail/admin views.

If user opens a URL for another consumer and backend returns `403`, show access denied.

## 11. Demo data discipline

Seeded data must be visually marked if surfaced as such.

Allowed labels:

```text
Seeded usage history
Demo backend
Logical cost
Backend cost
```

Do not invent human names, emails, companies or telemetry. Use the real demo consumers:

```text
equipo-marketing
equipo-producto
equipo-atencion-cliente
admin
```

## 12. Implementation order

1. Project setup: Vite + React + TS, Tailwind with industrial tokens (§2), ECharts theme (§1.1.1).
2. Responsive app shell and role-aware navigation (drawer on mobile, §1.1.2).
3. API client with Authorization bearer support.
4. `/dashboard/me` auth context.
5. Overview page using `/dashboard/summary` (responsive cards + ECharts).
6. Requests table using `/dashboard/usage/requests` (responsive table/cards).
7. Forecast page using `/dashboard/forecast/{consumer}` (ECharts line + budget markLine).
8. Alerts and recommendations pages.
9. Budgets page with admin edit support.
10. Consumers page for admin.
11. Models page for admin.
12. Routing page for admin-managed model/backend configuration.
13. Visual polish and responsive checks at ~360px / ~768px / ~1280px.
