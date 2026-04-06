"""Tests for KiteTicker singleton manager (ticker.py)."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import backend.ticker as ticker_mgr


@pytest.fixture(autouse=True)
def reset_ticker_state():
    """Restore module-level ticker state after each test."""
    orig_clients = ticker_mgr._clients.copy()
    orig_tokens = ticker_mgr._subscribed_tokens.copy()
    orig_ticker = ticker_mgr._ticker
    orig_loop = ticker_mgr._loop
    orig_kite = ticker_mgr._kite_client
    orig_polling = ticker_mgr._polling_task
    orig_forbidden = ticker_mgr._ws_forbidden_count
    yield
    ticker_mgr._clients = orig_clients
    ticker_mgr._subscribed_tokens = orig_tokens
    ticker_mgr._ticker = orig_ticker
    ticker_mgr._loop = orig_loop
    ticker_mgr._kite_client = orig_kite
    ticker_mgr._polling_task = orig_polling
    ticker_mgr._ws_forbidden_count = orig_forbidden


# ── add_client / remove_client ────────────────────────────────────────────────

def test_add_client_returns_asyncio_queue():
    ticker_mgr._clients = set()
    q = ticker_mgr.add_client()
    assert isinstance(q, asyncio.Queue)


def test_add_client_registers_queue():
    ticker_mgr._clients = set()
    q = ticker_mgr.add_client()
    assert q in ticker_mgr._clients


def test_remove_client_deregisters():
    ticker_mgr._clients = set()
    q = ticker_mgr.add_client()
    ticker_mgr.remove_client(q)
    assert q not in ticker_mgr._clients


def test_remove_client_unknown_queue_is_safe():
    """remove_client with an unregistered queue must not raise."""
    ticker_mgr._clients = set()
    q = asyncio.Queue()
    ticker_mgr.remove_client(q)  # no error


# ── add_token ─────────────────────────────────────────────────────────────────

def test_add_token_appends_new_token():
    ticker_mgr._subscribed_tokens = [100, 200]
    ticker_mgr._ticker = None  # no live ticker
    ticker_mgr.add_token(300)
    assert 300 in ticker_mgr._subscribed_tokens


def test_add_token_ignores_duplicate():
    ticker_mgr._subscribed_tokens = [100, 200]
    ticker_mgr._ticker = None
    ticker_mgr.add_token(100)  # already present
    assert ticker_mgr._subscribed_tokens.count(100) == 1


def test_add_token_subscribes_via_ticker_if_active():
    ticker_mgr._subscribed_tokens = [100]
    mock_ticker = MagicMock()
    ticker_mgr._ticker = mock_ticker
    ticker_mgr.add_token(999)
    mock_ticker.subscribe.assert_called_once_with([999])
    mock_ticker.set_mode.assert_called_once()


# ── _on_ticks broadcast ────────────────────────────────────────────────────────

def test_on_ticks_no_clients_is_noop():
    """_on_ticks with no clients doesn't crash."""
    ticker_mgr._clients = set()
    ticker_mgr._loop = None
    ticker_mgr._on_ticks(MagicMock(), [{"instrument_token": 1, "last_price": 100}])
    # No error means success


def test_on_ticks_payload_structure():
    """_on_ticks formats the tick payload correctly."""
    loop = asyncio.new_event_loop()
    q = asyncio.Queue()
    ticker_mgr._clients = {q}
    ticker_mgr._loop = loop

    raw_tick = {
        "instrument_token": 408065,
        "last_price": 1500.0,
        "change": 0.33,
        "volume": 1000,
        "ohlc": {"open": 1490.0, "high": 1510.0, "low": 1485.0, "close": 1498.0},
        "last_trade_time": None,
    }

    ticker_mgr._on_ticks(MagicMock(), [raw_tick])
    loop.run_until_complete(asyncio.sleep(0.05))

    assert not q.empty()
    msg = q.get_nowait()
    assert msg["type"] == "tick"
    payload = msg["data"]
    assert len(payload) == 1
    item = payload[0]
    assert item["instrument_token"] == 408065
    assert item["ltp"] == 1500.0
    assert item["open"] == 1490.0
    assert item["volume"] == 1000

    ticker_mgr._clients = set()
    ticker_mgr._loop = None
    loop.close()


