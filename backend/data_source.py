"""In-process OHLCV data source tracker.

Updated whenever data is fetched successfully — "kite" when Zerodha Kite
historical API is used, "yfinance" when the Yahoo Finance fallback is used.
Exposed via GET /health so the frontend can display it in the topbar.
"""
from __future__ import annotations

_ohlcv_source: str = "unknown"  # "kite" | "yfinance" | "unknown"


def set_ohlcv_source(source: str) -> None:
    global _ohlcv_source
    _ohlcv_source = source


def get_ohlcv_source() -> str:
    return _ohlcv_source
