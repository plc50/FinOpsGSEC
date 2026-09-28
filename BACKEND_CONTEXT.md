# Backend Implementation Context — AI FinOps Proxy

Este documento define el contexto de implementación del backend: proxy OpenAI-compatible, persistencia, routing, presupuestos, auditoría, forecast y APIs para dashboard. Debe tratarse como especificación funcional para implementar el MVP.

## 1. Alcance del backend

El backend debe implementar:

- API OpenAI-compatible mínima:
  - `GET /v1/models`
  - `POST /v1/chat/completions`
- Autenticación por API key interna usando `Authorization: Bearer <key>`.
- Resolución de consumidor, rol, permisos, presupuesto y catálogo visible.
- Routing automático cuando `model = "auto"`.
- Selección explícita de modelo solo para consumidores autorizados/admins.
- Cálculo de coste lógico, coste backend y overhead de routing.
- Control de presupuesto con warning, degradación y bloqueo.
- Auditoría por request.
- Agregación horaria de uso.
- Forecast MVP.
- APIs internas para dashboard admin/user.

Fuera del MVP:

- Cache semántica/vector DB.
- Cached tool plans.
- Ejecución de tools por el proxy.
- ML forecasting.
- What-if scenarios.
- Monte Carlo.

### 1.1 Arquitectura (separación de responsabilidades)

Tres capas: proxy (intercepción/routing/control), almacenamiento (auditoría y
agregados) y reporting (APIs de dashboard). Las claves de proveedor viven solo
en el proxy; los consumidores nunca las ven.

```mermaid
flowchart LR
  consumers["Consumidores internos (equipo-marketing, equipo-producto, ...)"]
  frontend["Dashboard frontend (industrial)"]

  subgraph proxyLayer [Proxy Layer]
    auth["Auth API key + rol/permisos"]
    classify["Clasificacion categoria + complejidad + capabilities"]
    router["Router: provider/model"]
    budget["Budget policy: warn / degrade / block"]
  end

  subgraph storageLayer [Storage Layer]
    audit["audit_records"]
    hourly["usage_hourly"]
  end

  subgraph reportingLayer [Reporting Layer]
    forecast["Forecast MVP"]
    dashApi["Dashboard API (/dashboard/*)"]
    alerts["Alerts + recommendations"]
  end

  subgraph providers [AI Providers]
    openrouter["openrouter"]
    fireworks["fireworks"]
    tabby["tabbyapi"]
  end

  consumers -->|"POST /v1/chat/completions"| auth
  auth --> classify --> router --> budget
  budget -->|"forward request"| openrouter
  budget --> fireworks
  budget --> tabby
  budget -->|"write audit row"| audit
  audit --> hourly
  hourly --> forecast
  audit --> dashApi
  hourly --> dashApi
  forecast --> dashApi
  audit --> alerts
  forecast --> alerts
  alerts --> dashApi
  frontend -->|"Bearer key /dashboard/*"| dashApi
```

### 1.2 Stack tecnologico

El backend se implementa en **Python + FastAPI**, gestionado con **uv** y
desarrollado con **TDD** (test-driven development).

| Capa | Eleccion | Motivo |
|---|---|---|
| Lenguaje | Python 3.11+ | Ecosistema LLM maduro; iteracion rapida |
| Framework HTTP | FastAPI + Uvicorn | ASGI async nativo, imprescindible para el streaming pass-through (§11) |
| Cliente HTTP saliente | httpx (async) | Streaming SSE hacia providers OpenAI-compatible, timeouts y errores de proveedor (§9.3) |
| Cliente OpenAI (opcional) | openai SDK | Backends demo son OpenAI-compatible; simplifica el reenvio |
| Validacion | Pydantic v2 | Modela contrato OpenAI, enums (§4, §12) y valida budgets (§6.6) |
| Persistencia | PostgreSQL 16 + SQLModel/SQLAlchemy (async) | `audit_records` y `usage_hourly` (§12/§13); `NUMERIC` exacto para coste y `percentile_cont` nativo para p95 (§13) |
| Driver DB | asyncpg (via SQLAlchemy async) | Acceso async a Postgres, coherente con FastAPI |
| Migraciones | Alembic | Versionado de esquema `audit_records`/`usage_hourly` |
| Tokenizer | tiktoken | `estimated_prompt_tokens` con fallback a `chars/4` (§8.2) |
| Config/catalogos | YAML/JSON + pydantic-settings | API keys, consumidores, providers y modelos (§3, §5) como config |
| Forecast/agregacion | stdlib (o pandas) | Forecast MVP (§14) es aritmetica de ventanas, sin ML |
| Seed | script Python | Sembrar 24h multi-proveedor con filas degraded/blocked (§13) |

#### Gestion de entorno y dependencias: uv

- Usar `uv` para el entorno virtual y las dependencias (`pyproject.toml` +
  `uv.lock`), no `pip`/`venv` manuales.
- Comandos base:

