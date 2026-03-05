"""
Tests for /api/v1/historical endpoints.

  GET    /historical/{instrument_token}
  POST   /historical/bulk
  GET    /historical/cache/status
  DELETE /historical/cache/{instrument_token}
"""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import seed_ohlcv


def _raw_candle(date: datetime, close: float = 1500.0):
    return {
        "date": date,
        "open": close - 10,
        "high": close + 20,
        "low": close - 20,
        "close": close,
        "volume": 1_000_000,
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /historical/{instrument_token}
# ─────────────────────────────────────────────────────────────────────────────

async def test_historical_returns_candles_from_cache(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Returns cached candles without calling Kite when cache is populated."""
    await seed_ohlcv(db_session, instrument_token=408065, symbol="INFY", num_candles=5)

    response = await client.get(
        "/api/v1/historical/408065",
        params={"interval": "day", "from_date": "2026-02-20", "to_date": "2026-02-24"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["instrument_token"] == 408065
    assert body["interval"] == "day"
    assert isinstance(body["candles"], list)
    assert len(body["candles"]) > 0


async def test_historical_fetches_from_kite_when_cache_empty(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """Falls back to Kite API when no cached data exists."""
    candle_dt = datetime(2026, 2, 24, 9, 15, tzinfo=timezone.utc)
    mock_kite.historical_data.return_value = [_raw_candle(candle_dt, 1500.0)]

    response = await client.get(
        "/api/v1/historical/408065",
        params={"interval": "day", "from_date": "2026-02-24", "to_date": "2026-02-24"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "kite"
    assert len(body["candles"]) == 1
    assert body["candles"][0]["close"] == pytest.approx(1500.0)


async def test_historical_invalid_interval_returns_400(
    client: AsyncClient,
) -> None:
    """Invalid interval string returns 400."""
    response = await client.get(
        "/api/v1/historical/408065",
        params={"interval": "weekly"},
    )
    assert response.status_code == 400
    assert "Invalid interval" in response.json()["detail"]


async def test_historical_kite_error_returns_502(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """502 when Kite API call fails (empty cache → must call Kite)."""
    mock_kite.historical_data.side_effect = Exception("Kite session expired")

    response = await client.get(
        "/api/v1/historical/999999",
        params={"interval": "day", "from_date": "2026-02-24", "to_date": "2026-02-24"},
    )

    assert response.status_code == 502


# ─────────────────────────────────────────────────────────────────────────────
# POST /historical/bulk
# ─────────────────────────────────────────────────────────────────────────────

async def test_bulk_historical_returns_results(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """Bulk endpoint returns candle data for each requested token."""
    candle_dt = datetime(2026, 2, 24, 9, 15, tzinfo=timezone.utc)
    mock_kite.historical_data.return_value = [_raw_candle(candle_dt, 1500.0)]

    response = await client.post(
        "/api/v1/historical/bulk",
        json={
            "instrument_tokens": [408065],
            "interval": "day",
            "date": "2026-02-24",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert "408065" in body["results"]
    assert body["results"]["408065"]["close"] == pytest.approx(1500.0)
    assert body["errors"] == {}


async def test_bulk_historical_uses_cache_when_available(
    client: AsyncClient, db_session: AsyncSession, mock_kite: MagicMock
) -> None:
    """Bulk endpoint uses DB cache instead of calling Kite when data exists."""
    await seed_ohlcv(db_session, instrument_token=408065, symbol="INFY", num_candles=1)

    response = await client.post(
        "/api/v1/historical/bulk",
        json={
            "instrument_tokens": [408065],
            "interval": "day",
            "date": "2026-02-24",
        },
    )

    assert response.status_code == 200
    # Kite should NOT be called since cache exists
    mock_kite.historical_data.assert_not_called()


async def test_bulk_historical_records_errors(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """Kite failure for one token records it in errors dict, not raising 502."""
    mock_kite.historical_data.side_effect = Exception("token expired")

    response = await client.post(
        "/api/v1/historical/bulk",
        json={
            "instrument_tokens": [999999],
            "interval": "day",
            "date": "2026-02-24",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert "999999" in body["errors"]
    assert body["results"] == {}


# ─────────────────────────────────────────────────────────────────────────────
# GET /historical/cache/status
# ─────────────────────────────────────────────────────────────────────────────

async def test_cache_status_empty(client: AsyncClient) -> None:
    """Cache status returns zeros when no data is cached."""
    response = await client.get("/api/v1/historical/cache/status")

    assert response.status_code == 200
    body = response.json()
    assert body["total_candles"] == 0
    assert body["cached_instruments"] == 0
    assert body["oldest"] is None
    assert body["newest"] is None


async def test_cache_status_with_data(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Cache status reflects seeded data."""
    await seed_ohlcv(db_session, instrument_token=408065, num_candles=5)

    response = await client.get("/api/v1/historical/cache/status")

    assert response.status_code == 200
    body = response.json()
    assert body["total_candles"] == 5
    assert body["cached_instruments"] == 1
    assert body["oldest"] is not None
    assert body["newest"] is not None


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /historical/cache/{instrument_token}
# ─────────────────────────────────────────────────────────────────────────────

async def test_delete_cache_removes_rows(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """DELETE cache endpoint removes all rows for a given instrument token."""
    await seed_ohlcv(db_session, instrument_token=408065, num_candles=5)

    response = await client.delete("/api/v1/historical/cache/408065")

    assert response.status_code == 200
    body = response.json()
    assert body["deleted_rows"] == 5


async def test_delete_cache_nonexistent_returns_zero(client: AsyncClient) -> None:
    """DELETE cache for a token with no cached data returns deleted_rows=0."""
    response = await client.delete("/api/v1/historical/cache/999999")
    assert response.status_code == 200
    assert response.json()["deleted_rows"] == 0
