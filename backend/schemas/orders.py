from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class OrderOut(BaseModel):
    order_id: str
    tradingsymbol: str
    exchange: str
    transaction_type: str
    product: str
    order_type: str
    variety: str
    quantity: int
    price: float | None
    trigger_price: float | None
    validity: str
    status: str
    filled_quantity: int
    average_price: float | None
    placed_at: datetime


class OrdersResponse(BaseModel):
    orders: list[OrderOut]


class PlaceOrderRequest(BaseModel):
    tradingsymbol: str
    exchange: Literal["NSE", "BSE", "NFO", "BFO", "MCX"] = "NSE"
    transaction_type: Literal["BUY", "SELL"]
    product: Literal["CNC", "MIS", "NRML"]
    order_type: Literal["MARKET", "LIMIT", "SL", "SL-M"]
    quantity: int
    price: float | None = None
    trigger_price: float | None = None
    variety: Literal["regular", "co", "amo", "iceberg", "auction", "bo"] = "regular"
    validity: Literal["DAY", "IOC", "TTL"] = "DAY"
    validity_ttl: int | None = None
    paper_trade: bool | None = None
    # Bracket order fields (variety="bo" only)
    squareoff: float | None = None
    stoploss: float | None = None
    trailing_stoploss: float | None = None


class PlaceOrderResponse(BaseModel):
    order_id: str
    audit_log_id: str
    paper_trade: bool


class ModifyOrderRequest(BaseModel):
    variety: Literal["regular", "co", "amo", "iceberg", "auction"] = "regular"
    order_type: Literal["MARKET", "LIMIT", "SL", "SL-M"]
    quantity: int | None = None
    price: float | None = None
    trigger_price: float | None = None


class ModifyOrderResponse(BaseModel):
    order_id: str
    status: str


class CancelOrderResponse(BaseModel):
    order_id: str
    status: str


class OrderHistoryResponse(BaseModel):
    order_id: str
    history: list[dict]


class CDSLAuthUrlResponse(BaseModel):
    auth_url: str
    isin: str
    qty: int
    exchange: str


# ── KITE-MARGIN-REQ: pre-order SPAN + exposure margin ────────────────────────

class OrderMarginItem(BaseModel):
    """Single order in a basket for Kite margin calculation."""
    exchange: Literal["NSE", "BSE", "NFO", "BFO", "MCX"]
    tradingsymbol: str
    transaction_type: Literal["BUY", "SELL"]
    variety: Literal["regular", "co", "amo", "iceberg", "bo"] = "regular"
    product: Literal["CNC", "MIS", "NRML"]
    order_type: Literal["MARKET", "LIMIT", "SL", "SL-M"]
    quantity: int
    price: float = 0
    trigger_price: float = 0


class OrderMarginsRequest(BaseModel):
    orders: list[OrderMarginItem]


class OrderMarginResult(BaseModel):
    span: float = 0
    exposure: float = 0
    option_premium: float = 0
    additional: float = 0
    bo: float = 0
    cash: float = 0
    var: float = 0
    total: float = 0


class OrderMarginsResponse(BaseModel):
    equity: OrderMarginResult
    commodity: OrderMarginResult
