"""
KPI formula validation and computation engine.

Supported formula syntax
────────────────────────
SCALAR      RSI(14)  |  PE_RATIO  |  CLOSE  |  SMA(20) - EMA(50)
BOOLEAN     RSI(14) > 70  |  CLOSE > EMA(20)  |  PE_RATIO < 15
CATEGORICAL BB_POSITION(20)   — built-in Bollinger Band signal (KP-11)

Supported indicator functions (pandas-ta backed)
─────────────────────────────────────────────────
  RSI(period)           Relative Strength Index
  SMA(period)           Simple Moving Average
  EMA(period)           Exponential Moving Average
  MACD()                MACD line
  MACD_SIGNAL()         MACD signal line
  MACD_HIST()           MACD histogram
  BB_UPPER(period)      Bollinger Band upper
  BB_MIDDLE(period)     Bollinger Band middle
  BB_LOWER(period)      Bollinger Band lower
  BB_POSITION(period)   Categorical signal per KP-11 (CATEGORICAL only)
  ATR(period)           Average True Range
  OBV()                 On-Balance Volume
  STOCH_K(k, d)         Stochastic %K
  STOCH_D(k, d)         Stochastic %D

Supported scalar names (no parentheses)
────────────────────────────────────────
  CLOSE  OPEN  HIGH  LOW  VOLUME
  PE_RATIO  EPS  BOOK_VALUE  FACE_VALUE
  WEEK_52_HIGH  WEEK_52_LOW  PCT_FROM_52W_HIGH  PCT_FROM_52W_LOW
"""
from __future__ import annotations

import ast
import re
from typing import Any

import numpy as np
import pandas as pd

try:
    import pandas_ta as ta
except ImportError:  # pragma: no cover
    ta = None  # type: ignore[assignment]


# ─────────────────────────────────────────────────────────────────────────────
# Whitelists
# ─────────────────────────────────────────────────────────────────────────────

INDICATOR_FUNCTIONS: dict[str, int] = {
    # name → expected arg count (0 = no args)
    "RSI": 1, "SMA": 1, "EMA": 1,
    "MACD": 0, "MACD_SIGNAL": 0, "MACD_HIST": 0,
    "BB_UPPER": 1, "BB_MIDDLE": 1, "BB_LOWER": 1,
    "BB_POSITION": 1,
    "ATR": 1, "OBV": 0,
    "STOCH_K": 2, "STOCH_D": 2,
}

SCALAR_NAMES: frozenset[str] = frozenset({
    "CLOSE", "OPEN", "HIGH", "LOW", "VOLUME",
    "PE_RATIO", "EPS", "BOOK_VALUE", "FACE_VALUE",
    "WEEK_52_HIGH", "WEEK_52_LOW",
    "PCT_FROM_52W_HIGH", "PCT_FROM_52W_LOW",
})

# Regex: matches NAME or NAME(args) — uppercase identifiers only
_TOKEN_RE = re.compile(r"\b([A-Z_][A-Z_0-9]*)\s*(?:\(\s*([\d,\s]*)\s*\))?")
_COMPARE_RE = re.compile(r"^(.+?)\s*(>=|<=|==|>|<)\s*([\d.]+)\s*$")


# ─────────────────────────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────────────────────────

class FormulaValidationError(ValueError):
    """Formula is syntactically invalid or references a disallowed identifier."""


def validate_formula(formula: str, return_type: str) -> None:
    """
    Validate a KPI formula string against the whitelist.
    Raises FormulaValidationError with a descriptive message if invalid.
    Does NOT compute anything — safe to call on every save.
    """
    f = formula.strip()

    if return_type == "CATEGORICAL":
        if not re.fullmatch(r"BB_POSITION\s*\(\s*\d+\s*\)", f):
            raise FormulaValidationError(
                "CATEGORICAL formulas must use BB_POSITION(period), e.g. BB_POSITION(20)"
            )
        return

    m = _COMPARE_RE.match(f)
    if m:
        if return_type == "SCALAR":
            raise FormulaValidationError(
                "SCALAR formulas must not contain a comparison operator. "
                "Use BOOLEAN return_type for conditions like RSI(14) > 70."
            )
        lhs = m.group(1).strip()
        try:
            float(m.group(3))
        except ValueError:
            raise FormulaValidationError(
                f"Right-hand side of comparison must be a number; got {m.group(3)!r}"
            )
    else:
        if return_type == "BOOLEAN":
            raise FormulaValidationError(
                "BOOLEAN formulas must contain a comparison operator (>, <, >=, <=, ==). "
                "Example: RSI(14) > 70"
            )
        lhs = f

    _validate_expression(lhs)


