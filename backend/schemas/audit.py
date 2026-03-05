from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class AuditLogOut(BaseModel):
    id: UUID
    action_type: str
    tradingsymbol: str
    exchange: str
    order_params: dict[str, Any]
    kite_order_id: str | None
    kite_gtt_id: int | None
    outcome: str
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AuditResponse(BaseModel):
    total: int
    logs: list[AuditLogOut]
