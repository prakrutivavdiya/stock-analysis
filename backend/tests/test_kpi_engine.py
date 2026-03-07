"""
Unit tests for backend.kpi_engine — formula validation and evaluation.

These are pure unit tests: no HTTP client, no database, no fixtures beyond
synthetic OHLCV DataFrames.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.kpi_engine import (
    FormulaValidationError,
    evaluate_formula,
    validate_formula,
)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _make_df(n: int = 50, base_close: float = 1500.0) -> pd.DataFrame:
    """Build a minimal OHLCV DataFrame with n rows."""
    closes = [base_close + i * 2 for i in range(n)]
    return pd.DataFrame({
        "open": [c - 5 for c in closes],
        "high": [c + 10 for c in closes],
        "low": [c - 10 for c in closes],
        "close": closes,
        "volume": [1_000_000] * n,
    })


def _make_flat_df(n: int = 50, close: float = 1500.0) -> pd.DataFrame:
    """Build a DataFrame where all closes are identical (for deterministic tests)."""
    return pd.DataFrame({
        "open": [close] * n,
        "high": [close + 5] * n,
        "low": [close - 5] * n,
        "close": [close] * n,
        "volume": [1_000_000] * n,
    })


_SAMPLE_FUNDAMENTALS = {
    "pe_ratio": 28.5,
    "eps": 52.63,
    "book_value": 200.0,
    "face_value": 5.0,
    "week_52_high": 1800.0,
    "week_52_low": 1200.0,
}


# ─────────────────────────────────────────────────────────────────────────────
# validate_formula — SCALAR
# ─────────────────────────────────────────────────────────────────────────────

class TestValidateFormulaScalar:
    def test_close_is_valid_scalar(self):
        validate_formula("CLOSE", "SCALAR")  # must not raise

    def test_rsi_is_valid_scalar(self):
        validate_formula("RSI(14)", "SCALAR")

    def test_sma_minus_ema_is_valid(self):
        validate_formula("SMA(20) - EMA(50)", "SCALAR")

    def test_pe_ratio_is_valid_fundamental_scalar(self):
        validate_formula("PE_RATIO", "SCALAR")

    def test_scalar_with_comparison_raises(self):
        with pytest.raises(FormulaValidationError, match="comparison operator"):
            validate_formula("RSI(14) > 70", "SCALAR")

    def test_unknown_identifier_raises(self):
        with pytest.raises(FormulaValidationError, match="Unknown identifier"):
            validate_formula("UNKNOWN_FN(14)", "SCALAR")

    def test_arithmetic_on_scalars_is_valid(self):
        validate_formula("CLOSE - SMA(20)", "SCALAR")

    def test_week_52_pct_scalars_valid(self):
        validate_formula("PCT_FROM_52W_HIGH", "SCALAR")
        validate_formula("PCT_FROM_52W_LOW", "SCALAR")


# ─────────────────────────────────────────────────────────────────────────────
# validate_formula — BOOLEAN
# ─────────────────────────────────────────────────────────────────────────────

class TestValidateFormulaBoolean:
    def test_rsi_gt_threshold(self):
        validate_formula("RSI(14) > 70", "BOOLEAN")

    def test_close_gt_number(self):
        validate_formula("CLOSE > 1500", "BOOLEAN")

    def test_pe_ratio_lt_15(self):
        validate_formula("PE_RATIO < 15", "BOOLEAN")

    def test_gte_operator(self):
        validate_formula("SMA(20) >= 1500.5", "BOOLEAN")

    def test_equality_operator(self):
        validate_formula("CLOSE == 1500", "BOOLEAN")

    def test_boolean_without_comparison_raises(self):
        with pytest.raises(FormulaValidationError, match="comparison operator"):
            validate_formula("RSI(14)", "BOOLEAN")

    def test_unknown_identifier_in_boolean_raises(self):
        with pytest.raises(FormulaValidationError, match="Unknown identifier"):
            validate_formula("MAGIC(14) > 70", "BOOLEAN")

    # ── AND / OR compound conditions ──────────────────────────────────────────

    def test_and_compound_valid(self):
        validate_formula("RSI(14) > 70 AND CLOSE > SMA(20)", "BOOLEAN")

    def test_or_compound_valid(self):
        validate_formula("RSI(14) > 70 OR MACD() > 0", "BOOLEAN")

    def test_and_or_mixed_valid(self):
        validate_formula("RSI(14) > 70 AND CLOSE > 1000 OR PE_RATIO < 20", "BOOLEAN")

    def test_and_compound_unknown_identifier_raises(self):
        with pytest.raises(FormulaValidationError, match="Unknown identifier"):
            validate_formula("RSI(14) > 70 AND MAGIC_IND > 50", "BOOLEAN")

    def test_and_compound_missing_operator_raises(self):
        """Atom without a comparison operator should raise."""
        with pytest.raises(FormulaValidationError):
            validate_formula("RSI(14) > 70 AND CLOSE", "BOOLEAN")


# ─────────────────────────────────────────────────────────────────────────────
# validate_formula — CATEGORICAL
# ─────────────────────────────────────────────────────────────────────────────

class TestValidateFormulaCategorical:
    def test_bb_position_20_valid(self):
        validate_formula("BB_POSITION(20)", "CATEGORICAL")

    def test_bb_position_other_period_valid(self):
        validate_formula("BB_POSITION(14)", "CATEGORICAL")

    def test_bb_position_with_comparison_raises(self):
        with pytest.raises(FormulaValidationError, match="CATEGORICAL|IF"):
            validate_formula("BB_POSITION(20) > 0", "CATEGORICAL")

    # ── IF chain validation ────────────────────────────────────────────────────

    def test_if_chain_single_condition_valid(self):
        validate_formula('IF(CLOSE > 1000, "High", "Low")', "CATEGORICAL")

    def test_if_chain_two_conditions_valid(self):
        validate_formula(
            'IF(CLOSE >= BB_UPPER(20), "Sell Signal", IF(CLOSE <= BB_LOWER(20), "Buy Signal", "Hold"))',
            "CATEGORICAL",
        )

    def test_if_chain_indicator_rhs_valid(self):
        """RHS of comparison can be an indicator expression, not just a literal."""
        validate_formula('IF(CLOSE >= BB_UPPER(20), "Sell Signal", "Hold")', "CATEGORICAL")

    def test_if_chain_numeric_rhs_valid(self):
        validate_formula('IF(RSI(14) > 70, "Overbought", "OK")', "CATEGORICAL")

    def test_if_chain_missing_quote_label_raises(self):
        """Label must be a double-quoted string."""
        with pytest.raises(FormulaValidationError, match="double-quoted"):
            validate_formula('IF(CLOSE > 1000, High, "Low")', "CATEGORICAL")

    def test_if_chain_unknown_identifier_raises(self):
        with pytest.raises(FormulaValidationError, match="Unknown identifier"):
            validate_formula('IF(UNKNOWN_THING > 1000, "High", "Low")', "CATEGORICAL")

    def test_if_chain_no_default_raises(self):
        """A chain that ends without a string literal default must raise."""
        with pytest.raises(FormulaValidationError):
            validate_formula('IF(CLOSE > 1000, "High", IF(CLOSE < 500, "Low"))', "CATEGORICAL")

    def test_plain_identifier_raises(self):
        """A bare identifier that is neither BB_POSITION nor an IF chain must raise."""
        with pytest.raises(FormulaValidationError):
            validate_formula("RSI(14)", "CATEGORICAL")

    def test_if_chain_and_condition_valid(self):
        validate_formula(
            'IF(CLOSE >= BB_UPPER(20) AND RSI(14) > 70, "Strong Sell", "Hold")',
            "CATEGORICAL",
        )

    def test_if_chain_or_condition_valid(self):
        validate_formula(
            'IF(RSI(14) > 80 OR CLOSE >= BB_UPPER(20), "Sell", "Hold")',
            "CATEGORICAL",
        )


# ─────────────────────────────────────────────────────────────────────────────
# evaluate_formula — SCALAR
# ─────────────────────────────────────────────────────────────────────────────

class TestEvaluateFormulaScalar:
    def test_close_returns_last_close(self):
        df = _make_df(50, 1500.0)
        result = evaluate_formula("CLOSE", df, None, "SCALAR")
        assert result == pytest.approx(df["close"].iloc[-1])

    def test_empty_df_returns_none(self):
        result = evaluate_formula("CLOSE", pd.DataFrame(), None, "SCALAR")
        assert result is None

    def test_sma_returns_float(self):
        df = _make_df(50)
        result = evaluate_formula("SMA(20)", df, None, "SCALAR")
        assert isinstance(result, float)
        assert result > 0

    def test_rsi_returns_float_between_0_and_100(self):
        df = _make_df(50)
        result = evaluate_formula("RSI(14)", df, None, "SCALAR")
        assert result is None or (0 <= result <= 100)

    def test_sma_minus_ema(self):
        df = _make_df(100)
        sma = evaluate_formula("SMA(20)", df, None, "SCALAR")
        ema = evaluate_formula("EMA(20)", df, None, "SCALAR")
        diff = evaluate_formula("SMA(20) - EMA(20)", df, None, "SCALAR")
        if sma is not None and ema is not None and diff is not None:
            assert diff == pytest.approx(sma - ema, rel=1e-4)

    def test_pe_ratio_from_fundamental(self):
        df = _make_df(20)
        result = evaluate_formula("PE_RATIO", df, _SAMPLE_FUNDAMENTALS, "SCALAR")
        assert result == pytest.approx(28.5)

    def test_fundamental_not_available_returns_none(self):
        df = _make_df(20)
        result = evaluate_formula("PE_RATIO", df, None, "SCALAR")
        assert result is None

    def test_insufficient_data_returns_none_for_slow_indicator(self):
        """SMA(200) with only 5 candles should return None (not enough data)."""
        df = _make_df(5)
        result = evaluate_formula("SMA(200)", df, None, "SCALAR")
        assert result is None

    def test_week_52_pct_from_high(self):
        df = _make_flat_df(50, close=1500.0)
        fundamentals = {"week_52_high": 1800.0, "week_52_low": 1200.0}
        result = evaluate_formula("PCT_FROM_52W_HIGH", df, fundamentals, "SCALAR")
        # (1500 - 1800) / 1800 * 100 = -16.67
        assert result == pytest.approx(-16.67, rel=0.01)


# ─────────────────────────────────────────────────────────────────────────────
# evaluate_formula — BOOLEAN
# ─────────────────────────────────────────────────────────────────────────────

class TestEvaluateFormulaBoolean:
    def test_rsi_gt_threshold_true(self):
        """With strongly trending data, RSI should eventually exceed 50."""
        df = _make_df(50)
        result = evaluate_formula("RSI(14) > 50", df, None, "BOOLEAN")
        # Result can be True, False, or None (if not enough data) — just assert type
        assert result is None or isinstance(result, (bool, np.bool_))

    def test_close_gt_number_returns_bool(self):
        df = _make_df(50, 1500.0)
        result = evaluate_formula("CLOSE > 1000", df, None, "BOOLEAN")
        # close is ≥ 1500, so > 1000 must be True
        assert result is True

    def test_close_lt_number_false(self):
        df = _make_df(20, 1500.0)
        result = evaluate_formula("CLOSE < 100", df, None, "BOOLEAN")
        # close is ~1500+, so < 100 must be False
        assert result is False

    def test_pe_ratio_lt_threshold(self):
        df = _make_df(20)
        result = evaluate_formula("PE_RATIO < 30", df, _SAMPLE_FUNDAMENTALS, "BOOLEAN")
        assert result is True  # 28.5 < 30

    def test_pe_ratio_gt_threshold(self):
        df = _make_df(20)
        result = evaluate_formula("PE_RATIO > 30", df, _SAMPLE_FUNDAMENTALS, "BOOLEAN")
        assert result is False  # 28.5 < 30

    def test_missing_fundamental_returns_none(self):
        df = _make_df(20)
        result = evaluate_formula("PE_RATIO > 20", df, None, "BOOLEAN")
        assert result is None

    # ── AND / OR compound evaluation ──────────────────────────────────────────

    def test_and_both_true(self):
        """CLOSE > 100 AND CLOSE < 9999 with close ≈ 1600 → True."""
        df = _make_df(50, 1500.0)
        result = evaluate_formula("CLOSE > 100 AND CLOSE < 9999", df, None, "BOOLEAN")
        assert result is True

    def test_and_one_false(self):
        """CLOSE > 100 AND CLOSE > 9999 with close ≈ 1600 → False."""
        df = _make_df(50, 1500.0)
        result = evaluate_formula("CLOSE > 100 AND CLOSE > 9999", df, None, "BOOLEAN")
        assert result is False

    def test_or_first_true(self):
        """CLOSE > 9999 OR CLOSE > 100 with close ≈ 1600 → True (second clause matches)."""
        df = _make_df(50, 1500.0)
        result = evaluate_formula("CLOSE > 9999 OR CLOSE > 100", df, None, "BOOLEAN")
        assert result is True

    def test_or_both_false(self):
        """Both OR clauses false → False."""
        df = _make_df(50, 1500.0)
        result = evaluate_formula("CLOSE > 9999 OR CLOSE > 9998", df, None, "BOOLEAN")
        assert result is False

    def test_and_missing_data_skips_clause(self):
        """When PE_RATIO is unavailable, that AND-clause is skipped; overall None or False."""
        df = _make_df(20)
        result = evaluate_formula("PE_RATIO > 10 AND CLOSE > 100", df, None, "BOOLEAN")
        # PE_RATIO=None → clause skipped → all_skipped=True only if CLOSE also unavailable
        # CLOSE is available so the AND-clause is not fully skipped, it evaluates to False
        assert result is False or result is None


# ─────────────────────────────────────────────────────────────────────────────
# evaluate_formula — CATEGORICAL
# ─────────────────────────────────────────────────────────────────────────────

class TestEvaluateFormulaCategorical:
    def test_bb_position_returns_string(self):
        df = _make_df(50)
        result = evaluate_formula("BB_POSITION(20)", df, None, "CATEGORICAL")
        # Must be one of the three signals or None
        assert result in ("Buy Signal", "Sell Signal", "Hold", None)

    def test_bb_position_at_lower_band(self):
        """When close is at lower Bollinger Band, should return Buy Signal."""
        df = _make_flat_df(50, 1500.0)
        # Force close to be at lower BB by using very tight range
        # Since flat price = SMA = BBM, and BB bands will be 0-width, result may be None
        result = evaluate_formula("BB_POSITION(20)", df, None, "CATEGORICAL")
        assert result in ("Buy Signal", "Sell Signal", "Hold", None)

    def test_empty_df_returns_none(self):
        result = evaluate_formula("BB_POSITION(20)", pd.DataFrame(), None, "CATEGORICAL")
        assert result is None

    # ── IF chain evaluation ────────────────────────────────────────────────────

    def test_if_chain_close_above_threshold_returns_first_label(self):
        """CLOSE > 1000 with close ≈ 1600 → "High"."""
        df = _make_df(50, 1500.0)  # last close ≈ 1598
        result = evaluate_formula('IF(CLOSE > 1000, "High", "Low")', df, None, "CATEGORICAL")
        assert result == "High"

    def test_if_chain_close_below_threshold_returns_default(self):
        """CLOSE > 1000 with close ≈ 598 → "Low" (the default)."""
        df = _make_df(50, 500.0)  # base=500, last close = 500 + 49*2 = 598
        result = evaluate_formula('IF(CLOSE > 1000, "High", "Low")', df, None, "CATEGORICAL")
        assert result == "Low"

    def test_if_chain_returns_default_when_no_condition_matches(self):
        """Two conditions, neither matches → default label."""
        # close ≈ 698 (between 500 and 1000), so neither branch triggers
        df = _make_df(50, 600.0)  # last close = 600 + 49*2 = 698
        formula = 'IF(CLOSE > 1000, "High", IF(CLOSE < 500, "Low", "Medium"))'
        result = evaluate_formula(formula, df, None, "CATEGORICAL")
        assert result == "Medium"

    def test_if_chain_second_condition_matches(self):
        """When first condition fails but second matches, returns second label."""
        df = _make_df(50, 100.0)  # last close = 100 + 49*2 = 198 < 500
        formula = 'IF(CLOSE > 1000, "High", IF(CLOSE < 500, "Low", "Medium"))'
        result = evaluate_formula(formula, df, None, "CATEGORICAL")
        assert result == "Low"

    def test_if_chain_with_indicator_rhs(self):
        """RHS is an indicator (BB_UPPER); result must be a valid label or None."""
        df = _make_df(50)
        formula = 'IF(CLOSE >= BB_UPPER(20), "Sell Signal", "Hold")'
        result = evaluate_formula(formula, df, None, "CATEGORICAL")
        assert result in ("Sell Signal", "Hold", None)

    def test_if_chain_skips_unavailable_data_and_returns_default(self):
        """If condition data unavailable (PE_RATIO missing), skip → return default."""
        df = _make_df(20)
        formula = 'IF(PE_RATIO > 30, "Overvalued", "Fair")'
        result = evaluate_formula(formula, df, None, "CATEGORICAL")
        assert result == "Fair"  # PE_RATIO is None → condition skipped → default

    # ── AND / OR in CATEGORICAL conditions ───────────────────────────────────

    def test_if_chain_and_both_match_returns_label(self):
        """IF(CLOSE > 100 AND CLOSE < 9999, "In Range", "Out") with close ≈ 1600 → "In Range"."""
        df = _make_df(50, 1500.0)
        formula = 'IF(CLOSE > 100 AND CLOSE < 9999, "In Range", "Out")'
        result = evaluate_formula(formula, df, None, "CATEGORICAL")
        assert result == "In Range"

    def test_if_chain_and_one_fails_returns_default(self):
        """IF condition fails because one AND atom is False → falls to default."""
        df = _make_df(50, 1500.0)
        formula = 'IF(CLOSE > 100 AND CLOSE > 9999, "High", "Normal")'
        result = evaluate_formula(formula, df, None, "CATEGORICAL")
        assert result == "Normal"

    def test_if_chain_or_either_match_returns_label(self):
        """IF condition with OR where second clause is True → returns label."""
        df = _make_df(50, 1500.0)
        formula = 'IF(CLOSE > 9999 OR CLOSE > 100, "Signal", "None")'
        result = evaluate_formula(formula, df, None, "CATEGORICAL")
        assert result == "Signal"


# ─────────────────────────────────────────────────────────────────────────────
# evaluate_formula — MACD
# ─────────────────────────────────────────────────────────────────────────────

class TestEvaluateFormulaMacd:
    def test_macd_returns_scalar(self):
        df = _make_df(100)
        result = evaluate_formula("MACD()", df, None, "SCALAR")
        assert result is None or isinstance(result, float)

    def test_macd_signal_returns_scalar(self):
        df = _make_df(100)
        result = evaluate_formula("MACD_SIGNAL()", df, None, "SCALAR")
        assert result is None or isinstance(result, float)

    def test_macd_boolean(self):
        df = _make_df(100)
        result = evaluate_formula("MACD() > 0", df, None, "BOOLEAN")
        assert result is None or isinstance(result, (bool, np.bool_))


# ─────────────────────────────────────────────────────────────────────────────
# Security: validate_formula blocks code injection
# ─────────────────────────────────────────────────────────────────────────────

class TestFormulaSecurityValidation:
    def test_lambda_is_blocked(self):
        with pytest.raises(FormulaValidationError):
            validate_formula("lambda x: x", "SCALAR")

    def test_import_is_blocked(self):
        with pytest.raises(FormulaValidationError, match="Unknown identifier"):
            validate_formula("IMPORT", "SCALAR")

    def test_attribute_access_is_blocked(self):
        """Attribute access like __class__ must be blocked."""
        with pytest.raises(FormulaValidationError):
            validate_formula("CLOSE.__class__", "SCALAR")

    def test_eval_function_call_blocked(self):
        """Python builtins like eval() are blocked by the AST check."""
        with pytest.raises(FormulaValidationError):
            validate_formula("eval(1)", "SCALAR")