def _validate_expression(expr: str) -> None:
    """Verify that every identifier in the expression is whitelisted."""
    for m in re.finditer(r"\b([A-Z_][A-Z_0-9]*)\b", expr):
        ident = m.group(1)
        if ident not in INDICATOR_FUNCTIONS and ident not in SCALAR_NAMES:
            raise FormulaValidationError(
                f"Unknown identifier {ident!r}. "
                f"Allowed functions: {sorted(INDICATOR_FUNCTIONS)}. "
                f"Allowed scalars: {sorted(SCALAR_NAMES)}."
            )

    # Replace known function calls with placeholder to get a parseable Python AST
    sanitized = _TOKEN_RE.sub(lambda m: f"__F_{m.group(1)}", expr)
    try:
        tree = ast.parse(sanitized, mode="eval")
    except SyntaxError as exc:
        raise FormulaValidationError(f"Formula syntax error: {exc}") from exc

    # Walk AST — disallow any node type that could execute arbitrary code
    for node in ast.walk(tree):
        if isinstance(node, (ast.Call, ast.Attribute, ast.Subscript,
                              ast.Lambda, ast.GeneratorExp, ast.ListComp,
                              ast.SetComp, ast.DictComp)):
            raise FormulaValidationError(
                "Unsupported expression construct in formula. "
                "Only arithmetic operations on indicator values are allowed."
            )


# ─────────────────────────────────────────────────────────────────────────────
# Indicator computation
# ─────────────────────────────────────────────────────────────────────────────

def _last(series: pd.Series | None) -> float | None:
    """Return the last non-NaN value, or None if series is None or all NaN."""
    if series is None:
        return None
    valid = series.dropna()
    return float(valid.iloc[-1]) if not valid.empty else None


def _compute_indicators(
    df: pd.DataFrame,
    formula: str,
    fundamental: dict[str, Any] | None = None,
) -> dict[str, float | str | None]:
    """
    Compute all indicator values referenced in the formula against a OHLCV DataFrame.
    The DataFrame must have columns: open, high, low, close, volume (lowercase).
    Returns a flat mapping of formula token → scalar value.
    """
    if ta is None:
        raise RuntimeError("pandas-ta is not installed. Run: pip install pandas-ta")

    close = df["close"]
    high = df["high"]
    low = df["low"]
    volume = df["volume"]
    close_val = _last(close)

    # ── Base price scalars ────────────────────────────────────────────────────
    values: dict[str, float | str | None] = {
        "CLOSE": close_val,
        "OPEN": _last(df["open"]),
        "HIGH": _last(high),
        "LOW": _last(low),
        "VOLUME": _last(volume),
    }

    # ── Fundamental scalars ───────────────────────────────────────────────────
    f = fundamental or {}
    values["PE_RATIO"] = f.get("pe_ratio")
    values["EPS"] = f.get("eps")
    values["BOOK_VALUE"] = f.get("book_value")
    values["FACE_VALUE"] = f.get("face_value")
    values["WEEK_52_HIGH"] = f.get("week_52_high")
    values["WEEK_52_LOW"] = f.get("week_52_low")

    # Derived 52-week % deviations
    w52h = values["WEEK_52_HIGH"]
    w52l = values["WEEK_52_LOW"]
    values["PCT_FROM_52W_HIGH"] = (
        (close_val - w52h) / w52h * 100 if close_val and w52h else None
    )
    values["PCT_FROM_52W_LOW"] = (
        (close_val - w52l) / w52l * 100 if close_val and w52l else None
    )

    # ── Compute only the indicators actually referenced in the formula ─────────
    formula_upper = formula.upper()

    for m in _TOKEN_RE.finditer(formula_upper):
        name = m.group(1)
        if name not in INDICATOR_FUNCTIONS:
            continue
        args_str = m.group(2) or ""
        args = [int(a.strip()) for a in args_str.split(",") if a.strip()]
        key = f"{name}({','.join(str(a) for a in args)})" if args else name

        if key in values:
            continue  # already computed

        if name == "RSI":
            period = args[0] if args else 14
            values[key] = _last(ta.rsi(close, length=period))

        elif name == "SMA":
            period = args[0] if args else 20
            values[key] = _last(ta.sma(close, length=period))

        elif name == "EMA":
            period = args[0] if args else 20
            values[key] = _last(ta.ema(close, length=period))

        elif name in ("MACD", "MACD_SIGNAL", "MACD_HIST"):
            result = ta.macd(close)
            if result is not None and not result.empty:
                values["MACD"] = _last(result.iloc[:, 0])
                values["MACD_SIGNAL"] = _last(result.iloc[:, 2])
                values["MACD_HIST"] = _last(result.iloc[:, 1])
            else:
                values["MACD"] = values["MACD_SIGNAL"] = values["MACD_HIST"] = None

        elif name in ("BB_UPPER", "BB_MIDDLE", "BB_LOWER", "BB_POSITION"):
            period = args[0] if args else 20
            cache_key = f"_BB_COMPUTED_{period}"
            if cache_key not in values:
                result = ta.bbands(close, length=period)
                if result is not None and not result.empty:
                    col_l = next((c for c in result.columns if "BBL" in c), None)
                    col_m = next((c for c in result.columns if "BBM" in c), None)
                    col_u = next((c for c in result.columns if "BBU" in c), None)
                    bb_l = _last(result[col_l]) if col_l else None
                    bb_m = _last(result[col_m]) if col_m else None
                    bb_u = _last(result[col_u]) if col_u else None
                else:
                    bb_l = bb_m = bb_u = None
                values[f"BB_LOWER({period})"] = bb_l
                values[f"BB_MIDDLE({period})"] = bb_m
                values[f"BB_UPPER({period})"] = bb_u
                values[cache_key] = True
                # BB_POSITION categorical signal (KP-11)
                if bb_u is not None and bb_l is not None and close_val is not None:
                    band_height = bb_u - bb_l
                    thresh = band_height * 0.05
                    if close_val >= bb_u - thresh:
                        values[f"BB_POSITION({period})"] = "Sell Signal"
                    elif close_val <= bb_l + thresh:
                        values[f"BB_POSITION({period})"] = "Buy Signal"
                    else:
                        values[f"BB_POSITION({period})"] = "Hold"
                else:
                    values[f"BB_POSITION({period})"] = None

        elif name == "ATR":
            period = args[0] if args else 14
            values[key] = _last(ta.atr(high, low, close, length=period))

        elif name == "OBV":
            values["OBV"] = _last(ta.obv(close, volume))

        elif name in ("STOCH_K", "STOCH_D"):
            k = args[0] if len(args) > 0 else 14
            d = args[1] if len(args) > 1 else 3
            sk, sd = f"STOCH_K({k},{d})", f"STOCH_D({k},{d})"
            if sk not in values:
                result = ta.stoch(high, low, close, k=k, d=d)
                if result is not None and not result.empty:
                    values[sk] = _last(result.iloc[:, 0])
                    values[sd] = _last(result.iloc[:, 1])
                else:
                    values[sk] = values[sd] = None

    return values


