"""Async database engine and session helpers."""
from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from .config import settings

_engine: AsyncEngine | None = None
_sessionmaker: sessionmaker | None = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(settings.database_url, future=True, echo=False)
    return _engine


def get_sessionmaker() -> sessionmaker:
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = sessionmaker(
            bind=get_engine(), class_=AsyncSession, expire_on_commit=False
        )
    return _sessionmaker


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding an async session."""
    maker = get_sessionmaker()
    async with maker() as session:
        yield session
