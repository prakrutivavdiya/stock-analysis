"""
Alert condition evaluation engine.

Pure functions — no I/O, no DB access.
Called by:
  - ticker._on_ticks  (real-time price checks)
  - routers/alerts.py POST  (creation-time validation: condition already met?)
"""
from __future__ import annotations

from decimal import Decimal


def _pct_change(ltp: float, day_open: float) -> float:
    """Intraday % change from day open.  Returns 0.0 if day_open is zero."""
    if not day_open:
        return 0.0
    return (ltp - day_open) / day_open * 100.0


def should_fire(condition_type: str, threshold: float, ltp: float, day_open: float) -> bool:
    """
    Return True if the alert condition is satisfied for the given price snapshot.

    Parameters
    ----------
    condition_type : one of ALERT_CONDITION_TYPES
    threshold      : the user-supplied price level or % value
    ltp            : current last traded price
    day_open       : today's opening price (used for CROSS and PCT conditions)
    """
    match condition_type:
        case "PRICE_ABOVE":
            return ltp >= threshold
        case "PRICE_BELOW":
            return ltp <= threshold
        case "PRICE_CROSS_ABOVE":
            # Condition met when price has moved UP through the threshold today
            return day_open < threshold <= ltp
        case "PRICE_CROSS_BELOW":
            # Condition met when price has moved DOWN through the threshold today
            return day_open > threshold >= ltp
        case "PCT_CHANGE_ABOVE":
            return _pct_change(ltp, day_open) >= threshold
        case "PCT_CHANGE_BELOW":
            return _pct_change(ltp, day_open) <= threshold
    return False


def already_met(condition_type: str, threshold: float, ltp: float, day_open: float) -> bool:
    """
    Check at alert-creation time whether the condition is *already* satisfied.

    Semantically the same as should_fire, but kept separate so callers can
    produce a user-facing error message rather than a silent trigger.
    """
    return should_fire(condition_type, threshold, ltp, day_open)


def build_message(
    tradingsymbol: str,
    condition_type: str,
    threshold: float | Decimal,
    trigger_price: float,
) -> str:
    """Build the human-readable alert notification message."""
    thr = float(threshold)
    match condition_type:
        case "PRICE_ABOVE":
            return f"{tradingsymbol} reached ₹{trigger_price:.2f} (above ₹{thr:.2f})"
        case "PRICE_BELOW":
            return f"{tradingsymbol} dropped to ₹{trigger_price:.2f} (below ₹{thr:.2f})"
        case "PRICE_CROSS_ABOVE":
            return f"{tradingsymbol} crossed above ₹{thr:.2f} (current: ₹{trigger_price:.2f})"
        case "PRICE_CROSS_BELOW":
            return f"{tradingsymbol} crossed below ₹{thr:.2f} (current: ₹{trigger_price:.2f})"
        case "PCT_CHANGE_ABOVE":
            return f"{tradingsymbol} up {thr:+.2f}% intraday (current: ₹{trigger_price:.2f})"
        case "PCT_CHANGE_BELOW":
            return f"{tradingsymbol} down {thr:.2f}% intraday (current: ₹{trigger_price:.2f})"
    return f"{tradingsymbol} alert triggered at ₹{trigger_price:.2f}"


def already_met_error(
    tradingsymbol: str,
    condition_type: str,
    threshold: float,
    ltp: float,
) -> str:
    """Human-readable error explaining why the alert cannot be created."""
    thr = threshold
    match condition_type:
        case "PRICE_ABOVE":
            return (
                f"{tradingsymbol} is already above ₹{thr:.2f} "
                f"(current price: ₹{ltp:.2f}). "
                "Set a higher threshold."
            )
        case "PRICE_BELOW":
            return (
                f"{tradingsymbol} is already below ₹{thr:.2f} "
                f"(current price: ₹{ltp:.2f}). "
                "Set a lower threshold."
            )
        case "PRICE_CROSS_ABOVE":
            return (
                f"{tradingsymbol} has already crossed above ₹{thr:.2f} today "
                f"(current price: ₹{ltp:.2f})."
            )
        case "PRICE_CROSS_BELOW":
            return (
                f"{tradingsymbol} has already crossed below ₹{thr:.2f} today "
                f"(current price: ₹{ltp:.2f})."
            )
        case "PCT_CHANGE_ABOVE":
            return (
                f"{tradingsymbol} is already up more than {thr:.2f}% intraday "
                f"(current price: ₹{ltp:.2f})."
            )
        case "PCT_CHANGE_BELOW":
            return (
                f"{tradingsymbol} is already down more than {abs(thr):.2f}% intraday "
                f"(current price: ₹{ltp:.2f})."
            )
    return f"Condition already met for {tradingsymbol} at ₹{ltp:.2f}."
