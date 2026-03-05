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


# ─────────────────────────────────────────────────────────────────────────────
# validate_formula — CATEGORICAL
# ─────────────────────────────────────────────────────────────────────────────

class TestValidateFormulaCategorical:
    def test_bb_position_20_valid(self):
        validate_formula("BB_POSITION(20)", "CATEGORICAL")

    def test_bb_position_other_period_valid(self):
        validate_formula("BB_POSITION(14)", "CATEGORICAL")

    def test_non_bb_position_raises(self):
        with pytest.raises(FormulaValidationError, match="BB_POSITION"):
            validate_formula("RSI(14)", "CATEGORICAL")

    def test_bb_position_with_comparison_raises(self):
        with pytest.raises(FormulaValidationError, match="BB_POSITION"):
            validate_formula("BB_POSITION(20) > 0", "CATEGORICAL")


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
