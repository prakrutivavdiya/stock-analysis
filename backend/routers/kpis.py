"""
KPIs router — 6 endpoints

  GET    /kpis                       → list user's KPI definitions
  POST   /kpis                       → create a new KPI
  PUT    /kpis/{kpi_id}              → update a KPI
  DELETE /kpis/{kpi_id}              → delete a KPI
  POST   /kpis/{kpi_id}/compute      → compute KPI for given instruments + date
  GET    /kpis/portfolio             → compute all active KPIs for all holdings (D-1)
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timezone
from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from backend.deps import CurrentUser, DBSession, KiteClient
from backend.kpi_engine import FormulaValidationError, evaluate_formula, validate_formula
from backend.models import FundamentalCache, KPI, OHLCVCache
from backend.schemas.kpis import (
    KPIComputeRequest,
    KPIComputeResponse,
    KPIComputeResult,
    KPICreate,
    KPIOut,
    KPIPortfolioResponse,
    KPIsListResponse,
    KPIUpdate,
    PortfolioKPIRow,
)

router = APIRouter()


async def _load_fundamental(
    db: DBSession,
    token: int,
    tradingsymbol: str = "",
    exchange: str = "NSE",
) -> dict[str, Any] | None:
    """Return fundamental data dict from cache, falling back to Yahoo Finance if absent."""
    from datetime import date as _date

    fund_row = (await db.execute(
        select(FundamentalCache).where(FundamentalCache.instrument_token == token)
    )).scalar_one_or_none()

    if fund_row is None and tradingsymbol:
        try:
            import yfinance as yf
            suffix = ".BO" if exchange.upper() == "BSE" else ".NS"
            info = await asyncio.to_thread(
                lambda: yf.Ticker(f"{tradingsymbol}{suffix}").info
            )
            pe = info.get("trailingPE")
            eps = info.get("trailingEps")
            w52h = info.get("fiftyTwoWeekHigh")
            w52l = info.get("fiftyTwoWeekLow")
            bv = info.get("bookValue")
            if any(v is not None for v in [pe, eps, w52h, w52l]):
                row = FundamentalCache(
                    instrument_token=token,
                    tradingsymbol=tradingsymbol,
                    exchange=exchange,
                    pe_ratio=float(pe) if pe else None,
                    eps=float(eps) if eps else None,
                    book_value=float(bv) if bv else None,
                    face_value=None,
                    week_52_high=float(w52h) if w52h else None,
                    week_52_low=float(w52l) if w52l else None,
                    data_date=_date.today(),
                )
                db.add(row)
                try:
                    await db.commit()
                    await db.refresh(row)
                    fund_row = row
                except Exception:
                    await db.rollback()
        except Exception:
            pass

    if fund_row is None:
        return None

    return {
        "pe_ratio": float(fund_row.pe_ratio) if fund_row.pe_ratio else None,
        "eps": float(fund_row.eps) if fund_row.eps else None,
        "book_value": float(fund_row.book_value) if fund_row.book_value else None,
        "face_value": float(fund_row.face_value) if fund_row.face_value else None,
        "week_52_high": float(fund_row.week_52_high) if fund_row.week_52_high else None,
        "week_52_low": float(fund_row.week_52_low) if fund_row.week_52_low else None,
    }


# NSE market hours in UTC minutes from midnight
# 09:15 IST = 03:45 UTC → 3*60+45 = 225 minutes
# 15:30 IST = 10:00 UTC → 10*60+0  = 600 minutes
_MARKET_OPEN_MINUTES_UTC = 225
_MARKET_CLOSE_MINUTES_UTC = 600


def _market_is_open() -> bool:
    now = datetime.now(timezone.utc)
    if now.weekday() >= 5:  # Sat/Sun
        return False
    t = now.hour * 60 + now.minute
    return _MARKET_OPEN_MINUTES_UTC <= t < _MARKET_CLOSE_MINUTES_UTC


async def _load_ohlcv_df(
    db: DBSession,
    kite: KiteClient,
    instrument_token: int,
    as_of_date: date,
    interval: str,
    using_live: bool,
    tradingsymbol: str = "",
    exchange: str = "NSE",
) -> pd.DataFrame:
    """
    Build an OHLCV DataFrame for the given instrument up to as_of_date.
    Cache-first; on cache miss tries Kite historical API, then falls back to
    Yahoo Finance (same pattern as historical.py) if Kite denies permission.
    """
    # Need enough candles for slow indicators (e.g. SMA(200) needs 200+ trading days)
    # 400 calendar days ≈ 270 trading days (safely above 200 after weekends + ~16 NSE holidays)
    lookback_days = 400 if interval == "day" else 60
    as_of_dt = datetime(as_of_date.year, as_of_date.month, as_of_date.day, tzinfo=timezone.utc)
    from_dt = as_of_dt - pd.Timedelta(days=lookback_days)
    to_dt = datetime(as_of_date.year, as_of_date.month, as_of_date.day, 23, 59, 59, tzinfo=timezone.utc)

    rows = (await db.execute(
        select(OHLCVCache)
        .where(
            OHLCVCache.instrument_token == instrument_token,
            OHLCVCache.interval == interval,
            OHLCVCache.candle_timestamp >= from_dt,
            OHLCVCache.candle_timestamp <= to_dt,
        )
        .order_by(OHLCVCache.candle_timestamp)
    )).scalars().all()

    # Track tradingsymbol for LTP patching (resolved from cache or caller)
    cached_tradingsymbol: str | None = None

    if not rows:
        # ── Try Kite historical API ───────────────────────────────────────────
        raw_kite: list | None = None
        try:
            raw_kite = await asyncio.to_thread(
                kite.historical_data, instrument_token, from_dt, to_dt, interval
            )
        except Exception as exc:
            exc_str = str(exc).lower()
            if tradingsymbol and (
                "permission" in exc_str or "403" in exc_str or "subscription" in exc_str
            ):
                # Kite add-on not active — fall back to Yahoo Finance
                try:
                    from backend.routers.historical import _fetch_from_yfinance
                    await _fetch_from_yfinance(
                        db, instrument_token, tradingsymbol, exchange,
                        interval, from_dt, to_dt,
                    )
                    # Re-query the cache now populated by yfinance
                    rows = (await db.execute(
                        select(OHLCVCache)
                        .where(
                            OHLCVCache.instrument_token == instrument_token,
                            OHLCVCache.interval == interval,
                            OHLCVCache.candle_timestamp >= from_dt,
                            OHLCVCache.candle_timestamp <= to_dt,
                        )
                        .order_by(OHLCVCache.candle_timestamp)
                    )).scalars().all()
                except Exception:
                    pass
            # Any other Kite error: rows stays empty, df will be empty below

        if raw_kite:
            from backend.data_source import set_ohlcv_source
            set_ohlcv_source("kite")
            symbol = tradingsymbol or str(instrument_token)
            cached_tradingsymbol = symbol
            for c in raw_kite:
                ts = c["date"]
                if isinstance(ts, datetime) and ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                db.add(OHLCVCache(
                    instrument_token=instrument_token, tradingsymbol=symbol,
                    exchange=exchange, interval=interval,
                    candle_timestamp=ts,
                    open=c["open"], high=c["high"], low=c["low"],
                    close=c["close"], volume=c["volume"],
                ))
            try:
                await db.commit()
            except Exception:
                await db.rollback()
            using_live = False  # just fetched from Kite; no LTP patch needed
            df = pd.DataFrame([
                {"timestamp": c["date"], "open": c["open"], "high": c["high"],
                 "low": c["low"], "close": c["close"], "volume": c["volume"]}
                for c in raw_kite
            ])
            if df.empty:
                return pd.DataFrame()
        elif rows:
            # Populated by yfinance fallback above
            cached_tradingsymbol = rows[0].tradingsymbol
            df = pd.DataFrame([
                {"timestamp": r.candle_timestamp, "open": float(r.open),
                 "high": float(r.high), "low": float(r.low),
                 "close": float(r.close), "volume": r.volume}
                for r in rows
            ])
        else:
            return pd.DataFrame()
    else:
        cached_tradingsymbol = rows[0].tradingsymbol
        df = pd.DataFrame([
            {"timestamp": r.candle_timestamp, "open": float(r.open),
             "high": float(r.high), "low": float(r.low),
             "close": float(r.close), "volume": r.volume}
            for r in rows
        ])

    # If market is open, patch the last close with live price using cached tradingsymbol
    if using_live and not df.empty and cached_tradingsymbol:
        try:
            ltp_raw = await asyncio.to_thread(kite.ltp, [f"NSE:{cached_tradingsymbol}"])
            if ltp_raw:
                ltp = next(iter(ltp_raw.values()), {}).get("last_price")
                if ltp:
                    df.iloc[-1, df.columns.get_loc("close")] = float(ltp)
        except Exception:
            pass

    df.rename(columns={"timestamp": "date"}, inplace=True)
    df = df.rename(columns=str.lower)
    if "date" in df.columns:
        df = df.rename(columns={"date": "timestamp"})
    return df


# ─────────────────────────────────────────────────────────────────────────────
# KPI CRUD
# ─────────────────────────────────────────────────────────────────────────────

@router.get("", response_model=KPIsListResponse)
async def list_kpis(current_user: CurrentUser, db: DBSession) -> KPIsListResponse:
    rows = (await db.execute(
        select(KPI).where(KPI.user_id == current_user.id).order_by(KPI.display_order, KPI.created_at)
    )).scalars().all()
    return KPIsListResponse(kpis=[KPIOut.model_validate(r) for r in rows])


@router.post("", response_model=KPIOut, status_code=201)
async def create_kpi(
    body: KPICreate,
    current_user: CurrentUser,
    db: DBSession,
) -> KPIOut:
    try:
        validate_formula(body.formula, body.return_type)
    except FormulaValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    kpi = KPI(
        user_id=current_user.id,
        name=body.name,
        formula=body.formula,
        return_type=body.return_type,
        description=body.description,
    )
    db.add(kpi)
    await db.commit()
    await db.refresh(kpi)
    return KPIOut.model_validate(kpi)


@router.put("/{kpi_id}", response_model=KPIOut)
async def update_kpi(
    kpi_id: uuid.UUID,
    body: KPIUpdate,
    current_user: CurrentUser,
    db: DBSession,
) -> KPIOut:
    kpi = await db.get(KPI, kpi_id)
    if kpi is None or kpi.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="KPI not found")

    if body.formula is not None or body.return_type is not None:
        new_formula = body.formula or kpi.formula
        new_type = body.return_type or kpi.return_type
        try:
            validate_formula(new_formula, new_type)
        except FormulaValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    for field, val in body.model_dump(exclude_none=True).items():
        setattr(kpi, field, val)

    await db.commit()
    await db.refresh(kpi)
    return KPIOut.model_validate(kpi)


@router.delete("/{kpi_id}", status_code=204)
async def delete_kpi(
    kpi_id: uuid.UUID,
    current_user: CurrentUser,
    db: DBSession,
) -> None:
    kpi = await db.get(KPI, kpi_id)
    if kpi is None or kpi.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="KPI not found")
    await db.delete(kpi)
    await db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# KPI Compute
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/{kpi_id}/compute", response_model=KPIComputeResponse)
async def compute_kpi(
    kpi_id: uuid.UUID,
    body: KPIComputeRequest,
    current_user: CurrentUser,
    db: DBSession,
    kite: KiteClient,
) -> KPIComputeResponse:
    """Compute a single KPI for the given instruments on a date."""
    kpi = await db.get(KPI, kpi_id)
    if kpi is None or kpi.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="KPI not found")

    as_of = date.fromisoformat(body.as_of_date)
    using_live = _market_is_open()

    results: dict[str, KPIComputeResult] = {}

    for token in body.instrument_tokens:
        df = await _load_ohlcv_df(db, kite, token, as_of, body.interval, using_live)

        fundamental = await _load_fundamental(db, token)

        value = evaluate_formula(kpi.formula, df, fundamental, kpi.return_type)
        results[str(token)] = KPIComputeResult(value=value, return_type=kpi.return_type)

    return KPIComputeResponse(
        kpi_id=kpi_id,
        as_of_date=body.as_of_date,
        using_live_price=using_live,
        results=results,
    )


# Built-in standard KPIs always computed for every holding (no user definition needed)
# key → (formula, return_type)
_BUILT_IN_KPIS: list[tuple[str, str, str]] = [
    ("dailyRSI",      "RSI(14)",          "SCALAR"),
    ("rsiOverbought", "RSI(14) > 70",     "BOOLEAN"),
    ("bbPosition",    "BB_POSITION(20)",  "CATEGORICAL"),
    ("peRatio",       "PE_RATIO",         "SCALAR"),
    ("eps",           "EPS",              "SCALAR"),
    ("from52WeekHigh","PCT_FROM_52W_HIGH","SCALAR"),
]


@router.get("/portfolio", response_model=KPIPortfolioResponse)
async def portfolio_kpis(
    current_user: CurrentUser,
    db: DBSession,
    kite: KiteClient,
) -> KPIPortfolioResponse:
    """Compute built-in + user-defined active KPIs for all current holdings."""
    # Active user-defined KPIs for this user
    kpi_rows = (await db.execute(
        select(KPI).where(
            KPI.user_id == current_user.id,
            KPI.is_active == True,  # noqa: E712
        ).order_by(KPI.display_order)
    )).scalars().all()

    try:
        holdings = await asyncio.to_thread(kite.holdings)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Kite API error: {exc}") from exc

    using_live = _market_is_open()
    d1 = date.today()  # live if market open; else latest available

    kpi_meta = [
        {"id": str(k.id), "name": k.name, "return_type": k.return_type}
        for k in kpi_rows
    ]

    portfolio_results: list[PortfolioKPIRow] = []

    for h in holdings:
        token = h.get("instrument_token")
        symbol = h.get("tradingsymbol", "")
        if not token:
            continue

        df = await _load_ohlcv_df(
            db, kite, token, d1, "day", using_live,
            tradingsymbol=symbol, exchange=h.get("exchange", "NSE"),
        )

        fundamental = await _load_fundamental(db, token, symbol, h.get("exchange", "NSE"))

        kpi_values: dict[str, dict[str, Any]] = {}

        # Always compute built-in standard KPIs (RSI, BB, fundamentals)
        for key, formula, return_type in _BUILT_IN_KPIS:
            try:
                val = evaluate_formula(formula, df, fundamental, return_type)
            except Exception:
                val = None
            kpi_values[key] = {"value": val}

        # Layer user-defined KPIs on top (by KPI name)
        for kpi in kpi_rows:
            try:
                val = evaluate_formula(kpi.formula, df, fundamental, kpi.return_type)
            except Exception:
                val = None
            kpi_values[kpi.name] = {"value": val}

        portfolio_results.append(PortfolioKPIRow(
            tradingsymbol=symbol,
            instrument_token=token,
            kpi_values=kpi_values,
        ))

    return KPIPortfolioResponse(
        as_of_date=d1.isoformat(),
        kpis=kpi_meta,
        results=portfolio_results,
    )
