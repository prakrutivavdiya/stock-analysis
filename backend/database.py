"""
Async SQLAlchemy engine and session factory.

Usage:
  Production  — set DATABASE_URL to a PostgreSQL async URL:
                  postgresql+asyncpg://user:pass@host:5432/stockpilot

  Development — set DATABASE_URL to a SQLite async URL:
                  sqlite+aiosqlite:///./stockpilot_dev.db
                  (create the file first; aiosqlite handles the rest)

Environment variable: DATABASE_URL  (required at runtime)
"""

from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from backend.config import settings

# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

DATABASE_URL: str = settings.DATABASE_URL

# pool_size and max_overflow are PostgreSQL/asyncpg-only; aiosqlite uses a
# single-file lock and rejects these kwargs entirely.
_is_sqlite = settings.DATABASE_URL.startswith("sqlite")
_engine_kwargs: dict = {
    "echo": False,          # set to True to log all SQL statements
    "pool_pre_ping": True,  # verify connections before use (handles stale connections)
}
if not _is_sqlite:
    _engine_kwargs["pool_size"] = 10
    _engine_kwargs["max_overflow"] = 20

engine = create_async_engine(DATABASE_URL, **_engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,  # keep attributes accessible after commit
    autoflush=False,
    autocommit=False,
)

# ---------------------------------------------------------------------------
# Declarative base — all models inherit from this
# ---------------------------------------------------------------------------


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""


# ---------------------------------------------------------------------------
# Dependency — yields an AsyncSession per request (FastAPI-style)
# ---------------------------------------------------------------------------


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency that provides a database session per request.

    Usage:
        @router.get("/example")
        async def example(db: AsyncSession = Depends(get_db)):
            ...
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# ---------------------------------------------------------------------------
# Schema initialisation helper (dev / testing only)
# ---------------------------------------------------------------------------


async def create_all_tables() -> None:
    """
    Create all tables that do not already exist.
    Use Alembic migrations in production; this is for dev / testing only.
    """
    from backend import models  # noqa: F401 — ensure models are registered

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
