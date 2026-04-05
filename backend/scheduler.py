"""
APScheduler async jobs — runs inside the FastAPI lifespan.

Schedule (IST — Asia/Kolkata)
─────────────────────────────
  Mon–Fri 08:30  Reload Kite instruments dump into memory
  Mon–Fri 09:20  Fetch D-1 daily OHLCV for all held instruments (warm ohlcv_cache)
  Mon–Fri 09:25  Recompute all active KPIs for all users' holdings (pre-warm + error surfacing)
  Sunday  08:00  Refresh fundamental data from NSE India for all held instruments
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta

import pytz
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from backend.database import AsyncSessionLocal
from backend.models import FundamentalCache, OHLCVCache, User

log = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")
_scheduler = AsyncIOScheduler(timezone=IST)


# ─────────────────────────────────────────────────────────────────────────────
# Job: reload instruments dump from Kite
# ─────────────────────────────────────────────────────────────────────────────

async def _job_reload_instruments() -> None:
    """Reload the full instruments dump from Kite into memory (Mon–Fri 08:30 IST)."""
    from backend.routers.instruments import _load_instruments
    log.info("Scheduler: reloading instruments cache")
    await _load_instruments()


# ─────────────────────────────────────────────────────────────────────────────
# Job: fetch D-1 OHLCV for all held instruments
# ─────────────────────────────────────────────────────────────────────────────

async def _job_fetch_d1_ohlcv() -> None:
    """Fetch the previous trading day's daily candle for every held instrument."""
    from kiteconnect import KiteConnect

    from backend.config import settings
    from backend.crypto import decrypt_token

    log.info("Scheduler: starting D-1 OHLCV fetch")

    d1 = _prev_trading_day()
    from_dt = datetime.combine(d1, datetime.min.time())
    to_dt = datetime.combine(d1, datetime.max.time())

    async with AsyncSessionLocal() as db:
        users = (await db.execute(
            select(User).where(User.is_active == True)  # noqa: E712
        )).scalars().all()

        for user in users:
            try:
                kc = KiteConnect(api_key=settings.KITE_API_KEY)
                kc.set_access_token(
                    decrypt_token(user.kite_access_token_enc, settings.KITE_ENCRYPTION_KEY)
                )
                holdings = await asyncio.to_thread(kc.holdings)
            except Exception as exc:
                log.warning("OHLCV scheduler: failed to get holdings for %s: %s", user.kite_user_id, exc)
                continue

            tokens_seen: set[int] = set()
            for h in holdings:
                token = h.get("instrument_token")
                symbol = h.get("tradingsymbol", "")
                exchange = h.get("exchange", "NSE")
                if not token or token in tokens_seen:
                    continue
                tokens_seen.add(token)

                # Skip if already cached for D-1
                existing = await db.execute(
                    select(OHLCVCache).where(
                        OHLCVCache.instrument_token == token,
                        OHLCVCache.interval == "day",
                        OHLCVCache.candle_timestamp >= from_dt,
                        OHLCVCache.candle_timestamp <= to_dt,
                    )
                )
                if existing.scalar_one_or_none():
                    continue

                candles = None
                try:
                    candles = await asyncio.to_thread(
                        kc.historical_data, token, from_dt, to_dt, "day"
                    )
                    from backend.data_source import set_ohlcv_source
                    set_ohlcv_source("kite")
                except Exception as exc:
                    exc_str = str(exc).lower()
                    if symbol and (
                        "permission" in exc_str or "403" in exc_str or "subscription" in exc_str
                    ):
                        try:
                            from backend.routers.historical import _fetch_from_yfinance
                            await _fetch_from_yfinance(
                                db, token, symbol, exchange, "day", from_dt, to_dt,
                            )
                            log.info("Scheduler: yfinance fallback used for %s", symbol)
                        except Exception as yf_exc:
                            log.warning("Scheduler: yfinance fallback failed for %s: %s", symbol, yf_exc)
                    else:
                        log.warning("OHLCV fetch failed for token %s: %s", token, exc)
                    continue

                if not candles:
                    continue

                for c in candles:
                    db.add(OHLCVCache(
                        instrument_token=token,
                        tradingsymbol=symbol,
                        exchange=exchange,
                        interval="day",
                        candle_timestamp=c["date"],
                        open=c["open"],
                        high=c["high"],
                        low=c["low"],
                        close=c["close"],
                        volume=c["volume"],
                    ))

            await db.commit()
            break  # One authenticated user is enough for shared ohlcv_cache

    log.info("Scheduler: D-1 OHLCV fetch complete")


# ─────────────────────────────────────────────────────────────────────────────
# Job: refresh fundamental data from NSE India
# ─────────────────────────────────────────────────────────────────────────────

