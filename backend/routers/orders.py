"""
Orders router — 5 endpoints

  GET    /orders                     → today's orders from Kite (live)
  POST   /orders                     → place a new order (or paper trade)
  PUT    /orders/{order_id}          → modify a pending order
  DELETE /orders/{order_id}          → cancel a pending order
  GET    /orders/{order_id}/history  → full order status history from Kite
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.deps import CurrentUser, DBSession, KiteClient
from backend.models import AuditLog
from backend.schemas.orders import (
    CancelOrderResponse,
    ModifyOrderRequest,
    ModifyOrderResponse,
    OrderHistoryResponse,
    OrderOut,
    OrdersResponse,
    PlaceOrderRequest,
    PlaceOrderResponse,
)

router = APIRouter()


def _parse_kite_order(o: dict) -> OrderOut:
    placed_at = o.get("order_timestamp") or o.get("exchange_timestamp") or datetime.now(timezone.utc)
    if isinstance(placed_at, str):
        try:
            placed_at = datetime.fromisoformat(placed_at)
        except ValueError:
            placed_at = datetime.now(timezone.utc)
    if isinstance(placed_at, datetime) and placed_at.tzinfo is None:
        placed_at = placed_at.replace(tzinfo=timezone.utc)

    return OrderOut(
        order_id=str(o.get("order_id", "")),
        tradingsymbol=o.get("tradingsymbol", ""),
        exchange=o.get("exchange", ""),
        transaction_type=o.get("transaction_type", ""),
        product=o.get("product", ""),
        order_type=o.get("order_type", ""),
        variety=o.get("variety", "regular"),
        quantity=int(o.get("quantity", 0)),
        price=float(o.get("price") or 0) or None,
        trigger_price=float(o.get("trigger_price") or 0) or None,
        validity=o.get("validity", "DAY"),
        status=o.get("status", ""),
        filled_quantity=int(o.get("filled_quantity", 0)),
        average_price=float(o.get("average_price") or 0) or None,
        placed_at=placed_at,
    )


@router.get("", response_model=OrdersResponse)
async def list_orders(kite: KiteClient, _user: CurrentUser) -> OrdersResponse:
    """Fetch today's orders from Kite."""
    try:
        raw = await asyncio.to_thread(kite.orders)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Kite API error: {exc}") from exc

    return OrdersResponse(orders=[_parse_kite_order(o) for o in raw])


@router.post("", response_model=PlaceOrderResponse, status_code=201)
async def place_order(
    body: PlaceOrderRequest,
    current_user: CurrentUser,
    kite: KiteClient,
    db: DBSession,
) -> PlaceOrderResponse:
    """
    Place a new order via Kite, or simulate it (paper trade).
    Always writes to audit_logs regardless of outcome (AU-10).
    """
    is_paper = body.paper_trade if body.paper_trade is not None else current_user.paper_trade_mode

    order_params = body.model_dump(exclude={"paper_trade"})
    kite_order_id: str | None = None
    outcome = "SUCCESS"
    error_message: str | None = None

    if is_paper:
        # Simulate order — never forward to Kite
        kite_order_id = f"PAPER-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6].upper()}"
    else:
        try:
            kite_kwargs = {
                "tradingsymbol": body.tradingsymbol,
                "exchange": body.exchange,
                "transaction_type": body.transaction_type,
                "quantity": body.quantity,
                "product": body.product,
                "order_type": body.order_type,
                "variety": body.variety,
                "validity": body.validity,
            }
            if body.price:
                kite_kwargs["price"] = body.price
            if body.trigger_price:
                kite_kwargs["trigger_price"] = body.trigger_price
            if body.validity_ttl and body.validity == "TTL":
                kite_kwargs["validity_ttl"] = body.validity_ttl

            raw_id = await asyncio.to_thread(kite.place_order, **kite_kwargs)
            kite_order_id = str(raw_id)
        except Exception as exc:
            outcome = "FAILURE"
            error_message = str(exc)
            if "InputException" in type(exc).__name__ or "DataException" in type(exc).__name__:
                # Kite rejected the order — 422
                pass

    audit = AuditLog(
        user_id=current_user.id,
        action_type="PAPER_TRADE" if is_paper else "PLACE_ORDER",
        tradingsymbol=body.tradingsymbol,
        exchange=body.exchange,
        order_params=order_params,
        kite_order_id=kite_order_id,
        outcome=outcome,
        error_message=error_message,
    )
    db.add(audit)
    await db.commit()

    if outcome == "FAILURE" and not is_paper:
        raise HTTPException(
            status_code=422,
            detail={
                "error": {
                    "code": "KITE_ORDER_REJECTED",
                    "message": error_message,
                    "request_id": str(audit.id),
                }
            },
        )

    return PlaceOrderResponse(
        order_id=kite_order_id or "",
        audit_log_id=str(audit.id),
        paper_trade=is_paper,
    )


