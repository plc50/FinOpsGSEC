# DEMO_GUIDE — Desplegar y demostrar el AI FinOps Proxy

Guía rápida para dejar **todo** el stack corriendo y ejecutar la demo. Cualquier
miembro del equipo debería poder seguirla de cero en <10 minutos.

## 1. Prerequisitos

- **Docker** (Postgres + los dos OpenWebUI corren en contenedores).
- **uv** (backend Python): https://docs.astral.sh/uv/
- **pnpm** + Node 20+ (frontend).
- **jq** (lo usa `scripts/verify.sh`).
- **go-task** (opcional; el `Makefile` es equivalente: sustituye `go-task X` por `make X`).

## 2. Configuración (`backend/.env`)

```bash
cp backend/.env.example backend/.env
```

Claves a rellenar para el modo **real** (con proveedores):

| Variable | Qué es |
|---|---|
| `OPENROUTER_API_KEY` | Clave de OpenRouter |
| `FIREWORKS_API_KEY` | Clave de Fireworks |
| `TABBY_API_KEY` | Clave de TabbyAPI (viene precargada en el example) |

**TabbyAPI/ExLlamaV3** corre en el PC del compañero, accesible por VPN en
`127.0.0.1:5000`. Antes de la demo, precalienta el modelo (carga en VRAM):

```bash
bash scripts/warm-providers.sh
```

## 3. Levantar la demo

### Modo real (proveedores de verdad)

```bash
go-task demo-up        # o: make demo-up
```

### Modo mock (sin acceso a proveedores — plan B garantizado)

```bash
MOCK_PROVIDERS=true go-task demo-up    # o: MOCK_PROVIDERS=true make demo-up
```

El backend responde completions simuladas realistas; **todo lo demás
(routing, costes, presupuestos, alertas, forecast, informes) funciona igual**.

### Qué levanta `demo-up`

| Servicio | URL | Notas |
|---|---|---|
| Backend proxy (FastAPI) | http://localhost:8000 | docs en `/docs`, health en `/health` |
| Dashboard (React) | http://localhost:5173 | login con una API key de abajo |
| Postgres + pgvector | localhost:5432 | contenedor `finops-postgres` |
| OpenWebUI **admin** | http://localhost:8080 | `admin@finops.local` / `finops1234` |
| OpenWebUI **marketing** | http://localhost:8081 | `marketing@finops.local` / `finops1234` |
| Seed automático | — | ~1130 requests en 7 días con patrón laboral |

> El primer arranque de OpenWebUI en un volumen limpio puede tardar 2–4 min
> (descarga un modelo de embeddings). Los arranques siguientes son rápidos.

### API keys de consumidores (`Authorization: Bearer <key>`)

| Key | Consumidor | Rol |
|---|---|---|
| `finops_key_marketing` | equipo-marketing | consumer (code_generation **reclasificado a misc** por política) |
| `finops_key_producto` | equipo-producto | consumer |
| `finops_key_atencion` | equipo-atencion-cliente | consumer |
| `finops_key_admin` | admin | admin (ve todo, gestiona presupuestos) |

### Conectar opencode u otro cliente OpenAI-compatible

Cualquier cliente que hable la API de OpenAI funciona sin cambios:

- **Base URL:** `http://localhost:8000/v1`
- **API key:** una `finops_key_*` de la tabla anterior
- **Modelo:** `auto` (routing inteligente) o cualquier `provider/model` del catálogo

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer finops_key_producto" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hola"}]}'
```

## 4. Presentación integrada (`/pitch`)

La presentación de cinco minutos vive dentro del mismo frontend React y no muestra el
sidebar ni la barra del dashboard:

```text
Dashboard:    http://localhost:5173/
Presentation: http://localhost:5173/pitch
Preflight:    http://localhost:5173/pitch?setup=1
```

1. Autentícate con una key administrativa (`finops_key_admin` en la configuración
   local).
2. Abre **Preflight** y elige el nivel de demo:
   - **Safe backend (recomendado):** arranca con
     `MOCK_PROVIDERS=true go-task demo-up`. El proveedor es simulado, pero routing,
     política, Postgres, auditoría, alertas, ahorro y caché siguen pasando por el backend.
   - **Live:** `go-task demo-up` y credenciales reales en `backend/.env`.
   - **Frontend rehearsal:** `VITE_USE_MOCKS=true go-task demo-up`. Las tres demos son
     deterministas, mutables en memoria y muestran la etiqueta **DEMO DATA**.
3. Introduce una key de consumidor distinta (recomendado: marketing). La presentación
   la mantiene sólo en memoria y nunca sustituye la key admin de la sesión.
4. Ejecuta los checks y la prueba no destructiva de `/v1/models`.
5. Si vas a usar claves conocidas en un build que no sea de desarrollo, compila/arranca
   con `VITE_ENABLE_DEMO_KEYS=true`. No se muestran automáticamente en producción normal.

### Restauración segura del presupuesto

La slide de presupuesto captura el objeto original completo antes de mutar la
configuración. Ningún cambio se ejecuta al abrirla. Tras demostrar presión o bloqueo,
pulsa el botón amarillo **Restore original budget**; repone exactamente `budget` y
`warning_threshold` y puede ejecutarse varias veces. Mientras exista un cambio pendiente,
la slide y Preflight muestran un aviso visible. Hay restauración de mejor esfuerzo al
salir, pero no la uses como sustituto del botón manual.

### Atajos y secuencia de cinco minutos

| Tecla | Acción |
|---|---|
| `→`, `Page Down`, `Espacio` | Siguiente slide |
| `←`, `Page Up` | Slide anterior |
| `Home`, `End` | Primera / última slide |
| `N` | Mostrar/ocultar notas del presentador |
| `Esc` | Cerrar panel, salir de pantalla completa o volver al dashboard |

Las teclas no cambian de slide cuando se escribe en un `input`, `textarea`, `select`,
botón o elemento editable. También hay botones discretos, pantalla completa, hash
`#slide-N` persistente y swipe horizontal.

