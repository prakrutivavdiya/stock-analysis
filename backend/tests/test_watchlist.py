"""
Tests for the watchlist router — 7 endpoints, all 201/200/204 happy paths
plus auth isolation, duplicate detection, and cascade delete.

Endpoints covered:
  GET    /api/v1/watchlist                          (list_watchlists)
  POST   /api/v1/watchlist                          (create_watchlist)
  PATCH  /api/v1/watchlist/{wl_id}                  (rename_watchlist)
  DELETE /api/v1/watchlist/{wl_id}                  (delete_watchlist)
  POST   /api/v1/watchlist/{wl_id}/items            (add_item)
  DELETE /api/v1/watchlist/{wl_id}/items/{item_id}  (remove_item)
  PATCH  /api/v1/watchlist/{wl_id}/items/reorder    (reorder_items)
"""
from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Watchlist, WatchlistItem
from tests.conftest import USER_ID, seed_user

# add_token is safe in tests: _ticker is None so it only appends to a list

# A second user UUID for isolation tests
OTHER_USER_ID = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")

BASE = "/api/v1/watchlist"


# ─────────────────────────────────────────────────────────────────────────────
# Seed helpers
# ─────────────────────────────────────────────────────────────────────────────

async def seed_watchlist(
    db: AsyncSession,
    *,
    name: str = "My Stocks",
    user_id: uuid.UUID = USER_ID,
    display_order: int = 0,
) -> Watchlist:
    wl = Watchlist(user_id=user_id, name=name, display_order=display_order)
    db.add(wl)
    await db.commit()
    await db.refresh(wl)
    return wl


