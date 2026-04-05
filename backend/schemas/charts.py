from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, RootModel


class DrawingCreate(BaseModel):
    interval: str
    drawing_type: str      # hline | trendline | rectangle | text
    label: str | None = None
    drawing_data: dict[str, Any]


class DrawingUpdate(BaseModel):
    label: str | None = None
    drawing_data: dict[str, Any] | None = None


class DrawingOut(BaseModel):
    id: UUID
    drawing_type: str
    label: str | None
    drawing_data: dict[str, Any]
    created_at: datetime

    model_config = {"from_attributes": True}


class DrawingsResponse(BaseModel):
    instrument_token: int
    interval: str
    drawings: list[DrawingOut]


class CandleIn(BaseModel):
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


class ComputeRequest(BaseModel):
    indicators: list[str]
    candles: list[CandleIn]


class IndicatorPoint(BaseModel):
    timestamp: datetime
    value: float | None = None
    macd: float | None = None
    signal: float | None = None
    histogram: float | None = None
    upper: float | None = None
    middle: float | None = None
    lower: float | None = None


class IndicatorsResponse(RootModel[dict[str, list[dict[str, Any]]]]):
    """Keys are indicator names; values are lists of IndicatorPoint-like dicts."""
