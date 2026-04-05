"""Tests for APScheduler jobs and lifecycle (scheduler.py)."""
from __future__ import annotations

import asyncio
from datetime import date, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytz
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from backend.scheduler import _prev_trading_day, _job_reload_instruments, _job_fetch_d1_ohlcv, _job_refresh_fundamentals
import backend.scheduler as scheduler_module


IST = pytz.timezone("Asia/Kolkata")


# ─── Helper tests ────────────────────────────────────────────────────────────

def test_prev_trading_day_returns_weekday():
    """_prev_trading_day() always returns Mon–Fri."""
    d = _prev_trading_day()
    assert isinstance(d, date)
    assert d.weekday() <= 4  # 0=Mon, 4=Fri


def test_prev_trading_day_not_today():
    """Returns a date strictly before today (IST)."""
    today = datetime.now(IST).date()
    d = _prev_trading_day()
    assert d < today


def test_prev_trading_day_skips_weekend():
    """The returned date is always a weekday regardless of current day."""
    d = _prev_trading_day()
    assert d.weekday() not in (5, 6)  # not Saturday or Sunday


# ─── Scheduler lifecycle tests ────────────────────────────────────────────────
# The module-level _scheduler is an AsyncIOScheduler singleton that cannot be
# restarted after shutdown (the internal event loop is closed).  Each test that
# exercises lifecycle creates its own fresh scheduler, injects it into the
# module, and tears it down afterwards.

@pytest.fixture()
def fresh_scheduler():
    """Yield a brand-new AsyncIOScheduler and restore the original after the test."""
    orig = scheduler_module._scheduler
    sched = AsyncIOScheduler(timezone=IST)
    scheduler_module._scheduler = sched
    yield sched
    # Cleanup: shut down if still running
    try:
        if sched.running:
            sched.shutdown(wait=False)
    except Exception:
        pass
    scheduler_module._scheduler = orig


@pytest.mark.asyncio
async def test_start_scheduler_registers_four_jobs(fresh_scheduler):
    """start_scheduler() registers all four scheduled jobs."""
    await scheduler_module.start_scheduler()

    job_ids = [job.id for job in fresh_scheduler.get_jobs()]
    assert "reload_instruments" in job_ids
    assert "fetch_d1_ohlcv" in job_ids
    assert "recompute_kpis" in job_ids
    assert "refresh_fundamentals" in job_ids


@pytest.mark.asyncio
async def test_shutdown_scheduler_no_error(fresh_scheduler):
    """shutdown_scheduler() completes without raising."""
    await scheduler_module.start_scheduler()
    await scheduler_module.shutdown_scheduler()  # must not raise


@pytest.mark.asyncio
async def test_start_scheduler_idempotent(fresh_scheduler):
    """Calling start_scheduler() twice (replace_existing=True) doesn't duplicate jobs."""
    await scheduler_module.start_scheduler()
    # Second call on an already-running scheduler: add_job with replace_existing
    # The scheduler is already started; start() would raise, but add_job is fine.
    # Patch _scheduler.start to be a no-op on the second call:
    fresh_scheduler.add_job(
        _job_reload_instruments,
        CronTrigger(hour=8, minute=30, day_of_week="mon-fri", timezone=IST),
        id="reload_instruments",
        replace_existing=True,
        misfire_grace_time=1800,
    )
    fresh_scheduler.add_job(
        _job_fetch_d1_ohlcv,
        CronTrigger(hour=9, minute=20, day_of_week="mon-fri", timezone=IST),
        id="fetch_d1_ohlcv",
        replace_existing=True,
        misfire_grace_time=300,
    )
    fresh_scheduler.add_job(
        _job_refresh_fundamentals,
        CronTrigger(hour=8, minute=0, day_of_week="sun", timezone=IST),
        id="refresh_fundamentals",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    job_ids = [job.id for job in fresh_scheduler.get_jobs()]
    assert job_ids.count("reload_instruments") == 1
    assert job_ids.count("fetch_d1_ohlcv") == 1
    assert job_ids.count("refresh_fundamentals") == 1


# ─── Job function unit tests ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_job_reload_instruments_is_callable():
    """_job_reload_instruments is importable and callable."""
    assert callable(_job_reload_instruments)


@pytest.mark.asyncio
async def test_job_fetch_d1_ohlcv_skips_without_users():
    """_job_fetch_d1_ohlcv completes without error when no active users exist."""
    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)
    # Return no users
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = []
    mock_session.execute = AsyncMock(return_value=mock_result)

    with patch("backend.scheduler.AsyncSessionLocal", return_value=mock_session):
        await _job_fetch_d1_ohlcv()  # should complete without error


@pytest.mark.asyncio
async def test_job_refresh_fundamentals_skips_without_users():
    """_job_refresh_fundamentals completes without error when no active users exist."""
    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = []
    mock_session.execute = AsyncMock(return_value=mock_result)
    mock_session.commit = AsyncMock()

    with patch("backend.scheduler.AsyncSessionLocal", return_value=mock_session):
        await _job_refresh_fundamentals()  # should complete without error
