"""Tests for GET /api/v1/health — no authentication required."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient


async def test_health_healthy(client: AsyncClient) -> None:
    """Health endpoint returns 'healthy' when DB is reachable."""
    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)
    mock_session.execute = AsyncMock()

    with patch("backend.routers.system.AsyncSessionLocal", return_value=mock_session):
        response = await client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["db"] == "connected"
    assert "version" in body


async def test_health_unhealthy_when_db_down(client: AsyncClient) -> None:
    """Health endpoint returns 'unhealthy' when DB connection fails."""
    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)
    mock_session.execute = AsyncMock(side_effect=Exception("connection refused"))

    with patch("backend.routers.system.AsyncSessionLocal", return_value=mock_session):
        response = await client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "unhealthy"
    assert body["db"] == "unreachable"


async def test_health_no_auth_required(client: AsyncClient) -> None:
    """Health endpoint is publicly accessible — no 401 without credentials."""
    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with patch("backend.routers.system.AsyncSessionLocal", return_value=mock_session):
        # Request WITHOUT any auth cookies or headers
        response = await client.get("/api/v1/health")

    assert response.status_code == 200


# ─────────────────────────────────────────────────────────────────────────────
# ohlcv_source inference branch (lines 36-51 of system.py)
# Triggered when get_ohlcv_source() returns "unknown" and db is connected.
# ─────────────────────────────────────────────────────────────────────────────

async def test_health_datasource_infers_kite_from_active_user(
    client: AsyncClient,
) -> None:
    """datasource='kite' when ohlcv_source is unknown but an active user exists."""
    # Session 1: SELECT 1 health check (succeeds → db=connected)
    session1 = AsyncMock()
    session1.__aenter__ = AsyncMock(return_value=session1)
    session1.__aexit__ = AsyncMock(return_value=False)
    session1.execute = AsyncMock()

    # Session 2: user query — returns a mock active user
    session2 = AsyncMock()
    session2.__aenter__ = AsyncMock(return_value=session2)
    session2.__aexit__ = AsyncMock(return_value=False)
    user_result = MagicMock()
    user_result.scalar_one_or_none.return_value = MagicMock()  # non-None → "kite"
    session2.execute = AsyncMock(return_value=user_result)

    # get_ohlcv_source is imported inside the function — patch at source module
    with patch("backend.routers.system.AsyncSessionLocal", side_effect=[session1, session2]):
        with patch("backend.data_source.get_ohlcv_source", return_value="unknown"):
            response = await client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["datasource"] == "kite"


async def test_health_datasource_infers_yfinance_when_no_active_user(
    client: AsyncClient,
) -> None:
    """datasource='yfinance' when ohlcv_source is unknown and no active user."""
    session1 = AsyncMock()
    session1.__aenter__ = AsyncMock(return_value=session1)
    session1.__aexit__ = AsyncMock(return_value=False)
    session1.execute = AsyncMock()

    session2 = AsyncMock()
    session2.__aenter__ = AsyncMock(return_value=session2)
    session2.__aexit__ = AsyncMock(return_value=False)
    no_user_result = MagicMock()
    no_user_result.scalar_one_or_none.return_value = None  # no active user → "yfinance"
    session2.execute = AsyncMock(return_value=no_user_result)

    with patch("backend.routers.system.AsyncSessionLocal", side_effect=[session1, session2]):
        with patch("backend.data_source.get_ohlcv_source", return_value="unknown"):
            response = await client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json()["datasource"] == "yfinance"