async def _job_refresh_fundamentals() -> None:
    """
    Refresh P/E, EPS, 52W data from NSE India for all instruments in any user's holdings.
    Runs every Sunday at 08:00 IST (PRD §5.10).
    """
    from backend.routers.fundamentals import _fetch_nse_fundamental

    log.info("Scheduler: starting fundamental data refresh")

    async with AsyncSessionLocal() as db:
        users = (await db.execute(
            select(User).where(User.is_active == True)  # noqa: E712
        )).scalars().all()

        symbols_seen: set[str] = set()
        for user in users:
            try:
                from kiteconnect import KiteConnect
                from backend.config import settings
                from backend.crypto import decrypt_token

                kc = KiteConnect(api_key=settings.KITE_API_KEY)
                kc.set_access_token(
                    decrypt_token(user.kite_access_token_enc, settings.KITE_ENCRYPTION_KEY)
                )
                holdings = await asyncio.to_thread(kc.holdings)
            except Exception:
                continue

            for h in holdings:
                symbol = h.get("tradingsymbol", "")
                token = h.get("instrument_token")
                exchange = h.get("exchange", "NSE")
                if not symbol or symbol in symbols_seen:
                    continue
                symbols_seen.add(symbol)

                try:
                    data = await _fetch_nse_fundamental(symbol)
                    if data:
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
                        row.data_date = data.get("data_date")
                except Exception as exc:
                    log.warning("Fundamental refresh failed for %s: %s", symbol, exc)

        await db.commit()

    log.info("Scheduler: fundamental refresh complete — %d symbols", len(symbols_seen))


# ─────────────────────────────────────────────────────────────────────────────
# Job: recompute all active KPIs for all users' holdings (09:25 IST Mon–Fri)
# ─────────────────────────────────────────────────────────────────────────────

async def _job_recompute_kpis() -> None:
    """
    Pre-warm KPI computation at 09:25 IST (5 min after D-1 OHLCV job).

    For each active user:
      1. Fetch their holdings from Kite.
      2. Load active KPI definitions from DB.
      3. Evaluate every KPI×holding combination using cached OHLCV + fundamentals.

    Results are NOT persisted — the purpose is to:
      - Ensure the OHLCV cache is warmed before the first user page load.
      - Surface formula evaluation errors in server logs early.

    Satisfies PRD §6.1 ("Scheduled job recomputes all active KPIs") and §9.
    """
    from kiteconnect import KiteConnect

    from backend.config import settings
    from backend.crypto import decrypt_token
    from backend.kpi_engine import evaluate_formula
    from backend.models import KPI as KPIModel
    from backend.routers.kpis import _load_fundamental, _load_ohlcv_df

    log.info("Scheduler: starting KPI pre-warm recompute")
    total_evals = 0

    async with AsyncSessionLocal() as db:
        users = (await db.execute(
            select(User).where(User.is_active == True)  # noqa: E712
        )).scalars().all()

        for user in users:
            try:
                kc = KiteConnect(api_key=settings.KITE_API_KEY)
                kc.set_access_token(
                    decrypt_token(user.kite_access_token_enc, settings.KITE_ENCRYPTION_KEY)
                )
                holdings = await asyncio.to_thread(kc.holdings)
            except Exception as exc:
                log.warning("KPI scheduler: failed to get holdings for %s: %s", user.kite_user_id, exc)
                continue

            kpis = (await db.execute(
                select(KPIModel).where(
                    KPIModel.user_id == user.id,
                    KPIModel.is_active == True,  # noqa: E712
                )
            )).scalars().all()

            if not kpis:
                continue

            today = _prev_trading_day()

            for h in holdings:
                token = h.get("instrument_token")
                symbol = h.get("tradingsymbol", "")
                exchange = h.get("exchange", "NSE")
                if not token:
                    continue

                try:
                    df = await _load_ohlcv_df(
                        db, kc, token, today, "day", False, symbol, exchange
                    )
                    fundamental = await _load_fundamental(db, token, symbol, exchange)
                except Exception as exc:
                    log.warning("KPI scheduler: OHLCV/fundamental load failed for %s: %s", symbol, exc)
                    continue

                for kpi in kpis:
                    try:
                        evaluate_formula(kpi.formula, df, fundamental, kpi.return_type)
                        total_evals += 1
                    except Exception as exc:
                        log.warning(
                            "KPI scheduler: formula error — KPI=%r symbol=%r: %s",
                            kpi.name, symbol, exc,
                        )

    log.info("Scheduler: KPI pre-warm complete — %d evaluations", total_evals)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _prev_trading_day() -> date:
    """Return the most recent NSE trading day prior to today (IST), skipping weekends + holidays."""
    from backend.holidays import prev_trading_day
    return prev_trading_day(datetime.now(IST).date())


# ─────────────────────────────────────────────────────────────────────────────
# Lifecycle
# ─────────────────────────────────────────────────────────────────────────────

async def start_scheduler() -> None:
    _scheduler.add_job(
        _job_reload_instruments,
        CronTrigger(hour=8, minute=30, day_of_week="mon-fri", timezone=IST),
        id="reload_instruments",
        replace_existing=True,
        misfire_grace_time=1800,
    )
    _scheduler.add_job(
        _job_fetch_d1_ohlcv,
        CronTrigger(hour=9, minute=20, day_of_week="mon-fri", timezone=IST),
        id="fetch_d1_ohlcv",
        replace_existing=True,
        misfire_grace_time=300,
    )
    _scheduler.add_job(
        _job_recompute_kpis,
        CronTrigger(hour=9, minute=25, day_of_week="mon-fri", timezone=IST),
        id="recompute_kpis",
        replace_existing=True,
        misfire_grace_time=300,
    )
    _scheduler.add_job(
        _job_refresh_fundamentals,
        CronTrigger(hour=8, minute=0, day_of_week="sun", timezone=IST),
        id="refresh_fundamentals",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    _scheduler.start()
    log.info("APScheduler started")


async def shutdown_scheduler() -> None:
    _scheduler.shutdown(wait=False)
    log.info("APScheduler stopped")
