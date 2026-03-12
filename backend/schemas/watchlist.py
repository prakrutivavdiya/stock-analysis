"""Pydantic v2 schemas for watchlist endpoints."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class WatchlistCreate(BaseModel):
    name: str = Field(..., max_length=100)


class WatchlistRename(BaseModel):
    name: str = Field(..., max_length=100)


class WatchlistItemAdd(BaseModel):
    instrument_token: int
    tradingsymbol: str
    exchange: str


class ReorderRequest(BaseModel):
    item_ids: list[uuid.UUID]


class WatchlistItemOut(BaseModel):
    id: uuid.UUID
    watchlist_id: uuid.UUID
    instrument_token: int
    tradingsymbol: str
    exchange: str
    display_order: int
    created_at: datetime

    model_config = {"from_attributes": True}


class WatchlistOut(BaseModel):
    id: uuid.UUID
    name: str
    display_order: int
    created_at: datetime
    items: list[WatchlistItemOut] = []

    model_config = {"from_attributes": True}


class WatchlistsResponse(BaseModel):
    watchlists: list[WatchlistOut]
