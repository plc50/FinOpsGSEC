# PRESENTACION — Guion para el turno de 10 minutos

Guion para jueces técnicos de Mercedes-Benz, mapeado explícitamente a
`material/CHALLENGE.es.md` (criterios de aceptación + rúbrica de 110 pts).

---

## 1. Narrativa del problema (≈1 min)

Las empresas consumen IA generativa de varios proveedores a la vez y **nadie
tiene visibilidad real de cuánto se gasta, quién lo gasta ni si está
justificado** (Flexera 2025: 32% del gasto cloud se desperdicia). Nuestra
respuesta es la pieza de infraestructura que falta: un **proxy FinOps** que se
interpone entre los equipos internos y los proveedores de IA, y responde a las
cuatro preguntas FinOps: *quién* gasta, *cuánto* cuesta cada petición, *cuándo*
intervenir y *por qué* se justifica cada elección de modelo.

## 2. Arquitectura (≈1,5 min) — Pilar 4

- **Proxy transparente OpenAI-compatible.** Exponemos `/v1/chat/completions` y
  `/v1/models` idénticos a OpenAI: **cualquier front o harness funciona sin
  cambiar una línea** — lo demostramos con OpenWebUI y opencode apuntando a
  `http://localhost:8000/v1` con una key interna. Ese fue uno de los dos
  grandes esfuerzos del proyecto: transparencia y flexibilidad máximas.
- **Tres capas separadas** (diagrama en `README.md`): **proxy** (auth →
  clasificación → routing → política de presupuesto → caché), **almacenamiento**
  (audit_records + agregados horarios en Postgres/pgvector) y **reporting**
  (dashboard API, forecast, alertas, informes).
- **Multi-proveedor y agnóstico:** OpenRouter, Fireworks y **TabbyAPI con
  ExLlamaV3** local — los tres OpenAI-compatible, declarados por YAML; añadir
  un proveedor es configuración, no código. Elegimos TabbyAPI/ExLlamaV3 en vez
  de Ollama porque es un **motor de inferencia SOTA** (cuantización EXL3,
  mejor rendimiento en GPU doméstica).
- **Seguridad:** las claves de proveedor viven **solo dentro del proxy** y se
  inyectan server-side; los consumidores usan keys internas `finops_key_*` con
  scope aislado (403 si intentas leer datos de otro equipo, 401 sin key).

## 3. Cumplimiento punto por punto (≈1 min de transición + se demuestra en vivo)

### Criterios de aceptación (los 6 obligatorios)

| Criterio | Evidencia demoable |
|---|---|
| Intercepta y enruta inteligentemente entre ≥2 proveedores | `model=auto` → categoría (`misc`/`code_generation`/`web_search`/`qa_internal`) + complejidad (`low`/`medium`/`high`) + filtro de capabilities → página **Requests**: filas en openrouter, fireworks y tabbyapi |
| Tokens + coste registrados por petición | Detalle de cualquier fila: `prompt/output tokens` y coste calculado con las **tarifas del catálogo** |
| ≥2 consumidores con gasto independiente | **Consumers** (admin): marketing, producto y atención-cliente con gasto, presupuesto e historial separados |
| Presupuesto configurable → respuesta visible | Warning al 80% → **degradación un tier** si ahorro ≥25% → **bloqueo 429 `budget_exceeded`**; se fuerza en vivo bajando el presupuesto en **Budgets** |
| ≥2 criterios explícitos de ahorro | Ver §4 abajo — articulados y aplicados a datos reales |
| Demo en vivo | Todo contra el stack corriendo + `go-task verify` (11 PASS) en segunda pantalla |

### Los 5 pilares de la rúbrica

- **Pilar 1 · Visibilidad (25):** tokens por petición en los 3 proveedores;
  desglose por consumidor; coste verificable a mano contra el catálogo de tarifas.
- **Pilar 2 · Gobernanza (25):** presupuestos por consumidor editables en la UI;
  alertas (`budget_warning`, `budget_exceeded`, `request_blocked`,
  `model_degraded`, `cost_spike`, `projection_exceeded`); registro de auditoría
  completo filtrable; **forecast** con proyección de gasto y fecha estimada de
  agotamiento del presupuesto.
- **Pilar 3 · Criterios de ahorro (30):** ver §4.
- **Pilar 4 · Arquitectura (20):** agnóstico al proveedor (YAML), 3 capas,
  claves nunca expuestas.
- **Pilar 5 · Presentación (10):** este guion.

### Extras (más allá de la rúbrica)

- **Caché semántica** con pgvector: prompts equivalentes (similitud coseno
  **≥0.95**) se sirven de caché a **coste cero** — el segundo gran esfuerzo del
  proyecto.
- **Token reduction:** conversaciones largas se compactan automáticamente
  (se preserva system + últimos turnos, el resto se resume); campos
  `context_reduced` / `context_tokens_saved` en la auditoría.
- **Rate limiting** por consumidor (tokens/minuto, ventana deslizante) → 429 `rate_limited`.
- **Regla estática de política:** categorías restringidas por consumidor. Modo
  suave (`category_downgrades`): las peticiones de código de marketing se sirven
  reclasificadas a `misc` con modelos baratos (auditadas con `original_category`
  y alerta `category_downgraded`). Modo duro (`blocked_categories`): 403
  `blocked_category`. La elección bloquear-vs-degradar es una palanca de negocio.
