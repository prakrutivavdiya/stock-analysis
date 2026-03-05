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
    variety: Literal["regular", "co", "amo", "iceberg", "auction"] = "regular"
    validity: Literal["DAY", "IOC", "TTL"] = "DAY"
    validity_ttl: int | None = None
    paper_trade: bool | None = None


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