Secuencia recomendada: apertura 0:20 → problema 0:25 → arquitectura 0:30 → routing 1:00
→ presupuesto 1:05 (incluida restauración) → caché 0:55 (deja activada la repetición
exacta) → ahorro 0:30 → cierre 0:15.

Si falla Internet, cambia a **Safe backend**. Si tampoco está disponible el backend,
reinicia con `VITE_USE_MOCKS=true` y usa **Frontend rehearsal**. Los fallos conservan la
slide, permiten reintentar y nunca muestran stack traces en pantalla.

## 5. Operación

| Comando | Qué hace |
|---|---|
| `go-task verify` | Smoke test de aceptación end-to-end (11 checks, PASS/FAIL) |
| `go-task status` | Estado de todos los servicios |
| `go-task logs` | Últimas líneas de backend y frontend |
| `go-task demo-down` | Para todo el stack |

## 6. Checklist pre-demo

1. **NO re-ejecutes el seed durante la demo** (`demo-up` ya lo ejecuta; volver a
   lanzarlo en mitad de la demo resetea datos y presupuestos).
2. **Precalienta TabbyAPI** (`bash scripts/warm-providers.sh`) si vas en modo real.
3. `go-task verify` en una segunda pantalla → 11 PASS como prueba en vivo.
4. Abre `http://localhost:5173/pitch?setup=1`, valida admin + consumer key y deja todos
   los checks en verde (o entiende cada aviso amarillo).
5. Ensayadas las jugadas clave:
   - **Bloqueo por presupuesto:** en el dashboard (admin) → **Budgets**, baja el
     presupuesto de `equipo-marketing` por debajo de su gasto actual y guarda.
     La siguiente petición de marketing devuelve **429 `budget_exceeded`** y
     aparece la alerta. Restaura el presupuesto después.
   - **Semantic cache hit:** envía un prompt, luego repítelo **parafraseado**
     (similitud ≥0.95) → la fila sale como `cached` con coste $0 y responde al instante.
   - **Downgrade de categoría:** desde el OpenWebUI de **marketing** (`:8081`) pide
     "write a python function that..." → la petición **se sirve igualmente**, pero
     reclasificada a `misc` (modelo simple/barato). En Requests la fila muestra
     `code_generation → misc (policy)` en el detalle, más una alerta informativa
     `category_downgraded`. Configurable en `budgets.yaml` (`category_downgrades`);
     el bloqueo duro (`blocked_categories`, 403) sigue disponible como alternativa.
   - **Rate limiting:** ráfaga de peticiones seguidas con la misma key hasta
     superar los tokens/minuto → **429 `rate_limited`** (ventana deslizante de 60 s;
     configurable con `RATE_LIMIT_*` y por consumidor en `budgets.yaml`).
   - **Informes CSV/PDF:** descarga desde el dashboard o directamente:
     `GET /dashboard/reports/costs.csv` y `/costs.pdf` con la key de admin
     (filtros `?consumer=&start_date=&end_date=`).
   - **Pestaña Savings:** total ahorrado vs baseline sin proxy, % de reducción
     de coste y desglose por mecanismo (routing, caché, degradación, downgrade,
     token reduction), con badges **measured/estimated**. Ideal para cerrar la
     demo: es el ROI de la herramienta en una pantalla.
6. El seed deja `equipo-marketing` al ~84% de su presupuesto **a propósito**: las
   peticiones elegibles se degradan un tier (filas ámbar en Requests) — es la
   evidencia del Pilar 3, no un bug.
