"""
Tests for /api/v1/fundamentals endpoints.

  GET  /fundamentals/{instrument_token}
  POST /fundamentals/refresh
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import FundamentalCache
from tests.conftest import seed_ohlcv


async def _seed_fundamental(
    db: AsyncSession,
    instrument_token: int = 408065,
    tradingsymbol: str = "INFY",
    pe_ratio: float | None = 28.5,
    stale: bool = False,
) -> FundamentalCache:
    """Insert a FundamentalCache row for testing."""
    fetched_at = (
        datetime.now(timezone.utc) - timedelta(days=10)
        if stale
        else datetime.now(timezone.utc)
    )
    row = FundamentalCache(
        instrument_token=instrument_token,
        tradingsymbol=tradingsymbol,
        exchange="NSE",
        pe_ratio=pe_ratio,
        eps=50.0,
        book_value=200.0,
        face_value=5.0,
        week_52_high=1800.0,
        week_52_low=1200.0,
        data_date=date.today(),
        fetched_at=fetched_at,
    )
    db.add(row)
    await db.commit()
    return row


# ─────────────────────────────────────────────────────────────────────────────
# GET /fundamentals/{instrument_token}
# ─────────────────────────────────────────────────────────────────────────────

async def test_get_fundamentals_returns_cached_data(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Returns cached fundamental data fields."""
    await _seed_fundamental(db_session, pe_ratio=28.5)

    response = await client.get("/api/v1/fundamentals/408065")

    assert response.status_code == 200
    body = response.json()
    assert body["instrument_token"] == 408065
    assert body["tradingsymbol"] == "INFY"
    assert body["pe_ratio"] == pytest.approx(28.5)
    assert body["eps"] == pytest.approx(50.0)
    assert body["week_52_high"] == pytest.approx(1800.0)
    assert body["week_52_low"] == pytest.approx(1200.0)
    assert body["staleness_warning"] is False


async def test_get_fundamentals_marks_stale_data(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """staleness_warning is True when data is older than 8 days."""
    await _seed_fundamental(db_session, stale=True)

    response = await client.get("/api/v1/fundamentals/408065")

    assert response.status_code == 200
    assert response.json()["staleness_warning"] is True


async def test_get_fundamentals_not_found(client: AsyncClient) -> None:
    """404 when no fundamental data is cached for the instrument."""
    response = await client.get("/api/v1/fundamentals/999999")
    assert response.status_code == 404
    assert "not yet available" in response.json()["detail"]


async def test_get_fundamentals_null_pe(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """pe_ratio can be null when not available from NSE."""
    await _seed_fundamental(db_session, pe_ratio=None)

    response = await client.get("/api/v1/fundamentals/408065")

    assert response.status_code == 200
    assert response.json()["pe_ratio"] is None


# ─────────────────────────────────────────────────────────────────────────────
# POST /fundamentals/refresh
# ─────────────────────────────────────────────────────────────────────────────

async def test_refresh_fundamentals_success(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """Successful refresh upserts and returns refreshed/failed counts."""
    mock_kite.holdings.return_value = [
        {"tradingsymbol": "INFY", "instrument_token": 408065, "exchange": "NSE"}
    ]
    nse_data = {
        "pe_ratio": 28.5,
        "eps": 50.0,
        "book_value": 200.0,
        "face_value": 5.0,
        "week_52_high": 1800.0,
        "week_52_low": 1200.0,
        "data_date": "2026-02-24",
    }

    with patch(
        "backend.routers.fundamentals._fetch_nse_fundamental",
        new_callable=AsyncMock,
        return_value=nse_data,
    ):
        response = await client.post("/api/v1/fundamentals/refresh")

    assert response.status_code == 200
    body = response.json()
    assert body["refreshed"] == 1
    assert body["failed"] == []
    assert "completed_at" in body


async def test_refresh_fundamentals_nse_fetch_failure(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """When NSE scrape returns None, symbol is recorded in failed list."""
    mock_kite.holdings.return_value = [
        {"tradingsymbol": "INFY", "instrument_token": 408065, "exchange": "NSE"}
    ]

    with patch(
        "backend.routers.fundamentals._fetch_nse_fundamental",
        new_callable=AsyncMock,
        return_value=None,
    ):
        response = await client.post("/api/v1/fundamentals/refresh")

    assert response.status_code == 200
    body = response.json()
    assert body["refreshed"] == 0
    assert "INFY" in body["failed"]


async def test_refresh_fundamentals_kite_error_returns_502(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """502 when the Kite holdings call fails."""
    mock_kite.holdings.side_effect = Exception("Kite session expired")

    response = await client.post("/api/v1/fundamentals/refresh")

    assert response.status_code == 502


async def test_refresh_fundamentals_empty_holdings(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """No holdings → refresh succeeds with refreshed=0."""
    mock_kite.holdings.return_value = []

    response = await client.post("/api/v1/fundamentals/refresh")

    assert response.status_code == 200
    assert response.json()["refreshed"] == 0
    assert response.json()["failed"] == []
