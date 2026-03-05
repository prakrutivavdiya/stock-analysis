from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class FundamentalsResponse(BaseModel):
    instrument_token: int
    tradingsymbol: str
    pe_ratio: float | None
    eps: float | None
    book_value: float | None
    face_value: float | None
    week_52_high: float | None
    week_52_low: float | None
    fetched_at: datetime
    data_date: str | None
    staleness_warning: bool


class FundamentalsRefreshResponse(BaseModel):
    refreshed: int
    failed: list[str]
    completed_at: datetime
