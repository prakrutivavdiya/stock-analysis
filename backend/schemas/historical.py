from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class Candle(BaseModel):
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int


class HistoricalResponse(BaseModel):
    instrument_token: int
    tradingsymbol: str
    interval: str
    from_date: str
    to_date: str
    candles: list[Candle]
    source: str  # "cache" | "kite"


class BulkHistoricalRequest(BaseModel):
    instrument_tokens: list[int]
    interval: str = "day"
    date: str  # YYYY-MM-DD


class CandleOHLC(BaseModel):
    open: float
    high: float
    low: float
    close: float
    volume: int


class BulkHistoricalResponse(BaseModel):
    date: str
    results: dict[str, CandleOHLC]
    errors: dict[str, str]


class CacheStatusResponse(BaseModel):
    cached_instruments: int
    total_candles: int
    oldest: str | None
    newest: str | None


class CacheDeleteResponse(BaseModel):
    deleted_rows: int