```bash
uv init
uv add fastapi uvicorn httpx pydantic pydantic-settings sqlmodel sqlalchemy asyncpg alembic tiktoken
uv add --dev pytest pytest-asyncio httpx respx coverage ruff
uv run uvicorn app.main:app --reload
uv run pytest
```

#### Base de datos: PostgreSQL

- Motor: **PostgreSQL 16**, accedido de forma async con SQLAlchemy + asyncpg.
- Levantar en local con Docker para dev y demo:

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: finops
      POSTGRES_PASSWORD: finops
      POSTGRES_DB: finops
    ports:
      - "5432:5432"
    volumes:
      - finops_pgdata:/var/lib/postgresql/data
volumes:
  finops_pgdata:
```

- Conexion via variable de entorno:

```text
DATABASE_URL=postgresql+asyncpg://finops:finops@localhost:5432/finops
```

- Usar tipo `NUMERIC` para todos los campos de coste/`budget_charge`/ahorro y
  aprovechar `percentile_cont(0.95)` para `p95_latency` (§13) y `date_trunc`
  para las ventanas del forecast (§14).
- Esquema versionado con Alembic (`uv run alembic upgrade head`).

#### Metodologia: TDD

El desarrollo sigue el ciclo red-green-refactor. Se escribe primero el test que
falla, luego el minimo codigo para pasarlo, y despues se refactoriza.

- Framework: **pytest** + **pytest-asyncio** para endpoints async.
- HTTP de FastAPI: **httpx.AsyncClient** contra la app ASGI.
- Base de datos en tests: usar una **Postgres de test** (misma imagen del
  `docker-compose`, base `finops_test`), con fixtures que envuelven cada test en
  una transaccion con rollback para aislamiento. No mockear la DB: se testea
  contra el motor real para validar `NUMERIC`, percentiles y `date_trunc`.
- Backends de IA: mockear con **respx** (o dobles OpenAI-compatible) para no
  depender de proveedores reales en los tests.
- Cobertura minima orientativa de las reglas de negocio criticas:
  - Categorizacion determinista y decision de categoria (§6).
  - Complejidad y tier (§8).
  - Filtro de capabilities y `no_compatible_model` (§7).
  - Coste logico/backend y `budget_charge` (§10.2-§10.4).
  - Politica de presupuesto: allow/warn/degrade/block y ahorro estimado (§10.5-§10.6).
  - Forecast MVP y estados on_track/at_risk/projected_over_budget (§14).
  - Permisos por rol en dashboard y `forbidden_scope` (§15).
  - Triggers de alertas (§16.1).
- Orden TDD sugerido: replicar §17 escribiendo el test de cada paso antes de la
  implementacion.

## 2. Contrato OpenAI-compatible

### 2.1 `GET /v1/models`

Devuelve modelos visibles según la API key.

Consumidor normal:

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

Admin o consumidor con permiso de selección explícita:

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
      "id": "openrouter/anthropic/claude-sonnet-5",
      "object": "model",
      "owned_by": "openrouter"
    }
  ]
}
```

Regla `owned_by`:

- `auto` -> `finops-proxy`
- modelo explícito -> provider antes del primer `/`, por ejemplo `openrouter`,
  `fireworks` o `tabbyapi`

### 2.2 `POST /v1/chat/completions`

Body mínimo aceptado:

```json
{
  "model": "auto",
  "messages": [
    {
      "role": "user",
      "content": "Resume esto en una frase."
    }
  ]
}
```

Campos relevantes que el backend debe soportar o reenviar:

| Campo | Uso backend |
|---|---|
| `model` | `auto` activa routing. Modelo explícito requiere permiso. |
| `messages` | Base para clasificación, token estimation, prompt fingerprint y backend request. |
| `max_tokens` | Si falta, backend añade default por categoría. |
| `stream` | Si `true`, usar streaming pass-through con auditoría al cierre. |
| `tools` | Añade capacidad requerida `tool_calling`; proxy no ejecuta tools. |
| `tool_choice` | Añade capacidad requerida `tool_calling` solo si hay `tools`; proxy no ejecuta tools. |
| `response_format` | JSON schema/object añade capacidad requerida `structured_outputs`. |
| `temperature`, `top_p`, `stop`, `presence_penalty`, `frequency_penalty`, `seed`, `user` | Reenviar sin usarlos para routing. |
| Campos desconocidos | Reenviar sin interpretar. No deben guardarse en auditoría salvo allowlist explícita. |

El proxy puede transformar la request enviada al provider:

- Sustituir `model`/`auto` por el nombre exacto del modelo en el provider.
- Añadir `max_tokens` si falta.
- Añadir/ajustar opciones necesarias para compatibilidad del provider.

El proxy no debe modificar `messages` en el MVP. Si el provider/model elegido no
soporta el formato/capacidad requerido por `messages`, debe devolver
`no_compatible_model`.

## 3. Autenticación, consumidores y roles

### 3.1 API key

Toda request protegida debe incluir:

```http
Authorization: Bearer <consumer_api_key>
```

La API key nunca se guarda completa en auditoría. Guardar solo:

