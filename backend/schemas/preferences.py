"""Pydantic schemas for user UI preferences (PD-09)."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class HoldingsSortPreference(BaseModel):
    column: str = Field(default="symbol", description="Column to sort by")
    direction: Literal["asc", "desc"] = Field(default="asc")


class UIPreferences(BaseModel):
    visible_holdings_columns: list[str] = Field(
        default_factory=list,
        description="List of visible column IDs in the holdings table",
    )
    holdings_sort: HoldingsSortPreference = Field(
        default_factory=HoldingsSortPreference,
        description="Sort preference for the holdings table",
    )


class UIPreferencesResponse(BaseModel):
    preferences: UIPreferences
