"""
WebSocket router — live market data + alert notifications

  WS /ws/quotes  → streams KiteTicker tick data and per-user alert notifications

Messages are JSON objects differentiated by `type`:
  { "type": "tick",  "data": [ { instrument_token, ltp, open, high, low,
                                  close, change, volume, last_trade_time } ] }
  { "type": "alert", "data": { alert_id, tradingsymbol, exchange, condition_type,
                                 threshold, trigger_price, message, triggered_at } }
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import backend.ticker as ticker_mgr

router = APIRouter()


def _get_user_id_from_ws(websocket: WebSocket) -> uuid.UUID | None:
    """Decode the access_token cookie to identify the connected user."""
    try:
        from jose import JWTError, jwt
        from backend.config import settings
        token = websocket.cookies.get("access_token")
        if not token:
            return None
        payload = jwt.decode(
            token,
            settings.JWT_PUBLIC_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        sub = payload.get("sub")
        return uuid.UUID(sub) if sub else None
    except Exception:
        return None


@router.websocket("/ws/quotes")
async def quotes_websocket(websocket: WebSocket) -> None:
    """
    Stream live tick data and alert notifications to the browser.

    Each connected client gets its own asyncio.Queue that receives:
    - Tick messages pushed by the KiteTicker background thread
    - Alert messages pushed by the alert engine when conditions fire
    """
    await websocket.accept()
    user_id = _get_user_id_from_ws(websocket)
    q = ticker_mgr.add_client(user_id)
    try:
        while True:
            msg = await q.get()
            await websocket.send_json(msg)
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        ticker_mgr.remove_client(q)
