from __future__ import annotations

from pydantic import BaseModel


class Holding(BaseModel):
    tradingsymbol: str
    exchange: str
    instrument_token: int
    quantity: int
    t1_quantity: int
    average_price: float
    last_price: float
    close_price: float
    pnl: float
    pnl_pct: float
    day_change: float
    day_change_pct: float
    current_value: float
    invested_value: float


class HoldingsSummary(BaseModel):
    total_invested: float
    total_current_value: float
    total_pnl: float
    total_pnl_pct: float
    total_day_change: float
    total_day_change_pct: float


class HoldingsResponse(BaseModel):
    holdings: list[Holding]
    summary: HoldingsSummary


class Position(BaseModel):
    tradingsymbol: str
    exchange: str
    product: str
    quantity: int
    average_price: float
    last_price: float
    pnl: float
    unrealised: float
    realised: float


class PositionsResponse(BaseModel):
    positions: list[Position]


class EquityMargin(BaseModel):
    available_cash: float
    opening_balance: float
    used_debits: float


class MarginsResponse(BaseModel):
    equity: EquityMargin


class PortfolioSummary(BaseModel):
    total_invested: float
    current_value: float
    total_pnl: float
    total_pnl_pct: float
    available_margin: float
    holdings_count: int
    profitable_count: int
    loss_count: int
    xirr: float | None
