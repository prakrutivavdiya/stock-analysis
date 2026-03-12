"""
KiteTicker singleton manager.

Connects to Zerodha's WebSocket market feed in a background daemon thread.
Broadcasts tick data to all connected FastAPI WebSocket clients via asyncio.Queue.

If the WebSocket connection is rejected (403 — subscription not enabled), the
manager automatically falls back to polling Kite's OHLC REST endpoint every
3 seconds so live prices still flow to the frontend.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any

from kiteconnect import KiteConnect, KiteTicker

log = logging.getLogger(__name__)

# Module-level state
_ticker: KiteTicker | None = None
_kite_client: KiteConnect | None = None   # kept for polling fallback
_clients: set[asyncio.Queue] = set()
_loop: asyncio.AbstractEventLoop | None = None
_subscribed_tokens: list[int] = []

# Polling fallback state
_ws_forbidden_count = 0          # consecutive 403 errors
_WS_FORBIDDEN_THRESHOLD = 2      # switch to polling after this many failures
_polling_task: asyncio.Task | None = None


# ─────────────────────────────────────────────────────────────────────────────
# REST polling fallback (runs as asyncio Task in the main event loop)
# ─────────────────────────────────────────────────────────────────────────────

async def _polling_loop() -> None:
    """Poll Kite OHLC REST endpoint every 3 s and forward to client queues."""
    log.info("Live price polling started (%d tokens)", len(_subscribed_tokens))
    _consecutive_errors = 0
    _MAX_POLL_ERRORS = 3  # stop polling after this many consecutive failures
    while _subscribed_tokens and _kite_client:
        try:
            tokens = _subscribed_tokens[:500]
            # ohlc() returns ltp + open/high/low/close — enough for live display
            raw: dict = await asyncio.to_thread(_kite_client.ohlc, tokens)
            _consecutive_errors = 0  # reset on success
            if _clients and raw:
                payload = []
                for token in tokens:
                    data = raw.get(token) or raw.get(str(token))
                    if data:
                        ohlc = data.get("ohlc") or {}
                        ltp  = float(data.get("last_price", 0))
                        close = float(ohlc.get("close", ltp))
                        change = ((ltp - close) / close * 100) if close else 0.0
                        payload.append({
                            "instrument_token": token,
                            "ltp":    ltp,
                            "open":   float(ohlc.get("open",  0)),
                            "high":   float(ohlc.get("high",  0)),
                            "low":    float(ohlc.get("low",   0)),
                            "close":  close,
                            "change": round(change, 4),
                            "volume": 0,
                            "last_trade_time": None,
                        })
                if payload:
                    for q in list(_clients):
                        await q.put(payload)
        except Exception as exc:
            _consecutive_errors += 1
            log.warning(
                "Live price polling error (%d/%d): %s",
                _consecutive_errors, _MAX_POLL_ERRORS, exc,
            )
            if _consecutive_errors >= _MAX_POLL_ERRORS:
                log.warning(
                    "Live price polling disabled after %d errors — "
                    "Kite market data subscription may be required.",
                    _consecutive_errors,
                )
                return  # stop polling; don't hammer the API
        await asyncio.sleep(3)


def _ensure_polling() -> None:
    """Schedule the polling task on the main event loop if not already running."""
    global _polling_task
    if not _loop:
        return
    if _polling_task and not _polling_task.done():
        return
    _polling_task = asyncio.run_coroutine_threadsafe(
        _start_polling_task(), _loop
    ).result(timeout=1)


async def _start_polling_task() -> asyncio.Task:
    global _polling_task
    _polling_task = asyncio.create_task(_polling_loop())
    return _polling_task


# ─────────────────────────────────────────────────────────────────────────────
# KiteTicker callbacks (called from the ticker thread)
# ─────────────────────────────────────────────────────────────────────────────

def _on_ticks(ws: Any, ticks: list[dict]) -> None:  # noqa: ARG001
    if not _clients or not _loop:
        return
    payload = []
    for t in ticks:
        ohlc = t.get("ohlc") or {}
        lt = t.get("last_trade_time")
        payload.append({
            "instrument_token": t["instrument_token"],
            "ltp":    t.get("last_price", 0),
            "open":   ohlc.get("open", 0),
            "high":   ohlc.get("high", 0),
            "low":    ohlc.get("low", 0),
            "close":  ohlc.get("close", 0),
            "change": t.get("change", 0),
            "volume": t.get("volume", 0),
            "last_trade_time": lt.isoformat() if lt else None,
        })
    for q in list(_clients):
        asyncio.run_coroutine_threadsafe(q.put(payload), _loop)


def _on_connect(ws: Any, response: Any) -> None:  # noqa: ARG001
    global _ws_forbidden_count
    _ws_forbidden_count = 0  # reset on successful connect
    if _subscribed_tokens:
        ws.subscribe(_subscribed_tokens)
        ws.set_mode(ws.MODE_QUOTE, _subscribed_tokens)
    log.info("KiteTicker connected, subscribed %d tokens", len(_subscribed_tokens))


def _on_error(ws: Any, code: Any, reason: Any) -> None:  # noqa: ARG001
    global _ws_forbidden_count
    reason_str = str(reason).lower()
    if "403" in str(code) or "forbidden" in reason_str or "403" in reason_str:
        _ws_forbidden_count += 1
        log.warning(
            "KiteTicker 403 Forbidden (%d/%d) — WebSocket subscription may not be enabled",
            _ws_forbidden_count, _WS_FORBIDDEN_THRESHOLD,
        )
        if _ws_forbidden_count >= _WS_FORBIDDEN_THRESHOLD:
            log.info("Switching to REST polling fallback for live prices")
            try:
                _ensure_polling()
            except Exception as exc:
                log.warning("Failed to start polling fallback: %s", exc)
            # Stop auto-reconnect — no point hammering a 403
            try:
                ws.stop()
            except Exception:
                pass
    else:
        log.warning("KiteTicker error %s: %s", code, reason)


def _on_close(ws: Any, code: Any, reason: Any) -> None:  # noqa: ARG001
    log.info("KiteTicker closed: %s %s", code, reason)


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

async def start_ticker(tokens: list[int], api_key: str, access_token: str) -> None:
    """Start (or restart) the KiteTicker with the given instrument tokens."""
    global _ticker, _loop, _subscribed_tokens, _kite_client, _ws_forbidden_count
    _loop = asyncio.get_running_loop()
    _subscribed_tokens = tokens
    _ws_forbidden_count = 0

    # Keep a KiteConnect instance for the polling fallback
    _kite_client = KiteConnect(api_key=api_key)
    _kite_client.set_access_token(access_token)

    # Cancel any existing polling task (WebSocket takes priority)
    if _polling_task and not _polling_task.done():
        _polling_task.cancel()

    if _ticker:
        try:
            _ticker.close()
        except Exception:
            pass

    _ticker = KiteTicker(api_key, access_token)
    _ticker.on_ticks   = _on_ticks
    _ticker.on_connect = _on_connect
    _ticker.on_error   = _on_error
    _ticker.on_close   = _on_close

    threading.Thread(
        target=_ticker.connect,
        kwargs={"threaded": True},
        daemon=True,
        name="kite-ticker",
    ).start()
    log.info("KiteTicker thread started, %d tokens queued for subscription", len(tokens))


async def stop_ticker() -> None:
    """Gracefully stop the KiteTicker."""
    global _ticker
    if _ticker:
        try:
            _ticker.close()
        except Exception:
            pass
        _ticker = None
    log.info("KiteTicker stopped")


def add_client() -> asyncio.Queue:
    """Register a new WebSocket client and return its tick queue."""
    q: asyncio.Queue = asyncio.Queue()
    _clients.add(q)
    return q


def remove_client(q: asyncio.Queue) -> None:
    """Unregister a WebSocket client."""
    _clients.discard(q)


def add_token(token: int) -> None:
    """Add a single token to the live subscription without restarting the ticker."""
    global _subscribed_tokens
    if token not in _subscribed_tokens:
        _subscribed_tokens.append(token)
        if _ticker:
            try:
                _ticker.subscribe([token])
                _ticker.set_mode(_ticker.MODE_QUOTE, [token])
            except Exception as exc:
                log.warning("add_token failed for %s: %s", token, exc)
