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

import httpx
from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import HTMLResponse
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

# Keywords that indicate a CDSL/eDIS authorization is required for delivery sells.
_CDSL_KEYWORDS = ("cdsl", "edis", "tpin", "cdp pin", "authoris", "authoriz")


def _is_cdsl_error(message: str) -> bool:
    """Return True when a Kite exception looks like a CDSL authorization error."""
    lower = message.lower()
    return any(kw in lower for kw in _CDSL_KEYWORDS)


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

    cdsl_required = (
        outcome == "FAILURE"
        and not is_paper
        and _is_cdsl_error(error_message or "")
    )

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
        if cdsl_required:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": {
                        "code": "CDSL_AUTH_REQUIRED",
                        "message": "CDSL/eDIS authorization is required to sell delivery holdings. "
                                   "Please authorize via the CDSL portal and retry.",
                        "tradingsymbol": body.tradingsymbol,
                        "exchange": body.exchange,
                        "qty": body.quantity,
                        "request_id": str(audit.id),
                    }
                },
            )
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


# ─────────────────────────────────────────────────────────────────────────────
# CDSL / eDIS authorization helpers
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/cdsl/form")
async def cdsl_form(
    current_user: CurrentUser,
    isin: str = Query(..., description="ISIN of the security to authorize"),
    qty: int = Query(..., gt=0, description="Quantity to authorize"),
    exchange: str = Query(..., description="Exchange (NSE or BSE)"),
) -> Response:
    """
    Server-side eDIS TPIN form proxy.

    Flow:
      1. Browser opens this endpoint in a new tab (session cookie is included).
      2. Backend decrypts the user's Kite access token and calls
         POST https://api.kite.trade/tpin/generate.
      3. Kite returns the CDSL authorization HTML form.
      4. We serve that HTML directly — the browser auto-submits the form to CDSL.
      5. CDSL redirects back to redirect_uri (our frontend /orders?cdsl_status=completed).
      6. Frontend detects the callback param and shows a retry button.

    On any Kite-side error we fall back to a manual redirect to the Kite
    portfolio page with instructions.
    """
    from backend.config import settings
    from backend.crypto import decrypt_token

    # If KITE_API_KEY is not configured the Authorization header would be malformed
    # and Kite returns "Route not found". Skip the API call and go straight to fallback.
    if not settings.KITE_API_KEY:
        return _cdsl_fallback_html(
            "Kite API key not configured on this server. "
            "Please authorize manually via Kite Web."
        )

    redirect_uri = f"{settings.FRONTEND_URL}/orders?cdsl_status=completed"

    try:
        kite_token = decrypt_token(current_user.kite_access_token_enc, settings.KITE_ENCRYPTION_KEY)
    except Exception:
        return _cdsl_fallback_html("Could not decrypt Kite session. Please re-login.")

    headers = {
        "X-Kite-Version": "3",
        "Authorization": f"token {settings.KITE_API_KEY}:{kite_token}",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    payload = {
        "isin": isin,
        "qty": str(qty),
        "exchange": exchange,
        "segment": "equity",   # Kite expects "equity", not the exchange name
        "bulk": "1",
        "redirect_uri": redirect_uri,
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.kite.trade/tpin/generate",
                headers=headers,
                data=payload,
            )
        if resp.status_code == 200:
            body = resp.json()
            if body.get("status") == "ok":
                form_html: str = (body.get("data") or {}).get("edisFormHtml", "")
                if form_html:
                    return HTMLResponse(content=form_html)
        # Kite returned an error — translate "Route not found" into actionable message
        try:
            error_msg = resp.json().get("message", f"Kite API error (HTTP {resp.status_code})")
        except Exception:
            error_msg = f"Kite API error (HTTP {resp.status_code})"
        if "route not found" in error_msg.lower():
            error_msg = (
                "CDSL form not available via API — your Kite Connect subscription "
                "may not include eDIS access. Please authorize manually via Kite Web."
            )
        return _cdsl_fallback_html(error_msg)
    except httpx.TimeoutException:
        return _cdsl_fallback_html("Kite API timed out. Please try again.")
    except Exception as exc:
        return _cdsl_fallback_html(str(exc))


def _cdsl_fallback_html(reason: str) -> HTMLResponse:
    """
    Fallback page shown when we cannot auto-generate the CDSL form.
    Redirects the user to Kite Web where they can authorize manually.
    """
    safe_reason = reason.replace("<", "&lt;").replace(">", "&gt;")
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CDSL Authorization</title>
  <style>
    body {{ font-family: system-ui, sans-serif; background: #0a0a0a; color: #e5e5e5;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }}
    .card {{ background: #121212; border: 1px solid #2a2a2a; border-radius: 8px;
             padding: 32px; max-width: 480px; width: 100%; }}
    h2 {{ color: #ff6600; margin: 0 0 12px; }}
    p  {{ color: #999; font-size: 14px; line-height: 1.6; margin: 0 0 8px; }}
    .reason {{ color: #f87171; font-size: 12px; font-family: monospace;
               background: #1a0a0a; border: 1px solid #3a1a1a; border-radius: 4px;
               padding: 8px 12px; margin: 12px 0; }}
    a.btn {{ display: inline-block; background: #ff6600; color: white; padding: 10px 20px;
             border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;
             margin-top: 16px; }}
    a.btn:hover {{ background: #ff7700; }}
  </style>
</head>
<body>
  <div class="card">
    <h2>CDSL Authorization Required</h2>
    <p>Automatic CDSL form generation failed. Please complete authorization manually on Kite Web.</p>
    <div class="reason">{safe_reason}</div>
    <p>After authorizing, return to StockPilot and retry your sell order.</p>
    <a class="btn" href="https://kite.zerodha.com/portfolio/holdings" target="_blank" rel="noopener noreferrer">
      Open Kite Web &rarr;
    </a>
  </div>
</body>
</html>"""
    return HTMLResponse(content=html, status_code=200)
