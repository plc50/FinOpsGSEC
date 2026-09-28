# NOTES — Guion de 5 minutos (por slide)

Deck: `slides/index.html` (tema claro, 10 slides). Navegación: flechas / espacio /
rueda. `Home`/`End` para saltar. Presupuesto total: **5:00**. Los tiempos son
acumulados (fin de cada slide).

---

## 1 · Portada — 0:15

> «Somos [equipo] y esto es **AI FinOps Proxy**: la capa de control que convierte
> el gasto en GenAI en una decisión de negocio. Visibilidad, gobernanza y ahorro
> medido — sin cambiar ni una línea en los clientes.»

Una frase y avanzar.

## 2 · El problema — 0:45

> «Las empresas consumen IA de varios proveedores a la vez, y nadie sabe quién
> gasta, cuánto cuesta cada petición ni si está justificado. Flexera 2025: el
> **32% del gasto cloud se desperdicia** — y la GenAI acelera esa cifra. Esas
> cuatro preguntas — quién, cuánto, por qué, cuándo — son exactamente las que
> responde nuestro proxy.»

## 3 · La solución — 1:15

> «Nos interponemos entre los equipos y los proveedores. Fijaos en las dos
> etiquetas del diagrama: **API OpenAI a los dos lados**. A la izquierda entran
> OpenWebUI, opencode, curl, cualquier SDK. A la derecha salen OpenRouter,
> Fireworks y TabbyAPI con ExLlamaV3 en GPU local. Y en medio, todo el valor:
> routing, presupuestos, caché, auditoría.»

## 4 · Un estándar, cero fricción — 1:50 ⭐

> «Este fue uno de los dos grandes esfuerzos de ingeniería del proyecto. El
> proxy habla el estándar de OpenAI **en ambas direcciones**: recibe
> `/v1/chat/completions` exactamente como OpenAI — así que cualquier cliente
> funciona con **cero cambios de código**, solo cambias la base URL — y llama a
> cada proveedor con ese mismo estándar, así que **añadir un proveedor es YAML,
> no código**. Y de regalo: los equipos solo ven keys internas; las claves de
> proveedor nunca salen del proxy.»

Vender esto con confianza: es la razón por la que la adopción es trivial.

## 5 · Cómo funciona — 2:25

> «Por dentro, cada petición pasa por seis etapas: autenticación, clasificación
> por categoría y complejidad, routing al **modelo más barato capaz** de hacer
> el trabajo, política de presupuesto, caché semántica con pgvector — similitud
> ≥0,95, hit a coste cero — y auditoría completa. El cliente solo pone
> `model=auto`; el resto queda registrado y es verificable.»

Recorrer la línea de izquierda a derecha con el dedo, sin detallar cada caja.

## 6 · El dinero — 3:10 ⭐ (slide clave)

> «Y esto es lo que importa: con los datos reales del seed de la demo — 7 días,
> unas 1.240 peticiones — el proxy ahorra **$14,84 sobre $8,37 realmente
> gastados: un 64% menos** que sin proxy. Y somos honestos con el desglose: lo
> **verde es medido** — degradaciones, token reduction, caché, downgrades —
> precio de catálogo sobre datos auditados. Lo **azul es estimado**: el smart
> routing comparado contra un contrafactual explícito, "todo al modelo premium".
> Esa distinción medido/estimado está en el propio dashboard.»

Pausa de 2 segundos en el −64% antes de hablar. Es el número de la presentación.

## 7 · Gobernanza — 3:45

> «El ahorro sin control no vale nada. Presupuesto por consumidor, editable en
> vivo: warning al 80%, degradación de **exactamente un tier** — misma categoría,
> capabilities preservadas, solo si el ahorro es ≥25% — y si aún así se rompe,
> bloqueo 429. Además: alertas, forecast con fecha de agotamiento, rate limiting
> y políticas de categoría — el código de marketing se sirve reclasificado a
> `misc` con modelos baratos, todo auditado. La degradación está **acotada por
> diseño**: ese es nuestro trade-off coste/calidad.»

## 8 · Cumplimiento — 4:10

> «Contra el challenge: los **6 criterios de aceptación, todos demoables en
> vivo** — routing entre 3 proveedores, tokens y coste por petición, 3
> consumidores independientes, presupuestos con respuesta visible, 2 criterios
> explícitos de ahorro y demo en vivo con `go-task verify` en 11 PASS. Y los 5
> pilares de la rúbrica cubiertos, incluido el de más peso: criterios de
> ahorro, 30 puntos.»

No leer la lista: barrer con la mano y destacar solo verify 11 PASS y el pilar de 30 pts.

## 9 · Arquitectura / extras — 4:40

> «Decisiones de diseño: un solo estándar en ambas direcciones; multi-proveedor
> declarado por YAML; inferencia local con ExLlamaV3, un motor SOTA — mejor
> throughput por VRAM que Ollama; caché semántica a coste cero; claves de
> proveedor que jamás tocan al consumidor; e informes CSV y PDF listos para
> finanzas.»

Elegir 3 de las 6 tarjetas según el tiempo restante; no leerlas todas.

## 10 · Cierre — 5:00

> «Ahora lo veis en vivo: routing en directo con tres proveedores, un
> presupuesto reventando en 429 delante vuestro, un cache hit a coste cero, y
> el ROI completo en la pestaña Savings. Roadmap: fallback automático entre
> proveedores y reconciliación contra factura real. Gracias — vamos a la demo.»

---

## Chuleta de números

| Dato | Valor |
|---|---|
| Reducción de coste | **64%** |
| Ahorrado / gastado | **$14,84 / $8,37** |
| Periodo | 7 días · ~1.240 requests |
| Smart routing (estimado) | $11,77 |
| Degradación presupuesto (medido) | $1,34 |
| Token reduction (medido) | $1,21 |
| Caché semántica (medido) | $0,51 |
| Downgrades categoría (medido) | $0,02 |
| Umbral caché | coseno ≥ 0,95 |
| Degradación | 1 tier máx · ahorro ≥ 25% · warning al 80% |
| Verify | 11 PASS |
| Flexera 2025 | 32% del gasto cloud desperdiciado |
