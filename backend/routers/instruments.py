"""
Instruments router — 2 endpoints

  GET /instruments/search?q=<query>&exchange=<NSE|BSE>  → fuzzy search
  GET /instruments/{instrument_token}                    → instrument detail

Instruments are loaded from the Kite instruments CSV dump at startup and kept
in memory in _instrument_cache.  The dump is exchange-level data (same for all
users) so we use a KiteConnect instance initialized with just the API key.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from kiteconnect import KiteConnect

from backend.config import settings
from backend.deps import CurrentUser
from backend.schemas.instruments import InstrumentDetail, InstrumentResult, InstrumentSearchResponse

log = logging.getLogger(__name__)
router = APIRouter()

# In-memory instruments store: instrument_token → dict
_instrument_cache: dict[int, dict[str, Any]] = {}
_cache_loaded = False


async def _load_instruments() -> None:
    """Download the instruments dump from Kite and populate _instrument_cache."""
    global _cache_loaded
    kc = KiteConnect(api_key=settings.KITE_API_KEY)
    try:
        instruments = await asyncio.to_thread(kc.instruments)
        _instrument_cache.clear()
        for inst in instruments:
            _instrument_cache[inst["instrument_token"]] = inst
        _cache_loaded = True
        log.info("Instruments cache loaded: %d instruments", len(_instrument_cache))
    except Exception as exc:
        log.warning("Failed to load instruments from Kite: %s", exc)


async def ensure_instruments_loaded() -> None:
    if not _cache_loaded:
        await _load_instruments()


@router.get("/search", response_model=InstrumentSearchResponse)
async def search_instruments(
    _user: CurrentUser,
    q: str = Query(..., min_length=1, description="Symbol or company name query"),
    exchange: str | None = Query(default=None, description="NSE or BSE"),
) -> InstrumentSearchResponse:
    """Search instruments by trading symbol or company name (case-insensitive)."""
    await ensure_instruments_loaded()

    q_lower = q.lower()
    results: list[InstrumentResult] = []

    for inst in _instrument_cache.values():
        if inst.get("instrument_type") not in ("EQ", "ETF"):
            continue
        if exchange and inst.get("exchange") != exchange.upper():
            continue

        symbol: str = inst.get("tradingsymbol", "")
        name: str = inst.get("name", "")

        if q_lower in symbol.lower() or q_lower in name.lower():
            results.append(InstrumentResult(
                instrument_token=inst["instrument_token"],
                tradingsymbol=symbol,
                name=name,
                exchange=inst.get("exchange", ""),
                instrument_type=inst.get("instrument_type", ""),
            ))

        if len(results) >= 20:
            break

    # Sort: exact symbol match first
    results.sort(key=lambda r: (r.tradingsymbol.lower() != q_lower, r.tradingsymbol))
    return InstrumentSearchResponse(results=results[:20])


@router.get("/{instrument_token}", response_model=InstrumentDetail)
async def get_instrument(
    instrument_token: int,
    _user: CurrentUser,
) -> InstrumentDetail:
    """Fetch detail for a single instrument by token."""
    await ensure_instruments_loaded()

    inst = _instrument_cache.get(instrument_token)
    if not inst:
        raise HTTPException(status_code=404, detail="Instrument not found")

    return InstrumentDetail(
        instrument_token=inst["instrument_token"],
        tradingsymbol=inst.get("tradingsymbol", ""),
        name=inst.get("name", ""),
        exchange=inst.get("exchange", ""),
        isin=inst.get("isin"),
        lot_size=int(inst.get("lot_size", 1)),
        tick_size=float(inst.get("tick_size", 0.05)),
    )
