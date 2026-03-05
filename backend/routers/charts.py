"""
Charts router — 5 endpoints

  GET    /charts/{instrument_token}/drawings?interval=   → list drawings
  POST   /charts/{instrument_token}/drawings             → save drawing
  PUT    /charts/{instrument_token}/drawings/{id}        → update drawing
  DELETE /charts/{instrument_token}/drawings/{id}        → delete drawing
  GET    /charts/indicators/compute                      → compute indicator series
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timezone

import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import and_, select

from backend.deps import CurrentUser, DBSession, KiteClient
from backend.models import ChartDrawing, OHLCVCache
from backend.schemas.charts import DrawingCreate, DrawingOut, DrawingsResponse, DrawingUpdate, IndicatorsResponse

router = APIRouter()

VALID_INTERVALS = {"5minute", "15minute", "30minute", "60minute", "day"}


@router.get("/{instrument_token}/drawings", response_model=DrawingsResponse)
async def list_drawings(
    instrument_token: int,
    current_user: CurrentUser,
    db: DBSession,
    interval: str = Query(default="day"),
) -> DrawingsResponse:
    rows = (await db.execute(
        select(ChartDrawing).where(
            and_(
                ChartDrawing.user_id == current_user.id,
                ChartDrawing.instrument_token == instrument_token,
                ChartDrawing.interval == interval,
            )
        ).order_by(ChartDrawing.created_at)
    )).scalars().all()

    return DrawingsResponse(
        instrument_token=instrument_token,
        interval=interval,
        drawings=[DrawingOut.model_validate(r) for r in rows],
    )


@router.post("/{instrument_token}/drawings", response_model=DrawingOut, status_code=201)
async def create_drawing(
    instrument_token: int,
    body: DrawingCreate,
    current_user: CurrentUser,
    db: DBSession,
) -> DrawingOut:
    valid_types = {"hline", "trendline", "rectangle", "text"}
    if body.drawing_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"drawing_type must be one of {valid_types}")

    # Resolve tradingsymbol + exchange from ohlcv_cache (best-effort)
    cached = (await db.execute(
        select(OHLCVCache).where(OHLCVCache.instrument_token == instrument_token).limit(1)
    )).scalar_one_or_none()

    drawing = ChartDrawing(
        user_id=current_user.id,
        instrument_token=instrument_token,
        tradingsymbol=cached.tradingsymbol if cached else str(instrument_token),
        exchange=cached.exchange if cached else "NSE",
        interval=body.interval,
        drawing_type=body.drawing_type,
        drawing_data=body.drawing_data,
        label=body.label,
    )
    db.add(drawing)
    await db.commit()
    await db.refresh(drawing)
    return DrawingOut.model_validate(drawing)


@router.put("/{instrument_token}/drawings/{drawing_id}", response_model=DrawingOut)
async def update_drawing(
    instrument_token: int,
    drawing_id: uuid.UUID,
    body: DrawingUpdate,
    current_user: CurrentUser,
    db: DBSession,
) -> DrawingOut:
    drawing = await db.get(ChartDrawing, drawing_id)
    if (
        drawing is None
        or drawing.user_id != current_user.id
        or drawing.instrument_token != instrument_token
    ):
        raise HTTPException(status_code=404, detail="Drawing not found")

    if body.label is not None:
        drawing.label = body.label
    if body.drawing_data is not None:
        drawing.drawing_data = body.drawing_data

    await db.commit()
    await db.refresh(drawing)
    return DrawingOut.model_validate(drawing)


@router.delete("/{instrument_token}/drawings/{drawing_id}", status_code=204)
async def delete_drawing(
    instrument_token: int,
    drawing_id: uuid.UUID,
    current_user: CurrentUser,
    db: DBSession,
) -> None:
    drawing = await db.get(ChartDrawing, drawing_id)
    if (
        drawing is None
        or drawing.user_id != current_user.id
        or drawing.instrument_token != instrument_token
    ):
        raise HTTPException(status_code=404, detail="Drawing not found")

    await db.delete(drawing)
    await db.commit()


@router.get("/indicators/compute", response_model=IndicatorsResponse)
async def compute_indicators(
    current_user: CurrentUser,
    db: DBSession,
    kite: KiteClient,
    instrument_token: int = Query(...),
    interval: str = Query(default="day"),
    from_date: str = Query(...),
    to_date: str = Query(...),
    indicators: str = Query(..., description="Comma-separated list, e.g. SMA_20,EMA_50,RSI_14,MACD,BB_20"),
) -> dict:
    """
    Compute indicator time-series for the Lightweight Charts fallback.
    Not called when TradingView Charting Library is active.
    Returns: { "SMA_20": [{timestamp, value}], "BB_20": [{timestamp, upper, middle, lower}], ... }
    """
    if interval not in VALID_INTERVALS:
        raise HTTPException(status_code=400, detail=f"Invalid interval. Valid: {VALID_INTERVALS}")

    try:
        from_d = date.fromisoformat(from_date)
        to_d = date.fromisoformat(to_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    from_dt = datetime(from_d.year, from_d.month, from_d.day, tzinfo=timezone.utc)
    to_dt = datetime(to_d.year, to_d.month, to_d.day, 23, 59, 59, tzinfo=timezone.utc)

    # Load OHLCV from cache or Kite
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

    if not rows:
        try:
            raw = await asyncio.to_thread(kite.historical_data, instrument_token, from_dt, to_dt, interval)
            df = pd.DataFrame(raw)
            if not df.empty:
                df.rename(columns={"date": "timestamp"}, inplace=True)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Kite API error: {exc}") from exc
    else:
        df = pd.DataFrame([
            {"timestamp": r.candle_timestamp, "open": float(r.open),
             "high": float(r.high), "low": float(r.low),
             "close": float(r.close), "volume": r.volume}
            for r in rows
        ])

    if df.empty:
        return {}

    df.columns = [c.lower() for c in df.columns]
    close = df["close"]
    high = df["high"] if "high" in df.columns else close
    low = df["low"] if "low" in df.columns else close
    ts_list = df["timestamp"].tolist()

    try:
        import pandas_ta as ta
    except ImportError:
        raise HTTPException(status_code=500, detail="pandas-ta not installed")

    result: dict = {}
    indicator_specs = [s.strip() for s in indicators.split(",") if s.strip()]

    for spec in indicator_specs:
        parts = spec.split("_")
        name = parts[0].upper()
        period = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None

        if name == "SMA" and period:
            series = ta.sma(close, length=period)
            result[spec] = [
                {"timestamp": ts, "value": round(v, 4) if pd.notna(v) else None}
                for ts, v in zip(ts_list, series.tolist())
            ]
        elif name == "EMA" and period:
            series = ta.ema(close, length=period)
            result[spec] = [
                {"timestamp": ts, "value": round(v, 4) if pd.notna(v) else None}
                for ts, v in zip(ts_list, series.tolist())
            ]
        elif name == "RSI" and period:
            series = ta.rsi(close, length=period)
            result[spec] = [
                {"timestamp": ts, "value": round(v, 2) if pd.notna(v) else None}
                for ts, v in zip(ts_list, series.tolist())
            ]
        elif name == "MACD":
            macd_df = ta.macd(close)
            if macd_df is not None:
                cols = macd_df.columns.tolist()
                result["MACD"] = [
                    {
                        "timestamp": ts,
                        "macd": round(row.iloc[0], 4) if pd.notna(row.iloc[0]) else None,
                        "signal": round(row.iloc[2], 4) if pd.notna(row.iloc[2]) else None,
                        "histogram": round(row.iloc[1], 4) if pd.notna(row.iloc[1]) else None,
                    }
                    for ts, (_, row) in zip(ts_list, macd_df.iterrows())
                ]
        elif name == "BB" and period:
            bb = ta.bbands(close, length=period)
            if bb is not None:
                col_l = next((c for c in bb.columns if "BBL" in c), None)
                col_m = next((c for c in bb.columns if "BBM" in c), None)
                col_u = next((c for c in bb.columns if "BBU" in c), None)
                result[spec] = [
                    {
                        "timestamp": ts,
                        "upper": round(row[col_u], 4) if col_u and pd.notna(row[col_u]) else None,
                        "middle": round(row[col_m], 4) if col_m and pd.notna(row[col_m]) else None,
                        "lower": round(row[col_l], 4) if col_l and pd.notna(row[col_l]) else None,
                    }
                    for ts, (_, row) in zip(ts_list, bb.iterrows())
                ]
        elif name == "ATR" and period:
            series = ta.atr(high, low, close, length=period)
            result[spec] = [
                {"timestamp": ts, "value": round(v, 4) if pd.notna(v) else None}
                for ts, v in zip(ts_list, series.tolist())
            ]

    return result
