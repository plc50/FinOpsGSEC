.PHONY: help db-up db-down migrate seed serve serve-mock providers-warm test lint fmt

help:
	@echo "AI FinOps Proxy backend — targets:"
	@echo "  make db-up          Start Postgres 16 (finops + finops_test) via docker compose"
	@echo "  make db-down        Stop Postgres"
	@echo "  make migrate        Apply Alembic migrations (alembic upgrade head)"
	@echo "  make seed           Seed ~24h of demo data (multi-provider)"
	@echo "  make serve          Run API on :8000 (real providers)"
	@echo "  make serve-mock     Run API on :8000 with MOCK_PROVIDERS=true"
	@echo "  make providers-warm Pre-warm both Ollama models (no demo cold-start)"
	@echo "  make test           Run the pytest suite against finops_test"
	@echo "  make lint           Ruff lint"
	@echo "  make fmt            Ruff format"

db-up:
	docker compose up -d

db-down:
	docker compose down

migrate:
	uv run alembic upgrade head

seed:
	uv run python -m app.seed

serve:
	uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

serve-mock:
	MOCK_PROVIDERS=true uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

providers-warm:
	bash ../scripts/warm-providers.sh

test:
	uv run pytest

lint:
	uv run ruff check .

fmt:
	uv run ruff format .