- **Informes CSV y PDF** descargables (`/dashboard/reports/costs.csv|pdf`).
- **Pestaña Savings:** cuánto ahorra el proxy vs "todo al modelo premium sin
  caché". Separa ahorro **medido** (caché semántica, degradaciones, downgrades
  de categoría, token reduction — precios del catálogo sobre datos auditados)
  del **estimado** (smart routing, contrafactual explícito), con serie
  temporal apilada, desglose por mecanismo y por consumidor.

## 4. Los 2 criterios explícitos de ahorro (Pilar 3) (≈1 min)

1. **Enrutar cada tarea al tier más barato *compatible* con su complejidad.**
   Categoría + complejidad + filtro de capabilities (tool_calling,
   structured_outputs, web_search, vision) → el modelo más barato que puede
   hacer el trabajo. Tareas `misc` simples van a modelos baratos; código
   complejo mantiene tier alto.
2. **Degradar exactamente UN tier, solo bajo presión de presupuesto y con
   ahorro material.** Si `gasto/presupuesto ≥ 80%`, se busca el modelo un tier
   por debajo **en la misma categoría** que conserve las capabilities, y solo
   se degrada si el ahorro estimado es **≥25%**. Si no se cumple → se mantiene
   el baseline con warning. Si la petición rompería el presupuesto → 429.

**Trade-off coste/calidad:** la degradación está **acotada por diseño** — nunca
más de un tier, nunca cambia de categoría, nunca pierde una capability
requerida. Cada degradación registra `baseline_model`, ahorro estimado y ratio
en la fila de auditoría; el ahorro total agregado sale en el dashboard.

**Dónde se ve:** la pestaña **Savings** agrega todo el ahorro — real gastado vs
baseline sin proxy, % de reducción de coste, run-rate mensual y desglose por
mecanismo — distinguiendo con badges lo **medido** de lo **estimado**.

## 5. Guion minuto a minuto (10 min)

| Min | Qué haces | Qué demuestra |
|---|---|---|
| 0–1 | Narrativa del problema (§1). | Pilar 5: historia clara. |
| 1–2,5 | Diagrama de arquitectura + "cualquier cliente OpenAI-compatible funciona sin cambios". | Pilar 4 completo. |
| 2,5–4 | **Dashboard Overview + Requests:** enviar 2–3 prompts distintos (chat, web, código) con `model=auto` desde OpenWebUI/curl; ver aparecer las filas en vivo (badge "Live") con proveedor/modelo distintos, tokens y coste. Abrir un detalle. | AC1 + AC2, Pilar 1. |
| 4–5 | **Consumers:** tres equipos con gasto diferenciado. **Forecast:** proyección y fecha de agotamiento. | AC3, Pilar 2. |
| 5–6,5 | **Budgets:** bajar el presupuesto de marketing → petición → **429 budget_exceeded** + alerta. Mostrar filas ámbar `degraded` con baseline vs elegido y ahorro. Restaurar presupuesto. | AC4 + AC5, Pilares 2 y 3. |
| 6,5–8 | **Extras encadenados:** repetir un prompt parafraseado → **cache hit a $0**; pedir código desde OpenWebUI marketing → **se sirve reclasificado a misc con modelo barato** (`code_generation → misc` en el detalle); ráfaga → **429 rate_limited**; descargar el **PDF de costes**. | Diferenciación. |
| 8–9 | `go-task verify` en pantalla: **11 PASS** en directo. | "Demo en vivo" verificable. |
| 9–10 | Cierre: pestaña **Savings** (total ahorrado, % de reducción, medido vs estimado) + criterios de ahorro articulados (§4) + preguntas. | Pilar 3 + Pilar 5. |

**Plan B:** si no hay acceso a proveedores, `MOCK_PROVIDERS=true go-task demo-up`
— todo el flujo (routing, costes, presupuestos, caché, informes) funciona igual
con completions simuladas.

## 6. Respuestas preparadas para preguntas difíciles

- **«¿Cómo de precisos son vuestros precios?»** — Usamos un **catálogo curado
  de tarifas alineado con los precios públicos** de cada proveedor
  (`backend/config/provider_models.yaml`); el coste de cada fila es
  `tokens × tarifa` y se puede verificar a mano. No hacemos reconciliación
  contra factura real — sería el siguiente paso natural en producción.
- **«¿Qué pasa con la calidad tras degradar?»** — La degradación está **acotada
  por diseño**: máximo un tier, misma categoría, capabilities preservadas, y
  solo si el ahorro es ≥25%. La pérdida de calidad aceptada es un salto de un
  tier, nunca más; el trabajo más sensible solo se degrada bajo presión de
  presupuesto, nunca por defecto.
- **«¿Qué pasa si se cae un proveedor?»** — Siendo honestos: la petición
  devuelve un `provider_error` controlado, queda auditada y dispara alerta;
  **no hay fallback automático a otro proveedor** hoy. Es una decisión de
  alcance del hackathon y el primer punto del roadmap.
- **«¿Por qué TabbyAPI y no Ollama?»** — TabbyAPI con **ExLlamaV3** es un motor
  de inferencia SOTA (cuantización EXL3, mejor throughput/VRAM). Además expone
  API OpenAI-compatible, así que encaja en el proxy exactamente igual que
  OpenRouter o Fireworks — refuerza el diseño agnóstico.
- **«¿La clasificación de categoría llama a un LLM?»** — Reglas deterministas
  primero; solo si la confianza es baja se consulta un clasificador barato
  (configurable, `CLASSIFIER_*`). Sin dependencia dura de red para clasificar.
