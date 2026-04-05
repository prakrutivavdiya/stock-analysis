"""
NSE trading holiday calendar — loaded once at startup from Kite, with static fallback.

Usage:
    from backend.holidays import is_exchange_holiday, prev_trading_day, load_holidays_from_kite

    # At startup (optional — falls back to static list):
    load_holidays_from_kite(kite_client)

    # Anywhere else:
    is_exchange_holiday(date.today())
    prev_trading_day()
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

log = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Static fallback — NSE equity segment trading holidays for 2026
# Source: NSE India holiday master (updated annually)
# ──────────────────────────────────────────────────────────────────────────────

_STATIC_HOLIDAYS_2026: frozenset[date] = frozenset(
    {
        date(2026, 1, 26),   # Republic Day
        date(2026, 3, 25),   # Holi
        date(2026, 4, 3),    # Good Friday
        date(2026, 4, 14),   # Dr. Ambedkar Jayanti
        date(2026, 4, 17),   # Ram Navami
        date(2026, 5, 1),    # Maharashtra Day
        date(2026, 6, 19),   # Bakri Id (Eid ul-Adha)
        date(2026, 7, 6),    # Eid ul-Adha (makeup)
        date(2026, 8, 15),   # Independence Day
        date(2026, 8, 27),   # Ganesh Chaturthi
        date(2026, 10, 2),   # Gandhi Jayanti
        date(2026, 10, 24),  # Dussehra
        date(2026, 11, 13),  # Diwali — Laxmi Pujan
        date(2026, 11, 14),  # Diwali — Balipratipada
        date(2026, 11, 25),  # Gurunanak Jayanti
        date(2026, 12, 25),  # Christmas
    }
)

# Populated at startup from kite.trading_holidays(); empty set = use static list
_live_holidays: frozenset[date] = frozenset()


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────


def load_holidays_from_kite(kite) -> None:  # type: ignore[type-arg]
    """
    Call once at startup with an authenticated KiteConnect instance.

    On failure (Kite session unavailable, permission error, etc.) we log a
    warning and continue — the static fallback list covers the current year.
    """
    global _live_holidays
    try:
        raw = kite.trading_holidays("NSE")
        parsed: set[date] = set()
        for h in raw:
            # Kite returns either {"tradingDate": "YYYY-MM-DD"} or a date string
            raw_date = h.get("tradingDate") or h.get("date") or h
            if isinstance(raw_date, date):
                parsed.add(raw_date)
            elif isinstance(raw_date, str):
                parsed.add(date.fromisoformat(raw_date[:10]))
        _live_holidays = frozenset(parsed)
        log.info("Holidays: loaded %d NSE trading holidays from Kite", len(_live_holidays))
    except Exception as exc:
        log.warning("Holidays: failed to load from Kite (%s) — using static 2026 list", exc)


def is_exchange_holiday(d: date) -> bool:
    """Return True when d is a declared NSE equity trading holiday."""
    holidays = _live_holidays if _live_holidays else _STATIC_HOLIDAYS_2026
    return d in holidays


def prev_trading_day(today: date | None = None) -> date:
    """
    Return the most recent trading day strictly before today (or the supplied date).

    Skips weekends (Sat=5, Sun=6) and declared NSE exchange holidays.
    """
    d = (today or date.today()) - timedelta(days=1)
    while d.weekday() >= 5 or is_exchange_holiday(d):
        d -= timedelta(days=1)
    return d
