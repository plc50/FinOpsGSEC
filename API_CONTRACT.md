# API Contract — AI FinOps Proxy

Este contrato define la interfaz compartida entre backend y frontend. Es la fuente de verdad para endpoints, autenticacion, permisos, payloads, enums y errores.

## 1. Base rules

Base URL local sugerida:

```text
http://localhost:8000
```

Todas las rutas de dashboard requieren:

```http
Authorization: Bearer <consumer_api_key>
```

Las rutas OpenAI-compatible tambien requieren la misma API key:

```http
Authorization: Bearer <consumer_api_key>
Content-Type: application/json
```

El frontend no debe enviar headers custom de identidad. No existe `X-Consumer-ID`.

Formato de fecha/hora:

```text
ISO-8601 UTC, e.g. 2026-07-01T10:00:00Z
```

Moneda MVP:

```text
USD
```

## 2. Auth and permissions

Roles:

```text
admin
consumer
```

Permission model:

| Capability | Admin | Consumer |
|---|---|---|
| View own usage | Yes | Yes |
| View all consumers usage | Yes | No |
| View own forecast | Yes | Yes |
| View all forecasts | Yes | No |
| View own audit records | Yes | Yes |
| View all audit records | Yes | No |
| Update budgets | Yes | No |
| Use `model = auto` | Yes | Yes |
| Use explicit provider/model | Yes | No |

## 3. Common enums

```text
category:
  qa_internal
  web_search
  code_generation
  misc

complexity_tier:
  low
  medium
  high

budget_action:
  allow
  warn_only
  degraded
  blocked

request_status:
  completed
  degraded
  blocked
  warn_only
  semantic_cache_hit
  cancelled_by_client
  provider_error
  provider_stream_error

usage_source:
  provider
  estimated
  semantic_cache

forecast_status:
  on_track
  at_risk
  projected_over_budget

forecast_confidence:
  low
  medium
  high

severity:
  info
  warning
  critical

alert_type:
  budget_warning
  budget_exceeded
  expensive_request
  cost_spike
  projection_exceeded
  model_degraded
  request_blocked
  post_stream_budget_overrun
  provider_error

recommendation_type:
  projected_over_budget
  budget_degradation_recommendation
```

## 4. Error contract

All errors use:

```json
{
  "error": {
    "message": "Human-readable message.",
    "type": "invalid_request_error",
    "param": null,
    "code": "some_code"
  }
}
```

| Case | HTTP | `type` | `code` | `param` |
|---|---:|---|---|---|
| Missing API key | 401 | `invalid_request_error` | `missing_api_key` | `null` |
| Invalid API key | 401 | `invalid_request_error` | `invalid_api_key` | `null` |
| Explicit model not allowed | 403 | `invalid_request_error` | `model_selection_not_allowed` | `model` |
| No compatible model | 400 | `invalid_request_error` | `no_compatible_model` | `model` |
| Budget exceeded | 429 | `insufficient_quota` | `budget_exceeded` | `null` |
| Provider/network error without upstream response | 502 | `server_error` | `provider_error` | `null` |
| OpenAI-compatible provider error | upstream status | upstream `type` | upstream `code` | upstream `param` |
| Forbidden dashboard scope | 403 | `invalid_request_error` | `forbidden_scope` | `consumer` |
| Validation error | 400 | `invalid_request_error` | `validation_error` | field name |

## 5. OpenAI-compatible endpoints

## 5.1 `GET /v1/models`

Returns models visible to the API key.

Response:

```json
{
  "object": "list",
  "data": [
    {
      "id": "auto",
      "object": "model",
      "owned_by": "finops-proxy"
    }
  ]
}
```

Admin response may include explicit provider/model entries:

```json
{
  "object": "list",
  "data": [
    {
      "id": "auto",
      "object": "model",
      "owned_by": "finops-proxy"
    },
    {
      "id": "openrouter/anthropic/claude-sonnet",
      "object": "model",
      "owned_by": "openrouter"
    }
  ]
}
```

## 5.2 `POST /v1/chat/completions`

Request:

```json
{
  "model": "auto",
  "messages": [
    {
      "role": "user",
      "content": "Resume esto en una frase."
    }
  ],
  "stream": false
}
```

Supported request fields:

```text
model
messages
max_tokens
stream
tools
tool_choice
response_format
temperature
top_p
stop
presence_penalty
frequency_penalty
seed
user
```

Rules:

- `model = auto` is allowed for all valid API keys.
- Explicit `model` is allowed only if `can_select_model = true`.
- If `max_tokens` is missing, backend applies category default.
- If `stream = true`, backend returns OpenAI-compatible server-sent events.
- If a streamed provider call returns an HTTP error before the stream opens, backend
  forwards the provider's OpenAI-compatible error envelope and status as a normal JSON
  error response.
- If a streamed provider call fails after the stream has opened, backend cannot change
  the HTTP status. If no content chunk has been sent yet, backend emits a visible
  `provider_error` chunk before closing; otherwise it closes the stream and records
  `provider_stream_error`.
