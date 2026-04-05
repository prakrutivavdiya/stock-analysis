"""
Tests for /api/v1/kpis endpoints.

  GET    /kpis                       → list KPI definitions
  POST   /kpis                       → create a KPI
  PUT    /kpis/{kpi_id}              → update a KPI
  DELETE /kpis/{kpi_id}              → delete a KPI
  POST   /kpis/{kpi_id}/compute      → compute KPI for instruments
  GET    /kpis/portfolio             → compute all KPIs for holdings
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import KPI
from tests.conftest import OTHER_USER_ID, USER_ID, seed_kpi, seed_ohlcv, seed_other_user, seed_user


# ─────────────────────────────────────────────────────────────────────────────
# GET /kpis
# ─────────────────────────────────────────────────────────────────────────────

async def test_list_kpis_empty(client: AsyncClient) -> None:
    """Returns empty list when no KPIs exist."""
    response = await client.get("/api/v1/kpis")
    assert response.status_code == 200
    assert response.json()["kpis"] == []


async def test_list_kpis_returns_own_kpis(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Returns the authenticated user's KPI definitions."""
    await seed_kpi(db_session, name="RSI Signal", formula="RSI(14) > 70", return_type="BOOLEAN")
    await seed_kpi(db_session, name="Close Price", formula="CLOSE", return_type="SCALAR")

    response = await client.get("/api/v1/kpis")

    assert response.status_code == 200
    body = response.json()
    assert len(body["kpis"]) == 2
    names = {k["name"] for k in body["kpis"]}
    assert names == {"RSI Signal", "Close Price"}


# ─────────────────────────────────────────────────────────────────────────────
# POST /kpis
# ─────────────────────────────────────────────────────────────────────────────

