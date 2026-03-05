"""
Fundamentals router — 2 endpoints

  GET  /fundamentals/{instrument_token}  → cached P/E, EPS, 52W data
  POST /fundamentals/refresh             → on-demand NSE India data refresh

External API: NSE India (https://www.nseindia.com)
  Undocumented public endpoint — requires session cookie.
  Rate-limited by NSE; we rate-limit our refresh endpoint to 2 req/user/hour.

NSE endpoint used:
  GET https://www.nseindia.com/api/quote-equity?symbol=<SYMBOL>

  Relevant response fields:
    priceInfo.pdSymbolPe          → P/E ratio
    priceInfo.weekHighLow.max     → 52-week high
    priceInfo.weekHighLow.min     → 52-week low
    securityInfo.faceVal          → face value
    metadata.isin                 → ISIN
  EPS is derived: last_price / pe_ratio (approximate; NSE doesn't expose EPS directly)
  Book value: attempted from priceInfo.intrinsicValue (not always available)
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select
from tenacity import retry, stop_after_attempt, wait_exponential

from backend.deps import CurrentUser, DBSession, KiteClient
from backend.limiter import get_user_key, limiter
from backend.models import FundamentalCache
from backend.schemas.fundamentals import FundamentalsRefreshResponse, FundamentalsResponse

log = logging.getLogger(__name__)
router = APIRouter()

_NSE_BASE = "https://www.nseindia.com"
_NSE_QUOTE_URL = f"{_NSE_BASE}/api/quote-equity"
_STALENESS_DAYS = 8   # warn if data is older than 8 days

_NSE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
    "Connection": "keep-alive",
}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
async def _fetch_nse_fundamental(symbol: str) -> dict[str, Any] | None:
    """
    Scrape fundamental data from NSE India for a given trading symbol.

    External API: NSE India  https://www.nseindia.com/api/quote-equity?symbol=INFY
    Requires session cookies obtained by first hitting the NSE homepage.
    Returns a dict with keys: pe_ratio, eps, book_value, face_value,
    week_52_high, week_52_low, data_date, or None on failure.
    """
    async with httpx.AsyncClient(headers=_NSE_HEADERS, follow_redirects=True, timeout=15.0) as client:
        # Step 1: visit homepage to obtain session cookies
        try:
            await client.get(_NSE_BASE)
        except Exception:
            pass  # proceed without cookies as fallback

        # Step 2: fetch quote data
        try:
            resp = await client.get(_NSE_QUOTE_URL, params={"symbol": symbol})
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            log.warning("NSE fetch failed for %s: %s", symbol, exc)
            return None

    price_info = data.get("priceInfo", {})
    security_info = data.get("securityInfo", {})
    week_hl = price_info.get("weekHighLow", {})

    pe_ratio: float | None = None
    raw_pe = price_info.get("pdSymbolPe")
    if raw_pe and str(raw_pe).strip() not in ("-", "", "0"):
        try:
            pe_ratio = float(raw_pe)
        except (ValueError, TypeError):
            pass

    last_price: float | None = None
    try:
        last_price = float(price_info.get("lastPrice", 0) or 0)
    except (ValueError, TypeError):
        pass

    # EPS derived from price and P/E (NSE doesn't expose EPS directly)
    eps: float | None = None
    if pe_ratio and last_price and pe_ratio > 0:
        eps = round(last_price / pe_ratio, 4)

    face_value: float | None = None
    try:
        fv = security_info.get("faceVal") or security_info.get("faceValue")
        if fv:
            face_value = float(fv)
    except (ValueError, TypeError):
        pass

    book_value: float | None = None
    try:
        bv = price_info.get("intrinsicValue") or price_info.get("bookValue")
        if bv:
            book_value = float(bv)
    except (ValueError, TypeError):
        pass

    week_52_high: float | None = None
    week_52_low: float | None = None
    try:
        week_52_high = float(week_hl.get("max", 0) or 0) or None
        week_52_low = float(week_hl.get("min", 0) or 0) or None
    except (ValueError, TypeError):
        pass

    return {
        "pe_ratio": pe_ratio,
        "eps": eps,
        "book_value": book_value,
        "face_value": face_value,
        "week_52_high": week_52_high,
        "week_52_low": week_52_low,
        "data_date": date.today().isoformat(),
    }


async def _upsert_fundamental(
    db: DBSession,
    token: int,
    symbol: str,
    exchange: str,
    data: dict[str, Any],
) -> None:
    row = await db.get(FundamentalCache, token)
    if row is None:
        row = FundamentalCache(instrument_token=token)
        db.add(row)
    row.tradingsymbol = symbol
    row.exchange = exchange
    row.pe_ratio = data.get("pe_ratio")
    row.eps = data.get("eps")
    row.book_value = data.get("book_value")
    row.face_value = data.get("face_value")
    row.week_52_high = data.get("week_52_high")
    row.week_52_low = data.get("week_52_low")
    raw_date = data.get("data_date")
    row.data_date = date.fromisoformat(raw_date) if isinstance(raw_date, str) else raw_date


@router.get("/{instrument_token}", response_model=FundamentalsResponse)
async def get_fundamentals(
    instrument_token: int,
    db: DBSession,
    _user: CurrentUser,
) -> FundamentalsResponse:
    """Retrieve cached fundamental data for a single instrument."""
    result = await db.execute(
        select(FundamentalCache).where(
            FundamentalCache.instrument_token == instrument_token
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Fundamental data not yet available for this instrument. "
                   "POST /fundamentals/refresh to trigger a fetch.",
        )

    stale = False
    if row.fetched_at:
        age = datetime.now(timezone.utc) - row.fetched_at.replace(tzinfo=timezone.utc)
        stale = age > timedelta(days=_STALENESS_DAYS)

    return FundamentalsResponse(
        instrument_token=row.instrument_token,
        tradingsymbol=row.tradingsymbol,
        pe_ratio=float(row.pe_ratio) if row.pe_ratio else None,
        eps=float(row.eps) if row.eps else None,
        book_value=float(row.book_value) if row.book_value else None,
        face_value=float(row.face_value) if row.face_value else None,
        week_52_high=float(row.week_52_high) if row.week_52_high else None,
        week_52_low=float(row.week_52_low) if row.week_52_low else None,
        fetched_at=row.fetched_at,
        data_date=row.data_date.isoformat() if row.data_date else None,
        staleness_warning=stale,
    )


@router.post("/refresh", response_model=FundamentalsRefreshResponse)
@limiter.limit("2/hour", key_func=get_user_key)
async def refresh_fundamentals(
    request: Request,  # required by slowapi for rate limiting
    kite: KiteClient,
    db: DBSession,
    _user: CurrentUser,
) -> FundamentalsRefreshResponse:
    """
    Trigger on-demand fundamental data refresh for all held instruments.
    Scrapes NSE India (external API).
    Rate-limited to 2 requests/user/hour.
    """
    try:
        holdings = await asyncio.to_thread(kite.holdings)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Kite API error: {exc}") from exc

    refreshed = 0
    failed: list[str] = []

    for h in holdings:
        symbol = h.get("tradingsymbol", "")
        token = h.get("instrument_token")
        exchange = h.get("exchange", "NSE")
        if not symbol or not token:
            continue

        try:
            data = await _fetch_nse_fundamental(symbol)
            if data:
                await _upsert_fundamental(db, token, symbol, exchange, data)
                refreshed += 1
            else:
                failed.append(symbol)
        except Exception as exc:
            log.warning("Fundamental refresh failed for %s: %s", symbol, exc)
            failed.append(symbol)

    await db.commit()

    return FundamentalsRefreshResponse(
        refreshed=refreshed,
        failed=failed,
        completed_at=datetime.now(timezone.utc),
    )
