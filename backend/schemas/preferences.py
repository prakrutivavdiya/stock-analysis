"""Pydantic schemas for user UI preferences (PD-09)."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class HoldingsSortPreference(BaseModel):
    column: str = Field(default="symbol", description="Column to sort by")
    direction: Literal["asc", "desc"] = Field(default="asc")


class ChartPreferences(BaseModel):
    interval: str = Field(default="D", description="Active chart interval e.g. D, 5, 15, 60, W, M")
    chart_type: str = Field(default="candle", description="candle | bar | line | area")
    active_indicators: list[str] = Field(
        default_factory=list,
        description="Ordered list of active indicator keys e.g. ['RSI_14', 'EMA_20']",
    )


class UIPreferences(BaseModel):
    visible_holdings_columns: list[str] = Field(
        default_factory=list,
        description="List of visible column IDs in the holdings table",
    )
    holdings_sort: HoldingsSortPreference = Field(
        default_factory=HoldingsSortPreference,
        description="Sort preference for the holdings table",
    )
    chart_prefs: ChartPreferences = Field(
        default_factory=ChartPreferences,
        description="Global chart preferences: interval, chart type, active indicators",
    )


class UIPreferencesResponse(BaseModel):
    preferences: UIPreferences


class ChartPreferencesResponse(BaseModel):
    chart_prefs: ChartPreferences
