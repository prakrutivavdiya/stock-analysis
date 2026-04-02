"""Tests for GET/PUT /user/preferences (PD-09)."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


# --- GET /user/preferences ---

@pytest.mark.asyncio
async def test_get_preferences_defaults(client: AsyncClient, mock_user):
    """Returns default prefs when ui_preferences is None."""
    mock_user.ui_preferences = None
    resp = await client.get("/api/v1/user/preferences")
    assert resp.status_code == 200
    data = resp.json()
    assert "preferences" in data
    prefs = data["preferences"]
    assert prefs["visible_holdings_columns"] == []
    assert prefs["holdings_sort"]["column"] == "symbol"
    assert prefs["holdings_sort"]["direction"] == "asc"


@pytest.mark.asyncio
async def test_get_preferences_empty_dict(client: AsyncClient, mock_user):
    """Returns defaults when ui_preferences is {}."""
    mock_user.ui_preferences = {}
    resp = await client.get("/api/v1/user/preferences")
    assert resp.status_code == 200
    prefs = resp.json()["preferences"]
    assert prefs["visible_holdings_columns"] == []


@pytest.mark.asyncio
async def test_get_preferences_saved_values(client: AsyncClient, mock_user):
    """Returns saved preferences."""
    mock_user.ui_preferences = {
        "visible_holdings_columns": ["ltp", "pnl", "quantity"],
        "holdings_sort": {"column": "ltp", "direction": "desc"},
    }
    resp = await client.get("/api/v1/user/preferences")
    assert resp.status_code == 200
    prefs = resp.json()["preferences"]
    assert prefs["visible_holdings_columns"] == ["ltp", "pnl", "quantity"]
    assert prefs["holdings_sort"]["column"] == "ltp"
    assert prefs["holdings_sort"]["direction"] == "desc"


# --- PUT /user/preferences ---
# The preferences router calls db.refresh(current_user) after commit.
# Since mock_user is a MagicMock (not an ORM-mapped instance), we patch
# db.refresh with a no-op AsyncMock to avoid the UnmappedInstanceError.

@pytest.mark.asyncio
async def test_put_preferences_saves(client: AsyncClient, mock_user, db_session):
    """PUT /user/preferences overwrites and returns the new prefs."""
    mock_user.ui_preferences = {}
    payload = {
        "visible_holdings_columns": ["quantity", "avgPrice"],
        "holdings_sort": {"column": "avgPrice", "direction": "asc"},
    }
    with patch.object(db_session, "refresh", new_callable=AsyncMock), \
         patch("backend.routers.preferences.flag_modified"):
        resp = await client.put("/api/v1/user/preferences", json=payload)
    assert resp.status_code == 200
    prefs = resp.json()["preferences"]
    assert prefs["visible_holdings_columns"] == ["quantity", "avgPrice"]
    assert prefs["holdings_sort"]["column"] == "avgPrice"


@pytest.mark.asyncio
async def test_put_preferences_partial(client: AsyncClient, mock_user, db_session):
    """PUT with only visible_holdings_columns — sort defaults used."""
    mock_user.ui_preferences = {}
    payload = {"visible_holdings_columns": ["ltp"]}
    with patch.object(db_session, "refresh", new_callable=AsyncMock), \
         patch("backend.routers.preferences.flag_modified"):
        resp = await client.put("/api/v1/user/preferences", json=payload)
    assert resp.status_code == 200
    prefs = resp.json()["preferences"]
    assert prefs["visible_holdings_columns"] == ["ltp"]
    assert prefs["holdings_sort"]["column"] == "symbol"  # default


@pytest.mark.asyncio
async def test_put_preferences_empty(client: AsyncClient, mock_user, db_session):
    """PUT with {} resets to defaults."""
    mock_user.ui_preferences = {"visible_holdings_columns": ["ltp"]}
    with patch.object(db_session, "refresh", new_callable=AsyncMock), \
         patch("backend.routers.preferences.flag_modified"):
        resp = await client.put("/api/v1/user/preferences", json={})
    assert resp.status_code == 200
    prefs = resp.json()["preferences"]
    assert prefs["visible_holdings_columns"] == []


@pytest.mark.asyncio
async def test_get_preferences_route_accessible(client: AsyncClient, mock_user):
    """Route is accessible when mock auth is in place (200 returned)."""
    mock_user.ui_preferences = None  # ensure clean state — no MagicMock child
    resp = await client.get("/api/v1/user/preferences")
    assert resp.status_code == 200


# --- GET /user/columns ---

@pytest.mark.asyncio
async def test_get_columns_returns_list(client: AsyncClient, mock_user):
    """Returns the full list of standard column definitions."""
    resp = await client.get("/api/v1/user/columns")
    assert resp.status_code == 200
    data = resp.json()
    assert "columns" in data
    assert len(data["columns"]) == 11


@pytest.mark.asyncio
async def test_get_columns_schema(client: AsyncClient, mock_user):
    """Each column definition has all required fields with correct types."""
    resp = await client.get("/api/v1/user/columns")
    for col in resp.json()["columns"]:
        assert isinstance(col["id"], str)
        assert isinstance(col["label"], str)
        assert col["align"] in ("left", "right")
        assert isinstance(col["default_visible"], bool)
        assert col["filter_type"] in ("text", "range", "boolean", "categorical")


@pytest.mark.asyncio
async def test_get_columns_default_visible_count(client: AsyncClient, mock_user):
    """Exactly 8 columns are default_visible=True."""
    resp = await client.get("/api/v1/user/columns")
    defaults = [c for c in resp.json()["columns"] if c["default_visible"]]
    assert len(defaults) == 8


@pytest.mark.asyncio
async def test_get_columns_ids_are_unique(client: AsyncClient, mock_user):
    """All column IDs are unique."""
    resp = await client.get("/api/v1/user/columns")
    ids = [c["id"] for c in resp.json()["columns"]]
    assert len(ids) == len(set(ids))
