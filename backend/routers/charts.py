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


# ---------------------------------------------------------------------------
# Indicator spec helpers
# ---------------------------------------------------------------------------

_MULTI_PART_NAMES = ("BB_PCT", "BB_BW", "STOCHRSI", "SUPERTREND")


def _parse_indicator_spec(spec: str) -> tuple[str, list[float]]:
    """
    Parse 'NAME_param1_param2' → (NAME, [param1, param2]).
    Handles multi-part names like BB_PCT, BB_BW, STOCHRSI, SUPERTREND.
    """
    s = spec.upper()
    for multi in _MULTI_PART_NAMES:
        if s == multi or s.startswith(multi + "_"):
            rest = spec[len(multi):].lstrip("_")
            params = [float(p) for p in rest.split("_") if p and p.replace(".", "").isdigit()]
            return multi, params
    parts = spec.split("_")
    name = parts[0].upper()
    params = [float(p) for p in parts[1:] if p.replace(".", "").isdigit()]
    return name, params


def _to_value_list(series: pd.Series, ts_list: list, decimals: int = 4) -> list[dict]:
    return [
        {"timestamp": ts, "value": round(float(v), decimals) if pd.notna(v) else None}
        for ts, v in zip(ts_list, series.tolist())
    ]


def _to_multi_list(df_sub: pd.DataFrame, ts_list: list, col_map: dict[str, str], decimals: int = 4) -> list[dict]:
    """Build a list of dicts from a multi-column DataFrame using col_map = {output_key: df_col}."""
    rows = []
    for ts, (_, row) in zip(ts_list, df_sub.iterrows()):
        d: dict = {"timestamp": ts}
        for out_key, col in col_map.items():
            val = row.get(col) if col else None
            d[out_key] = round(float(val), decimals) if val is not None and pd.notna(val) else None
        rows.append(d)
    return rows


# ---------------------------------------------------------------------------
# Drawing CRUD
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Indicators compute
# ---------------------------------------------------------------------------

