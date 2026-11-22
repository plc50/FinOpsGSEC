# AI FinOps Proxy — Make fallback for teams without go-task.
#
# The primary demo entrypoint is Taskfile.yml. Keep this file intentionally
# small and equivalent to the public Taskfile tasks.

SHELL := /bin/bash
ROOT := $(shell pwd)
RUN := $(ROOT)/.run

API_BASE ?= http://localhost:8000
FRONT_URL ?= http://localhost:5173
MOCK_PROVIDERS ?= false
BACKEND_LOG := $(RUN)/backend.log
FRONTEND_LOG := $(RUN)/frontend.log

OPENWEBUI_IMAGE ?= ghcr.io/open-webui/open-webui:main
OPENWEBUI_PROXY_BASE ?= http://host.docker.internal:8000
OPENWEBUI_PASSWORD ?= finops1234
OPENWEBUI_SECRET_KEY ?= finops-demo-secret

.PHONY: help demo-up demo-down status logs verify \
        _infra-up _migrate _seed _backend-up _frontend-up \
        _openwebui-admin-up _openwebui-marketing-up _openwebui-up

help:
	@echo "AI FinOps Proxy demo targets:"
	@echo "  make demo-up     Start Postgres, API, dashboard, and OpenWebUI admin/marketing"
	@echo "  make demo-down   Stop the demo stack"
	@echo "  make status      Show running demo services"
	@echo "  make logs        Tail backend and frontend logs"
	@echo "  make verify      Run the acceptance smoke test"
	@echo ""
	@echo "Primary deliverable: Taskfile.yml (go-task demo-up)."

demo-up: _infra-up _migrate _seed _backend-up _frontend-up _openwebui-admin-up _openwebui-marketing-up status
	@echo ""
	@echo "=================================================================="
	@echo " AI FinOps Proxy demo is UP."
	@echo "   Dashboard            : $(FRONT_URL)/"
	@echo "   Presentation         : $(FRONT_URL)/pitch"
	@echo "   Preflight            : $(FRONT_URL)/pitch?setup=1"
	@echo "   API                  : $(API_BASE)   (docs at $(API_BASE)/docs)"
	@echo "   OpenWebUI admin      : http://localhost:8080  admin@finops.local / $(OPENWEBUI_PASSWORD)"
	@echo "   OpenWebUI marketing  : http://localhost:8081  marketing@finops.local / $(OPENWEBUI_PASSWORD)"
	@echo "   Stop with            : make demo-down"
	@echo "=================================================================="

demo-down:
	-@fuser -k 5173/tcp >/dev/null 2>&1 || true
	-@fuser -k 8000/tcp >/dev/null 2>&1 || true
	-@pkill -f 'uvicorn app.main:app' >/dev/null 2>&1 || true
	-@pkill -f 'vite' >/dev/null 2>&1 || true
	-@docker rm -f finops-openwebui-admin finops-openwebui-marketing finops-openwebui >/dev/null 2>&1 || true
	-@docker stop finops-postgres >/dev/null 2>&1 || true
	-@rm -f $(BACKEND_LOG) $(FRONTEND_LOG)
	@echo "Demo stopped. Bring it back with: make demo-up"

status:
	@docker ps --filter name=finops-postgres --format '  postgres            : {{.Status}}' 2>/dev/null || true
	@docker ps --filter name=finops-openwebui-admin --format '  openwebui-admin     : {{.Status}}' 2>/dev/null || true
	@docker ps --filter name=finops-openwebui-marketing --format '  openwebui-marketing : {{.Status}}' 2>/dev/null || true
	@if curl -sf $(API_BASE)/health >/dev/null 2>&1; then echo "  backend             : UP   $(API_BASE)"; else echo "  backend             : DOWN"; fi
	@if curl -sf $(FRONT_URL) >/dev/null 2>&1; then echo "  frontend            : UP   $(FRONT_URL)"; else echo "  frontend            : DOWN"; fi
	@if curl -sf http://localhost:8080 >/dev/null 2>&1; then echo "  openwebui-admin     : UP   http://localhost:8080"; else echo "  openwebui-admin     : DOWN"; fi
	@if curl -sf http://localhost:8081 >/dev/null 2>&1; then echo "  openwebui-marketing : UP   http://localhost:8081"; else echo "  openwebui-marketing : DOWN"; fi

logs:
	@echo "== backend ($(BACKEND_LOG)) =="
	@tail -n 30 $(BACKEND_LOG) 2>/dev/null || echo "(no backend log)"
	@echo "== frontend ($(FRONTEND_LOG)) =="
	@tail -n 30 $(FRONTEND_LOG) 2>/dev/null || echo "(no frontend log)"

verify:
	API_BASE=$(API_BASE) FRONT_URL=$(FRONT_URL) bash scripts/verify.sh

_infra-up:
	@mkdir -p $(RUN)
	@docker start finops-postgres >/dev/null 2>&1 || docker compose up -d db
	@echo "Waiting for Postgres..."
	@for i in $$(seq 1 40); do \
	  docker exec finops-postgres pg_isready -U finops -d finops >/dev/null 2>&1 && { echo "  Postgres ready."; exit 0; }; \
	  sleep 1; \
	done; echo "  Postgres did not become ready in time." >&2; exit 1

_migrate:
	cd backend && uv run alembic upgrade head

