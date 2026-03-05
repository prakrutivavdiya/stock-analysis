from __future__ import annotations

from pydantic import BaseModel


class InstrumentResult(BaseModel):
    instrument_token: int
    tradingsymbol: str
    name: str
    exchange: str
    instrument_type: str


class InstrumentSearchResponse(BaseModel):
    results: list[InstrumentResult]


class InstrumentDetail(BaseModel):
    instrument_token: int
    tradingsymbol: str
    name: str
    exchange: str
    isin: str | None
    lot_size: int
    tick_size: float