```text
api_key_id
api_key_prefix
```

### 3.2 Config de consumidores

Config mínima:

```json
{
  "api_keys": {
    "finops_key_marketing": {
      "api_key_id": "key_marketing",
      "consumer": "equipo-marketing",
      "role": "consumer",
      "can_select_model": false
    },
    "finops_key_producto": {
      "api_key_id": "key_producto",
      "consumer": "equipo-producto",
      "role": "consumer",
      "can_select_model": false
    },
    "finops_key_atencion": {
      "api_key_id": "key_atencion",
      "consumer": "equipo-atencion-cliente",
      "role": "consumer",
      "can_select_model": false
    },
    "finops_key_admin": {
      "api_key_id": "key_admin",
      "consumer": "admin",
      "role": "admin",
      "can_select_model": true
    }
  }
}
```

### 3.3 Consumidores MVP

| Consumer | Consumer score | Presupuesto demo | Puede seleccionar modelo |
|---|---:|---:|---|
| `equipo-atencion-cliente` | 0.10 | Bajo | No |
| `equipo-marketing` | 0.30 | Medio | No |
| `equipo-producto` | 0.60 | Alto | No por defecto |
| `admin` | No aplica | Admin/global | Sí |

Los presupuestos deben ser configurables. Los valores concretos pueden vivir en seed/config.

## 4. Errores OpenAI-compatible

Todos los errores externos deben seguir:

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

| Caso | HTTP | `type` | `code` | `param` |
|---|---:|---|---|---|
| Falta API key | 401 | `invalid_request_error` | `missing_api_key` | `null` |
| API key inválida | 401 | `invalid_request_error` | `invalid_api_key` | `null` |
| Modelo explícito no permitido | 403 | `invalid_request_error` | `model_selection_not_allowed` | `model` |
| No hay modelo compatible | 400 | `invalid_request_error` | `no_compatible_model` | `model` |
| Presupuesto superado | 429 | `insufficient_quota` | `budget_exceeded` | `null` |
| Backend/proveedor falla sin respuesta upstream | 502 | `server_error` | `provider_error` | `null` |
| Proveedor devuelve error OpenAI-compatible | upstream status | upstream `type` | upstream `code` | upstream `param` |
| Dashboard scope no permitido | 403 | `invalid_request_error` | `forbidden_scope` | `consumer` |
| Error de validación | 400 | `invalid_request_error` | `validation_error` | field name |

## 5. Catálogos backend

### 5.1 Model catalog

Cada entrada de modelo enrutable debe tener metadatos mantenidos manualmente
por el equipo. Estos datos no se infieren de `/v1/models`, porque el endpoint
OpenAI-compatible no expone categoría, tier, precio ni capacidades.

```json
{
  "provider": "fireworks",
  "model": "accounts/fireworks/models/glm-5p1",
  "display_name": "GLM 5.1",
  "input_price_per_1m_tokens": 0.20,
  "output_price_per_1m_tokens": 0.20,
  "capabilities": ["text", "structured_outputs"]
}
```

Trade-off coste/calidad (criterio explícito de degradación):

- La degradación solo baja de `tier` dentro de la MISMA categoría y respetando
  capacidades (§10.5). Nunca cambia la tarea.
- Se acepta degradar cuando el ahorro estimado es material
  (`estimated_savings_ratio >= MIN_DEGRADATION_SAVINGS`, es decir, >= 25 %),
  asumiendo que `tier = high | medium | low` es la señal local de calidad/coste.
- `code_generation` y `qa_internal` de tier `high` son los más sensibles a
  calidad; la degradación aquí solo se aplica bajo presión de presupuesto
  (warning threshold alcanzado), no por defecto.

`capabilities` permitidas:

```text
text
tool_calling
web_search
files
rag
vision
audio
structured_outputs
```

### 5.2 Defaults globales por categoría/tier

Los defaults viven en la sección `routing_defaults` de
`backend/config/provider_models.yaml`. El catálogo manual `provider_models`
describe modelos/precios/capacidades; `routing_defaults` asigna
`category + tier -> provider + exact model name`.

`tier` permitido:

```text
low | medium | high
```

`category` permitido:

```text
qa_internal | web_search | code_generation | misc
```

| Category | High | Medium | Low |
|---|---|---|---|
| `qa_internal` | `openrouter/anthropic/claude-sonnet-5` | `fireworks/accounts/fireworks/models/gpt-oss-120b` | `tabbyapi/gemma-4-12B-it-exl3` |
| `web_search` | `openrouter/perplexity/sonar-pro-search` | `openrouter/x-ai/grok-4.20` | `openrouter/perplexity/sonar` |
| `code_generation` | `openrouter/anthropic/claude-sonnet-5` | `fireworks/accounts/fireworks/models/deepseek-v4-pro` | `tabbyapi/gemma-4-12B-it-exl3` |
| `misc` | `openrouter/anthropic/claude-sonnet-5` | `fireworks/accounts/fireworks/models/glm-5p1` | `tabbyapi/gemma-4-12B-it-exl3` |