- Semantic cache: before calling the provider, the proxy may reuse a recent
  pgvector-backed response for the same consumer, selected provider/model and
  generation parameters when the latest user prompt similarity is at least
  `SEMANTIC_CACHE_SIMILARITY_THRESHOLD` (default `0.95`). Cache hits are audited as
  `status = semantic_cache_hit`, `usage_source = semantic_cache`, with zero actual
  model/backend cost and zero budget charge. Prompt embeddings normalize leading
  markdown prefixes, greetings and accents, so variants such as `* Hola,
  cómo...` and `Como...` can match without lowering the global threshold.
- Requests involving real or forced tool calling never use semantic cache. This
  includes `tool_choice = required`, an explicit function/tool choice,
  `role = tool/function`, `tool_calls` and `function_call`. Merely advertising
  available tools with `tool_choice: "auto"` is cacheable when the stored
  response contains normal assistant text and no tool calls.
- The proxy does not execute tools.

Non-stream response follows OpenAI Chat Completions shape. The `model` field
must be the selected provider/model identifier.

Example:

```json
{
  "id": "chatcmpl_demo_001",
  "object": "chat.completion",
  "created": 1782890400,
  "model": "google/gemini-2.5-flash-lite-preview-09-2025",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Resumen generado por el backend de demo."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 118,
    "completion_tokens": 72,
    "total_tokens": 190
  }
}
```

## 6. Dashboard endpoints

All endpoints in this section require API key auth.

## 6.1 `GET /dashboard/me`

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

## 6.2 `GET /dashboard/summary`

Query params:

```text
consumer optional, admin only
```

Consumer response:

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

`total_savings` is the sum of `estimated_savings` across degraded requests in
the scope (routing/degradation savings). See BACKEND_CONTEXT §10.6.

Admin global response:

```json
{
  "scope": "admin",
  "consumer": null,
  "current_spend": 42.75,
  "budget": 100.0,
  "budget_used_pct": 0.4275,
  "projected_spend": 118.4,
  "forecast_status": "projected_over_budget",
  "requests_count": 128,
  "degraded_requests": 12,
  "blocked_requests": 3,
  "alerts_count": 4,
  "total_savings": 0.0187,
  "currency": "USD"
}
```

## 6.3 `GET /dashboard/usage/consumers`

Query params:

```text
time_range optional, default 24h
```

Response:

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

`total_savings` is the sum of `estimated_savings` across degraded requests for
that consumer (routing/degradation savings). See BACKEND_CONTEXT §10.6.

Consumer role returns one item for its own consumer.

## 6.4 `GET /dashboard/usage/requests`

Query params:

```text
consumer optional, admin only
category optional
provider optional
model optional
routing_source optional
budget_action optional
status optional
usage_source optional
time_range optional, default 24h
page optional, default 1
page_size optional, default 25, max 100
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

The savings fields (`baseline_provider`, `baseline_model`, `baseline_model_cost`,
`estimated_savings`, `estimated_savings_ratio`) are non-null only when
`budget_action = "degraded"`. Example of a degraded row:

```json
{
  "id": "audit_017",
  "consumer": "equipo-marketing",
  "requested_model": "auto",
  "selected_provider": "fireworks",
  "selected_model": "accounts/fireworks/models/glm-5p1",
  "baseline_provider": "openrouter",
  "baseline_model": "anthropic/claude-sonnet",
  "category": "qa_internal",
  "complexity_tier": "high",
  "estimated_model_cost": 0.00021,
  "actual_model_cost": 0.00019,
  "baseline_model_cost": 0.00104,
  "estimated_savings": 0.00083,
  "estimated_savings_ratio": 0.80,
  "budget_action": "degraded",
  "status": "degraded"
}
```

## 6.5 `GET /dashboard/budgets`

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

Consumer role returns only own consumer.

## 6.6 `POST /dashboard/budgets/{consumer}`

Admin only.

Request:

```json
{
  "budget": 15.0,
  "warning_threshold": 0.8
}
```

Validation:

```text
budget > 0
0.1 <= warning_threshold <= 0.99
```

Response:

```json
{
  "consumer": "equipo-marketing",
  "budget": 15.0,
  "warning_threshold": 0.8,
  "currency": "USD"
}
```

Consumer role:

```text
HTTP 403
code = forbidden_scope
```

## 6.7 `GET /dashboard/forecast`

Admin returns all visible consumers. Consumer returns own consumer.

Response:

```json
{
  "items": [
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
      "budget_exhaustion_at": "2026-07-23T18:00:00Z"
    }
  ]
}
```

## 6.8 `GET /dashboard/forecast/{consumer}`

Admin may request any consumer. Consumer may request only own consumer.

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

Forbidden consumer scope:

```text
HTTP 403
code = forbidden_scope
```

## 6.9 `GET /dashboard/alerts`

Query params:

```text
consumer optional, admin only
severity optional
type optional
time_range optional, default 24h
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

## 6.10 `GET /dashboard/recommendations`

Query params:

