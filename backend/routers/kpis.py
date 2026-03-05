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
) -> pd.DataFrame:
    """
    Build an OHLCV DataFrame for the given instrument up to as_of_date.
    Uses the ohlcv_cache; fetches from Kite if not present.
    """
    # Need enough candles for slow indicators (e.g. SMA(200) needs 200+ trading days)
    lookback_days = 300 if interval == "day" else 60
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

    # Track tradingsymbol for LTP patching (only available when loading from cache)
    cached_tradingsymbol: str | None = None

    if not rows:
        try:
            raw = await asyncio.to_thread(kite.historical_data, instrument_token, from_dt, to_dt, interval)
            df = pd.DataFrame(raw)
            if not df.empty:
                df.rename(columns={"date": "timestamp"}, inplace=True)
                # Cache the fetched rows (tradingsymbol unknown at this point; use token as placeholder)
                symbol = str(instrument_token)
                exchange = "NSE"
                for _, c in df.iterrows():
                    ts = c["timestamp"]
                    if hasattr(ts, "tzinfo") and ts.tzinfo is None:
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
                # Data was just fetched live from Kite; no LTP patch needed
                using_live = False
            else:
                return pd.DataFrame()
        except Exception:
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

        fund_row = (await db.execute(
            select(FundamentalCache).where(FundamentalCache.instrument_token == token)
        )).scalar_one_or_none()
        fundamental = {
            "pe_ratio": float(fund_row.pe_ratio) if fund_row and fund_row.pe_ratio else None,
            "eps": float(fund_row.eps) if fund_row and fund_row.eps else None,
            "book_value": float(fund_row.book_value) if fund_row and fund_row.book_value else None,
            "face_value": float(fund_row.face_value) if fund_row and fund_row.face_value else None,
            "week_52_high": float(fund_row.week_52_high) if fund_row and fund_row.week_52_high else None,
            "week_52_low": float(fund_row.week_52_low) if fund_row and fund_row.week_52_low else None,
        } if fund_row else None

        value = evaluate_formula(kpi.formula, df, fundamental, kpi.return_type)
        results[str(token)] = KPIComputeResult(value=value, return_type=kpi.return_type)

    return KPIComputeResponse(
        kpi_id=kpi_id,
        as_of_date=body.as_of_date,
        using_live_price=using_live,
        results=results,
    )


@router.get("/portfolio", response_model=KPIPortfolioResponse)
async def portfolio_kpis(
    current_user: CurrentUser,
    db: DBSession,
    kite: KiteClient,
) -> KPIPortfolioResponse:
    """Compute all active KPIs for all current holdings on D-1 in one call."""
    # Active KPIs for this user
    kpi_rows = (await db.execute(
        select(KPI).where(
            KPI.user_id == current_user.id,
            KPI.is_active == True,  # noqa: E712
        ).order_by(KPI.display_order)
    )).scalars().all()

    if not kpi_rows:
        return KPIPortfolioResponse(as_of_date=date.today().isoformat(), kpis=[], results=[])

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

        df = await _load_ohlcv_df(db, kite, token, d1, "day", using_live)

        fund_row = (await db.execute(
            select(FundamentalCache).where(FundamentalCache.instrument_token == token)
        )).scalar_one_or_none()
        fundamental: dict[str, Any] | None = {
            "pe_ratio": float(fund_row.pe_ratio) if fund_row and fund_row.pe_ratio else None,
            "eps": float(fund_row.eps) if fund_row and fund_row.eps else None,
            "book_value": float(fund_row.book_value) if fund_row and fund_row.book_value else None,
            "face_value": float(fund_row.face_value) if fund_row and fund_row.face_value else None,
            "week_52_high": float(fund_row.week_52_high) if fund_row and fund_row.week_52_high else None,
            "week_52_low": float(fund_row.week_52_low) if fund_row and fund_row.week_52_low else None,
        } if fund_row else None

        kpi_values: dict[str, dict[str, Any]] = {}
        for kpi in kpi_rows:
            val = evaluate_formula(kpi.formula, df, fundamental, kpi.return_type)
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