### 5.3 Provider catalog

Cada provider OpenAI-compatible debe tener:

```json
{
  "id": "tabbyapi",
  "display_name": "TabbyAPI",
  "base_url": "http://127.0.0.1:5000/v1",
  "auth": null,
  "supports_chat_completions": true,
  "supports_streaming": true
}
```

MVP providers:

| Provider | Base URL | Auth |
|---|---|---|
| `openrouter` | `https://openrouter.ai/api/v1` | `bearer` via `OPENROUTER_API_KEY` |
| `fireworks` | `https://api.fireworks.ai/inference/v1` | `bearer` via `FIREWORKS_API_KEY` |
| `tabbyapi` | `http://127.0.0.1:5000/v1` | `bearer` via `TABBY_API_KEY` |

## 6. Categoría

### 6.1 Categorías permitidas

```text
qa_internal
web_search
code_generation
misc
```

### 6.2 Reglas deterministas

Cada regla devuelve:

```json
{
  "category": "code_generation",
  "confidence": 0.98,
  "source": "rules"
}
```

Reglas iniciales:

| Señal | Category | Confidence |
|---|---|---:|
| Bloque de código fenced, stacktrace, error de build, SQL explícito | `code_generation` | 0.95-0.99 |
| "últimas noticias", "fuentes actuales", "busca en internet", "precio actual" | `web_search` | 0.95 |
| "documentación interna", "política", "CRM", "ticket", "procedimiento interno" | `qa_internal` | 0.80-0.95 |
| "traduce", "resume", "reformula", "dame ideas" sin otra señal fuerte | `misc` | 0.70-0.85 |

### 6.3 Clasificador pequeño

Usar solo si reglas no alcanzan confianza suficiente.

Input:

```json
{
  "messages_text": "Concatenation of text parts from the last user message and relevant short context, truncated to 2000 characters.",
  "allowed_categories": ["qa_internal", "web_search", "code_generation", "misc"]
}
```

Output requerido:

```json
{
  "category": "qa_internal",
  "confidence": 0.86
}
```

No incluir `reason`.

Config:

```text
CLASSIFIER_PROVIDER = fireworks
CLASSIFIER_MODEL = accounts/fireworks/models/deepseek-v4-flash
temperature = 0
max_tokens = 300
structured output / JSON schema if supported
```

### 6.4 Decisión de categoría

Algoritmo:

```text
if rule_result.confidence >= 0.95:
  category = rule_result.category
elif classifier_result.confidence >= 0.70:
  category = classifier_result.category
elif rule_result.confidence >= 0.70:
  category = rule_result.category
else:
  category = misc
```

Registrar:

```text
category
category_source = rules | classifier | fallback
rule_confidence
classifier_confidence
routing_overhead_cost
```

## 7. Required capabilities

Inicial:

```text
required_capabilities = ["text"]
```

Extracción:

| Condición | Añadir |
|---|---|
| `tools` existe | `tool_calling` |
| `tool_choice` existe sin `tools` | no añade capacidad |
| `tool_choice` existe | `tool_calling` |
| `response_format.type = json_schema` | `structured_outputs` |
| `response_format.type = json_object` | `structured_outputs` |
| mensaje contiene imagen | `vision` |
| mensaje contiene audio | `audio` |
| mensaje contiene archivo | `files` |
| `category = web_search` | `web_search` |

The proxy does not execute tools. Solo filtra modelos que soporten `tool_calling`.

Si no hay modelo compatible:

```text
HTTP 400
code = no_compatible_model
```

## 8. Complejidad

### 8.1 Formula

```text
complexity_score =
  0.35 * prompt_length_score
+ 0.35 * category_score
+ 0.20 * context_score
+ 0.10 * consumer_score
```

### 8.2 Prompt tokens

Pre-call:

```text
estimated_prompt_tokens =
  tokenizer_count(messages) if tokenizer available
  else ceil(total_text_chars / 4)
```

Post-call:

```text
actual_prompt_tokens =
  response.usage.prompt_tokens if present
  else estimated_prompt_tokens
```

### 8.3 Prompt length score

| Estimated prompt tokens | Score |
|---:|---:|
| `0 - 250` | 0.10 |
| `251 - 1_000` | 0.35 |
| `1_001 - 4_000` | 0.65 |
| `4_001 - 12_000` | 0.85 |
| `> 12_000` | 1.00 |

### 8.4 Category score

| Category | Score |
|---|---:|
| `misc` | 0.10 |
| `qa_internal` | 0.35 |
| `web_search` | 0.65 |
| `code_generation` | 0.75 |

### 8.5 Context score

Use number of prior messages in `messages` excluding current last user message.

| Prior messages | Score |
|---:|---:|
| `0` | 0.00 |
| `1 - 4` | 0.25 |
| `5 - 12` | 0.50 |
| `13 - 30` | 0.80 |
| `> 30` | 1.00 |

### 8.6 Consumer score

