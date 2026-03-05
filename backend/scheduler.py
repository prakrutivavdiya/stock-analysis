"""
APScheduler async jobs — runs inside the FastAPI lifespan.

Schedule (IST — Asia/Kolkata)
─────────────────────────────
  Mon–Fri 09:20  Fetch D-1 daily OHLCV for all held instruments (warm ohlcv_cache)
  Mon–Fri 09:25  Pre-warm KPI computation: noop (KPIs computed on-demand via API;
                  this job just ensures OHLCV cache is populated first)
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

                try:
                    candles = await asyncio.to_thread(
                        kc.historical_data, token, from_dt, to_dt, "day"
                    )
                except Exception as exc:
                    log.warning("OHLCV fetch failed for token %s: %s", token, exc)
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
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _prev_trading_day() -> date:
    """Return the most recent Monday–Friday prior to today (IST)."""
    d = datetime.now(IST).date() - timedelta(days=1)
    while d.weekday() >= 5:  # Saturday=5, Sunday=6
        d -= timedelta(days=1)
    return d


# ─────────────────────────────────────────────────────────────────────────────
# Lifecycle
# ─────────────────────────────────────────────────────────────────────────────

async def start_scheduler() -> None:
    _scheduler.add_job(
        _job_fetch_d1_ohlcv,
        CronTrigger(hour=9, minute=20, day_of_week="mon-fri", timezone=IST),
        id="fetch_d1_ohlcv",
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
