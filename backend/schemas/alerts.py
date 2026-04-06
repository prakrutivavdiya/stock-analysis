"""
Pydantic v2 schemas for the alerts router.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator

from backend.models import ALERT_CONDITION_TYPES


class AlertCreate(BaseModel):
    tradingsymbol: str = Field(..., min_length=1, max_length=50)
    exchange: str = Field(..., min_length=1, max_length=10)
    instrument_token: int
    condition_type: str
    threshold: Decimal = Field(..., description="Price level or % value")
    note: str | None = Field(None, max_length=300)

    @field_validator("condition_type")
    @classmethod
    def validate_condition_type(cls, v: str) -> str:
        if v not in ALERT_CONDITION_TYPES:
            raise ValueError(f"condition_type must be one of {ALERT_CONDITION_TYPES}")
        return v

    @field_validator("exchange")
    @classmethod
    def upper_exchange(cls, v: str) -> str:
        return v.upper()

    @field_validator("tradingsymbol")
    @classmethod
    def upper_symbol(cls, v: str) -> str:
        return v.upper()


class AlertUpdate(BaseModel):
    """All fields optional — partial update."""
    condition_type: str | None = None
    threshold: Decimal | None = None
    note: str | None = None
    status: str | None = Field(None, description="ACTIVE | DISABLED")

    @field_validator("condition_type")
    @classmethod
    def validate_condition_type(cls, v: str | None) -> str | None:
        if v is not None and v not in ALERT_CONDITION_TYPES:
            raise ValueError(f"condition_type must be one of {ALERT_CONDITION_TYPES}")
        return v

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str | None) -> str | None:
        if v is not None and v not in ("ACTIVE", "DISABLED"):
            raise ValueError("status must be ACTIVE or DISABLED")
        return v


class AlertNotificationOut(BaseModel):
    id: uuid.UUID
    alert_id: uuid.UUID
    tradingsymbol: str
    exchange: str
    triggered_at: datetime
    trigger_price: Decimal | None
    message: str

    model_config = {"from_attributes": True}


class AlertOut(BaseModel):
    id: uuid.UUID
    tradingsymbol: str
    exchange: str
    instrument_token: int
    condition_type: str
    threshold: Decimal
    note: str | None
    status: str
    triggered_at: datetime | None
    created_at: datetime
    updated_at: datetime
    # Last notification for quick display
    last_notification: AlertNotificationOut | None = None

    model_config = {"from_attributes": True}


class AlertsListResponse(BaseModel):
    alerts: list[AlertOut]
    total: int


class AlertNotificationsListResponse(BaseModel):
    notifications: list[AlertNotificationOut]
    total: int