| Consumer | Score |
|---|---:|
| `equipo-atencion-cliente` | 0.10 |
| `equipo-marketing` | 0.30 |
| `equipo-producto` | 0.60 |
| `admin` | 0.30 |

### 8.7 Tier

| Complexity score | Tier |
|---:|---|
| `< 0.35` | `low` |
| `0.35 - 0.69` | `medium` |
| `>= 0.70` | `high` |

## 9. Routing

### 9.1 Normal consumer

If `model != "auto"` and consumer is not authorized:

```text
HTTP 403
code = model_selection_not_allowed
```

If `model = "auto"`:

```text
category -> complexity tier -> candidate provider/models -> capability filter -> budget policy -> selected_provider + selected_model
```

The YAML catalog provides initial defaults for the category/tier to
provider/model mapping. Admin routing configuration (§9.4) is the normal control
plane for changing those mappings as model releases evolve.

### 9.2 Admin explicit model

If admin sends explicit model:

- Validate model exists in the provider/model catalog.
- Validate required capabilities.
- Calculate category and complexity as advisory signals.
- Enforce budget.
- Use selected provider/model unless blocked by capability/budget.

### 9.3 Backend fallback

Fallback is technical only.

Allowed:

```text
same selected provider/model
different compatible transport endpoint only when configured for that provider/model
```

Not allowed:

```text
change category during fallback
change provider/model during fallback
ignore capabilities
```

### 9.4 Admin-managed routing configuration

MVP admins must be able to configure automatic routing from the dashboard per:

```text
consumer/equipo -> category -> complexity_tier -> provider -> model
```

This is a routing-control feature, not a provider-secret feature. Provider
credentials remain server-side only.

Expected persistent model:

```text
routing_config
  id
  consumer nullable  # null means global default
  category
  complexity_tier
  provider
  model
  enabled
  created_at
  updated_at
  updated_by_api_key_id
```

HTTP/dashboard APIs represent the nullable global row with the reserved path
and response value `global`; storage keeps `consumer = null`.

Resolution order for `model = "auto"`:

```text
1. classify category + complexity_tier + required_capabilities
2. if active team routing_config exists for consumer/category/tier:
     use provider/model as baseline routing choice
3. otherwise use active global routing_config for category/tier
4. otherwise use YAML catalog baseline
5. validate provider/model exists in the manually maintained model catalog
6. validate required_capabilities against model capabilities at request time
   (OpenAI clients such as OpenWebUI/opencode provide capabilities through the
   request; the admin UI cannot know every future request shape)
7. apply budget policy (warn/degrade/block)
8. if degradation is needed, choose the same consumer/category route one tier
   lower; if missing, use the global lower-tier route; if missing there too,
   use the YAML catalog lower-tier route; if still missing or incompatible,
   warn_only
9. apply technical backend fallback only within the selected provider/model
```

Invariants:

- Consumer role cannot read or mutate routing configuration.
- `global` is a reserved routing-config consumer alias and cannot be used as a
  real team/consumer id.
- The same provider/model may be assigned to many categories and tiers.
- The admin UI may assign any model to any category; category is a route
  dimension, not a hard model-eligibility constraint.
- Routing configuration does not implement budget behavior. It defines the
  baseline provider/model; §10 budget policy runs afterwards.
- Audit records should include `routing_source = catalog | admin_config` and
  `routing_config_id` so decisions are explainable later.
- Budget degradation still wins over configured routing when the consumer is in
  the warning band and a one-tier-lower compatible route satisfies §10.5.
- Provider/model catalog metadata is manually maintained for MVP. Exact provider
  model names must be used; for TabbyAPI, for example, `model` must match the
  loaded model name such as `gemma-4-12B-it-exl3`.

## 10. Budget policy

### 10.1 Output token estimate

If client sends `max_tokens`:

```text
effective_max_tokens = client.max_tokens
max_tokens_source = client
```

If missing:

```text
effective_max_tokens = DEFAULT_MAX_TOKENS[category]
max_tokens_source = proxy_default
```

Defaults:

| Category | Default max tokens |
|---|---:|
| `misc` | 300 |
| `qa_internal` | 700 |
| `web_search` | 1000 |
| `code_generation` | 1500 |

Estimated output:

```text
estimated_output_tokens = effective_max_tokens
```

### 10.2 Estimated model cost

Prices are per 1M tokens.

```text
estimated_model_cost =
  (estimated_prompt_tokens / 1_000_000) * model_input_price_per_1m
+ (estimated_output_tokens / 1_000_000) * model_output_price_per_1m
```

### 10.3 Post-call actual model cost

```text
actual_model_cost =
  (actual_prompt_tokens / 1_000_000) * model_input_price_per_1m
+ (actual_output_tokens / 1_000_000) * model_output_price_per_1m
```

If `usage` missing:

```text
usage_source = estimated
actual_prompt_tokens = estimated_prompt_tokens
actual_output_tokens = estimated_output_tokens
actual_model_cost = estimated_model_cost
```

If `usage` present:

```text
usage_source = provider
```