# ─────────────────────────────────────────────────────────────────────────────
# Expression evaluation
# ─────────────────────────────────────────────────────────────────────────────

_SAFE_CHARS_RE = re.compile(r"^[\d.\s+\-*/()eE]+$")


def _eval_scalar_expr(expr: str, values: dict[str, Any]) -> float | None:
    """
    Substitute all indicator tokens with their numeric values and evaluate.
    Returns None if any referenced value is missing or computation fails.
    """
    _SENTINEL = "__NONE__"

    def replace(m: re.Match) -> str:
        name = m.group(1)
        args_str = m.group(2) or ""
        args = [a.strip() for a in args_str.split(",") if a.strip()]
        key = f"{name}({','.join(args)})" if args else name
        val = values.get(key)
        return _SENTINEL if val is None else str(float(val))

    substituted = _TOKEN_RE.sub(replace, expr.upper())

    if _SENTINEL in substituted:
        return None  # a required indicator value was unavailable

    if not _SAFE_CHARS_RE.match(substituted):
        return None  # unexpected characters after substitution (safety check)

    try:
        return float(eval(substituted, {"__builtins__": {}}))  # noqa: S307
    except Exception:
        return None


def _apply_op(lhs: float, op: str, rhs: float) -> bool:
    return {
        ">": lhs > rhs, "<": lhs < rhs,
        ">=": lhs >= rhs, "<=": lhs <= rhs, "==": lhs == rhs,
    }[op]


# ─────────────────────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────────────────────

def evaluate_formula(
    formula: str,
    df: pd.DataFrame,
    fundamental: dict[str, Any] | None,
    return_type: str,
) -> Any:
    """
    Evaluate a KPI formula against an OHLCV DataFrame.

    Parameters
    ----------
    formula     : validated KPI formula string
    df          : OHLCV DataFrame with columns open/high/low/close/volume (lowercase)
                  sorted ascending by timestamp, ≥ 1 row
    fundamental : dict from FundamentalCache row (pe_ratio, eps, etc.) or None
    return_type : "SCALAR" | "BOOLEAN" | "CATEGORICAL"

    Returns
    -------
    float | bool | str | None
        None when a required indicator cannot be computed (e.g. not enough candles,
        or fundamental data unavailable for PE_RATIO / EPS).
    """
    if df.empty:
        return None

    f = formula.strip()
    values = _compute_indicators(df, f, fundamental)

    if return_type == "CATEGORICAL":
        m = re.fullmatch(r"BB_POSITION\s*\(\s*(\d+)\s*\)", f, re.IGNORECASE)
        if m:
            return values.get(f"BB_POSITION({int(m.group(1))})")
        return None

    m = _COMPARE_RE.match(f)
    if m:
        lhs_val = _eval_scalar_expr(m.group(1).strip(), values)
        if lhs_val is None:
            return None
        return _apply_op(lhs_val, m.group(2), float(m.group(3)))

    return _eval_scalar_expr(f, values)
