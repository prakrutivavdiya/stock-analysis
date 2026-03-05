"""
Tests for /api/v1/orders endpoints.

  GET    /orders                     → list today's orders
  POST   /orders                     → place live or paper order
  PUT    /orders/{order_id}          → modify a pending order
  DELETE /orders/{order_id}          → cancel a pending order
  GET    /orders/{order_id}/history  → full order status history
"""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import AuditLog
from tests.conftest import USER_ID, seed_user


def _raw_order(order_id: str = "ORDER123") -> dict:
    return {
        "order_id": order_id,
        "tradingsymbol": "INFY",
        "exchange": "NSE",
        "transaction_type": "BUY",
        "product": "CNC",
        "order_type": "LIMIT",
        "variety": "regular",
        "quantity": 10,
        "price": 1500.0,
        "trigger_price": None,
        "validity": "DAY",
        "status": "COMPLETE",
        "filled_quantity": 10,
        "average_price": 1500.0,
        "order_timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /orders
# ─────────────────────────────────────────────────────────────────────────────

async def test_list_orders_returns_todays_orders(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """Returns parsed list of today's orders from Kite."""
    mock_kite.orders.return_value = [_raw_order("ORDER123")]

    response = await client.get("/api/v1/orders")

    assert response.status_code == 200
    body = response.json()
    assert len(body["orders"]) == 1
    o = body["orders"][0]
    assert o["order_id"] == "ORDER123"
    assert o["tradingsymbol"] == "INFY"
    assert o["quantity"] == 10


async def test_list_orders_empty(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """Empty orders list from Kite returns empty array."""
    mock_kite.orders.return_value = []
    response = await client.get("/api/v1/orders")
    assert response.status_code == 200
    assert response.json()["orders"] == []


async def test_list_orders_kite_error_returns_502(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """502 when Kite API call fails."""
    mock_kite.orders.side_effect = Exception("Kite session expired")
    response = await client.get("/api/v1/orders")
    assert response.status_code == 502


# ─────────────────────────────────────────────────────────────────────────────
# POST /orders — live order
# ─────────────────────────────────────────────────────────────────────────────

async def test_place_live_order_success(
    client: AsyncClient, mock_kite: MagicMock, db_session: AsyncSession
) -> None:
    """Places a live order, gets order ID from Kite, writes audit log."""
    mock_kite.place_order.return_value = "KITE_ORDER_001"

    response = await client.post(
        "/api/v1/orders",
        json={
            "tradingsymbol": "INFY",
            "exchange": "NSE",
            "transaction_type": "BUY",
            "quantity": 10,
            "product": "CNC",
            "order_type": "LIMIT",
            "price": 1500.0,
            "validity": "DAY",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["order_id"] == "KITE_ORDER_001"
    assert body["paper_trade"] is False

    # Verify audit log was written
    result = await db_session.execute(
        select(AuditLog).where(AuditLog.user_id == USER_ID)
    )
    log = result.scalar_one_or_none()
    assert log is not None
    assert log.action_type == "PLACE_ORDER"
    assert log.tradingsymbol == "INFY"
    assert log.outcome == "SUCCESS"


async def test_place_live_order_kite_rejection_writes_audit_and_returns_422(
    client: AsyncClient, mock_kite: MagicMock, db_session: AsyncSession
) -> None:
    """Kite rejection → 422, audit log records FAILURE."""
    mock_kite.place_order.side_effect = Exception("Insufficient margin")

    response = await client.post(
        "/api/v1/orders",
        json={
            "tradingsymbol": "INFY",
            "exchange": "NSE",
            "transaction_type": "BUY",
            "quantity": 10,
            "product": "CNC",
            "order_type": "MARKET",
            "validity": "DAY",
        },
    )

    assert response.status_code == 422

    # Audit log must still be written
    result = await db_session.execute(
        select(AuditLog).where(AuditLog.user_id == USER_ID)
    )
    log = result.scalar_one_or_none()
    assert log is not None
    assert log.outcome == "FAILURE"
    assert "Insufficient margin" in (log.error_message or "")


# ─────────────────────────────────────────────────────────────────────────────
# POST /orders — paper trade
# ─────────────────────────────────────────────────────────────────────────────

async def test_place_paper_trade_does_not_call_kite(
    client: AsyncClient, mock_kite: MagicMock, db_session: AsyncSession
) -> None:
    """Paper trade never forwards to Kite; generates PAPER- prefixed order ID."""
    response = await client.post(
        "/api/v1/orders",
        json={
            "tradingsymbol": "INFY",
            "exchange": "NSE",
            "transaction_type": "BUY",
            "quantity": 10,
            "product": "CNC",
            "order_type": "MARKET",
            "validity": "DAY",
            "paper_trade": True,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["paper_trade"] is True
    assert body["order_id"].startswith("PAPER-")

    # Kite must not be called
    mock_kite.place_order.assert_not_called()

    # Audit log action type = PAPER_TRADE
    result = await db_session.execute(
        select(AuditLog).where(AuditLog.user_id == USER_ID)
    )
    log = result.scalar_one_or_none()
    assert log is not None
    assert log.action_type == "PAPER_TRADE"


# ─────────────────────────────────────────────────────────────────────────────
# PUT /orders/{order_id}
# ─────────────────────────────────────────────────────────────────────────────

async def test_modify_order_success(
    client: AsyncClient, mock_kite: MagicMock, db_session: AsyncSession
) -> None:
    """Modify succeeds, writes MODIFY_ORDER audit log."""
    mock_kite.modify_order.return_value = None

    response = await client.put(
        "/api/v1/orders/ORDER123",
        json={
            "order_type": "LIMIT",
            "price": 1520.0,
            "quantity": 10,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["order_id"] == "ORDER123"
    assert body["status"] == "updated"

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.user_id == USER_ID)
    )
    log = result.scalar_one_or_none()
    assert log is not None
    assert log.action_type == "MODIFY_ORDER"
    assert log.outcome == "SUCCESS"


async def test_modify_order_kite_error_returns_422_and_writes_audit(
    client: AsyncClient, mock_kite: MagicMock, db_session: AsyncSession
) -> None:
    """422 on modify failure; audit log records FAILURE."""
    mock_kite.modify_order.side_effect = Exception("Order already executed")

    response = await client.put(
        "/api/v1/orders/ORDER123",
        json={"order_type": "LIMIT", "price": 1520.0},
    )

    assert response.status_code == 422

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.user_id == USER_ID)
    )
    log = result.scalar_one_or_none()
    assert log is not None
    assert log.outcome == "FAILURE"


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /orders/{order_id}
# ─────────────────────────────────────────────────────────────────────────────

async def test_cancel_order_success(
    client: AsyncClient, mock_kite: MagicMock, db_session: AsyncSession
) -> None:
    """Cancel succeeds, writes CANCEL_ORDER audit log."""
    mock_kite.cancel_order.return_value = None

    response = await client.delete("/api/v1/orders/ORDER123")

    assert response.status_code == 200
    body = response.json()
    assert body["order_id"] == "ORDER123"
    assert body["status"] == "CANCELLED"

    result = await db_session.execute(
        select(AuditLog).where(AuditLog.user_id == USER_ID)
    )
    log = result.scalar_one_or_none()
    assert log is not None
    assert log.action_type == "CANCEL_ORDER"
    assert log.outcome == "SUCCESS"


async def test_cancel_order_kite_error_returns_422(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """422 when Kite rejects the cancel."""
    mock_kite.cancel_order.side_effect = Exception("Order not found")
    response = await client.delete("/api/v1/orders/BADORDER")
    assert response.status_code == 422


# ─────────────────────────────────────────────────────────────────────────────
# GET /orders/{order_id}/history
# ─────────────────────────────────────────────────────────────────────────────

async def test_order_history_returns_history(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """Returns the full status history for an order."""
    mock_kite.order_history.return_value = [
        {"status": "OPEN", "order_id": "ORDER123"},
        {"status": "COMPLETE", "order_id": "ORDER123"},
    ]

    response = await client.get("/api/v1/orders/ORDER123/history")

    assert response.status_code == 200
    body = response.json()
    assert body["order_id"] == "ORDER123"
    assert len(body["history"]) == 2


async def test_order_history_kite_error_returns_502(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """502 when Kite history call fails."""
    mock_kite.order_history.side_effect = Exception("order not found")
    response = await client.get("/api/v1/orders/BADORDER/history")
    assert response.status_code == 502