### 10.4 Budget charge

```text
budget_charge = actual_model_cost + routing_overhead_cost
```

For pre-check:

```text
estimated_budget_charge = estimated_model_cost + estimated_routing_overhead_cost
```

### 10.5 Warning/degradation/blocking

Constants:

```text
WARNING_THRESHOLD = 0.80
MIN_DEGRADATION_SAVINGS = 0.25
EXPENSIVE_REQUEST_THRESHOLD = 0.01   # USD budget_charge for a single request
COST_SPIKE_MULTIPLIER = 3.0          # current hourly rate vs 24h avg hourly rate
```

Policy:

```text
if current_spend + estimated_budget_charge > budget_limit:
  block with budget_exceeded

elif current_spend / budget_limit >= WARNING_THRESHOLD:
  # Bounded to a single tier jump (§5.1): only the model exactly one tier
  # below the baseline, same category, capability-compatible.
  if a compatible model one tier lower exists
     and estimated_savings_ratio >= MIN_DEGRADATION_SAVINGS:
       degrade   # high->medium or medium->low; never skip a tier
  else:
       warn_only

else:
  allow
```

Degradation must not change category or violate required capabilities.

### 10.6 Estimated savings on degradation

When `budget_action = degraded`, the proxy must quantify the savings versus the
model that would have been selected without degradation (the baseline).

```text
baseline_provider / baseline_model =
  provider/model selected before degradation
  (category + complexity tier, no budget adjustment)

baseline_model_cost =
  (estimated_prompt_tokens / 1_000_000) * baseline_input_price_per_1m
+ (estimated_output_tokens / 1_000_000) * baseline_output_price_per_1m

estimated_savings = baseline_model_cost - estimated_model_cost

estimated_savings_ratio =
  estimated_savings / baseline_model_cost   if baseline_model_cost > 0
  else 0
```

Rules:

- Only populated when `budget_action = degraded`. Otherwise all four values are
  `null` (contract expects `null` when not degraded).
- `estimated_savings_ratio` reuses the same ratio compared against
  `MIN_DEGRADATION_SAVINGS` in the degradation decision (§10.5).
- Savings are estimates (pre-call). They are not recomputed post-call.

## 11. Streaming

If `stream != true`, normal request/response.

If `stream = true`:

1. Run all pre-checks before opening backend stream.
2. If allowed, open stream to backend.
3. Forward chunks OpenAI-compatible.
4. Accumulate final text if needed for token fallback.
5. On stream end, finalize audit record.

Do not cut stream mid-flight if final cost exceeds budget.

If final cost exceeds budget:

```text
status = completed
post_stream_budget_overrun = true
trigger = projection/budget alert
future requests may be blocked/degraded
```

If client disconnects:

```text
status = cancelled_by_client
usage_source = provider if final usage exists else estimated
```

If backend stream fails:

```text
status = provider_stream_error
if provider returns HTTP error before stream opens, forward upstream status/body
as normal JSON error response
if stream has already opened and no content chunk was sent, emit a visible
provider_error chunk before closing
if content was already sent, close the stream and audit provider_stream_error
```

### 11.1 Semantic cache with pgvector

Before calling a provider, the proxy may reuse a recent cached response from
`semantic_cache_entries` when all conditions are true:

- `SEMANTIC_CACHE_ENABLED = true`.
- PostgreSQL has the `vector` extension and the cache table exists.
- The request has no real or forced tool calling (`tool_choice = required`, an
  explicit function/tool choice, `role = tool/function`, `tool_calls` or
  `function_call`). Advertising available tools with `tool_choice: "auto"` is
  cacheable when the stored response is normal assistant text and contains no
  tool calls.
- Required capabilities are text-only.
- Same consumer, selected provider/model and generation fingerprint.
- Latest user prompt embedding cosine similarity is at least
  `SEMANTIC_CACHE_SIMILARITY_THRESHOLD` (default `0.95`).
- Prompt embeddings normalize leading markdown prefixes, greetings and accents,
  so Spanish variants such as `* Hola, cómo funciona...` and
  `Como funciona...` can match without lowering the global threshold.
- Cache entry age is within `SEMANTIC_CACHE_MAX_AGE_SECONDS` (default `604800`,
  seven days).

Stored cache fields:

```text
embedding vector(384)
response JSONB
consumer
selected_provider
selected_model
model_id
generation_fingerprint
prompt_fingerprint
prompt_text
prompt_tokens
completion_tokens
total_tokens
cost
```

Cache hit audit:

```text
status = semantic_cache_hit
usage_source = semantic_cache
actual_model_cost = 0
backend_cost = 0
budget_charge = 0
```

On cache miss, the request follows the normal provider path. Completed non-stream
responses and successfully completed streams are stored unless excluded by the
same rules above.

## 12. Audit model

Persist one `audit_records` row per incoming Chat Completion Request.

Allowed `status` values (must match `request_status` in API_CONTRACT §3):

```text
completed
degraded
blocked
warn_only
semantic_cache_hit
cancelled_by_client
provider_error
provider_stream_error
```