def test_on_ticks_exits_early_when_no_loop():
    """_on_ticks exits early when _loop is None even if clients are present."""
    q = asyncio.Queue()
    ticker_mgr._clients = {q}
    ticker_mgr._loop = None  # No loop — should exit early

    ticker_mgr._on_ticks(MagicMock(), [{"instrument_token": 1, "last_price": 100}])

    # Queue should be empty because the function returned early
    assert q.empty()


# ── _on_connect ────────────────────────────────────────────────────────────────

def test_on_connect_resets_forbidden_count():
    ticker_mgr._ws_forbidden_count = 3
    ticker_mgr._subscribed_tokens = []
    ws = MagicMock()
    ticker_mgr._on_connect(ws, {})
    assert ticker_mgr._ws_forbidden_count == 0


def test_on_connect_subscribes_tokens():
    ticker_mgr._ws_forbidden_count = 0
    ticker_mgr._subscribed_tokens = [111, 222]
    ws = MagicMock()
    ticker_mgr._on_connect(ws, {})
    ws.subscribe.assert_called_once_with([111, 222])
    ws.set_mode.assert_called_once()


def test_on_connect_no_tokens_skips_subscribe():
    """When there are no tokens, subscribe should not be called."""
    ticker_mgr._ws_forbidden_count = 0
    ticker_mgr._subscribed_tokens = []
    ws = MagicMock()
    ticker_mgr._on_connect(ws, {})
    ws.subscribe.assert_not_called()


# ── _on_error / 403 handling ──────────────────────────────────────────────────

def test_on_error_increments_forbidden_count():
    ticker_mgr._ws_forbidden_count = 0
    ticker_mgr._loop = None  # prevent polling attempt
    ticker_mgr._on_error(MagicMock(), 403, "Forbidden")
    assert ticker_mgr._ws_forbidden_count == 1


def test_on_error_non_403_does_not_increment():
    ticker_mgr._ws_forbidden_count = 0
    ticker_mgr._loop = None
    ticker_mgr._on_error(MagicMock(), 1006, "connection closed")
    assert ticker_mgr._ws_forbidden_count == 0


def test_on_error_403_in_reason_increments():
    """A 403 in the reason string also triggers the forbidden counter."""
    ticker_mgr._ws_forbidden_count = 0
    ticker_mgr._loop = None
    ticker_mgr._on_error(MagicMock(), 1000, "403 forbidden response")
    assert ticker_mgr._ws_forbidden_count == 1


# ── stop_ticker ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_stop_ticker_clears_state():
    mock_ticker = MagicMock()
    ticker_mgr._ticker = mock_ticker
    await ticker_mgr.stop_ticker()
    mock_ticker.close.assert_called_once()
    assert ticker_mgr._ticker is None


@pytest.mark.asyncio
async def test_stop_ticker_when_none_is_safe():
    ticker_mgr._ticker = None
    await ticker_mgr.stop_ticker()  # no error


# ── start_ticker ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_start_ticker_sets_tokens():
    with patch("backend.ticker.KiteTicker") as mock_kt_cls, \
         patch("backend.ticker.KiteConnect") as mock_kc_cls, \
         patch("threading.Thread") as mock_thread:
        mock_kt = MagicMock()
        mock_kt_cls.return_value = mock_kt
        mock_kc = MagicMock()
        mock_kc_cls.return_value = mock_kc
        mock_thread_instance = MagicMock()
        mock_thread.return_value = mock_thread_instance

        await ticker_mgr.start_ticker([111, 222], "api_key", "access_token")

        assert ticker_mgr._subscribed_tokens == [111, 222]
        mock_thread_instance.start.assert_called_once()


@pytest.mark.asyncio
async def test_start_ticker_closes_existing_ticker():
    """start_ticker() closes the existing ticker before creating a new one."""
    existing_ticker = MagicMock()
    ticker_mgr._ticker = existing_ticker

    with patch("backend.ticker.KiteTicker") as mock_kt_cls, \
         patch("backend.ticker.KiteConnect"), \
         patch("threading.Thread") as mock_thread:
        mock_kt_cls.return_value = MagicMock()
        mock_thread.return_value = MagicMock()

        await ticker_mgr.start_ticker([111], "api_key", "access_token")

        existing_ticker.close.assert_called_once()
