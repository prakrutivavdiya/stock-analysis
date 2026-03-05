"""
Shared test fixtures for StockPilot backend.

Test database  : SQLite in-memory via aiosqlite (isolated per test function).
Auth / Kite    : FastAPI dependency overrides — no real tokens or Kite calls.
App lifespan   : startup hooks (create_all_tables, _load_instruments, scheduler)
                 are patched so tests run in isolation without side-effects.
"""
from __future__ import annotations

import uuid
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.config import settings
from backend.database import Base, get_db
from backend.deps import get_current_user, get_kite_client
from backend.main import app
from backend.models import AuditLog, KPI, OHLCVCache, User

# ─────────────────────────────────────────────────────────────────────────────
# JWT test override: use HS256 + a simple secret so tests don't need RSA keys
# ─────────────────────────────────────────────────────────────────────────────
settings.JWT_ALGORITHM = "HS256"
settings.JWT_PRIVATE_KEY = "test_jwt_secret_key_for_testing_only"
settings.JWT_PUBLIC_KEY = "test_jwt_secret_key_for_testing_only"


# ─────────────────────────────────────────────────────────────────────────────
# Rate-limit reset — clear slowapi in-memory storage between tests
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_rate_limits() -> None:
    """Reset slowapi in-memory rate limit counters before each test."""
    from backend.limiter import limiter
    try:
        limiter._limiter.storage.reset()
    except Exception:
        pass
    yield

# ─────────────────────────────────────────────────────────────────────────────
# Database fixtures — fresh in-memory SQLite per test
# ─────────────────────────────────────────────────────────────────────────────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def db_engine():
    """Create all tables in a fresh in-memory SQLite database."""
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine) -> AsyncGenerator[AsyncSession, None]:
    """Yield a single AsyncSession for the duration of one test."""
    factory = async_sessionmaker(
        bind=db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )
    async with factory() as session:
        yield session


# ─────────────────────────────────────────────────────────────────────────────
# Mock user & Kite client
# ─────────────────────────────────────────────────────────────────────────────

USER_ID = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")


@pytest.fixture
def mock_user() -> MagicMock:
    """A fully-populated mock User object returned by get_current_user."""
    user = MagicMock(spec=User)
    user.id = USER_ID
    user.kite_user_id = "ZX1234"
    user.username = "Test User"
    user.email = "test@example.com"
    user.is_active = True
    user.paper_trade_mode = False
    user.kite_access_token_enc = "enc_token"
    user.kite_token_expires_at = datetime.now(timezone.utc) + timedelta(hours=8)
    user.exchange_memberships = ["NSE", "BSE"]
    user.product_types = ["CNC", "MIS", "NRML"]
    user.last_login_at = datetime.now(timezone.utc)
    return user


@pytest.fixture
def mock_kite() -> MagicMock:
    """A MagicMock wrapping KiteConnect — all calls are synchronous mocks."""
    return MagicMock()


# ─────────────────────────────────────────────────────────────────────────────
# HTTP test client with overridden dependencies
# ─────────────────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def client(
    db_session: AsyncSession,
    mock_user: MagicMock,
    mock_kite: MagicMock,
) -> AsyncGenerator[AsyncClient, None]:
    """
    Yield an httpx AsyncClient wired to the FastAPI app.

    Overrides:
      - get_db          → test SQLite session
      - get_current_user → mock_user (bypasses JWT validation)
      - get_kite_client  → mock_kite  (no real Kite API calls)

    App lifespan hooks (create_all_tables, _load_instruments, scheduler) are
    patched to prevent them from touching real resources.
    """
    async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = lambda: mock_user
    app.dependency_overrides[get_kite_client] = lambda: mock_kite

    with ExitStack() as stack:
        stack.enter_context(patch("backend.main.create_all_tables", new_callable=AsyncMock))
        stack.enter_context(patch("backend.main.start_scheduler", new_callable=AsyncMock))
        stack.enter_context(patch("backend.main.shutdown_scheduler", new_callable=AsyncMock))
        stack.enter_context(
            patch("backend.routers.instruments._load_instruments", new_callable=AsyncMock)
        )
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            follow_redirects=False,   # let tests assert redirect URLs explicitly
        ) as ac:
            yield ac

    app.dependency_overrides.clear()


# ─────────────────────────────────────────────────────────────────────────────
# Seed helpers
# ─────────────────────────────────────────────────────────────────────────────

async def seed_user(db: AsyncSession) -> User:
    """Insert a real User row so foreign-key relationships work."""
    user = User(
        id=USER_ID,
        kite_user_id="ZX1234",
        username="Test User",
        email="test@example.com",
        kite_access_token_enc="enc",
        kite_token_expires_at=datetime.now(timezone.utc) + timedelta(hours=8),
        exchange_memberships=["NSE", "BSE"],
        product_types=["CNC", "MIS", "NRML"],
        paper_trade_mode=False,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def seed_kpi(
    db: AsyncSession,
    *,
    name: str = "Test RSI",
    formula: str = "RSI(14) > 70",
    return_type: str = "BOOLEAN",
) -> KPI:
    """Insert a KPI row owned by USER_ID."""
    kpi = KPI(
        user_id=USER_ID,
        name=name,
        formula=formula,
        return_type=return_type,
        is_active=True,
        display_order=0,
    )
    db.add(kpi)
    await db.commit()
    await db.refresh(kpi)
    return kpi


async def seed_ohlcv(
    db: AsyncSession,
    instrument_token: int = 408065,
    symbol: str = "INFY",
    num_candles: int = 5,
) -> list[OHLCVCache]:
    """Insert daily OHLCV rows for one instrument."""
    rows = []
    base = datetime(2026, 2, 24, 10, 0, 0, tzinfo=timezone.utc)
    for i in range(num_candles):
        ts = base - timedelta(days=i)
        row = OHLCVCache(
            instrument_token=instrument_token,
            tradingsymbol=symbol,
            exchange="NSE",
            interval="day",
            candle_timestamp=ts,
            open=1500 + i,
            high=1520 + i,
            low=1490 + i,
            close=1510 + i,
            volume=1_000_000,
        )
        db.add(row)
        rows.append(row)
    await db.commit()
    return rows


async def seed_audit(
    db: AsyncSession,
    *,
    action_type: str = "PLACE_ORDER",
    tradingsymbol: str = "INFY",
    outcome: str = "SUCCESS",
    kite_order_id: str | None = "ORDER123",
) -> AuditLog:
    """Insert one AuditLog row owned by USER_ID."""
    log = AuditLog(
        user_id=USER_ID,
        action_type=action_type,
        tradingsymbol=tradingsymbol,
        exchange="NSE",
        order_params={"transaction_type": "BUY", "quantity": 10, "price": 1500.0},
        kite_order_id=kite_order_id,
        outcome=outcome,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return log
