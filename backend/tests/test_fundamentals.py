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

from unittest.mock import AsyncMock

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


async def test_refresh_fundamentals_fetch_raises_exception(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """When _fetch_nse_fundamental raises, symbol is added to failed list."""
    mock_kite.holdings.return_value = [
        {"tradingsymbol": "INFY", "instrument_token": 408065, "exchange": "NSE"}
    ]

    with patch(
        "backend.routers.fundamentals._fetch_nse_fundamental",
        new_callable=AsyncMock,
        side_effect=Exception("unexpected scrape error"),
    ):
        response = await client.post("/api/v1/fundamentals/refresh")

    assert response.status_code == 200
    body = response.json()
    assert body["refreshed"] == 0
    assert "INFY" in body["failed"]


# ─────────────────────────────────────────────────────────────────────────────
# Direct unit tests for _fetch_nse_fundamental (bypasses router/patch)
# Covers lines 69-140 of fundamentals.py
# ─────────────────────────────────────────────────────────────────────────────

async def test_fetch_nse_fundamental_returns_full_data() -> None:
    """Direct call to _fetch_nse_fundamental with a mocked httpx client.

    Covers: homepage GET, quote GET, pe_ratio/eps/face_value/book_value/52W parsing.
    """
    from backend.routers.fundamentals import _fetch_nse_fundamental

    nse_json = {
        "priceInfo": {
            "pdSymbolPe": "25.5",
            "lastPrice": 1530.0,
            "weekHighLow": {"max": 1800.0, "min": 1200.0},
            "intrinsicValue": 450.0,
        },
        "securityInfo": {"faceVal": "5"},
    }

    # httpx responses are synchronous — use MagicMock so .json() returns a dict, not a coroutine
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = nse_json

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    # First call: homepage (value ignored); second call: quote data
    mock_client.get = AsyncMock(side_effect=[MagicMock(), mock_resp])

    with patch("backend.routers.fundamentals.httpx.AsyncClient", return_value=mock_client):
        result = await _fetch_nse_fundamental.__wrapped__("INFY")  # bypass tenacity

    assert result is not None
    assert result["pe_ratio"] == pytest.approx(25.5)
    assert result["week_52_high"] == pytest.approx(1800.0)
    assert result["week_52_low"] == pytest.approx(1200.0)
    assert result["face_value"] == pytest.approx(5.0)
    assert result["book_value"] == pytest.approx(450.0)
    assert "eps" in result
    assert result["eps"] == pytest.approx(1530.0 / 25.5, rel=1e-3)
    assert "data_date" in result


async def test_fetch_nse_fundamental_null_fields_handled() -> None:
    """_fetch_nse_fundamental handles missing/dash/zero pe_ratio gracefully.

    Covers: pe_ratio="-" branch, eps=None (no pe_ratio), absent 52W/faceVal.
    """
    from backend.routers.fundamentals import _fetch_nse_fundamental

    nse_json = {
        "priceInfo": {
            "pdSymbolPe": "-",        # must be treated as None
            "lastPrice": 1000.0,
            "weekHighLow": {},         # no max/min → None
        },
        "securityInfo": {},            # no faceVal
    }

    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = nse_json

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    # Homepage GET raises (covered by the try/except pass), second call succeeds
    mock_client.get = AsyncMock(side_effect=[Exception("timeout"), mock_resp])

    with patch("backend.routers.fundamentals.httpx.AsyncClient", return_value=mock_client):
        result = await _fetch_nse_fundamental.__wrapped__("WIPRO")

    assert result is not None
    assert result["pe_ratio"] is None
    assert result["eps"] is None
    assert result["week_52_high"] is None
    assert result["week_52_low"] is None
    assert result["face_value"] is None


async def test_fetch_nse_fundamental_quote_request_fails_returns_none() -> None:
    """_fetch_nse_fundamental returns None when the quote request raises."""
    from backend.routers.fundamentals import _fetch_nse_fundamental

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    # Both calls raise — second triggers the except → return None path
    mock_client.get = AsyncMock(side_effect=Exception("connection refused"))

    with patch("backend.routers.fundamentals.httpx.AsyncClient", return_value=mock_client):
        result = await _fetch_nse_fundamental.__wrapped__("HDFC")

    assert result is None


# ─────────────────────────────────────────────────────────────────────────────
# Direct unit tests for _upsert_fundamental
# Covers lines 143-163 of fundamentals.py
# ─────────────────────────────────────────────────────────────────────────────

async def test_upsert_fundamental_creates_new_row(
    db_session: AsyncSession,
) -> None:
    """_upsert_fundamental inserts a new FundamentalCache row when token absent."""
    from backend.routers.fundamentals import _upsert_fundamental

    data = {
        "pe_ratio": 25.5,
        "eps": 60.0,
        "book_value": 200.0,
        "face_value": 5.0,
        "week_52_high": 1800.0,
        "week_52_low": 1200.0,
        "data_date": "2026-02-24",
    }

    await _upsert_fundamental(db_session, 408065, "INFY", "NSE", data)
    await db_session.commit()

    row = await db_session.get(FundamentalCache, 408065)
    assert row is not None
    assert row.tradingsymbol == "INFY"
    assert float(row.pe_ratio) == pytest.approx(25.5)
    assert float(row.eps) == pytest.approx(60.0)
    assert str(row.data_date) == "2026-02-24"


async def test_upsert_fundamental_updates_existing_row(
    db_session: AsyncSession,
) -> None:
    """_upsert_fundamental updates pe_ratio when a row already exists."""
    from backend.routers.fundamentals import _upsert_fundamental

    # Pre-insert a row
    existing = FundamentalCache(
        instrument_token=408065,
        tradingsymbol="INFY",
        exchange="NSE",
        pe_ratio=20.0,
    )
    db_session.add(existing)
    await db_session.commit()

    updated_data = {
        "pe_ratio": 30.0,
        "eps": 55.0,
        "book_value": None,
        "face_value": None,
        "week_52_high": None,
        "week_52_low": None,
        "data_date": "2026-03-01",
    }

    await _upsert_fundamental(db_session, 408065, "INFY", "NSE", updated_data)
    await db_session.commit()

    row = await db_session.get(FundamentalCache, 408065)
    assert row is not None
    assert float(row.pe_ratio) == pytest.approx(30.0)
    assert float(row.eps) == pytest.approx(55.0)
    assert str(row.data_date) == "2026-03-01"