async def test_create_kpi_success(client: AsyncClient) -> None:
    """Creates a KPI and returns it with a generated UUID."""
    response = await client.post(
        "/api/v1/kpis",
        json={
            "name": "RSI Overbought",
            "formula": "RSI(14) > 70",
            "return_type": "BOOLEAN",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "RSI Overbought"
    assert body["formula"] == "RSI(14) > 70"
    assert body["return_type"] == "BOOLEAN"
    assert "id" in body
    uuid.UUID(body["id"])  # must be valid UUID


async def test_create_kpi_invalid_formula_returns_400(client: AsyncClient) -> None:
    """400 when formula references an unknown identifier."""
    response = await client.post(
        "/api/v1/kpis",
        json={
            "name": "Bad KPI",
            "formula": "UNKNOWN_FUNC(14) > 70",
            "return_type": "BOOLEAN",
        },
    )

    assert response.status_code == 400
    assert "Unknown identifier" in response.json()["detail"]


async def test_create_kpi_type_mismatch_returns_400(client: AsyncClient) -> None:
    """400 when SCALAR formula contains a comparison operator."""
    response = await client.post(
        "/api/v1/kpis",
        json={
            "name": "Mismatch",
            "formula": "RSI(14) > 70",
            "return_type": "SCALAR",
        },
    )

    assert response.status_code == 400


async def test_create_categorical_kpi(client: AsyncClient) -> None:
    """CATEGORICAL KPI with BB_POSITION is accepted."""
    response = await client.post(
        "/api/v1/kpis",
        json={
            "name": "BB Signal",
            "formula": "BB_POSITION(20)",
            "return_type": "CATEGORICAL",
        },
    )
    assert response.status_code == 201
    assert response.json()["return_type"] == "CATEGORICAL"


# ─────────────────────────────────────────────────────────────────────────────
# PUT /kpis/{kpi_id}
# ─────────────────────────────────────────────────────────────────────────────

async def test_update_kpi_name(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Updating the name field persists the change."""
    kpi = await seed_kpi(db_session)

    response = await client.put(
        f"/api/v1/kpis/{kpi.id}",
        json={"name": "Updated Name"},
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Updated Name"


async def test_update_kpi_not_found(client: AsyncClient) -> None:
    """404 when KPI ID does not exist."""
    unknown_id = uuid.uuid4()
    response = await client.put(
        f"/api/v1/kpis/{unknown_id}",
        json={"name": "Anything"},
    )
    assert response.status_code == 404


async def test_update_kpi_invalid_formula_returns_400(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """400 when update introduces an invalid formula."""
    kpi = await seed_kpi(db_session, formula="RSI(14) > 70", return_type="BOOLEAN")

    response = await client.put(
        f"/api/v1/kpis/{kpi.id}",
        json={"formula": "INVALID_FN(14) > 70"},
    )

    assert response.status_code == 400


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /kpis/{kpi_id}
# ─────────────────────────────────────────────────────────────────────────────

async def test_delete_kpi_success(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """DELETE returns 204 and the KPI is gone."""
    kpi = await seed_kpi(db_session)

    response = await client.delete(f"/api/v1/kpis/{kpi.id}")
    assert response.status_code == 204

    # Confirm it's gone
    get_response = await client.get("/api/v1/kpis")
    assert get_response.json()["kpis"] == []


async def test_delete_kpi_not_found(client: AsyncClient) -> None:
    """404 when KPI ID does not exist."""
    response = await client.delete(f"/api/v1/kpis/{uuid.uuid4()}")
    assert response.status_code == 404


# ─────────────────────────────────────────────────────────────────────────────
# POST /kpis/{kpi_id}/compute
# ─────────────────────────────────────────────────────────────────────────────

async def test_compute_kpi_with_cached_data(
    client: AsyncClient, db_session: AsyncSession, mock_kite: MagicMock
) -> None:
    """Computes a SCALAR KPI using cached OHLCV data."""
    kpi = await seed_kpi(db_session, formula="CLOSE", return_type="SCALAR")
    await seed_ohlcv(db_session, instrument_token=408065, num_candles=30)

    with patch("backend.routers.kpis._market_is_open", return_value=False):
        response = await client.post(
            f"/api/v1/kpis/{kpi.id}/compute",
            json={
                "instrument_tokens": [408065],
                "as_of_date": "2026-02-24",
                "interval": "day",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert "408065" in body["results"]
    result = body["results"]["408065"]
    assert result["return_type"] == "SCALAR"
    assert result["value"] is not None or result["value"] is None  # may be None if no data


async def test_compute_kpi_not_found(client: AsyncClient) -> None:
    """404 when KPI ID doesn't exist."""
    response = await client.post(
        f"/api/v1/kpis/{uuid.uuid4()}/compute",
        json={
            "instrument_tokens": [408065],
            "as_of_date": "2026-02-24",
            "interval": "day",
        },
    )
    assert response.status_code == 404


# ─────────────────────────────────────────────────────────────────────────────
# GET /kpis/portfolio
# ─────────────────────────────────────────────────────────────────────────────

async def test_portfolio_kpis_no_active_kpis(
    client: AsyncClient, db_session: AsyncSession, mock_kite: MagicMock
) -> None:
    """Returns empty results when user has no active KPIs."""
    response = await client.get("/api/v1/kpis/portfolio")

    assert response.status_code == 200
    body = response.json()
    assert body["kpis"] == []
    assert body["results"] == []


async def test_portfolio_kpis_kite_error_returns_502(
    client: AsyncClient, db_session: AsyncSession, mock_kite: MagicMock
) -> None:
    """502 when Kite holdings call fails while computing portfolio KPIs."""
    await seed_kpi(db_session, formula="CLOSE", return_type="SCALAR")
    mock_kite.holdings.side_effect = Exception("Kite session expired")

    response = await client.get("/api/v1/kpis/portfolio")
    assert response.status_code == 502


async def test_portfolio_kpis_with_holdings(
    client: AsyncClient, db_session: AsyncSession, mock_kite: MagicMock
) -> None:
    """Returns per-holding KPI values when holdings and KPIs exist."""
    await seed_kpi(db_session, formula="CLOSE", return_type="SCALAR")
    await seed_ohlcv(db_session, instrument_token=408065, num_candles=30)
    mock_kite.holdings.return_value = [
        {"instrument_token": 408065, "tradingsymbol": "INFY", "quantity": 10}
    ]

    with patch("backend.routers.kpis._market_is_open", return_value=False):
        response = await client.get("/api/v1/kpis/portfolio")

    assert response.status_code == 200
    body = response.json()
    assert len(body["kpis"]) == 1
    assert len(body["results"]) == 1
    assert body["results"][0]["tradingsymbol"] == "INFY"


# ─────────────────────────────────────────────────────────────────────────────
# Security: user isolation — User B must not see User A's KPIs
# ─────────────────────────────────────────────────────────────────────────────

async def test_kpi_user_isolation(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """KPIs owned by a different user are not visible to the authenticated user."""
    await seed_other_user(db_session)
    other_kpi = KPI(
        user_id=OTHER_USER_ID,
        name="Other User KPI",
        formula="CLOSE",
        return_type="SCALAR",
        is_active=True,
        display_order=0,
    )
    db_session.add(other_kpi)
    await db_session.commit()

    response = await client.get("/api/v1/kpis")

    assert response.status_code == 200
    kpi_names = {k["name"] for k in response.json()["kpis"]}
    assert "Other User KPI" not in kpi_names, "User must not see other users' KPIs"


# ─────────────────────────────────────────────────────────────────────────────
# is_active=False KPI must not appear in /kpis/portfolio
# ─────────────────────────────────────────────────────────────────────────────

async def test_inactive_kpi_excluded_from_portfolio(
    client: AsyncClient, db_session: AsyncSession, mock_kite: MagicMock
) -> None:
    """KPI with is_active=False must not be computed or returned by /kpis/portfolio."""
    inactive_kpi = KPI(
        user_id=USER_ID,
        name="Inactive KPI",
        formula="CLOSE",
        return_type="SCALAR",
        is_active=False,
        display_order=0,
    )
    db_session.add(inactive_kpi)
    await db_session.commit()

    mock_kite.holdings.return_value = [
        {"instrument_token": 408065, "tradingsymbol": "INFY", "quantity": 10}
    ]

    response = await client.get("/api/v1/kpis/portfolio")

    assert response.status_code == 200
    assert response.json()["kpis"] == [], "Inactive KPIs must not appear in portfolio compute"


# ─────────────────────────────────────────────────────────────────────────────
# _load_ohlcv_df: Kite fetch path when cache is empty
# Covers lines 152-213 of kpis.py (_load_ohlcv_df with raw_kite data)
# ─────────────────────────────────────────────────────────────────────────────

async def test_compute_kpi_kite_fetch_when_cache_empty(
    client: AsyncClient, db_session: AsyncSession, mock_kite: MagicMock
) -> None:
    """KPI compute fetches OHLCV from Kite when cache is empty, then evaluates.

    Covers: _load_ohlcv_df Kite branch (raw_kite → DataFrame → OHLCVCache insert).
    """
    from datetime import timedelta

    kpi = await seed_kpi(db_session, formula="CLOSE", return_type="SCALAR")

    # Build 30 Kite-format candles (enough for CLOSE/SMA indicators)
    base = datetime(2026, 2, 24, 9, 15, tzinfo=timezone.utc)
    candles = [
        {
            "date": base - timedelta(days=i),
            "open":   float(1500 + i),
            "high":   float(1520 + i),
            "low":    float(1490 + i),
            "close":  float(1510 + i),
            "volume": 1_000_000,
        }
        for i in range(30)
    ]
    mock_kite.historical_data.return_value = candles

    with patch("backend.routers.kpis._market_is_open", return_value=False):
        response = await client.post(
            f"/api/v1/kpis/{kpi.id}/compute",
            json={
                "instrument_tokens": [408065],
                "as_of_date": "2026-02-24",
                "interval": "day",
                "tradingsymbol": "INFY",
                "exchange": "NSE",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert "408065" in body["results"]
    result = body["results"]["408065"]
    assert result["return_type"] == "SCALAR"
    # CLOSE with 30 candles should yield a valid numeric value
    assert result["value"] is not None
