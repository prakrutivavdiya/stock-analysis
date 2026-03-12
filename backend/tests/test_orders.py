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


async def test_global_paper_trade_mode_uses_user_preference(
    client: AsyncClient, mock_kite: MagicMock, mock_user, db_session: AsyncSession
) -> None:
    """
    When user.paper_trade_mode=True and no paper_trade flag in the body,
    the order is treated as a paper trade (TEST-PAPER: global mode override).
    """
    mock_user.paper_trade_mode = True

    response = await client.post(
        "/api/v1/orders",
        json={
            "tradingsymbol": "INFY",
            "exchange": "NSE",
            "transaction_type": "BUY",
            "quantity": 5,
            "product": "CNC",
            "order_type": "MARKET",
            "validity": "DAY",
            # paper_trade is intentionally omitted — falls back to user.paper_trade_mode
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["paper_trade"] is True
    assert body["order_id"].startswith("PAPER-")

    # Kite must not be called
    mock_kite.place_order.assert_not_called()

    # Audit log must record PAPER_TRADE, not PLACE_ORDER
    result = await db_session.execute(
        select(AuditLog).where(AuditLog.user_id == USER_ID)
    )
    log = result.scalar_one_or_none()
    assert log is not None
    assert log.action_type == "PAPER_TRADE"
    assert log.outcome == "SUCCESS"


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


# ─────────────────────────────────────────────────────────────────────────────
# CDSL / eDIS authorization errors
# ─────────────────────────────────────────────────────────────────────────────

async def test_place_cnc_sell_cdsl_error_returns_cdsl_auth_required(
    client: AsyncClient, mock_kite: MagicMock, db_session: AsyncSession
) -> None:
    """
    When Kite raises a CDSL/eDIS authorization error for a CNC SELL order,
    the endpoint returns 422 with code=CDSL_AUTH_REQUIRED instead of a generic rejection.
    """
    mock_kite.place_order.side_effect = Exception(
        "Delivery sale for instrument NSE:INFY requires CDSL TPIN authorisation."
    )

    response = await client.post(
        "/api/v1/orders",
        json={
            "tradingsymbol": "INFY",
            "exchange": "NSE",
            "transaction_type": "SELL",
            "quantity": 5,
            "product": "CNC",
            "order_type": "MARKET",
            "validity": "DAY",
        },
    )

    assert response.status_code == 422
    body = response.json()
    error = body["detail"]["error"]
    assert error["code"] == "CDSL_AUTH_REQUIRED"
    assert error["tradingsymbol"] == "INFY"
    assert error["exchange"] == "NSE"
    assert error["qty"] == 5

    # Audit log should still record the failure
    from sqlalchemy import select as _select
    result = await db_session.execute(
        _select(AuditLog).where(AuditLog.user_id == USER_ID)
    )
    log = result.scalar_one_or_none()
    assert log is not None
    assert log.outcome == "FAILURE"
    assert "cdsl" in (log.error_message or "").lower()


async def test_place_order_edis_keyword_triggers_cdsl_error(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """eDIS keyword in Kite error also triggers CDSL_AUTH_REQUIRED."""
    mock_kite.place_order.side_effect = Exception("edis: not authorised for this ISIN")

    response = await client.post(
        "/api/v1/orders",
        json={
            "tradingsymbol": "SBIN",
            "exchange": "NSE",
            "transaction_type": "SELL",
            "quantity": 10,
            "product": "CNC",
            "order_type": "MARKET",
            "validity": "DAY",
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"]["error"]["code"] == "CDSL_AUTH_REQUIRED"


async def test_place_order_non_cdsl_rejection_returns_kite_order_rejected(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """Non-CDSL Kite error still returns KITE_ORDER_REJECTED code."""
    mock_kite.place_order.side_effect = Exception("Insufficient margin for this order")

    response = await client.post(
        "/api/v1/orders",
        json={
            "tradingsymbol": "INFY",
            "exchange": "NSE",
            "transaction_type": "BUY",
            "quantity": 100,
            "product": "CNC",
            "order_type": "MARKET",
            "validity": "DAY",
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"]["error"]["code"] == "KITE_ORDER_REJECTED"


# ─────────────────────────────────────────────────────────────────────────────
# GET /orders/cdsl/form
# ─────────────────────────────────────────────────────────────────────────────

async def test_cdsl_form_returns_html_on_kite_success(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """
    When Kite API returns a valid edisFormHtml, the endpoint serves it as text/html.
    We mock httpx.AsyncClient so the test is hermetic (no real Kite call).
    """
    from unittest.mock import AsyncMock, patch, MagicMock as MM

    kite_response_body = {
        "status": "ok",
        "data": {"edisFormHtml": "<form method='POST' action='https://edis.cdslindia.com/edis/TPIN'>CDSL form</form>"},
    }

    mock_http_resp = MM()
    mock_http_resp.status_code = 200
    mock_http_resp.json.return_value = kite_response_body

    mock_http_client = AsyncMock()
    mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
    mock_http_client.__aexit__ = AsyncMock(return_value=False)
    mock_http_client.post = AsyncMock(return_value=mock_http_resp)

    with patch("backend.routers.orders.httpx.AsyncClient", return_value=mock_http_client):
        response = await client.get(
            "/api/v1/orders/cdsl/form",
            params={"isin": "INE009A01021", "qty": 5, "exchange": "NSE"},
        )

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "CDSL form" in response.text


async def test_cdsl_form_returns_fallback_html_on_kite_error(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """
    When Kite API returns an error, the endpoint serves the fallback HTML page
    with a link to kite.zerodha.com (status 200 — it's still a usable page).
    """
    from unittest.mock import AsyncMock, patch, MagicMock as MM

    mock_http_resp = MM()
    mock_http_resp.status_code = 403
    mock_http_resp.json.return_value = {"status": "error", "message": "Invalid session"}

    mock_http_client = AsyncMock()
    mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
    mock_http_client.__aexit__ = AsyncMock(return_value=False)
    mock_http_client.post = AsyncMock(return_value=mock_http_resp)

    with patch("backend.routers.orders.httpx.AsyncClient", return_value=mock_http_client):
        response = await client.get(
            "/api/v1/orders/cdsl/form",
            params={"isin": "INE009A01021", "qty": 5, "exchange": "NSE"},
        )

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "kite.zerodha.com" in response.text


async def test_cdsl_form_missing_isin_returns_422(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """Missing required isin parameter returns 422."""
    response = await client.get(
        "/api/v1/orders/cdsl/form",
        params={"qty": 5, "exchange": "NSE"},
    )
    assert response.status_code == 422


async def test_cdsl_form_invalid_qty_returns_422(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """qty must be > 0."""
    response = await client.get(
        "/api/v1/orders/cdsl/form",
        params={"isin": "INE009A01021", "qty": 0, "exchange": "NSE"},
    )
    assert response.status_code == 422
