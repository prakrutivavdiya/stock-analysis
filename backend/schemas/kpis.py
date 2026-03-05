from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class KPICreate(BaseModel):
    name: str = Field(..., max_length=100)
    formula: str
    return_type: Literal["SCALAR", "BOOLEAN", "CATEGORICAL"]
    description: str | None = None


class KPIUpdate(BaseModel):
    name: str | None = Field(None, max_length=100)
    formula: str | None = None
    return_type: Literal["SCALAR", "BOOLEAN", "CATEGORICAL"] | None = None
    description: str | None = None
    is_active: bool | None = None
    display_order: int | None = None


class KPIOut(BaseModel):
    id: UUID
    name: str
    formula: str
    return_type: str
    description: str | None
    is_active: bool
    display_order: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class KPIsListResponse(BaseModel):
    kpis: list[KPIOut]


class KPIComputeRequest(BaseModel):
    instrument_tokens: list[int]
    as_of_date: str       # YYYY-MM-DD
    interval: str = "day"


class KPIComputeResult(BaseModel):
    value: Any
    return_type: str


class KPIComputeResponse(BaseModel):
    kpi_id: UUID
    as_of_date: str
    using_live_price: bool
    results: dict[str, KPIComputeResult]


class PortfolioKPIRow(BaseModel):
    tradingsymbol: str
    instrument_token: int
    kpi_values: dict[str, dict[str, Any]]


class KPIPortfolioResponse(BaseModel):
    as_of_date: str
    kpis: list[dict[str, Any]]
    results: list[PortfolioKPIRow]
