"""Tests for WebSocket /ws/quotes endpoint and ticker_mgr helpers."""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest

import backend.ticker as ticker_mgr


# ─── ticker_mgr unit tests (no WebSocket needed) ──────────────────────────────

def test_add_client_returns_queue():
    """add_client() returns an asyncio.Queue and registers it."""
    orig = ticker_mgr._clients.copy()
    q = ticker_mgr.add_client()
    try:
        assert isinstance(q, asyncio.Queue)
        assert q in ticker_mgr._clients
    finally:
        ticker_mgr.remove_client(q)
    # Restored to original size
    assert len(ticker_mgr._clients) == len(orig)


def test_remove_client_deregisters():
    """remove_client() removes the queue from the set."""
    q = ticker_mgr.add_client()
    assert q in ticker_mgr._clients
    ticker_mgr.remove_client(q)
    assert q not in ticker_mgr._clients


def test_remove_client_idempotent():
    """Calling remove_client twice does not raise."""
    q = ticker_mgr.add_client()
    ticker_mgr.remove_client(q)
    ticker_mgr.remove_client(q)  # second call should not raise


def test_multiple_clients_isolated():
    """Each client gets its own independent queue."""
    q1 = ticker_mgr.add_client()
    q2 = ticker_mgr.add_client()
    try:
        assert q1 is not q2
        assert q1 in ticker_mgr._clients
        assert q2 in ticker_mgr._clients
    finally:
        ticker_mgr.remove_client(q1)
        ticker_mgr.remove_client(q2)
    assert q1 not in ticker_mgr._clients
    assert q2 not in ticker_mgr._clients


def test_on_ticks_broadcasts_to_clients():
    """_on_ticks() puts payload into every registered client queue."""
    loop = asyncio.new_event_loop()

    q1 = asyncio.Queue()
    q2 = asyncio.Queue()

    original_clients = ticker_mgr._clients.copy()
    original_loop = ticker_mgr._loop

    ticker_mgr._clients = {q1, q2}
    ticker_mgr._loop = loop

    ticks = [
        {
            "instrument_token": 12345,
            "last_price": 100.0,
            "change": 0.1,
            "volume": 500,
            "ohlc": {"open": 99.0, "high": 101.0, "low": 98.0, "close": 100.0},
        }
    ]

    ticker_mgr._on_ticks(MagicMock(), ticks)

    # Give the event loop a moment to process the run_coroutine_threadsafe calls
    loop.run_until_complete(asyncio.sleep(0.05))

    assert not q1.empty()
    assert not q2.empty()

    ticker_mgr._clients = original_clients
    ticker_mgr._loop = original_loop
    loop.close()


# ─── WebSocket endpoint tests via Starlette TestClient ────────────────────────

def test_ws_accepts_connection():
    """WebSocket handshake completes successfully."""
    from starlette.testclient import TestClient
    from backend.main import app

    # Use a pre-filled queue so the endpoint can send one message and we can
    # disconnect before the second blocking q.get() call.
    sentinel_q: asyncio.Queue = asyncio.Queue()

    with patch.object(ticker_mgr, "add_client", return_value=sentinel_q), \
         patch.object(ticker_mgr, "remove_client"):
        with TestClient(app) as tc:
            with tc.websocket_connect("/ws/quotes") as ws:
                assert ws is not None
                # Disconnect immediately — the endpoint catches the disconnect.


def test_ws_receives_tick_data():
    """Tick data put into the queue is forwarded to the WebSocket client."""
    from starlette.testclient import TestClient
    from backend.main import app

    ticks = [{"instrument_token": 408065, "ltp": 1500.0, "change": 0.5}]

    # Build a pre-seeded queue with the fully-formed message format
    q: asyncio.Queue = asyncio.Queue()
    q.put_nowait({"type": "tick", "data": ticks})

    with patch.object(ticker_mgr, "add_client", return_value=q), \
         patch.object(ticker_mgr, "remove_client"):
        with TestClient(app) as tc:
            with tc.websocket_connect("/ws/quotes") as ws:
                msg = ws.receive_json()
                assert msg["type"] == "tick"
                assert msg["data"][0]["instrument_token"] == 408065
                # Disconnect — the endpoint catches the disconnect exception.
