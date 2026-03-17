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
  MA_SLOPE(period)      SMA slope as angle in degrees (-90 to +90)
  EMA_SLOPE(period)     EMA slope as angle in degrees (-90 to +90)

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
    "MA_SLOPE": 1, "EMA_SLOPE": 1,   # slope of SMA/EMA as angle in degrees (-90..90)
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

# ── Categorical IF-chain helpers ──────────────────────────────────────────────
_IF_PREFIX_RE = re.compile(r"^IF\s*\(", re.IGNORECASE)
_STRING_LITERAL_RE = re.compile(r'^"([^"]+)"$')
_COND_OP_RE = re.compile(r"^(.+?)\s*(>=|<=|==|>|<)\s*(.+)$")

# ── AND / OR compound-condition helpers ───────────────────────────────────────
_AND_RE = re.compile(r"\bAND\b", re.IGNORECASE)
_OR_RE  = re.compile(r"\bOR\b",  re.IGNORECASE)


def _split_if_args(inner: str) -> tuple[str, str, str]:
    """Split the content inside IF(...) into (condition, label, else_expr).
    Respects nested parentheses and string literals."""
    depth, in_string = 0, False
    comma_idx: list[int] = []
    i = 0
    while i < len(inner):
        c = inner[i]
        if c == '"':
            in_string = not in_string
        elif not in_string:
            if c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
            elif c == ',' and depth == 0:
                comma_idx.append(i)
                if len(comma_idx) == 2:
                    break
        i += 1
    if len(comma_idx) < 2:
        raise FormulaValidationError(
            'IF formula must have the form: IF(condition, "label", else_expr)'
        )
    p1, p2 = comma_idx[0], comma_idx[1]
    return inner[:p1].strip(), inner[p1 + 1:p2].strip(), inner[p2 + 1:].strip()


def _parse_if_chain(
    formula: str,
) -> tuple[list[tuple[str, str]], str]:
    """Parse a nested IF formula into (conditions, default_label).

    conditions = [(lhs_expr, op, rhs_expr, true_label), ...]
    default_label = string returned when no condition matches.
    Raises FormulaValidationError on any syntax or identifier error.
    """
    conditions: list[tuple[str, str]] = []
    current = formula.strip()
    while True:
        # Base case: bare string literal → default label
        str_m = _STRING_LITERAL_RE.match(current)
        if str_m:
            return conditions, str_m.group(1)

        if not _IF_PREFIX_RE.match(current) or not current.endswith(")"):
            raise FormulaValidationError(
                "CATEGORICAL formula must be: IF(cond, \"label\", ...) "
                "ending with a \"default\" string literal"
            )

        # Strip IF( ... ) — find the opening paren
        inner = current[current.index("(") + 1: -1]
        cond_str, label_str, else_str = _split_if_args(inner)

        # Validate label is a non-empty quoted string
        label_m = _STRING_LITERAL_RE.match(label_str.strip())
        if not label_m:
            raise FormulaValidationError(
                f'Label must be a double-quoted string (e.g. "Sell Signal"), got {label_str!r}'
            )

        # Validate condition — may be a compound AND/OR expression
        _validate_compound_condition(cond_str)

        conditions.append((cond_str, label_m.group(1)))
        current = else_str.strip()


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
        if re.fullmatch(r"BB_POSITION\s*\(\s*\d+\s*\)", f):
            return  # legacy shorthand — still valid
        _parse_if_chain(f)  # raises FormulaValidationError on invalid syntax
        return

    if _is_boolean_expr(f):
        if return_type == "SCALAR":
            raise FormulaValidationError(
                "SCALAR formulas must not contain comparison operators or AND/OR. "
                "Use BOOLEAN return type for conditions like RSI(14) > 70."
            )
        _validate_compound_condition(f)
        return

    if return_type == "BOOLEAN":
        raise FormulaValidationError(
            "BOOLEAN formulas must contain a comparison operator (>, <, >=, <=, ==) "
            "and optionally AND/OR to combine conditions. Example: RSI(14) > 70"
        )
    _validate_expression(f)


