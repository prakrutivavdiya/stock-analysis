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
