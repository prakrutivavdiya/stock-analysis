"""
WebSocket router — live market data

  WS /ws/quotes  → streams KiteTicker tick data to browser clients
"""
from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import backend.ticker as ticker_mgr

router = APIRouter()


@router.websocket("/ws/quotes")
async def quotes_websocket(websocket: WebSocket) -> None:
    """
    Stream live tick data to the browser.

    Each connected client gets its own asyncio.Queue that is fed by the
    KiteTicker background thread.  Messages are JSON:
      { "type": "tick", "data": [ { instrument_token, ltp, open, high, low,
                                     close, change, volume, last_trade_time } ] }
    """
    await websocket.accept()
    q = ticker_mgr.add_client()
    try:
        while True:
            ticks = await q.get()
            await websocket.send_json({"type": "tick", "data": ticks})
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        ticker_mgr.remove_client(q)
