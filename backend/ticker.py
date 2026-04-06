"""
KiteTicker singleton manager + real-time price-alert evaluation.

Connects to Zerodha's WebSocket market feed in a background daemon thread.
Broadcasts tick data to all connected FastAPI WebSocket clients via asyncio.Queue.
Also evaluates ACTIVE price alerts on every tick and fires them one-shot.

If the WebSocket connection is rejected (403), falls back to polling Kite's
OHLC REST endpoint every 3 seconds so live prices still flow to the frontend.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from kiteconnect import KiteConnect, KiteTicker

log = logging.getLogger(__name__)

# ── Module-level state ────────────────────────────────────────────────────────

_ticker: KiteTicker | None = None
_kite_client: KiteConnect | None = None   # kept for polling fallback
_clients: set[asyncio.Queue] = set()
_client_user: dict[asyncio.Queue, uuid.UUID | None] = {}  # queue → user_id
_loop: asyncio.AbstractEventLoop | None = None
_subscribed_tokens: list[int] = []

# Polling fallback state
_ws_forbidden_count = 0
_WS_FORBIDDEN_THRESHOLD = 2
_polling_task: asyncio.Task | None = None


# ── Alert cache ────────────────────────────────────────────────────────────────

@dataclass
class _CachedAlert:
    id: uuid.UUID
    user_id: uuid.UUID
    tradingsymbol: str
    exchange: str
    condition_type: str
    threshold: float


_alert_cache: dict[int, list[_CachedAlert]] = {}   # instrument_token → alerts
_alert_cache_lock = threading.Lock()
_alert_cache_expiry: float = 0.0
_ALERT_CACHE_TTL: float = 30.0    # seconds


def invalidate_alert_cache() -> None:
    """Force a full reload on the next tick (called by the alerts router on mutations)."""
    global _alert_cache_expiry
    with _alert_cache_lock:
        _alert_cache_expiry = 0.0


async def _refresh_alert_cache() -> None:
    """Load all ACTIVE alerts from the DB into the in-memory cache."""
    global _alert_cache, _alert_cache_expiry
    from backend.database import AsyncSessionLocal
    from backend.models import Alert
    from sqlalchemy import select

    try:
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(
                select(Alert).where(Alert.status == "ACTIVE")
            )).scalars().all()

        cache: dict[int, list[_CachedAlert]] = {}
        for a in rows:
            token = a.instrument_token
            cache.setdefault(token, []).append(
                _CachedAlert(
                    id=a.id,
                    user_id=a.user_id,
                    tradingsymbol=a.tradingsymbol,
                    exchange=a.exchange,
                    condition_type=a.condition_type,
                    threshold=float(a.threshold),
                )
            )
        with _alert_cache_lock:
            _alert_cache = cache
            _alert_cache_expiry = time.monotonic() + _ALERT_CACHE_TTL
        log.debug("Alert cache refreshed: %d tokens, %d total alerts",
                  len(cache), sum(len(v) for v in cache.values()))
    except Exception as exc:
        log.warning("Alert cache refresh failed: %s", exc)


async def _fire_alerts(ticks_payload: list[dict]) -> None:
    """
    Evaluate ACTIVE price alerts against incoming tick data and fire those met.

    Called both from the KiteTicker thread (via run_coroutine_threadsafe) and
    from the REST polling loop (direct await).
    """
    # Refresh cache if stale
    if time.monotonic() >= _alert_cache_expiry:
        await _refresh_alert_cache()

    with _alert_cache_lock:
        cache_snapshot = {k: list(v) for k, v in _alert_cache.items()}

    if not cache_snapshot:
        return

    from backend.alert_engine import should_fire, build_message
    from backend.database import AsyncSessionLocal
    from backend.models import Alert, AlertNotification
    import backend.alert_broadcaster as _ab
    from datetime import datetime, timezone
    from sqlalchemy import select

    # ── Identify which alerts should fire ─────────────────────────────────────
    # List of (cached_alert, ltp)
    to_fire: list[tuple[_CachedAlert, float]] = []
    for tick in ticks_payload:
        token = tick["instrument_token"]
        cached = cache_snapshot.get(token)
        if not cached:
            continue
        ltp = float(tick.get("ltp", 0))
        day_open = float(tick.get("open", ltp) or ltp)
        if ltp <= 0:
            continue
        for ca in cached:
            if should_fire(ca.condition_type, ca.threshold, ltp, day_open):
                to_fire.append((ca, ltp))

    if not to_fire:
        return

    # ── Optimistically remove from cache to avoid double-fire on next tick ────
    fired_ids = {ca.id for ca, _ in to_fire}
    with _alert_cache_lock:
        for token, alerts in list(_alert_cache.items()):
            _alert_cache[token] = [a for a in alerts if a.id not in fired_ids]

    # ── Persist to DB and broadcast ───────────────────────────────────────────
    now = datetime.now(timezone.utc)
    try:
        async with AsyncSessionLocal() as db:
            for ca, trigger_price in to_fire:
                # Re-check status inside transaction to prevent races
                alert = (await db.execute(
                    select(Alert).where(Alert.id == ca.id, Alert.status == "ACTIVE")
                )).scalar_one_or_none()
                if alert is None:
                    continue  # already triggered by a parallel tick

                alert.status = "TRIGGERED"
                alert.triggered_at = now

                msg = build_message(ca.tradingsymbol, ca.condition_type,
                                    ca.threshold, trigger_price)
                notif = AlertNotification(
                    alert_id=alert.id,
                    user_id=alert.user_id,
                    tradingsymbol=ca.tradingsymbol,
                    exchange=ca.exchange,
                    triggered_at=now,
                    trigger_price=trigger_price,
                    message=msg,
                )
                db.add(notif)

            await db.commit()

        # ── Broadcast WebSocket notifications ─────────────────────────────────
        for ca, trigger_price in to_fire:
            msg = build_message(ca.tradingsymbol, ca.condition_type,
                                ca.threshold, trigger_price)
            await _ab.broadcast(ca.user_id, {
                "alert_id": str(ca.id),
                "tradingsymbol": ca.tradingsymbol,
                "exchange": ca.exchange,
                "condition_type": ca.condition_type,
                "threshold": str(ca.threshold),
                "trigger_price": trigger_price,
                "message": msg,
                "triggered_at": now.isoformat(),
            })
            log.info("Alert fired: %s %s @ %.2f", ca.tradingsymbol, ca.condition_type, trigger_price)
    except Exception as exc:
        log.warning("Alert fire DB error: %s", exc)


# ─────────────────────────────────────────────────────────────────────────────
# REST polling fallback (runs as asyncio Task in the main event loop)
# ─────────────────────────────────────────────────────────────────────────────

async def _polling_loop() -> None:
    """Poll Kite OHLC REST endpoint every 3 s and forward to client queues."""
    log.info("Live price polling started (%d tokens)", len(_subscribed_tokens))
    _consecutive_errors = 0
    _MAX_POLL_ERRORS = 3
    while _subscribed_tokens and _kite_client:
        try:
            tokens = _subscribed_tokens[:500]
            raw: dict = await asyncio.to_thread(_kite_client.ohlc, tokens)
            _consecutive_errors = 0
            if raw:
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
                    msg = {"type": "tick", "data": payload}
                    for q in list(_clients):
                        await q.put(msg)
                    # Also evaluate price alerts from polled data
                    await _fire_alerts(payload)
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
                return
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
    if not _loop:
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

    if _clients:
        msg = {"type": "tick", "data": payload}
        for q in list(_clients):
            asyncio.run_coroutine_threadsafe(q.put(msg), _loop)

    # Evaluate price alerts on each tick
    asyncio.run_coroutine_threadsafe(_fire_alerts(payload), _loop)


def _on_connect(ws: Any, response: Any) -> None:  # noqa: ARG001
    global _ws_forbidden_count, _polling_task
    _ws_forbidden_count = 0
    if _polling_task and not _polling_task.done():
        _polling_task.cancel()
        _polling_task = None
        log.info("KiteTicker connected — REST polling fallback cancelled")
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
            try:
                ws.stop()
            except Exception:
                pass
    else:
        log.warning("KiteTicker error %s: %s", code, reason)
        try:
            _ensure_polling()
        except Exception as exc:
            log.warning("Failed to start polling fallback on error: %s", exc)


def _on_close(ws: Any, code: Any, reason: Any) -> None:  # noqa: ARG001
    log.info("KiteTicker closed: %s %s", code, reason)
    try:
        _ensure_polling()
    except Exception as exc:
        log.warning("Failed to start polling fallback on close: %s", exc)


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

async def start_ticker(tokens: list[int], api_key: str, access_token: str) -> None:
    """Start (or restart) the KiteTicker with the given instrument tokens."""
    global _ticker, _loop, _subscribed_tokens, _kite_client, _ws_forbidden_count
    _loop = asyncio.get_running_loop()
    _subscribed_tokens = tokens
    _ws_forbidden_count = 0

    _kite_client = KiteConnect(api_key=api_key)
    _kite_client.set_access_token(access_token)

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

    async def _delayed_polling_fallback() -> None:
        await asyncio.sleep(10)
        if not _subscribed_tokens:
            return
        if not _polling_task or _polling_task.done():
            log.info("KiteTicker did not connect within 10 s — starting REST polling fallback")
            _ensure_polling()

    asyncio.create_task(_delayed_polling_fallback())


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


def add_client(user_id: uuid.UUID | None = None) -> asyncio.Queue:
    """Register a new WebSocket client and return its tick queue."""
    q: asyncio.Queue = asyncio.Queue()
    _clients.add(q)
    _client_user[q] = user_id
    if user_id is not None:
        try:
            import backend.alert_broadcaster as _ab
            _ab.register(user_id, q)
        except Exception:
            pass
    return q


def remove_client(q: asyncio.Queue) -> None:
    """Unregister a WebSocket client."""
    user_id = _client_user.pop(q, None)
    _clients.discard(q)
    if user_id is not None:
        try:
            import backend.alert_broadcaster as _ab
            _ab.unregister(user_id, q)
        except Exception:
            pass


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
