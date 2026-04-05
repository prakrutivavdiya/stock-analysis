"""
Async SQLAlchemy engine and session factory.

DATABASE_URL must be a PostgreSQL async URL:
  postgresql+asyncpg://user:pass@host:5432/stockpilot

Set via environment variable or backend/.env.local.
Run `alembic upgrade head` before first boot to create all tables.
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

# pool_pre_ping=False: asyncpg handles stale connections natively via its own
# keepalive mechanism; enabling it triggers MissingGreenlet errors.
engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=False,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
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