def _validate_compound_condition(cond_str: str) -> None:
    """Validate a compound condition (AND/OR of atomic comparisons).
    AND binds before OR (standard precedence).
    Raises FormulaValidationError if any atom is syntactically invalid or
    references an unknown identifier."""
    for or_clause in _OR_RE.split(cond_str):
        for atom in _AND_RE.split(or_clause):
            atom = atom.strip()
            m = _COND_OP_RE.match(atom)
            if not m:
                raise FormulaValidationError(
                    f"Each condition must be 'expr op expr', got {atom!r}. "
                    f"Supported operators: >=, <=, ==, >, <"
                )
            lhs, rhs = m.group(1).strip(), m.group(3).strip()
            _validate_expression(lhs)
            try:
                float(rhs)
            except ValueError:
                _validate_expression(rhs)


def _is_boolean_expr(f: str) -> bool:
    """Return True if the formula contains a comparison operator or AND/OR keyword."""
    return bool(re.search(r"(>=|<=|==|>|<)", f)) or bool(
        re.search(r"\b(AND|OR)\b", f, re.IGNORECASE)
    )


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

    # OHLCV fallback for 52W High/Low when fundamental cache is absent
    if values["WEEK_52_HIGH"] is None and not df.empty:
        h_val = df["high"].tail(252).max()
        if pd.notna(h_val) and h_val > 0:
            values["WEEK_52_HIGH"] = float(h_val)
    if values["WEEK_52_LOW"] is None and not df.empty:
        l_val = df["low"].tail(252).min()
        if pd.notna(l_val) and l_val > 0:
            values["WEEK_52_LOW"] = float(l_val)

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

        elif name in ("MA_SLOPE", "EMA_SLOPE"):
            period = args[0] if args else 20
            ma_series = ta.sma(close, length=period) if name == "MA_SLOPE" else ta.ema(close, length=period)
            if ma_series is not None:
                valid = ma_series.dropna()
                if len(valid) >= 2:
                    ma_curr = float(valid.iloc[-1])
                    ma_prev = float(valid.iloc[-2])
                    # slope as % change per bar, then convert to angle via arctan
                    # arctan naturally clamps result to (-90, 90) degrees
                    pct_slope = (ma_curr - ma_prev) / ma_curr * 100 if ma_curr != 0 else 0.0
                    values[key] = float(np.degrees(np.arctan(pct_slope)))
                else:
                    values[key] = None
            else:
                values[key] = None

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


def _eval_compound_condition(cond_str: str, values: dict[str, Any]) -> bool | None:
    """Evaluate an AND/OR compound condition. AND binds before OR.
    Returns True/False, or None if every OR-clause had an unavailable value."""
    all_skipped = True
    for or_clause in _OR_RE.split(cond_str):
        clause_true = True
        clause_skipped = False
        for atom in _AND_RE.split(or_clause):
            atom = atom.strip()
            m = _COND_OP_RE.match(atom)
            if not m:
                clause_true = False
                break
            lhs_val = _eval_scalar_expr(m.group(1).strip(), values)
            rhs_str = m.group(3).strip()
            try:
                rhs_val: float | None = float(rhs_str)
            except ValueError:
                rhs_val = _eval_scalar_expr(rhs_str, values)
            if lhs_val is None or rhs_val is None:
                clause_true = False
                clause_skipped = True
                break
            if not _apply_op(lhs_val, m.group(2), rhs_val):
                clause_true = False
                break
        if not clause_skipped:
            all_skipped = False
        if clause_true:
            return True
    return None if all_skipped else False


def _evaluate_categorical_if(
    formula: str,
    values: dict[str, Any],
) -> str | None:
    """Evaluate a nested IF categorical formula using pre-computed indicator values.
    Returns the label of the first matching condition, or the default label."""
    try:
        conditions, default_label = _parse_if_chain(formula)
    except FormulaValidationError:
        return None
    for cond_str, label in conditions:
        result = _eval_compound_condition(cond_str, values)
        if result is True:
            return label
    return default_label


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
        return _evaluate_categorical_if(f, values)

    if return_type == "BOOLEAN":
        return _eval_compound_condition(f, values)

    return _eval_scalar_expr(f, values)
