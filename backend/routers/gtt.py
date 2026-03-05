"""
GTT (Good Till Triggered) router — 4 endpoints

  GET    /gtt              → list active GTTs from Kite
  POST   /gtt              → place a new GTT
  PUT    /gtt/{trigger_id} → modify a GTT
  DELETE /gtt/{trigger_id} → delete a GTT
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from backend.deps import CurrentUser, DBSession, KiteClient
from backend.models import AuditLog
from backend.schemas.gtt import (
    GTTCreateRequest,
    GTTCreateResponse,
    GTTModifyRequest,
    GTTModifyResponse,
    GTTOut,
    GTTsResponse,
)

router = APIRouter()


def _parse_gtt(g: dict) -> GTTOut:
    condition = g.get("condition", {})
    orders = g.get("orders", [{}])
    order = orders[0] if orders else {}
    return GTTOut(
        trigger_id=int(g.get("id", 0)),
        tradingsymbol=condition.get("tradingsymbol", ""),
        trigger_type=g.get("type", "single"),
        trigger_value=float(condition.get("trigger_values", [0])[0]) if condition.get("trigger_values") else None,
        limit_price=float(order.get("price", 0)) or None,
        quantity=int(order.get("quantity", 0)) or None,
        transaction_type=order.get("transaction_type", ""),
        status=g.get("status", ""),
    )


@router.get("", response_model=GTTsResponse)
async def list_gtts(kite: KiteClient, _user: CurrentUser) -> GTTsResponse:
    """List all active GTTs for the current user."""
    try:
        raw = await asyncio.to_thread(kite.get_gtts)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Kite API error: {exc}") from exc

    return GTTsResponse(gtts=[_parse_gtt(g) for g in raw])


@router.post("", response_model=GTTCreateResponse, status_code=201)
async def create_gtt(
    body: GTTCreateRequest,
    current_user: CurrentUser,
    kite: KiteClient,
    db: DBSession,
) -> GTTCreateResponse:
    """Place a new GTT order via Kite. Always writes to audit_logs."""
    trigger_id: int | None = None
    outcome = "SUCCESS"
    error_message: str | None = None

    try:
        if body.trigger_type == "single":
            raw_id = await asyncio.to_thread(
                kite.place_gtt,
                trigger_type=kite.GTT_TYPE_SINGLE,
                tradingsymbol=body.tradingsymbol,
                exchange=body.exchange,
                trigger_values=[body.trigger_value],
                last_price=body.last_price,
                orders=[{
                    "transaction_type": body.transaction_type,
                    "quantity": body.quantity,
                    "product": body.product,
                    "order_type": "LIMIT",
                    "price": body.limit_price,
                }],
            )
        else:  # two-leg
            raw_id = await asyncio.to_thread(
                kite.place_gtt,
                trigger_type=kite.GTT_TYPE_TWO_LEG,
                tradingsymbol=body.tradingsymbol,
                exchange=body.exchange,
                trigger_values=[body.lower_trigger_value, body.upper_trigger_value],
                last_price=body.last_price,
                orders=[
                    {
                        "transaction_type": body.transaction_type,
                        "quantity": body.lower_quantity or body.quantity,
                        "product": body.product,
                        "order_type": "LIMIT",
                        "price": body.lower_limit_price,
                    },
                    {
                        "transaction_type": body.transaction_type,
                        "quantity": body.upper_quantity or body.quantity,
                        "product": body.product,
                        "order_type": "LIMIT",
                        "price": body.upper_limit_price,
                    },
                ],
            )
        trigger_id = int(raw_id)
    except Exception as exc:
        outcome = "FAILURE"
        error_message = str(exc)

    audit = AuditLog(
        user_id=current_user.id,
        action_type="PLACE_GTT",
        tradingsymbol=body.tradingsymbol,
        exchange=body.exchange,
        order_params=body.model_dump(),
        kite_gtt_id=trigger_id,
        outcome=outcome,
        error_message=error_message,
    )
    db.add(audit)
    await db.commit()

    if outcome == "FAILURE":
        raise HTTPException(status_code=422, detail=error_message)

    return GTTCreateResponse(trigger_id=trigger_id, audit_log_id=str(audit.id))


@router.put("/{trigger_id}", response_model=GTTModifyResponse)
async def modify_gtt(
    trigger_id: int,
    body: GTTModifyRequest,
    current_user: CurrentUser,
    kite: KiteClient,
    db: DBSession,
) -> GTTModifyResponse:
    """Modify a GTT order. Always writes to audit_logs."""
    outcome = "SUCCESS"
    error_message: str | None = None

    try:
        trigger_values = (
            [body.lower_trigger_value, body.upper_trigger_value]
            if body.trigger_type == "two-leg"
            else [body.trigger_value]
        )
        orders = (
            [
                {"transaction_type": body.transaction_type, "quantity": body.lower_quantity, "product": body.product, "order_type": "LIMIT", "price": body.lower_limit_price},
                {"transaction_type": body.transaction_type, "quantity": body.upper_quantity, "product": body.product, "order_type": "LIMIT", "price": body.upper_limit_price},
            ]
            if body.trigger_type == "two-leg"
            else [{"transaction_type": body.transaction_type, "quantity": body.quantity, "product": body.product, "order_type": "LIMIT", "price": body.limit_price}]
        )
        await asyncio.to_thread(
            kite.modify_gtt,
            trigger_id=trigger_id,
            trigger_type=body.trigger_type,
            tradingsymbol=body.tradingsymbol,
            exchange=body.exchange,
            trigger_values=trigger_values,
            last_price=body.last_price,
            orders=orders,
        )
    except Exception as exc:
        outcome = "FAILURE"
        error_message = str(exc)

    db.add(AuditLog(
        user_id=current_user.id,
        action_type="MODIFY_GTT",
        tradingsymbol=body.tradingsymbol,
        exchange=body.exchange,
        order_params={"trigger_id": trigger_id, **body.model_dump()},
        kite_gtt_id=trigger_id,
        outcome=outcome,
        error_message=error_message,
    ))
    await db.commit()

    if outcome == "FAILURE":
        raise HTTPException(status_code=422, detail=error_message)

    return GTTModifyResponse(trigger_id=trigger_id, status="updated")


@router.delete("/{trigger_id}", status_code=204)
async def delete_gtt(
    trigger_id: int,
    current_user: CurrentUser,
    kite: KiteClient,
    db: DBSession,
) -> None:
    """Delete a GTT order. Always writes to audit_logs."""
    outcome = "SUCCESS"
    error_message: str | None = None

    try:
        await asyncio.to_thread(kite.delete_gtt, trigger_id)
    except Exception as exc:
        outcome = "FAILURE"
        error_message = str(exc)

    db.add(AuditLog(
        user_id=current_user.id,
        action_type="DELETE_GTT",
        tradingsymbol="",
        exchange="",
        order_params={"trigger_id": trigger_id},
        kite_gtt_id=trigger_id,
        outcome=outcome,
        error_message=error_message,
    ))
    await db.commit()

    if outcome == "FAILURE":
        raise HTTPException(status_code=422, detail=error_message)