Allowed `budget_action` values:

```text
allow
warn_only
degraded
blocked
```

If a request completes after degradation:

```text
status = degraded
budget_action = degraded
```

If a request completes normally:

```text
status = completed
budget_action = allow | warn_only
```

Required fields:

```text
id
timestamp_started
timestamp_completed
api_key_id
api_key_prefix
consumer
role
requested_model
requested_model_allowed
category
category_source
rule_confidence
classifier_confidence
complexity_score
complexity_tier
required_capabilities
selected_provider
selected_model
backend_fallback_used
baseline_provider
baseline_model
baseline_model_cost
estimated_savings
estimated_savings_ratio
routing_source
routing_config_id
max_tokens
max_tokens_source
estimated_prompt_tokens
actual_prompt_tokens
estimated_output_tokens
actual_output_tokens
usage_source
estimated_model_cost
actual_model_cost
routing_overhead_cost
backend_cost
budget_charge
estimated_budget_charge
budget_action
status
error_code
latency_ms
prompt_fingerprint
prompt_preview
stream
post_stream_budget_overrun
```

`baseline_provider`, `baseline_model`, `baseline_model_cost`,
`estimated_savings` and `estimated_savings_ratio` are populated only when
`budget_action = degraded` (see §10.6). They are `null` for any other
`budget_action`.

Do not store full prompts by default.

Prompt fingerprint:

```text
sha256(normalized_messages)
```

Prompt preview:

```text
first 200 chars of redacted text content
```

## 13. Usage aggregation

Create `usage_hourly` from `audit_records`.

Fields:

```text
bucket_start
consumer
category
provider
model
request_count
estimated_input_tokens
actual_input_tokens
estimated_output_tokens
actual_output_tokens
model_cost
routing_overhead_cost
backend_cost
estimated_savings
degraded_requests
blocked_requests
avg_latency
p95_latency
```

Aggregation rules:

- `model_cost = sum(actual_model_cost)`
- `routing_overhead_cost = sum(routing_overhead_cost)`
- `backend_cost = sum(backend_cost)`
- `estimated_savings = sum(estimated_savings)` over degraded rows
- `blocked_requests = count(status = blocked)`
- `degraded_requests = count(budget_action = degraded)`

Dashboard `total_savings` (in `/dashboard/summary` and each item of
`/dashboard/usage/consumers`) is `sum(estimated_savings)` over the scope
(global for admin, per-consumer otherwise), respecting the requested
`time_range`.

Seed `audit_records` or `usage_hourly` with demo data for the last 24h.

The seed must distribute requests across at least two configured providers
(`openrouter`, `fireworks`, `tabbyapi`) so the demo shows token capture and
cost tracking across providers (rubric Pilar 1.1). It must also include some
`budget_action = degraded` rows with non-null
`estimated_savings`, at least one `blocked` row, and enough hourly buckets to
produce a non-trivial forecast.

## 14. Forecast MVP

Use `usage_hourly`.

For each consumer:

```text
weighted_hourly_rate =
  0.50 * hourly_rate_from_last_15m
+ 0.30 * hourly_rate_from_last_1h
+ 0.20 * hourly_rate_from_last_24h

projected_period_cost =
  spend_so_far + weighted_hourly_rate * remaining_hours_in_period
```

If a window has no data, use the nearest larger populated window. If no window has data:

```text
projected_period_cost = spend_so_far
forecast_confidence = low
```

Status:

```text
if projected_period_cost <= 0.80 * budget_limit:
  forecast_status = on_track
elif projected_period_cost <= budget_limit:
  forecast_status = at_risk
else:
  forecast_status = projected_over_budget
```

Budget exhaustion:

```text
if weighted_hourly_rate > 0:
  budget_exhaustion_at =
    now + ((budget_limit - spend_so_far) / weighted_hourly_rate) hours
else:
  budget_exhaustion_at = null
```

## 15. Dashboard API

All dashboard endpoints require API key auth.

Role rules:

- Admin sees all consumers.
- Consumer sees only its own consumer/team data.
- Consumer must never see audit records, prompts, forecasts or costs of other consumers.

