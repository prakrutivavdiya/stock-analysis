from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class GTTOut(BaseModel):
    trigger_id: int
    tradingsymbol: str
    trigger_type: str
    trigger_value: float | None
    limit_price: float | None
    quantity: int | None
    transaction_type: str
    status: str


class GTTsResponse(BaseModel):
    gtts: list[GTTOut]


class GTTCreateRequest(BaseModel):
    tradingsymbol: str
    exchange: Literal["NSE", "BSE", "NFO", "BFO", "MCX"] = "NSE"
    transaction_type: Literal["BUY", "SELL"]
    product: Literal["CNC", "MIS", "NRML"]
    trigger_type: Literal["single", "two-leg"]
    last_price: float
    # Single-leg
    trigger_value: float | None = None
    limit_price: float | None = None
    quantity: int | None = None
    # Two-leg
    upper_trigger_value: float | None = None
    upper_limit_price: float | None = None
    upper_quantity: int | None = None
    lower_trigger_value: float | None = None
    lower_limit_price: float | None = None
    lower_quantity: int | None = None


class GTTCreateResponse(BaseModel):
    trigger_id: int
    audit_log_id: str


class GTTModifyRequest(BaseModel):
    tradingsymbol: str
    exchange: Literal["NSE", "BSE", "NFO", "BFO", "MCX"] = "NSE"
    transaction_type: Literal["BUY", "SELL"]
    product: Literal["CNC", "MIS", "NRML"]
    last_price: float
    trigger_type: Literal["single", "two-leg"]
    trigger_value: float | None = None
    limit_price: float | None = None
    quantity: int | None = None
    upper_trigger_value: float | None = None
    upper_limit_price: float | None = None
    upper_quantity: int | None = None
    lower_trigger_value: float | None = None
    lower_limit_price: float | None = None
    lower_quantity: int | None = None


class GTTModifyResponse(BaseModel):
    trigger_id: int
    status: str
