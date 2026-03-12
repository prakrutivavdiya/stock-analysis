"""
Watchlist router — 7 endpoints

  GET    /watchlist                        → list all watchlists with items
  POST   /watchlist                        → create watchlist
  PATCH  /watchlist/{wl_id}               → rename watchlist
  DELETE /watchlist/{wl_id}               → delete watchlist + items
  POST   /watchlist/{wl_id}/items         → add instrument
  DELETE /watchlist/{wl_id}/items/{item_id} → remove instrument
  PATCH  /watchlist/{wl_id}/items/reorder → reorder items
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from backend.deps import CurrentUser, DBSession
from backend.models import Watchlist, WatchlistItem
from backend.schemas.watchlist import (
    ReorderRequest,
    WatchlistCreate,
    WatchlistItemAdd,
    WatchlistItemOut,
    WatchlistOut,
    WatchlistRename,
    WatchlistsResponse,
)

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# GET /watchlist — list all watchlists with items
# ─────────────────────────────────────────────────────────────────────────────

@router.get("", response_model=WatchlistsResponse)
async def list_watchlists(current_user: CurrentUser, db: DBSession) -> WatchlistsResponse:
    rows = (await db.execute(
        select(Watchlist)
        .where(Watchlist.user_id == current_user.id)
        .options(selectinload(Watchlist.items))
        .order_by(Watchlist.display_order, Watchlist.created_at)
    )).scalars().all()
    return WatchlistsResponse(watchlists=[WatchlistOut.model_validate(r) for r in rows])


# ─────────────────────────────────────────────────────────────────────────────
# POST /watchlist — create watchlist
# ─────────────────────────────────────────────────────────────────────────────

@router.post("", response_model=WatchlistOut, status_code=201)
async def create_watchlist(
    body: WatchlistCreate,
    current_user: CurrentUser,
    db: DBSession,
) -> WatchlistOut:
    # Count existing to set display_order
    count = (await db.execute(
        select(Watchlist).where(Watchlist.user_id == current_user.id)
    )).scalars().all()
    wl = Watchlist(
        user_id=current_user.id,
        name=body.name,
        display_order=len(count),
    )
    db.add(wl)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=409, detail="A watchlist with that name already exists")
    wl = (await db.execute(
        select(Watchlist).where(Watchlist.id == wl.id).options(selectinload(Watchlist.items))
    )).scalar_one()
    return WatchlistOut.model_validate(wl)


# ─────────────────────────────────────────────────────────────────────────────
# PATCH /watchlist/{wl_id} — rename
# ─────────────────────────────────────────────────────────────────────────────

@router.patch("/{wl_id}", response_model=WatchlistOut)
async def rename_watchlist(
    wl_id: uuid.UUID,
    body: WatchlistRename,
    current_user: CurrentUser,
    db: DBSession,
) -> WatchlistOut:
    wl = await db.get(Watchlist, wl_id)
    if wl is None or wl.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    wl.name = body.name
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=409, detail="A watchlist with that name already exists")
    wl = (await db.execute(
        select(Watchlist).where(Watchlist.id == wl_id).options(selectinload(Watchlist.items))
    )).scalar_one()
    return WatchlistOut.model_validate(wl)


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /watchlist/{wl_id} — delete watchlist + all items
# ─────────────────────────────────────────────────────────────────────────────

@router.delete("/{wl_id}", status_code=204)
async def delete_watchlist(
    wl_id: uuid.UUID,
    current_user: CurrentUser,
    db: DBSession,
) -> None:
    wl = await db.get(Watchlist, wl_id)
    if wl is None or wl.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    await db.delete(wl)
    await db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# POST /watchlist/{wl_id}/items — add instrument
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/{wl_id}/items", response_model=WatchlistItemOut, status_code=201)
async def add_item(
    wl_id: uuid.UUID,
    body: WatchlistItemAdd,
    current_user: CurrentUser,
    db: DBSession,
) -> WatchlistItemOut:
    wl = await db.get(Watchlist, wl_id)
    if wl is None or wl.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Watchlist not found")

    # Check duplicate
    existing = (await db.execute(
        select(WatchlistItem).where(
            WatchlistItem.watchlist_id == wl_id,
            WatchlistItem.instrument_token == body.instrument_token,
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Instrument already in watchlist")

    # Count existing items for display_order
    items_count = len((await db.execute(
        select(WatchlistItem).where(WatchlistItem.watchlist_id == wl_id)
    )).scalars().all())

    item = WatchlistItem(
        watchlist_id=wl_id,
        user_id=current_user.id,
        instrument_token=body.instrument_token,
        tradingsymbol=body.tradingsymbol,
        exchange=body.exchange,
        display_order=items_count,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)

    # Subscribe the new token to the live ticker
    try:
        from backend.ticker import add_token
        add_token(body.instrument_token)
    except Exception:
        pass  # Non-fatal — ticker may not be running

    return WatchlistItemOut.model_validate(item)


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /watchlist/{wl_id}/items/{item_id} — remove instrument
# ─────────────────────────────────────────────────────────────────────────────

@router.delete("/{wl_id}/items/{item_id}", status_code=204)
async def remove_item(
    wl_id: uuid.UUID,
    item_id: uuid.UUID,
    current_user: CurrentUser,
    db: DBSession,
) -> None:
    item = await db.get(WatchlistItem, item_id)
    if item is None or item.watchlist_id != wl_id or item.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.delete(item)
    await db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# PATCH /watchlist/{wl_id}/items/reorder — update display_order
# ─────────────────────────────────────────────────────────────────────────────

@router.patch("/{wl_id}/items/reorder", response_model=WatchlistOut)
async def reorder_items(
    wl_id: uuid.UUID,
    body: ReorderRequest,
    current_user: CurrentUser,
    db: DBSession,
) -> WatchlistOut:
    wl = await db.get(Watchlist, wl_id)
    if wl is None or wl.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Watchlist not found")

    for idx, item_id in enumerate(body.item_ids):
        item = await db.get(WatchlistItem, item_id)
        if item and item.watchlist_id == wl_id:
            item.display_order = idx

    await db.commit()
    wl = (await db.execute(
        select(Watchlist).where(Watchlist.id == wl_id).options(selectinload(Watchlist.items))
    )).scalar_one()
    return WatchlistOut.model_validate(wl)