```text
consumer optional, admin only
type optional
severity optional
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

## 7. Frontend formatting expectations

The backend returns raw numeric values. Frontend formats them.

Currency:

```text
amount >= 1 -> $12.34
amount < 1 -> $0.000041
```

Percent:

```text
0.84 -> 84%
```

Latency:

```text
1840 -> 1.84s
450 -> 450ms
```

## 8. Admin routing configuration

Purpose: allow MVP admins to configure baseline routing per:

```text
consumer/equipo -> category -> complexity_tier -> provider -> model
```

Consumer role must receive:

```text
HTTP 403
code = forbidden_scope
```

### 8.1 `GET /dashboard/routing-catalog`

Admin only. Returns manually maintained provider/model metadata for the routing
UI. This data is not inferred from `/v1/models`, and it is separate from the
category/tier defaults used by automatic routing.

Response:

```json
{
  "providers": [
    {
      "id": "tabbyapi",
      "display_name": "TabbyAPI",
      "base_url": "http://127.0.0.1:5000/v1",
      "supports_chat_completions": true,
      "supports_streaming": true
    }
  ],
  "models": [
    {
      "provider": "tabbyapi",
      "model": "gemma-4-12B-it-exl3",
      "display_name": "Gemma 4 12B IT EXL3",
      "capabilities": ["text"],
      "input_price_per_1m_tokens": 0.0,
      "output_price_per_1m_tokens": 0.0
    }
  ],
  "categories": ["qa_internal", "web_search", "code_generation", "misc"],
  "complexity_tiers": ["low", "medium", "high"]
}
```

### 8.2 `GET /dashboard/routing-config`

Admin only.

Rows with `"consumer": "global"` represent the global fallback route. The
backend stores that route as `consumer = null`; `global` is the HTTP/UI alias.

Response:

```json
{
  "items": [
    {
      "consumer": "equipo-marketing",
      "category": "code_generation",
      "complexity_tier": "medium",
      "default_provider": "fireworks",
      "default_model": "accounts/fireworks/models/glm-5p1",
      "configured_provider": "tabbyapi",
      "configured_model": "gemma-4-12B-it-exl3",
      "routing_source": "admin_config",
      "enabled": true,
      "model_capabilities": ["text", "tool_calling"],
      "input_price_per_1m_tokens": 0.20,
      "output_price_per_1m_tokens": 0.60,
      "updated_at": "2026-07-01T10:00:00Z",
      "updated_by_api_key_id": "key_admin"
    }
  ]
}
```

Allowed `routing_source`:

```text
catalog
admin_config
```

### 8.3 `PUT /dashboard/routing-config/{consumer}/{category}/{complexity_tier}`

Admin only.

Request:

```json
{
  "provider": "tabbyapi",
  "model": "gemma-4-12B-it-exl3",
  "enabled": true
}
```

Validation:

```text
consumer must be a known consumer or the reserved alias global
category must be one of API_CONTRACT §3 category
complexity_tier must be one of API_CONTRACT §3 complexity_tier
provider must exist in the manually maintained provider catalog
model must exist under provider in the manually maintained model catalog
model must be the exact provider model id (for TabbyAPI, the loaded model name)
capabilities are validated at request time against the selected model
```

`global` is reserved for routing configuration and cannot be used as a real
consumer/team id.

Response:

```json
{
  "consumer": "equipo-marketing",
  "category": "code_generation",
  "complexity_tier": "medium",
  "default_provider": "fireworks",
  "default_model": "accounts/fireworks/models/glm-5p1",
  "configured_provider": "tabbyapi",
  "configured_model": "gemma-4-12B-it-exl3",
  "routing_source": "admin_config",
  "enabled": true,
  "updated_at": "2026-07-01T10:00:00Z",
  "updated_by_api_key_id": "key_admin"
}
```

### 8.4 `DELETE /dashboard/routing-config/{consumer}/{category}/{complexity_tier}`

Admin only. Resets that route to the next fallback. Deleting a team route falls
back to `global` if present, otherwise to the catalog default. Deleting a
`global` route falls back to the catalog default.

Response:

```json
{
  "consumer": "equipo-marketing",
  "category": "code_generation",
  "complexity_tier": "medium",
  "routing_source": "catalog",
  "default_provider": "fireworks",
  "default_model": "accounts/fireworks/models/glm-5p1",
  "configured_provider": null,
  "configured_model": null,
  "enabled": false
}
```

## 9. Contract version

```json
{
  "contract": "ai-finops-proxy-dashboard",
  "version": "0.3.0"
}
```

Changelog:

- `0.3.0`: added MVP admin routing configuration contract (§8) for
  `consumer -> category -> complexity_tier -> provider -> model` assignment.
- `0.2.0`: added routing/degradation savings. The v0.3 provider/model audit
  fields preserve that evidence via `baseline_provider`, `baseline_model`,
  `baseline_model_cost`, `estimated_savings` and `estimated_savings_ratio`
  on degraded request rows (§6.4), plus `total_savings` on
  `/dashboard/summary` (§6.2) and `/dashboard/usage/consumers` (§6.3).
  See BACKEND_CONTEXT §10.6.
- `0.1.0`: initial contract.