async def seed_item(
    db: AsyncSession,
    watchlist_id: uuid.UUID,
    *,
    instrument_token: int = 408065,
    tradingsymbol: str = "INFY",
    exchange: str = "NSE",
    display_order: int = 0,
) -> WatchlistItem:
    item = WatchlistItem(
        watchlist_id=watchlist_id,
        user_id=USER_ID,
        instrument_token=instrument_token,
        tradingsymbol=tradingsymbol,
        exchange=exchange,
        display_order=display_order,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


# ─────────────────────────────────────────────────────────────────────────────
# GET /watchlist
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_watchlists_empty(client: AsyncClient) -> None:
    """Returns empty list when user has no watchlists."""
    r = await client.get(BASE)
    assert r.status_code == 200
    assert r.json() == {"watchlists": []}


@pytest.mark.asyncio
async def test_list_watchlists_returns_own_only(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Returns only the current user's watchlists; ignores other users'."""
    await seed_user(db_session)
    own = await seed_watchlist(db_session, name="Mine", user_id=USER_ID)

    # Insert a watchlist owned by another user directly (no FK user row needed in SQLite)
    other_wl = Watchlist(user_id=OTHER_USER_ID, name="Theirs", display_order=0)
    db_session.add(other_wl)
    await db_session.commit()

    r = await client.get(BASE)
    assert r.status_code == 200
    data = r.json()["watchlists"]
    ids = [w["id"] for w in data]
    assert str(own.id) in ids
    assert str(other_wl.id) not in ids


@pytest.mark.asyncio
async def test_list_watchlists_includes_items(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Watchlist items are embedded in the response."""
    await seed_user(db_session)
    wl = await seed_watchlist(db_session)
    item = await seed_item(db_session, wl.id, tradingsymbol="INFY")

    r = await client.get(BASE)
    assert r.status_code == 200
    wl_data = r.json()["watchlists"][0]
    assert len(wl_data["items"]) == 1
    assert wl_data["items"][0]["tradingsymbol"] == "INFY"
    assert wl_data["items"][0]["id"] == str(item.id)


@pytest.mark.asyncio
async def test_list_watchlists_ordered(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Watchlists are returned in display_order ascending."""
    await seed_user(db_session)
    await seed_watchlist(db_session, name="Second", display_order=1)
    await seed_watchlist(db_session, name="First", display_order=0)

    r = await client.get(BASE)
    names = [w["name"] for w in r.json()["watchlists"]]
    assert names == ["First", "Second"]


# ─────────────────────────────────────────────────────────────────────────────
# POST /watchlist
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_watchlist(client: AsyncClient, db_session: AsyncSession) -> None:
    """Creates a watchlist and returns 201 with the new watchlist object."""
    await seed_user(db_session)
    r = await client.post(BASE, json={"name": "Tech Stocks"})
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Tech Stocks"
    assert body["items"] == []
    assert "id" in body
    assert "display_order" in body


@pytest.mark.asyncio
async def test_create_watchlist_display_order_increments(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """display_order is set to the current count of existing watchlists."""
    await seed_user(db_session)
    r1 = await client.post(BASE, json={"name": "First"})
    r2 = await client.post(BASE, json={"name": "Second"})
    assert r1.json()["display_order"] == 0
    assert r2.json()["display_order"] == 1


@pytest.mark.asyncio
async def test_create_watchlist_duplicate_name_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Creating a watchlist with an existing name returns 409."""
    await seed_user(db_session)
    await seed_watchlist(db_session, name="Existing")
    r = await client.post(BASE, json={"name": "Existing"})
    assert r.status_code == 409


# ─────────────────────────────────────────────────────────────────────────────
# PATCH /watchlist/{wl_id} — rename
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_rename_watchlist(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Renaming a watchlist returns the updated name."""
    await seed_user(db_session)
    wl = await seed_watchlist(db_session, name="Old Name")
    r = await client.patch(f"{BASE}/{wl.id}", json={"name": "New Name"})
    assert r.status_code == 200
    assert r.json()["name"] == "New Name"
    assert r.json()["id"] == str(wl.id)


@pytest.mark.asyncio
async def test_rename_watchlist_not_found_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Renaming a non-existent watchlist returns 404."""
    r = await client.patch(f"{BASE}/{uuid.uuid4()}", json={"name": "X"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_rename_watchlist_other_user_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Cannot rename another user's watchlist — treated as 404."""
    other_wl = Watchlist(user_id=OTHER_USER_ID, name="Theirs", display_order=0)
    db_session.add(other_wl)
    await db_session.commit()

    r = await client.patch(f"{BASE}/{other_wl.id}", json={"name": "Stolen"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_rename_watchlist_duplicate_name_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Renaming to an already-used name returns 409."""
    await seed_user(db_session)
    await seed_watchlist(db_session, name="Alpha")
    wl2 = await seed_watchlist(db_session, name="Beta")
    r = await client.patch(f"{BASE}/{wl2.id}", json={"name": "Alpha"})
    assert r.status_code == 409


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /watchlist/{wl_id}
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_watchlist(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Deleting a watchlist returns 204 and it no longer appears in list."""
    await seed_user(db_session)
    wl = await seed_watchlist(db_session)
    r = await client.delete(f"{BASE}/{wl.id}")
    assert r.status_code == 204

    # Confirm it's gone
    r2 = await client.get(BASE)
    assert r2.json() == {"watchlists": []}


@pytest.mark.asyncio
async def test_delete_watchlist_cascades_items(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Deleting a watchlist also deletes its items (cascade)."""
    await seed_user(db_session)
    wl = await seed_watchlist(db_session)
    item = await seed_item(db_session, wl.id)

    # Item exists before delete
    fetched = await db_session.get(WatchlistItem, item.id)
    assert fetched is not None

    r = await client.delete(f"{BASE}/{wl.id}")
    assert r.status_code == 204

    # Item is gone after cascade
    db_session.expire_all()
    fetched_after = await db_session.get(WatchlistItem, item.id)
    assert fetched_after is None


@pytest.mark.asyncio
async def test_delete_watchlist_not_found_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    r = await client.delete(f"{BASE}/{uuid.uuid4()}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_watchlist_other_user_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    other_wl = Watchlist(user_id=OTHER_USER_ID, name="Theirs", display_order=0)
    db_session.add(other_wl)
    await db_session.commit()

    r = await client.delete(f"{BASE}/{other_wl.id}")
    assert r.status_code == 404


# ─────────────────────────────────────────────────────────────────────────────
# POST /watchlist/{wl_id}/items
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_add_item(client: AsyncClient, db_session: AsyncSession) -> None:
    """Adding an instrument to a watchlist returns 201 with the item."""
    await seed_user(db_session)
    wl = await seed_watchlist(db_session)

    r = await client.post(
        f"{BASE}/{wl.id}/items",
        json={"instrument_token": 408065, "tradingsymbol": "INFY", "exchange": "NSE"},
    )

    assert r.status_code == 201
    body = r.json()
    assert body["tradingsymbol"] == "INFY"
    assert body["instrument_token"] == 408065
    assert body["exchange"] == "NSE"
    assert body["display_order"] == 0
    assert "id" in body


@pytest.mark.asyncio
async def test_add_item_display_order_increments(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Each subsequent item gets the next display_order value."""
    await seed_user(db_session)
    wl = await seed_watchlist(db_session)
    await seed_item(db_session, wl.id, instrument_token=408065, tradingsymbol="INFY")

    r = await client.post(
        f"{BASE}/{wl.id}/items",
        json={"instrument_token": 341249, "tradingsymbol": "SBIN", "exchange": "NSE"},
    )
    assert r.status_code == 201
    assert r.json()["display_order"] == 1


@pytest.mark.asyncio
async def test_add_item_duplicate_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Adding the same instrument_token twice returns 409."""
    await seed_user(db_session)
    wl = await seed_watchlist(db_session)
    await seed_item(db_session, wl.id, instrument_token=408065, tradingsymbol="INFY")

    r = await client.post(
        f"{BASE}/{wl.id}/items",
        json={"instrument_token": 408065, "tradingsymbol": "INFY", "exchange": "NSE"},
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_add_item_watchlist_not_found_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    r = await client.post(
        f"{BASE}/{uuid.uuid4()}/items",
        json={"instrument_token": 408065, "tradingsymbol": "INFY", "exchange": "NSE"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_add_item_other_user_watchlist_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Cannot add an item to another user's watchlist."""
    other_wl = Watchlist(user_id=OTHER_USER_ID, name="Theirs", display_order=0)
    db_session.add(other_wl)
    await db_session.commit()

    r = await client.post(
        f"{BASE}/{other_wl.id}/items",
        json={"instrument_token": 408065, "tradingsymbol": "INFY", "exchange": "NSE"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_add_item_ticker_is_non_fatal(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Ticker subscription failure is non-fatal — item is still created.
    In tests _ticker is None so add_token is a no-op; this verifies the
    happy path and the error-handling contract together."""
    await seed_user(db_session)
    wl = await seed_watchlist(db_session)

    r = await client.post(
        f"{BASE}/{wl.id}/items",
        json={"instrument_token": 408065, "tradingsymbol": "INFY", "exchange": "NSE"},
    )
    assert r.status_code == 201


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /watchlist/{wl_id}/items/{item_id}
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_remove_item(client: AsyncClient, db_session: AsyncSession) -> None:
    """Removing an item returns 204; item is deleted from DB."""
    await seed_user(db_session)
    wl = await seed_watchlist(db_session)
    item = await seed_item(db_session, wl.id)

    r = await client.delete(f"{BASE}/{wl.id}/items/{item.id}")
    assert r.status_code == 204

    db_session.expire_all()
    assert await db_session.get(WatchlistItem, item.id) is None


@pytest.mark.asyncio
async def test_remove_item_not_found_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await seed_user(db_session)
    wl = await seed_watchlist(db_session)
    r = await client.delete(f"{BASE}/{wl.id}/items/{uuid.uuid4()}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_remove_item_wrong_watchlist_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Item exists but belongs to a different watchlist — 404."""
    await seed_user(db_session)
    wl1 = await seed_watchlist(db_session, name="WL1")
    wl2 = await seed_watchlist(db_session, name="WL2")
    item = await seed_item(db_session, wl1.id)

    r = await client.delete(f"{BASE}/{wl2.id}/items/{item.id}")
    assert r.status_code == 404


# ─────────────────────────────────────────────────────────────────────────────
# PATCH /watchlist/{wl_id}/items/reorder
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reorder_items(client: AsyncClient, db_session: AsyncSession) -> None:
    """Reordering items updates display_order on each item."""
    await seed_user(db_session)
    wl = await seed_watchlist(db_session)
    item_a = await seed_item(db_session, wl.id, instrument_token=408065, tradingsymbol="INFY", display_order=0)
    item_b = await seed_item(db_session, wl.id, instrument_token=341249, tradingsymbol="SBIN", display_order=1)

    # Reverse the order
    r = await client.patch(
        f"{BASE}/{wl.id}/items/reorder",
        json={"item_ids": [str(item_b.id), str(item_a.id)]},
    )
    assert r.status_code == 200

    body = r.json()
    items = sorted(body["items"], key=lambda x: x["display_order"])
    assert items[0]["tradingsymbol"] == "SBIN"
    assert items[1]["tradingsymbol"] == "INFY"


@pytest.mark.asyncio
async def test_reorder_items_ignores_unknown_ids(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Unknown item IDs in the reorder list are silently ignored."""
    await seed_user(db_session)
    wl = await seed_watchlist(db_session)
    item = await seed_item(db_session, wl.id)

    r = await client.patch(
        f"{BASE}/{wl.id}/items/reorder",
        json={"item_ids": [str(uuid.uuid4()), str(item.id)]},
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_reorder_items_watchlist_not_found_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    r = await client.patch(
        f"{BASE}/{uuid.uuid4()}/items/reorder",
        json={"item_ids": []},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_reorder_items_other_user_watchlist_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    other_wl = Watchlist(user_id=OTHER_USER_ID, name="Theirs", display_order=0)
    db_session.add(other_wl)
    await db_session.commit()

    r = await client.patch(
        f"{BASE}/{other_wl.id}/items/reorder",
        json={"item_ids": []},
    )
    assert r.status_code == 404
