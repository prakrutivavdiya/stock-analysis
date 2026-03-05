from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class LoginResponse(BaseModel):
    login_url: str


class CallbackUser(BaseModel):
    user_id: str
    name: str
    email: str


class CallbackResponse(BaseModel):
    user: CallbackUser
    expires_in: int


class RefreshResponse(BaseModel):
    expires_in: int


class LogoutResponse(BaseModel):
    message: str


class RevokeAllResponse(BaseModel):
    revoked_count: int


class MeResponse(BaseModel):
    user_id: str
    name: str
    email: str
    exchange_memberships: list[str]
    product_types: list[str]
    paper_trade_mode: bool
    kite_session_valid: bool
    kite_token_expires_at: datetime
    last_login_at: datetime | None
