"""Pytest fixtures: real Postgres test DB, ASGI client, provider mocking.

Each test runs against the real `finops_test` database. Tables are created once
per session; every test truncates all tables beforehand for isolation.
"""
from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel import SQLModel

from app import models  # noqa: F401  register tables
from app.config import settings
from app.db import get_session
from app.main import app
from app.services import rate_limit, semantic_cache

TEST_DATABASE_URL = settings.test_database_url

test_engine = create_async_engine(TEST_DATABASE_URL, future=True)
TestSession = sessionmaker(bind=test_engine, class_=AsyncSession, expire_on_commit=False)

_TABLES = [
    "audit_records",
    "usage_hourly",
    "budgets",
    "routing_config",
    "alerts",
    "recommendations",
]


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _create_schema():
    async with test_engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.drop_all)
        await conn.run_sync(SQLModel.metadata.create_all)
        await semantic_cache.ensure_schema(conn)
    yield
    await test_engine.dispose()


@pytest_asyncio.fixture(autouse=True)
async def _truncate():
    async with test_engine.begin() as conn:
        for table in _TABLES:
            await conn.exec_driver_sql(f'TRUNCATE TABLE "{table}" CASCADE')
        exists = await conn.exec_driver_sql(
            "SELECT to_regclass('public.semantic_cache_entries') IS NOT NULL"
        )
        if exists.scalar_one():
            await conn.exec_driver_sql('TRUNCATE TABLE "semantic_cache_entries" CASCADE')
    yield


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    """Isolate the in-memory sliding-window rate limiter between tests."""
    rate_limit.reset()
    yield
    rate_limit.reset()


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    async with TestSession() as s:
        yield s


@pytest_asyncio.fixture(autouse=True)
def _override_session():
    async def _get_test_session() -> AsyncIterator[AsyncSession]:
        async with TestSession() as s:
            yield s

    app.dependency_overrides[get_session] = _get_test_session
    yield
    app.dependency_overrides.pop(get_session, None)


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
def mock_providers():
    """Enable mock provider mode for a test."""
    original = settings.mock_providers
    settings.mock_providers = True
    yield
    settings.mock_providers = original


# Convenience auth headers.
HEADERS = {
    "marketing": {"Authorization": "Bearer finops_key_marketing"},
    "producto": {"Authorization": "Bearer finops_key_producto"},
    "atencion": {"Authorization": "Bearer finops_key_atencion"},
    "admin": {"Authorization": "Bearer finops_key_admin"},
}