@router.get("/indicators/compute", response_model=IndicatorsResponse)
async def compute_indicators(
    current_user: CurrentUser,
    db: DBSession,
    kite: KiteClient,
    instrument_token: int = Query(...),
    interval: str = Query(default="day"),
    from_date: str = Query(...),
    to_date: str = Query(...),
    indicators: str = Query(..., description="Comma-separated specs e.g. EMA_20,RSI_14,MACD,BB_20"),
    tradingsymbol: str = Query(default=""),
    exchange: str = Query(default="NSE"),
) -> dict:
    """
    Compute indicator time-series for the Lightweight Charts renderer.

    Supported specs
    ───────────────
    Trend overlays  : MA_n, EMA_n, DEMA_n, TEMA_n, HMA_n, VWMA_n, VWAP,
                      SUPERTREND_p_m, PSAR
    Trend oscillators: ADX_n, AROON_n
    Momentum        : RSI_n, STOCH_k_d, STOCHRSI_n, MACD, CCI_n, ROC_n,
                      WILLR_n, MOM_n
    Volatility overlay: BB_n, KC_n, DC_n
    Volatility osc  : ATR_n, BB_BW_n, BB_PCT_n, STDEV_n
    Volume          : OBV, MFI_n, CMF_n, VWAP
    """
    if interval not in VALID_INTERVALS:
        raise HTTPException(status_code=400, detail=f"Invalid interval. Valid: {VALID_INTERVALS}")

    try:
        from_d = date.fromisoformat(from_date)
        to_d   = date.fromisoformat(to_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    from_dt = datetime(from_d.year, from_d.month, from_d.day, tzinfo=timezone.utc)
    to_dt   = datetime(to_d.year,   to_d.month,   to_d.day, 23, 59, 59, tzinfo=timezone.utc)

    # ── Load OHLCV (from cache or Kite) ─────────────────────────────────────
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
        from backend.data_source import set_ohlcv_source
        # Resolve tradingsymbol: query param > cached row > token string
        sym = tradingsymbol or (rows[0].tradingsymbol if rows else "") or str(instrument_token)
        exch = exchange

        raw = None
        try:
            raw = await asyncio.to_thread(
                kite.historical_data, instrument_token, from_dt, to_dt, interval
            )
            set_ohlcv_source("kite")
        except Exception as kite_exc:
            exc_str = str(kite_exc).lower()
            if sym != str(instrument_token) and (
                "permission" in exc_str or "403" in exc_str or "subscription" in exc_str
            ):
                try:
                    from backend.routers.historical import _fetch_from_yfinance
                    candles = await _fetch_from_yfinance(
                        db, instrument_token, sym, exch, interval, from_dt, to_dt
                    )
                    # Re-query cache now populated by yfinance
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
                    raise HTTPException(status_code=502, detail=f"Kite API error: {kite_exc}") from kite_exc
            else:
                raise HTTPException(status_code=502, detail=f"Kite API error: {kite_exc}") from kite_exc

        if raw:
            df = pd.DataFrame(raw)
            if not df.empty:
                df.rename(columns={"date": "timestamp"}, inplace=True)
        elif rows:
            df = pd.DataFrame([
                {"timestamp": r.candle_timestamp, "open": float(r.open), "high": float(r.high),
                 "low": float(r.low), "close": float(r.close), "volume": r.volume}
                for r in rows
            ])
        else:
            return {}
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
    close   = df["close"]
    high    = df["high"]   if "high"   in df.columns else close
    low     = df["low"]    if "low"    in df.columns else close
    volume  = df["volume"] if "volume" in df.columns else pd.Series([0] * len(df))
    ts_list = df["timestamp"].tolist()

    try:
        import pandas_ta as ta
    except ImportError:
        raise HTTPException(status_code=500, detail="pandas-ta not installed")

    result: dict = {}
    specs = [s.strip() for s in indicators.split(",") if s.strip()]

    for spec in specs:
        try:
            name, params = _parse_indicator_spec(spec)
            p0 = int(params[0]) if len(params) > 0 else None
            p1 = params[1]      if len(params) > 1 else None

            # ── Trend overlays ────────────────────────────────────────────
            if name in ("MA", "SMA"):
                result[spec] = _to_value_list(ta.sma(close, length=p0 or 20), ts_list)

            elif name == "EMA":
                result[spec] = _to_value_list(ta.ema(close, length=p0 or 20), ts_list)

            elif name == "DEMA":
                result[spec] = _to_value_list(ta.dema(close, length=p0 or 20), ts_list)

            elif name == "TEMA":
                result[spec] = _to_value_list(ta.tema(close, length=p0 or 20), ts_list)

            elif name == "HMA":
                result[spec] = _to_value_list(ta.hma(close, length=p0 or 20), ts_list)

            elif name == "VWMA":
                result[spec] = _to_value_list(ta.vwma(close, volume, length=p0 or 20), ts_list)

            elif name == "VWAP":
                try:
                    df_v = df.copy()
                    df_v.index = pd.to_datetime(df_v["timestamp"])
                    vwap = ta.vwap(df_v["high"], df_v["low"], df_v["close"], df_v["volume"])
                    result[spec] = _to_value_list(vwap, ts_list)
                except Exception:
                    pass  # VWAP can fail on daily data — silently skip

            elif name == "SUPERTREND":
                period = p0 or 7
                mult   = float(p1) if p1 is not None else 3.0
                st = ta.supertrend(high, low, close, length=period, multiplier=mult)
                if st is not None:
                    val_col = next((c for c in st.columns if c.startswith("SUPERT_")),  None)
                    dir_col = next((c for c in st.columns if c.startswith("SUPERTd_")), None)
                    if val_col and dir_col:
                        result[spec] = [
                            {
                                "timestamp": ts,
                                "value":     round(float(v), 4) if pd.notna(v) else None,
                                "direction": int(d) if pd.notna(d) else None,
                            }
                            for ts, v, d in zip(ts_list, st[val_col], st[dir_col])
                        ]

            elif name == "PSAR":
                psar = ta.psar(high, low, close)
                if psar is not None:
                    lc = next((c for c in psar.columns if "PSARl" in c), None)
                    sc = next((c for c in psar.columns if "PSARs" in c), None)
                    data = []
                    for ts, (_, row) in zip(ts_list, psar.iterrows()):
                        lv = float(row[lc]) if lc and pd.notna(row[lc]) else None
                        sv = float(row[sc]) if sc and pd.notna(row[sc]) else None
                        data.append({
                            "timestamp": ts,
                            "long":  round(lv, 4) if lv is not None else None,
                            "short": round(sv, 4) if sv is not None else None,
                        })
                    result[spec] = data

            # ── Trend oscillators ─────────────────────────────────────────
            elif name == "ADX":
                adx_df = ta.adx(high, low, close, length=p0 or 14)
                if adx_df is not None:
                    ac = next((c for c in adx_df.columns if c.startswith("ADX_")), None)
                    pc = next((c for c in adx_df.columns if c.startswith("DMP_")), None)
                    nc = next((c for c in adx_df.columns if c.startswith("DMN_")), None)
                    result[spec] = _to_multi_list(adx_df, ts_list, {"adx": ac, "dip": pc, "din": nc}, 2)

            elif name == "AROON":
                aroon = ta.aroon(high, low, length=p0 or 14)
                if aroon is not None:
                    uc = next((c for c in aroon.columns if "AROONU" in c), None)
                    dc = next((c for c in aroon.columns if "AROOND" in c), None)
                    result[spec] = _to_multi_list(aroon, ts_list, {"up": uc, "down": dc}, 2)

            # ── Momentum oscillators ──────────────────────────────────────
            elif name == "RSI":
                result[spec] = _to_value_list(ta.rsi(close, length=p0 or 14), ts_list, 2)

            elif name == "STOCH":
                k = p0 or 14
                d = int(p1) if p1 is not None else 3
                s_df = ta.stoch(high, low, close, k=k, d=d)
                if s_df is not None:
                    result[spec] = _to_multi_list(s_df, ts_list, {"k": s_df.columns[0], "d": s_df.columns[1] if len(s_df.columns) > 1 else None}, 2)

            elif name == "STOCHRSI":
                ln = p0 or 14
                sr = ta.stochrsi(close, length=ln, rsi_length=ln, k=3, d=3)
                if sr is not None:
                    kc_ = next((c for c in sr.columns if "STOCHRSIk" in c), None)
                    dc_ = next((c for c in sr.columns if "STOCHRSId" in c), None)
                    result[spec] = _to_multi_list(sr, ts_list, {"k": kc_, "d": dc_}, 2)

            elif name == "MACD":
                macd_df = ta.macd(close)
                if macd_df is not None:
                    result["MACD"] = [
                        {
                            "timestamp": ts,
                            "macd":      round(float(row.iloc[0]), 4) if pd.notna(row.iloc[0]) else None,
                            "signal":    round(float(row.iloc[2]), 4) if pd.notna(row.iloc[2]) else None,
                            "histogram": round(float(row.iloc[1]), 4) if pd.notna(row.iloc[1]) else None,
                        }
                        for ts, (_, row) in zip(ts_list, macd_df.iterrows())
                    ]

            elif name == "CCI":
                result[spec] = _to_value_list(ta.cci(high, low, close, length=p0 or 20), ts_list, 2)

            elif name == "ROC":
                result[spec] = _to_value_list(ta.roc(close, length=p0 or 14), ts_list, 4)

            elif name == "WILLR":
                result[spec] = _to_value_list(ta.willr(high, low, close, length=p0 or 14), ts_list, 2)

            elif name == "MOM":
                result[spec] = _to_value_list(ta.mom(close, length=p0 or 10), ts_list, 4)

            # ── Volatility overlays ───────────────────────────────────────
            elif name == "BB":
                bb = ta.bbands(close, length=p0 or 20)
                if bb is not None:
                    lc = next((c for c in bb.columns if "BBL" in c), None)
                    mc = next((c for c in bb.columns if "BBM" in c), None)
                    uc = next((c for c in bb.columns if "BBU" in c), None)
                    result[spec] = _to_multi_list(bb, ts_list, {"lower": lc, "middle": mc, "upper": uc})

            elif name == "KC":
                kc_df = ta.kc(high, low, close, length=p0 or 20)
                if kc_df is not None:
                    uc = next((c for c in kc_df.columns if "KCUe" in c), None)
                    bc = next((c for c in kc_df.columns if "KCBe" in c), None)
                    lc = next((c for c in kc_df.columns if "KCLe" in c), None)
                    result[spec] = _to_multi_list(kc_df, ts_list, {"upper": uc, "middle": bc, "lower": lc})

            elif name == "DC":
                dc_df = ta.donchian(high, low, lower_length=p0 or 20, upper_length=p0 or 20)
                if dc_df is not None:
                    uc = next((c for c in dc_df.columns if "DCU" in c), None)
                    mc = next((c for c in dc_df.columns if "DCM" in c), None)
                    lc = next((c for c in dc_df.columns if "DCL" in c), None)
                    result[spec] = _to_multi_list(dc_df, ts_list, {"upper": uc, "middle": mc, "lower": lc})

            # ── Volatility oscillators ────────────────────────────────────
            elif name == "ATR":
                result[spec] = _to_value_list(ta.atr(high, low, close, length=p0 or 14), ts_list)

            elif name == "BB_BW":
                bb = ta.bbands(close, length=p0 or 20)
                if bb is not None:
                    bc = next((c for c in bb.columns if "BBB" in c), None)
                    if bc:
                        result[spec] = _to_value_list(bb[bc], ts_list)

            elif name == "BB_PCT":
                bb = ta.bbands(close, length=p0 or 20)
                if bb is not None:
                    pc = next((c for c in bb.columns if "BBP" in c), None)
                    if pc:
                        result[spec] = _to_value_list(bb[pc], ts_list)

            elif name == "STDEV":
                result[spec] = _to_value_list(ta.stdev(close, length=p0 or 20), ts_list)

            # ── Volume oscillators ────────────────────────────────────────
            elif name == "OBV":
                result[spec] = _to_value_list(ta.obv(close, volume), ts_list)

            elif name == "MFI":
                result[spec] = _to_value_list(ta.mfi(high, low, close, volume, length=p0 or 14), ts_list, 2)

            elif name == "CMF":
                result[spec] = _to_value_list(ta.cmf(high, low, close, volume, length=p0 or 20), ts_list, 4)

        except Exception:
            pass  # Non-fatal: skip indicators that fail to compute

    return result