_seed:
	cd backend && uv run python -m app.seed

_backend-up:
	@mkdir -p $(RUN)
	@if curl -sf $(API_BASE)/health >/dev/null 2>&1; then \
	  echo "Backend already running on :8000."; \
	else \
	  cd backend && setsid env MOCK_PROVIDERS=$(MOCK_PROVIDERS) uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 \
	    > $(BACKEND_LOG) 2>&1 < /dev/null & \
	  echo "Backend starting (MOCK_PROVIDERS=$(MOCK_PROVIDERS), log: $(BACKEND_LOG))..."; \
	fi
	@for i in $$(seq 1 40); do \
	  curl -sf $(API_BASE)/health >/dev/null 2>&1 && { echo "  Backend healthy on :8000."; exit 0; }; \
	  sleep 1; \
	done; echo "  Backend did not become healthy in time (see $(BACKEND_LOG))." >&2; exit 1

_frontend-up:
	@mkdir -p $(RUN)
	cd frontend && pnpm install --silent
	@if curl -sf $(FRONT_URL) >/dev/null 2>&1; then \
	  echo "Frontend already running on :5173."; \
	else \
	  cd frontend && setsid env VITE_API_BASE_URL=$(API_BASE) pnpm dev \
	    > $(FRONTEND_LOG) 2>&1 < /dev/null & \
	  echo "Frontend starting (log: $(FRONTEND_LOG))..."; \
	fi
	@for i in $$(seq 1 40); do \
	  curl -sf $(FRONT_URL) >/dev/null 2>&1 && { echo "  Frontend serving on :5173."; exit 0; }; \
	  sleep 1; \
	done; echo "  Frontend did not come up in time (see $(FRONTEND_LOG))." >&2; exit 1

_openwebui-admin-up:
	@$(MAKE) _openwebui-up \
	  OPENWEBUI_NAME=finops-openwebui-admin \
	  OPENWEBUI_VOLUME=finops-openwebui-admin-data \
	  OPENWEBUI_PORT=8080 \
	  OPENWEBUI_API_KEY=finops_key_admin \
	  OPENWEBUI_ACCOUNT_NAME=Admin \
	  OPENWEBUI_ACCOUNT_EMAIL=admin@finops.local

_openwebui-marketing-up:
	@$(MAKE) _openwebui-up \
	  OPENWEBUI_NAME=finops-openwebui-marketing \
	  OPENWEBUI_VOLUME=finops-openwebui-marketing-data \
	  OPENWEBUI_PORT=8081 \
	  OPENWEBUI_API_KEY=finops_key_marketing \
	  OPENWEBUI_ACCOUNT_NAME=Marketing \
	  OPENWEBUI_ACCOUNT_EMAIL=marketing@finops.local

_openwebui-up:
	@docker volume create $(OPENWEBUI_VOLUME) >/dev/null
	@docker rm -f $(OPENWEBUI_NAME) >/dev/null 2>&1 || true
	docker run -d \
	  --name $(OPENWEBUI_NAME) \
	  --restart unless-stopped \
	  --add-host=host.docker.internal:host-gateway \
	  -p 127.0.0.1:$(OPENWEBUI_PORT):8080 \
	  -v $(OPENWEBUI_VOLUME):/app/backend/data \
	  -e OPENAI_API_BASE_URL=$(OPENWEBUI_PROXY_BASE)/v1 \
	  -e OPENAI_API_KEY=$(OPENWEBUI_API_KEY) \
	  -e ENABLE_OLLAMA_API=False \
	  -e WEBUI_AUTH=True \
	  -e WEBUI_SECRET_KEY=$(OPENWEBUI_SECRET_KEY) \
	  -e ENABLE_TITLE_GENERATION=False \
	  -e ENABLE_FOLLOW_UP_GENERATION=False \
	  -e ENABLE_TAGS_GENERATION=False \
	  -e ENABLE_AUTOCOMPLETE_GENERATION=False \
	  -e ENABLE_RETRIEVAL_QUERY_GENERATION=False \
	  -e ENABLE_SEARCH_QUERY_GENERATION=False \
	  $(OPENWEBUI_IMAGE)
	@for i in $$(seq 1 240); do \
	  if curl -sf http://localhost:$(OPENWEBUI_PORT)/health >/dev/null 2>&1 || curl -sf http://localhost:$(OPENWEBUI_PORT) >/dev/null 2>&1; then \
	    echo "  OpenWebUI serving on http://localhost:$(OPENWEBUI_PORT)."; \
	    curl -s -X POST http://localhost:$(OPENWEBUI_PORT)/api/v1/auths/signup \
	      -H 'Content-Type: application/json' \
	      -d '{"name":"$(OPENWEBUI_ACCOUNT_NAME)","email":"$(OPENWEBUI_ACCOUNT_EMAIL)","password":"$(OPENWEBUI_PASSWORD)"}' >/dev/null 2>&1 || true; \
	    echo "  Login: $(OPENWEBUI_ACCOUNT_EMAIL) / $(OPENWEBUI_PASSWORD)"; \
	    echo "  Proxy key: $(OPENWEBUI_API_KEY)"; \
	    exit 0; \
	  fi; \
	  sleep 1; \
	done; echo "  OpenWebUI did not become ready in time." >&2; exit 1
