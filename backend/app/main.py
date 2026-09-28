"""FastAPI application entrypoint."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import SQLModel

from . import models  # noqa: F401  (register tables)
from .config import settings
from .db import get_engine
from .errors import (
    APIError,
    api_error_handler,
    validation_exception_handler,
)
from .routers import dashboard, openai_api
from .services import semantic_cache


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure tables exist (idempotent) so the demo works without a manual
    # migration step. Alembic remains the source of truth for schema versioning.
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
        await semantic_cache.ensure_schema(conn)
    yield


app = FastAPI(title="AI FinOps Proxy", version="0.3.0", lifespan=lifespan)

# Permissive CORS for the frontend dev server (§infra).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(APIError, api_error_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)

app.include_router(openai_api.router)
app.include_router(dashboard.router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "contract": "ai-finops-proxy-dashboard",
        "version": "0.3.0",
        # Safe to expose: this is a mode flag, never a provider credential.
        "mock_providers": settings.mock_providers,
    }