### 15.1 Endpoints

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
```

Admin endpoints for §9.4:

```text
GET /dashboard/routing-catalog
GET /dashboard/routing-config
PUT /dashboard/routing-config/{consumer}/{category}/{complexity_tier}
DELETE /dashboard/routing-config/{consumer}/{category}/{complexity_tier}
```

Permission rules:

| Endpoint | Admin | Consumer |
|---|---|---|
| `/dashboard/me` | Own auth context | Own auth context |
| `/dashboard/summary` | Global | Own consumer only |
| `/dashboard/usage/requests` | All | Own consumer only |
| `/dashboard/usage/consumers` | All | Own consumer only |
| `/dashboard/budgets` | All | Own consumer only |
| `POST /dashboard/budgets/{consumer}` | Allowed | Forbidden |
| `/dashboard/forecast` | All | Own consumer only |
| `/dashboard/forecast/{consumer}` | Any consumer | Own consumer only |
| `/dashboard/recommendations` | All | Own consumer only |
| `/dashboard/alerts` | All | Own consumer only |
| `/dashboard/routing-catalog` | Allowed | Forbidden |
| `/dashboard/routing-config` | Allowed | Forbidden |

### 15.2 Dashboard summary response

```json
{
  "scope": "admin",
  "current_spend": 42.75,
  "budget": 100.0,
  "projected_spend": 118.4,
  "forecast_status": "projected_over_budget",
  "requests_count": 128,
  "degraded_requests": 12,
  "blocked_requests": 3,
  "alerts_count": 4,
  "total_savings": 0.0187
}
```

Consumer scope:

```json
{
  "scope": "consumer",
  "consumer": "equipo-marketing",
  "current_spend": 8.4,
  "budget": 10.0,
  "projected_spend": 12.8,
  "forecast_status": "projected_over_budget",
  "requests_count": 41,
  "degraded_requests": 6,
  "blocked_requests": 1,
  "alerts_count": 2,
  "total_savings": 0.0049
}
```

## 16. Alerts and recommendations

Alerts:

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

### 16.1 Alert generation triggers

An alert row is created (once per triggering event) according to:

| `alert_type` | Trigger condition | Evaluated at | `severity` | `related_audit_record_id` |
|---|---|---|---|---|
| `budget_warning` | `current_spend / budget_limit >= WARNING_THRESHOLD` and below 1.0 | request finalize (§10.5) | `warning` | current record |
| `budget_exceeded` | pre-check blocks: `current_spend + estimated_budget_charge > budget_limit` | pre-check (§10.5) | `critical` | current record |
| `request_blocked` | request rejected with `budget_exceeded` (`status = blocked`) | pre-check (§10.5) | `critical` | current record |
| `model_degraded` | `budget_action = degraded` | routing/finalize (§10.5) | `warning` | current record |
| `projection_exceeded` | forecast recompute yields `forecast_status = projected_over_budget` | forecast run (§14) | `warning` | `null` |
| `expensive_request` | `budget_charge >= EXPENSIVE_REQUEST_THRESHOLD` | request finalize | `warning` | current record |
| `cost_spike` | current hourly rate `>= COST_SPIKE_MULTIPLIER * avg_hourly_rate_last_24h` (needs >= 1h of history) | usage aggregation (§13) | `warning` | `null` |
| `post_stream_budget_overrun` | `post_stream_budget_overrun = true` on a streamed request (§11) | stream finalize | `critical` | current record |
| `provider_error` | backend fails with no fallback (`status = provider_error`) | request finalize | `critical` | current record |

Deduplication:

- `budget_warning`, `projection_exceeded` and `cost_spike` should not be emitted
  again for the same consumer while the condition persists within the same
  evaluation window (e.g. one per hour). Per-request alerts
  (`budget_exceeded`, `request_blocked`, `model_degraded`, `expensive_request`,
  `post_stream_budget_overrun`, `provider_error`) are emitted once per audit record.

MVP recommendations:

```text
projected_over_budget
budget_degradation_recommendation
```

Recommendation payload:

```json
{
  "id": "rec_123",
  "type": "budget_degradation_recommendation",
  "consumer": "equipo-marketing",
  "severity": "warning",
  "message": "Marketing esta proyectado por encima del presupuesto. Degradar tareas misc de baja complejidad reduciria el gasto.",
  "created_at": "2026-07-01T10:00:00Z"
}
```

## 17. Implementation order

Cada paso se desarrolla con TDD (§1.2): escribir primero el test que falla,
luego el minimo codigo para pasarlo, y despues refactorizar. No se avanza al
siguiente paso hasta que sus tests estan en verde.

1. Test primero: Config/catalogs: API keys, consumers, provider/model catalog, budgets.
2. Test primero: Persistence: `audit_records`.
3. Test primero: `/v1/models`.
4. Test primero: `/v1/chat/completions` non-streaming pass-through.
5. Test primero: Category + complexity + capability filters.
6. Test primero: Logical cost + backend cost.
7. Test primero: Budget warning/degrade/block (incl. ahorro estimado §10.6).
8. Test primero: Dashboard summary + audit list.
9. Test primero: `usage_hourly` aggregation.
10. Test primero: Forecast MVP + seeded usage history.
11. Test primero: Alerts/recommendations (triggers §16.1).
12. Test primero: Streaming support.
13. Test primero: Admin explicit model selection.
14. Test primero: admin-only routing catalog API
    (`GET /dashboard/routing-catalog`) from manually maintained metadata.
15. Test primero: `routing_config` persistence and admin-only dashboard API
    (`GET`/`PUT`/`DELETE /dashboard/routing-config...`).
16. Test primero: `model = auto` uses admin routing configuration before budget
    policy while preserving category/capability invariants.
17. Test primero: audit records expose routing provenance
    (`routing_source`, `routing_config_id`) once the audit contract is finalized.
