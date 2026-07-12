"""
Historical Data router — 4 endpoints

  GET    /historical/{instrument_token}          → OHLCV candles (cache-first)
  POST   /historical/bulk                        → bulk D-1 fetch for multiple instruments
  GET    /historical/cache/status                → cache statistics
  DELETE /historical/cache/{instrument_token}    → invalidate cache for one instrument
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from backend.deps import CurrentUser, DBSession, KiteClient
from backend.models import OHLCVCache
from backend.schemas.historical import (
    BulkHistoricalRequest,
    BulkHistoricalResponse,
    CacheDeleteResponse,
    CacheStatusResponse,
    Candle,
    HistoricalResponse,
)

router = APIRouter()

VALID_INTERVALS = {"5minute", "15minute", "30minute", "60minute", "day"}

# Yahoo Finance interval mapping (fallback when Kite permission denied)
_YF_INTERVAL_MAP = {
    "5minute": "5m",
    "15minute": "15m",
    "30minute": "30m",
    "60minute": "60m",
    "day": "1d",
}

# NSE trade-series suffixes (e.g. RELIANCE-BE) that Yahoo Finance does not use —
# strip them before appending the .NS/.BO exchange suffix.
_NSE_SERIES_SUFFIXES = ("-BE", "-BZ", "-BL", "-SM", "-IL", "-IT", "-GB", "-GS")


def _yf_symbol(tradingsymbol: str, exchange: str) -> str:
    """Map an NSE/BSE tradingsymbol to its Yahoo Finance ticker."""
    sym = tradingsymbol.upper()
    for suf in _NSE_SERIES_SUFFIXES:
        if sym.endswith(suf):
            sym = sym[: -len(suf)]
            break
    return f"{sym}{'.BO' if exchange.upper() == 'BSE' else '.NS'}"


async def _fetch_from_yfinance(
    db: DBSession,
    instrument_token: int,
    tradingsymbol: str,
    exchange: str,
    interval: str,
    from_dt: datetime,
    to_dt: datetime,
) -> list[Candle]:
    """Fallback: fetch OHLCV via Yahoo Finance when Kite lacks historical permission."""
    from backend.data_source import set_ohlcv_source
    set_ohlcv_source("yfinance")

    import yfinance as yf  # imported lazily — not needed for normal flow

    yf_symbol = _yf_symbol(tradingsymbol, exchange)
    yf_interval = _YF_INTERVAL_MAP.get(interval, "1d")

    def _download():
        ticker = yf.Ticker(yf_symbol)
        return ticker.history(
            start=from_dt.strftime("%Y-%m-%d"),
            end=(to_dt + timedelta(days=1)).strftime("%Y-%m-%d"),
            interval=yf_interval,
            auto_adjust=True,
        )

    try:
        df = await asyncio.to_thread(_download)
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"Yahoo Finance fallback error: {exc}"
        ) from exc

    if df is None or df.empty:
        raise HTTPException(
            status_code=404, detail=f"No historical data found for {yf_symbol}"
        )

    # Skip candles already cached (see _fetch_and_cache) so a boundary duplicate
    # can't drop the whole batch. Widen by a day each side to catch tz-shifted
    # boundary candles (membership compares by instant).
    existing_ts = set((await db.execute(
        select(OHLCVCache.candle_timestamp).where(
            OHLCVCache.instrument_token == instrument_token,
            OHLCVCache.interval == interval,
            OHLCVCache.candle_timestamp >= from_dt - timedelta(days=1),
            OHLCVCache.candle_timestamp <= to_dt + timedelta(days=1),
        )
    )).scalars().all())

    candles: list[Candle] = []
    try:
        # Savepoint: a duplicate-row IntegrityError rolls back only these inserts,
        # never expiring ORM objects the caller still holds (avoids MissingGreenlet).
        async with db.begin_nested():
            for ts, row in df.iterrows():
                dt: datetime = ts.to_pydatetime() if hasattr(ts, "to_pydatetime") else datetime.fromisoformat(str(ts))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)

                candles.append(Candle(
                    timestamp=dt,
                    open=float(row["Open"]),
                    high=float(row["High"]),
                    low=float(row["Low"]),
                    close=float(row["Close"]),
                    volume=int(row.get("Volume", 0)),
                ))
                if dt in existing_ts:
                    continue  # already cached — don't re-insert

                db.add(OHLCVCache(
                    instrument_token=instrument_token,
                    tradingsymbol=tradingsymbol,
                    exchange=exchange,
                    interval=interval,
                    candle_timestamp=dt,
                    open=float(row["Open"]),
                    high=float(row["High"]),
                    low=float(row["Low"]),
                    close=float(row["Close"]),
                    volume=int(row.get("Volume", 0)),
                ))
        await db.commit()
    except IntegrityError:
        # savepoint already reverted; candles were built in Python and are still returned
        pass

    return candles


def _prev_trading_day() -> date:
    d = datetime.now(timezone.utc).date() - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


async def _fetch_and_cache(
    db: DBSession,
    kite: KiteClient,
    instrument_token: int,
    tradingsymbol: str,
    exchange: str,
    interval: str,
    from_dt: datetime,
    to_dt: datetime,
) -> list[Candle]:
    """Fetch OHLCV from Kite, write to ohlcv_cache, return candles."""
    from backend.data_source import set_ohlcv_source

    try:
        raw = await asyncio.to_thread(
            kite.historical_data, instrument_token, from_dt, to_dt, interval
        )
        set_ohlcv_source("kite")
    except Exception as exc:
        exc_str = str(exc).lower()
        if "permission" in exc_str or "403" in exc_str or "subscription" in exc_str:
            # Kite historical data requires a paid add-on; fall back to Yahoo Finance
            return await _fetch_from_yfinance(
                db, instrument_token, tradingsymbol, exchange, interval, from_dt, to_dt
            )
        raise HTTPException(status_code=502, detail=f"Kite historical API error: {exc}") from exc

    # Skip candles already cached so a single duplicate can't roll back the
    # whole batch. Kite returns IST-midnight timestamps that are the same
    # instant as a UTC-stored boundary candle (00:00 IST == 18:30 UTC prev day),
    # so the first candle of a forward-gap window is usually already present.
    # Widen the lookup by a day each side so a tz-shifted boundary is caught
    # (membership below compares by instant, so the extra rows are harmless).
    existing_ts = set((await db.execute(
        select(OHLCVCache.candle_timestamp).where(
            OHLCVCache.instrument_token == instrument_token,
            OHLCVCache.interval == interval,
            OHLCVCache.candle_timestamp >= from_dt - timedelta(days=1),
            OHLCVCache.candle_timestamp <= to_dt + timedelta(days=1),
        )
    )).scalars().all())

    candles: list[Candle] = []
    for c in raw:
        ts = c["date"]
        if isinstance(ts, datetime) and ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)

        candles.append(Candle(
            timestamp=ts,
            open=c["open"], high=c["high"], low=c["low"],
            close=c["close"], volume=c["volume"],
        ))
        if ts in existing_ts:
            continue  # already cached — don't re-insert

        db.add(OHLCVCache(
            instrument_token=instrument_token,
            tradingsymbol=tradingsymbol,
            exchange=exchange,
            interval=interval,
            candle_timestamp=ts,
            open=c["open"], high=c["high"], low=c["low"],
            close=c["close"], volume=c["volume"],
        ))

    try:
        await db.commit()
    except IntegrityError:
        # Concurrent writer cached the same candles; safe to ignore.
        await db.rollback()
    return candles


@router.get("/cache/status", response_model=CacheStatusResponse)
async def cache_status(db: DBSession, _user: CurrentUser) -> CacheStatusResponse:
    """Return statistics about the local OHLCV cache."""
    count_q = await db.execute(select(func.count()).select_from(OHLCVCache))
    total = count_q.scalar() or 0

    distinct_q = await db.execute(
        select(func.count(OHLCVCache.instrument_token.distinct()))
    )
    instruments = distinct_q.scalar() or 0

    range_q = await db.execute(
        select(
            func.min(OHLCVCache.candle_timestamp),
            func.max(OHLCVCache.candle_timestamp),
        )
    )
    oldest_ts, newest_ts = range_q.one()

    return CacheStatusResponse(
        cached_instruments=instruments,
        total_candles=total,
        oldest=oldest_ts.date().isoformat() if oldest_ts else None,
        newest=newest_ts.date().isoformat() if newest_ts else None,
    )


@router.get("/{instrument_token}", response_model=HistoricalResponse)
async def get_historical(
    instrument_token: int,
    db: DBSession,
    kite: KiteClient,
    _user: CurrentUser,
    interval: str = Query(default="day"),
    from_date: str = Query(default=""),
    to_date: str = Query(default=""),
    tradingsymbol: str = Query(default=""),
    exchange: str = Query(default="NSE"),
) -> HistoricalResponse:
    """
    Fetch OHLCV candles.
    Returns from ohlcv_cache if fully covered; fetches from Kite otherwise.
    Intraday cache expires after market close; daily cache is permanent.
    """
    if interval not in VALID_INTERVALS:
        raise HTTPException(status_code=400, detail=f"Invalid interval. Valid: {VALID_INTERVALS}")

    d1 = _prev_trading_day()
    from_d = date.fromisoformat(from_date) if from_date else d1
    to_d = date.fromisoformat(to_date) if to_date else d1

    from_dt = datetime(from_d.year, from_d.month, from_d.day, tzinfo=timezone.utc)
    to_dt = datetime(to_d.year, to_d.month, to_d.day, 23, 59, 59, tzinfo=timezone.utc)

    # Intraday cache is stale if market has closed today
    market_closed = datetime.now(timezone.utc).hour >= 10  # 15:30 IST ≈ 10:00 UTC
    is_intraday = interval != "day"

    source = "cache"
    cached_rows = await db.execute(
        select(OHLCVCache)
        .where(
            OHLCVCache.instrument_token == instrument_token,
            OHLCVCache.interval == interval,
            OHLCVCache.candle_timestamp >= from_dt,
            OHLCVCache.candle_timestamp <= to_dt,
        )
        .order_by(OHLCVCache.candle_timestamp)
    )
    cached = cached_rows.scalars().all()

    # Resolve symbol/exchange once (used in both branches)
    symbol = cached[0].tradingsymbol if cached else (tradingsymbol or str(instrument_token))
    exch   = cached[0].exchange      if cached else exchange

    # Use cache for daily data; use cache for intraday only if market is closed
    if cached and (not is_intraday or market_closed):
        candles = [
            Candle(
                timestamp=r.candle_timestamp,
                open=float(r.open), high=float(r.high),
                low=float(r.low), close=float(r.close),
                volume=r.volume,
            )
            for r in cached
        ]

        # For daily data, fill gaps between the cache and the requested range so
        # the series is contiguous (indicators are computed over the same range).
        if not is_intraday:
            # Backward gap: cache starts later than from_date (older history missing).
            # Fetch only the non-overlapping older window to avoid duplicate-key rollbacks.
            earliest_cached_date = cached[0].candle_timestamp.date()
            if earliest_cached_date > from_d + timedelta(days=7):
                gap_to_dt = datetime(
                    earliest_cached_date.year, earliest_cached_date.month, earliest_cached_date.day,
                    tzinfo=timezone.utc,
                ) - timedelta(seconds=1)
                try:
                    older = await _fetch_and_cache(
                        db, kite, instrument_token, symbol, exch, interval, from_dt, gap_to_dt
                    )
                    if older:
                        candles = older + candles  # older precedes all cached candles
                        source = "kite"
                except Exception:
                    pass  # best-effort — serve what we have

            # Forward gap: cache stops before to_d (e.g. Fri cache, Mon view — fetch Mon).
            latest_cached_date = cached[-1].candle_timestamp.date()
            if latest_cached_date < to_d:
                gap_from_dt = datetime(
                    latest_cached_date.year, latest_cached_date.month, latest_cached_date.day,
                    tzinfo=timezone.utc,
                ) + timedelta(days=1)
                try:
                    new_candles = await _fetch_and_cache(
                        db, kite, instrument_token, symbol, exch, interval, gap_from_dt, to_dt
                    )
                    if new_candles:
                        candles = candles + new_candles
                        source = "kite"
                except Exception:
                    pass  # keep existing cached candles on gap-fill failure
    else:
        source = "kite"
        candles = await _fetch_and_cache(
            db, kite, instrument_token, symbol, exch, interval, from_dt, to_dt
        )

    return HistoricalResponse(
        instrument_token=instrument_token,
        tradingsymbol=symbol,
        interval=interval,
        from_date=from_d.isoformat(),
        to_date=to_d.isoformat(),
        candles=candles,
        source=source,
    )


@router.post("/bulk", response_model=BulkHistoricalResponse)
async def bulk_historical(
    body: BulkHistoricalRequest,
    db: DBSession,
    kite: KiteClient,
    _user: CurrentUser,
) -> BulkHistoricalResponse:
    """Fetch D-1 daily candle for multiple instruments in one call."""
    target_date = date.fromisoformat(body.date) if body.date else _prev_trading_day()
    from_dt = datetime(target_date.year, target_date.month, target_date.day, tzinfo=timezone.utc)
    to_dt = datetime(target_date.year, target_date.month, target_date.day, 23, 59, 59, tzinfo=timezone.utc)

    results: dict[str, dict] = {}
    errors: dict[str, str] = {}

    for token in body.instrument_tokens:
        try:
            from backend.data_source import set_ohlcv_source

            cached_q = await db.execute(
                select(OHLCVCache).where(
                    OHLCVCache.instrument_token == token,
                    OHLCVCache.interval == body.interval,
                    OHLCVCache.candle_timestamp >= from_dt,
                    OHLCVCache.candle_timestamp <= to_dt,
                ).limit(1)
            )
            row = cached_q.scalar_one_or_none()

            if row:
                results[str(token)] = {
                    "open": float(row.open), "high": float(row.high),
                    "low": float(row.low), "close": float(row.close),
                    "volume": row.volume,
                }
            else:
                raw = None
                try:
                    raw = await asyncio.to_thread(
                        kite.historical_data, token, from_dt, to_dt, body.interval
                    )
                    set_ohlcv_source("kite")
                except Exception as kite_exc:
                    exc_str = str(kite_exc).lower()
                    if "permission" in exc_str or "403" in exc_str or "subscription" in exc_str:
                        # Look up tradingsymbol from any existing cache row for this token
                        sym_q = await db.execute(
                            select(OHLCVCache).where(OHLCVCache.instrument_token == token).limit(1)
                        )
                        sym_row = sym_q.scalar_one_or_none()
                        if sym_row:
                            try:
                                candles = await _fetch_from_yfinance(
                                    db, token, sym_row.tradingsymbol, sym_row.exchange,
                                    body.interval, from_dt, to_dt,
                                )
                                if candles:
                                    c = candles[-1]
                                    results[str(token)] = {
                                        "open": c.open, "high": c.high,
                                        "low": c.low, "close": c.close,
                                        "volume": c.volume,
                                    }
                            except Exception:
                                errors[str(token)] = str(kite_exc)
                        else:
                            errors[str(token)] = str(kite_exc)
                    else:
                        errors[str(token)] = str(kite_exc)

                if raw:
                    c = raw[-1]
                    results[str(token)] = {
                        "open": c["open"], "high": c["high"],
                        "low": c["low"], "close": c["close"],
                        "volume": c["volume"],
                    }
                    for candle in raw:
                        ts = candle["date"]
                        if isinstance(ts, datetime) and ts.tzinfo is None:
                            ts = ts.replace(tzinfo=timezone.utc)
                        db.add(OHLCVCache(
                            instrument_token=token,
                            tradingsymbol=str(token),
                            exchange="NSE",
                            interval=body.interval,
                            candle_timestamp=ts,
                            open=candle["open"], high=candle["high"],
                            low=candle["low"], close=candle["close"],
                            volume=candle["volume"],
                        ))
                    try:
                        await db.commit()
                    except IntegrityError:
                        await db.rollback()
        except Exception as exc:
            errors[str(token)] = str(exc)

    return BulkHistoricalResponse(
        date=target_date.isoformat(),
        results=results,
        errors=errors,
    )


@router.delete("/cache/{instrument_token}", response_model=CacheDeleteResponse)
async def delete_cache(
    instrument_token: int,
    db: DBSession,
    _user: CurrentUser,
) -> CacheDeleteResponse:
    """Invalidate all cached OHLCV data for an instrument (forces re-fetch)."""
    result = await db.execute(
        delete(OHLCVCache).where(OHLCVCache.instrument_token == instrument_token)
    )
    await db.commit()
    return CacheDeleteResponse(deleted_rows=result.rowcount)
