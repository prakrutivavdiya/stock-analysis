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

# ── Rate-limit / chunking knobs ──────────────────────────────────────────────
# Kite REST limits: historical_data ≈ 3 req/s. Stay well under to avoid the
# "Too many requests" (429) error. Pace per call + take a breather per chunk.
_HIST_MIN_INTERVAL = 0.4   # seconds to wait after each Kite historical_data call
_CHUNK_SIZE = 25           # instruments processed before a short breather
_CHUNK_PAUSE = 1.0         # seconds to pause between chunks


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
            processed = 0
            for h in holdings:
                token = h.get("instrument_token")
                symbol = h.get("tradingsymbol", "")
                exchange = h.get("exchange", "NSE")
                if not token or token in tokens_seen:
                    continue
                tokens_seen.add(token)

                # Chunk breather: pause every _CHUNK_SIZE instruments to avoid overload.
                processed += 1
                if processed > 1 and processed % _CHUNK_SIZE == 1:
                    await db.commit()          # flush the chunk before pausing
                    await asyncio.sleep(_CHUNK_PAUSE)

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
                    await asyncio.sleep(_HIST_MIN_INTERVAL)  # pace under Kite's 3 req/s
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
    from backend.routers.fundamentals import _fetch_nse_fundamental, _fetch_yf_fundamental

    log.info("Scheduler: starting fundamental data refresh")
    written = 0

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

                # Chunk breather + per-symbol pacing to stay polite to NSE/Yahoo.
                if len(symbols_seen) > 1 and len(symbols_seen) % _CHUNK_SIZE == 1:
                    await db.commit()
                    await asyncio.sleep(_CHUNK_PAUSE)

                try:
                    # NSE blocks scraping from many IPs (403) — fall back to Yahoo.
                    data = await _fetch_nse_fundamental(symbol)
                    if not data:
                        data = await _fetch_yf_fundamental(symbol, exchange)
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
                        written += 1
                except Exception as exc:
                    log.warning("Fundamental refresh failed for %s: %s", symbol, exc)

        await db.commit()

    log.info(
        "Scheduler: fundamental refresh complete — %d/%d symbols written",
        written, len(symbols_seen),
    )


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

            # Snapshot the fields we need into plain tuples BEFORE the loop.
            # _load_ohlcv_df / _load_fundamental may call db.rollback() on this
            # shared session, which expires every ORM object in the identity map
            # (expire_on_commit=False does NOT cover rollback). Touching an
            # expired kpi.* attribute afterwards triggers an implicit lazy load,
            # which is illegal under the async engine → MissingGreenlet.
            kpi_defs = [(k.name, k.formula, k.return_type) for k in kpis]

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

                for kpi_name, kpi_formula, kpi_return_type in kpi_defs:
                    try:
                        evaluate_formula(kpi_formula, df, fundamental, kpi_return_type)
                        total_evals += 1
                    except Exception as exc:
                        log.warning(
                            "KPI scheduler: formula error — KPI=%r symbol=%r: %s",
                            kpi_name, symbol, exc,
                        )

    log.info("Scheduler: KPI pre-warm complete — %d evaluations", total_evals)


# ─────────────────────────────────────────────────────────────────────────────
# Orchestrator: run all three data-refresh jobs to get fully fresh data
# ─────────────────────────────────────────────────────────────────────────────

async def refresh_all_data() -> None:
    """
    Run the three data-refresh jobs back-to-back so every cache is fresh.

    Order matters — it is a dependency chain, NOT a fan-out:
      1. D-1 OHLCV     → warms ohlcv_cache
      2. Fundamentals  → warms fundamental_cache
      3. KPI recompute → reads the two warm caches (mostly DB, few Kite calls)

    Run SEQUENTIALLY on purpose. Do NOT asyncio.gather() these: each job opens
    its own AsyncSession, and a single AsyncSession/asyncpg connection cannot be
    driven by two coroutines at once — that is what raises
    `MissingGreenlet: greenlet_spawn has not been called`. Chunking/pacing inside
    each job (see _CHUNK_SIZE / _HIST_MIN_INTERVAL) is what prevents Kite 429s;
    concurrency is not needed and would only trade a rate-limit error for a
    greenlet error.

    Safe to trigger manually (e.g. from an admin endpoint) or on demand.
    """
    log.info("Scheduler: full data refresh started")
    for name, job in (
        ("D-1 OHLCV", _job_fetch_d1_ohlcv),
        ("fundamentals", _job_refresh_fundamentals),
        ("KPI recompute", _job_recompute_kpis),
    ):
        try:
            await job()
        except Exception:
            # One job failing must not abort the rest — log and continue.
            log.exception("Scheduler: %s job failed during full refresh", name)
    log.info("Scheduler: full data refresh complete")


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
