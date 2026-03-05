"""
Tests for /api/v1/gtt endpoints.

  GET    /gtt              → list active GTTs
  POST   /gtt              → place a new GTT (single or two-leg)
  PUT    /gtt/{trigger_id} → modify a GTT
  DELETE /gtt/{trigger_id} → delete a GTT (204)
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import AuditLog
from tests.conftest import USER_ID


def _raw_gtt(trigger_id: int = 1001) -> dict:
    return {
        "id": trigger_id,
        "type": "single",
        "status": "active",
        "condition": {
            "tradingsymbol": "INFY",
            "trigger_values": [1400.0],
        },
        "orders": [
            {
                "transaction_type": "SELL",
                "quantity": 10,
                "product": "CNC",
                "price": 1398.0,
            }
        ],
    }


def _single_gtt_payload() -> dict:
    return {
        "tradingsymbol": "INFY",
        "exchange": "NSE",
        "trigger_type": "single",
        "transaction_type": "SELL",
        "quantity": 10,
        "product": "CNC",
        "last_price": 1500.0,
        "trigger_value": 1400.0,
        "limit_price": 1398.0,
    }


def _two_leg_gtt_payload() -> dict:
    return {
        "tradingsymbol": "INFY",
        "exchange": "NSE",
        "trigger_type": "two-leg",
        "transaction_type": "SELL",
        "quantity": 10,
        "product": "CNC",
        "last_price": 1500.0,
        "lower_trigger_value": 1300.0,
        "lower_limit_price": 1298.0,
        "lower_quantity": 10,
        "upper_trigger_value": 1700.0,
        "upper_limit_price": 1702.0,
        "upper_quantity": 10,
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /gtt
# ─────────────────────────────────────────────────────────────────────────────

async def test_list_gtts_returns_active_gtts(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """Lists active GTT orders from Kite."""
    mock_kite.get_gtts.return_value = [_raw_gtt(1001)]

    response = await client.get("/api/v1/gtt")

    assert response.status_code == 200
    body = response.json()
    assert len(body["gtts"]) == 1
    g = body["gtts"][0]
    assert g["trigger_id"] == 1001
    assert g["tradingsymbol"] == "INFY"
    assert g["trigger_type"] == "single"
    assert g["status"] == "active"


async def test_list_gtts_empty(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """Empty GTT list from Kite returns empty array."""
    mock_kite.get_gtts.return_value = []
    response = await client.get("/api/v1/gtt")
    assert response.status_code == 200
    assert response.json()["gtts"] == []


async def test_list_gtts_kite_error_returns_502(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """502 when Kite API call fails."""
    mock_kite.get_gtts.side_effect = Exception("Kite session expired")
    response = await client.get("/api/v1/gtt")
    assert response.status_code == 502


# ─────────────────────────────────────────────────────────────────────────────
# POST /gtt — single-leg
# ─────────────────────────────────────────────────────────────────────────────

async def test_create_single_leg_gtt_success(
    client: AsyncClient, mock_kite: MagicMock, db_session: AsyncSession
) -> None:
    """Creates a single-leg GTT, writes PLACE_GTT audit log."""
    mock_kite.place_gtt.return_value = 1001
    mock_kite.GTT_TYPE_SINGLE = "single"

    response = await client.post("/api/v1/gtt", json=_single_gtt_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["trigger_id"] == 1001
    assert "audit_log_id" in body

    # Verify audit log
    result = await db_session.execute(
        select(AuditLog).where(AuditLog.user_id == USER_ID)
    )
    log = result.scalar_one_or_none()
    assert log is not None
    assert log.action_type == "PLACE_GTT"
    assert log.tradingsymbol == "INFY"
    assert log.kite_gtt_id == 1001
    assert log.outcome == "SUCCESS"


async def test_create_two_leg_gtt_success(
    client: AsyncClient, mock_kite: MagicMock, db_session: AsyncSession
) -> None:
    """Creates a two-leg GTT successfully."""
    mock_kite.place_gtt.return_value = 1002
    mock_kite.GTT_TYPE_TWO_LEG = "two-leg"

    response = await client.post("/api/v1/gtt", json=_two_leg_gtt_payload())

    assert response.status_code == 201
    assert response.json()["trigger_id"] == 1002


async def test_create_gtt_kite_error_writes_failure_audit(
    client: AsyncClient, mock_kite: MagicMock, db_session: AsyncSession
) -> None:
    """Kite rejection writes FAILURE audit log and returns 422."""
    mock_kite.place_gtt.side_effect = Exception("GTT trigger limit exceeded")
    mock_kite.GTT_TYPE_SINGLE = "single"

    response = await client.post("/api/v1/gtt", json=_single_gtt_payload())

    assert response.status_code == 422

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.user_id == USER_ID)
    )
    log = result.scalar_one_or_none()
    assert log is not None
    assert log.outcome == "FAILURE"
    assert "GTT trigger limit" in (log.error_message or "")


# ─────────────────────────────────────────────────────────────────────────────
# PUT /gtt/{trigger_id}
# ─────────────────────────────────────────────────────────────────────────────

async def test_modify_gtt_success(
    client: AsyncClient, mock_kite: MagicMock, db_session: AsyncSession
) -> None:
    """Modifies an existing GTT and writes MODIFY_GTT audit log."""
    mock_kite.modify_gtt.return_value = None

    response = await client.put(
        "/api/v1/gtt/1001",
        json={
            "tradingsymbol": "INFY",
            "exchange": "NSE",
            "trigger_type": "single",
            "transaction_type": "SELL",
            "product": "CNC",
            "last_price": 1500.0,
            "trigger_value": 1380.0,
            "limit_price": 1378.0,
            "quantity": 10,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["trigger_id"] == 1001
    assert body["status"] == "updated"

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.user_id == USER_ID)
    )
    log = result.scalar_one_or_none()
    assert log is not None
    assert log.action_type == "MODIFY_GTT"
    assert log.kite_gtt_id == 1001
    assert log.outcome == "SUCCESS"


async def test_modify_gtt_uses_request_tradingsymbol(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """tradingsymbol from request body is forwarded to Kite (not hardcoded empty string)."""
    mock_kite.modify_gtt.return_value = None

    await client.put(
        "/api/v1/gtt/1001",
        json={
            "tradingsymbol": "RELIANCE",
            "exchange": "NSE",
            "trigger_type": "single",
            "transaction_type": "SELL",
            "product": "CNC",
            "last_price": 2500.0,
            "trigger_value": 2400.0,
            "limit_price": 2398.0,
            "quantity": 5,
        },
    )

    # Kite.modify_gtt must receive tradingsymbol="RELIANCE", not ""
    call_kwargs = mock_kite.modify_gtt.call_args.kwargs
    assert call_kwargs.get("tradingsymbol") == "RELIANCE"


async def test_modify_gtt_kite_error_returns_422(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """422 when Kite rejects the modification."""
    mock_kite.modify_gtt.side_effect = Exception("GTT not found")

    response = await client.put(
        "/api/v1/gtt/1001",
        json={
            "tradingsymbol": "INFY",
            "exchange": "NSE",
            "trigger_type": "single",
            "transaction_type": "SELL",
            "product": "CNC",
            "last_price": 1500.0,
            "trigger_value": 1380.0,
            "limit_price": 1378.0,
            "quantity": 10,
        },
    )
    assert response.status_code == 422


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /gtt/{trigger_id}
# ─────────────────────────────────────────────────────────────────────────────

async def test_delete_gtt_success(
    client: AsyncClient, mock_kite: MagicMock, db_session: AsyncSession
) -> None:
    """DELETE returns 204 and writes DELETE_GTT audit log."""
    mock_kite.delete_gtt.return_value = None

    response = await client.delete("/api/v1/gtt/1001")

    assert response.status_code == 204

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.user_id == USER_ID)
    )
    log = result.scalar_one_or_none()
    assert log is not None
    assert log.action_type == "DELETE_GTT"
    assert log.kite_gtt_id == 1001
    assert log.outcome == "SUCCESS"


async def test_delete_gtt_kite_error_returns_422(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """422 when Kite rejects the deletion."""
    mock_kite.delete_gtt.side_effect = Exception("GTT not found")
    response = await client.delete("/api/v1/gtt/9999")
    assert response.status_code == 422
