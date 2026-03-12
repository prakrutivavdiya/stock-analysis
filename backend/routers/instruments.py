"""
Instruments router — 2 endpoints

  GET /instruments/search?q=<query>&exchange=<NSE|BSE>  → substring search
  GET /instruments/{instrument_token}                    → instrument detail

Instruments are loaded from the Kite instruments CSV dump at startup (and
reloaded daily at 08:30 IST by the scheduler) and kept in memory.
_instrument_eq_list holds only EQ/ETF rows for fast search iteration.
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

# In-memory store: instrument_token → raw dict (all types)
_instrument_cache: dict[int, dict[str, Any]] = {}
# Pre-filtered list of EQ/ETF instruments for fast search iteration
_instrument_eq_list: list[dict[str, Any]] = []
_cache_loaded = False


async def _load_instruments() -> None:
    """Download the instruments dump from Kite and populate the in-memory caches."""
    global _cache_loaded, _instrument_eq_list
    kc = KiteConnect(api_key=settings.KITE_API_KEY)
    try:
        instruments = await asyncio.to_thread(kc.instruments)
        _instrument_cache.clear()
        eq_list: list[dict[str, Any]] = []
        for inst in instruments:
            _instrument_cache[inst["instrument_token"]] = inst
            if inst.get("instrument_type") in ("EQ", "ETF"):
                eq_list.append(inst)
        _instrument_eq_list = eq_list
        _cache_loaded = True
        log.info(
            "Instruments cache loaded: %d total, %d EQ/ETF",
            len(_instrument_cache), len(_instrument_eq_list),
        )
    except Exception as exc:
        log.warning("Failed to load instruments from Kite: %s", exc)


async def ensure_instruments_loaded() -> None:
    if not _cache_loaded:
        await _load_instruments()


@router.get("/search", response_model=InstrumentSearchResponse)
async def search_instruments(
    _user: CurrentUser,
    q: str = Query(..., min_length=1, description="Symbol or company name query (substring)"),
    exchange: str | None = Query(default=None, description="NSE or BSE"),
) -> InstrumentSearchResponse:
    """
    Search EQ/ETF instruments by trading symbol or company name.

    Substring matching — even partial strings return results.
    Ranked by relevance: exact symbol > starts-with symbol > starts-with name
    > contains symbol > contains name.
    Returns up to 20 results.
    """
    await ensure_instruments_loaded()

    q_lower = q.strip().lower()
    exch_upper = exchange.upper() if exchange else None

    # Collect (score, tradingsymbol, instrument) for all matches
    ranked: list[tuple[int, str, dict[str, Any]]] = []

    for inst in _instrument_eq_list:
        if exch_upper and inst.get("exchange") != exch_upper:
            continue

        symbol: str = inst.get("tradingsymbol", "")
        name: str = inst.get("name", "")
        sym_lower = symbol.lower()
        name_lower = name.lower()

        if q_lower == sym_lower:
            score = 0
        elif sym_lower.startswith(q_lower):
            score = 1
        elif name_lower.startswith(q_lower):
            score = 2
        elif q_lower in sym_lower:
            score = 3
        elif q_lower in name_lower:
            score = 4
        else:
            continue

        ranked.append((score, symbol, inst))

    # Sort by relevance score, then alphabetically by symbol
    ranked.sort(key=lambda x: (x[0], x[1]))

    return InstrumentSearchResponse(results=[
        InstrumentResult(
            instrument_token=inst["instrument_token"],
            tradingsymbol=inst.get("tradingsymbol", ""),
            name=inst.get("name", ""),
            exchange=inst.get("exchange", ""),
            instrument_type=inst.get("instrument_type", ""),
        )
        for _, _, inst in ranked[:20]
    ])


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