@router.put("/{order_id}", response_model=ModifyOrderResponse)
async def modify_order(
    order_id: str,
    body: ModifyOrderRequest,
    current_user: CurrentUser,
    kite: KiteClient,
    db: DBSession,
) -> ModifyOrderResponse:
    """Modify a pending order."""
    kite_kwargs = {
        "variety": body.variety,
        "order_id": order_id,
        "order_type": body.order_type,
    }
    if body.quantity:
        kite_kwargs["quantity"] = body.quantity
    if body.price:
        kite_kwargs["price"] = body.price
    if body.trigger_price:
        kite_kwargs["trigger_price"] = body.trigger_price

    outcome = "SUCCESS"
    error_message: str | None = None
    try:
        await asyncio.to_thread(kite.modify_order, **kite_kwargs)
    except Exception as exc:
        outcome = "FAILURE"
        error_message = str(exc)

    db.add(AuditLog(
        user_id=current_user.id,
        action_type="MODIFY_ORDER",
        tradingsymbol="",  # not available in modify request
        exchange="",
        order_params={**kite_kwargs, "original_order_id": order_id},
        kite_order_id=order_id,
        outcome=outcome,
        error_message=error_message,
    ))
    await db.commit()

    if outcome == "FAILURE":
        raise HTTPException(status_code=422, detail=error_message)

    return ModifyOrderResponse(order_id=order_id, status="updated")


@router.delete("/{order_id}", response_model=CancelOrderResponse)
async def cancel_order(
    order_id: str,
    current_user: CurrentUser,
    kite: KiteClient,
    db: DBSession,
    variety: str = Query(default="regular"),
) -> CancelOrderResponse:
    """Cancel a pending order."""
    outcome = "SUCCESS"
    error_message: str | None = None
    try:
        await asyncio.to_thread(kite.cancel_order, variety=variety, order_id=order_id)
    except Exception as exc:
        outcome = "FAILURE"
        error_message = str(exc)

    db.add(AuditLog(
        user_id=current_user.id,
        action_type="CANCEL_ORDER",
        tradingsymbol="",
        exchange="",
        order_params={"order_id": order_id, "variety": variety},
        kite_order_id=order_id,
        outcome=outcome,
        error_message=error_message,
    ))
    await db.commit()

    if outcome == "FAILURE":
        raise HTTPException(status_code=422, detail=error_message)

    return CancelOrderResponse(order_id=order_id, status="CANCELLED")


@router.get("/{order_id}/history", response_model=OrderHistoryResponse)
async def order_history(
    order_id: str,
    kite: KiteClient,
    _user: CurrentUser,
) -> OrderHistoryResponse:
    """Full order status history from Kite."""
    try:
        history = await asyncio.to_thread(kite.order_history, order_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Kite API error: {exc}") from exc

    return OrderHistoryResponse(order_id=order_id, history=history)
