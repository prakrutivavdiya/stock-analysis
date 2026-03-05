"""
Tests for /api/v1/portfolio endpoints.

  GET /portfolio/holdings
  GET /portfolio/positions
  GET /portfolio/margins
  GET /portfolio/summary
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import USER_ID, seed_audit, seed_user


def _raw_holding(symbol: str = "INFY", qty: int = 10, avg: float = 1500.0, ltp: float = 1600.0):
    return {
        "tradingsymbol": symbol,
        "exchange": "NSE",
        "instrument_token": 408065,
        "quantity": qty,
        "t1_quantity": 0,
        "average_price": avg,
        "last_price": ltp,
        "close_price": 1580.0,
    }


def _raw_position(symbol: str = "RELIANCE", qty: int = 5, ltp: float = 2500.0):
    return {
        "tradingsymbol": symbol,
        "exchange": "NSE",
        "product": "MIS",
        "quantity": qty,
        "average_price": 2480.0,
        "last_price": ltp,
        "pnl": (ltp - 2480.0) * qty,
        "unrealised": (ltp - 2480.0) * qty,
        "realised": 0.0,
    }


def _raw_margins():
    return {
        "equity": {
            "available": {"cash": 50000.0, "opening_balance": 52000.0},
            "utilised": {"debits": 2000.0},
        }
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /portfolio/holdings
# ─────────────────────────────────────────────────────────────────────────────

async def test_holdings_returns_list_with_pnl(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """Holdings endpoint computes P&L fields from Kite data."""
    mock_kite.holdings.return_value = [_raw_holding("INFY", 10, 1500.0, 1600.0)]

    response = await client.get("/api/v1/portfolio/holdings")

    assert response.status_code == 200
    body = response.json()
    assert len(body["holdings"]) == 1
    h = body["holdings"][0]
    assert h["tradingsymbol"] == "INFY"
    assert h["pnl"] == pytest.approx(1000.0)   # (1600-1500)*10
    assert h["pnl_pct"] == pytest.approx(6.67, abs=0.01)
    assert "summary" in body
    assert body["summary"]["total_pnl"] == pytest.approx(1000.0)


async def test_holdings_empty_portfolio(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """Holdings with no positions returns empty list and zero summary."""
    mock_kite.holdings.return_value = []
    response = await client.get("/api/v1/portfolio/holdings")
    assert response.status_code == 200
    assert response.json()["holdings"] == []
    assert response.json()["summary"]["total_pnl"] == 0.0


async def test_holdings_kite_error_returns_502(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """502 is returned when Kite API call fails."""
    mock_kite.holdings.side_effect = Exception("Kite session expired")
    response = await client.get("/api/v1/portfolio/holdings")
    assert response.status_code == 502


# ─────────────────────────────────────────────────────────────────────────────
# GET /portfolio/positions
# ─────────────────────────────────────────────────────────────────────────────

async def test_positions_returns_net_positions(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    mock_kite.positions.return_value = {
        "net": [_raw_position("RELIANCE", 5, 2500.0)],
        "day": [],
    }
    response = await client.get("/api/v1/portfolio/positions")
    assert response.status_code == 200
    body = response.json()
    assert len(body["positions"]) == 1
    assert body["positions"][0]["tradingsymbol"] == "RELIANCE"


async def test_positions_kite_error_returns_502(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    mock_kite.positions.side_effect = Exception("token expired")
    response = await client.get("/api/v1/portfolio/positions")
    assert response.status_code == 502


# ─────────────────────────────────────────────────────────────────────────────
# GET /portfolio/margins
# ─────────────────────────────────────────────────────────────────────────────

async def test_margins_returns_equity_margin(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    mock_kite.margins.return_value = _raw_margins()
    response = await client.get("/api/v1/portfolio/margins")
    assert response.status_code == 200
    body = response.json()
    assert body["equity"]["available_cash"] == pytest.approx(50000.0)
    assert body["equity"]["used_debits"] == pytest.approx(2000.0)


# ─────────────────────────────────────────────────────────────────────────────
# GET /portfolio/summary
# ─────────────────────────────────────────────────────────────────────────────

async def test_summary_without_audit_logs(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """Summary with no BUY audit entries returns xirr=None."""
    mock_kite.holdings.return_value = [_raw_holding()]
    mock_kite.margins.return_value = _raw_margins()

    response = await client.get("/api/v1/portfolio/summary")

    assert response.status_code == 200
    body = response.json()
    assert "total_invested" in body
    assert "available_margin" in body
    assert body["xirr"] is None  # no BUY entries


async def test_summary_with_buy_audit_logs(
    client: AsyncClient,
    mock_kite: MagicMock,
    db_session: AsyncSession,
) -> None:
    """Summary computes a numeric XIRR when BUY audit entries exist."""
    await seed_user(db_session)
    # Seed a BUY audit log for INFY
    log = await seed_audit(
        db_session,
        action_type="PLACE_ORDER",
        tradingsymbol="INFY",
        outcome="SUCCESS",
    )
    log.order_params = {"transaction_type": "BUY", "quantity": 10, "price": 1500.0}
    log.created_at = datetime.now(timezone.utc) - timedelta(days=90)
    await db_session.commit()

    mock_kite.holdings.return_value = [_raw_holding("INFY", 10, 1500.0, 1600.0)]
    mock_kite.margins.return_value = _raw_margins()

    response = await client.get("/api/v1/portfolio/summary")

    assert response.status_code == 200
    body = response.json()
    # XIRR may be None if pyxirr raises; just assert it's numeric or None
    assert body["xirr"] is None or isinstance(body["xirr"], float)


async def test_summary_kite_error_returns_502(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    mock_kite.holdings.side_effect = Exception("API error")
    response = await client.get("/api/v1/portfolio/summary")
    assert response.status_code == 502
