"""
Tests for /api/v1/auth endpoints.

  GET  /auth/login
  GET  /auth/callback
  POST /auth/refresh
  POST /auth/logout
  POST /auth/sessions/revoke-all
  GET  /auth/me
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import func, select

from backend.config import settings
from backend.models import RefreshToken, User
from tests.conftest import USER_ID, seed_user


# ─────────────────────────────────────────────────────────────────────────────
# GET /auth/login
# ─────────────────────────────────────────────────────────────────────────────

async def test_login_returns_kite_url(client: AsyncClient) -> None:
    """GET /auth/login returns the Kite OAuth URL."""
    with patch("backend.routers.auth.KiteConnect") as MockKite:
        MockKite.return_value.login_url.return_value = "https://kite.zerodha.com/connect/login?api_key=test"
        response = await client.get("/api/v1/auth/login")

    assert response.status_code == 200
    body = response.json()
    assert "login_url" in body
    assert body["login_url"].startswith("https://")


# ─────────────────────────────────────────────────────────────────────────────
# GET /auth/callback
# ─────────────────────────────────────────────────────────────────────────────

def _mock_kite_session(user_id: str = "ZX1234") -> dict:
    return {
        "access_token": "kite_access_token_abc123",
        "token_expiry": datetime.now(timezone.utc) + timedelta(hours=16),
    }


def _mock_kite_profile(user_id: str = "ZX1234") -> dict:
    # Use a per-user email so each distinct kite_user_id doesn't collide with
    # the seeded user row (email="test@example.com" / kite_user_id="ZX1234").
    email = "test@example.com" if user_id == "ZX1234" else f"{user_id.lower()}@example.com"
    return {
        "user_id": user_id,
        "user_name": "Test User",
        "email": email,
        "exchanges": ["NSE", "BSE"],
        "products": ["CNC", "MIS", "NRML"],
    }


async def test_callback_success_redirects_to_dashboard(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Successful callback redirects browser to /dashboard and sets cookies."""
    with (
        patch("backend.routers.auth.KiteConnect") as MockKite,
        patch("backend.routers.auth.encrypt_token", return_value="encrypted_abc"),
    ):
        instance = MockKite.return_value
        instance.generate_session = MagicMock(return_value=_mock_kite_session())
        instance.profile = MagicMock(return_value=_mock_kite_profile())

        response = await client.get(
            "/api/v1/auth/callback",
            params={"request_token": "valid_request_token"},
        )

    assert response.status_code == 302
    assert "/dashboard" in response.headers["location"]
    # httpOnly cookies must be set
    assert "access_token" in response.cookies
    assert "refresh_token" in response.cookies


async def test_callback_sets_last_login_on_first_login(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """First-time login sets last_login_at (not left NULL until second login)."""
    with (
        patch("backend.routers.auth.KiteConnect") as MockKite,
        patch("backend.routers.auth.encrypt_token", return_value="enc"),
    ):
        instance = MockKite.return_value
        instance.generate_session = MagicMock(return_value=_mock_kite_session())
        instance.profile = MagicMock(return_value=_mock_kite_profile("NEW_USER"))

        await client.get(
            "/api/v1/auth/callback",
            params={"request_token": "tok"},
        )

    from sqlalchemy import select
    result = await db_session.execute(
        select(User).where(User.kite_user_id == "NEW_USER")
    )
    user = result.scalar_one_or_none()
    assert user is not None
    assert user.last_login_at is not None, "last_login_at must be set on first login"


async def test_callback_kite_error_redirects_to_login(client: AsyncClient) -> None:
    """Kite session exchange failure redirects to /login?error=unauthorized."""
    with patch("backend.routers.auth.KiteConnect") as MockKite:
        MockKite.return_value.generate_session = MagicMock(
            side_effect=Exception("invalid_request_token")
        )
        response = await client.get(
            "/api/v1/auth/callback",
            params={"request_token": "bad_token"},
        )

    assert response.status_code == 302
    assert "error=unauthorized" in response.headers["location"]


async def test_callback_kite_error_dict_redirects(client: AsyncClient) -> None:
    """Kite returning status=='error' dict also redirects (not a Python exception)."""
    with patch("backend.routers.auth.KiteConnect") as MockKite:
        MockKite.return_value.generate_session = MagicMock(
            return_value={"status": "error", "message": "Invalid token"}
        )
        response = await client.get(
            "/api/v1/auth/callback",
            params={"request_token": "bad_token"},
        )

    assert response.status_code == 302
    assert "error=unauthorized" in response.headers["location"]


# ─────────────────────────────────────────────────────────────────────────────
# POST /auth/refresh
# ─────────────────────────────────────────────────────────────────────────────

async def _create_refresh_token(db: AsyncSession, *, expired: bool = False) -> str:
    """Insert a refresh token row and return the raw (unhashed) token."""
    await seed_user(db)
    raw = secrets.token_urlsafe(64)
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    expires = (
        datetime.now(timezone.utc) - timedelta(days=1)
        if expired
        else datetime.now(timezone.utc) + timedelta(days=30)
    )
    db.add(RefreshToken(
        user_id=USER_ID,
        token_hash=hashed,
        expires_at=expires,
        revoked=False,
    ))
    await db.commit()
    return raw


async def test_refresh_rotates_token(client: AsyncClient, db_session: AsyncSession) -> None:
    """Valid refresh token issues a new JWT and rotates the refresh token."""
    raw_rt = await _create_refresh_token(db_session)

    response = await client.post(
        "/api/v1/auth/refresh",
        cookies={"refresh_token": raw_rt},
    )

    assert response.status_code == 200
    assert "expires_in" in response.json()
    assert "access_token" in response.cookies
    assert "refresh_token" in response.cookies


async def test_refresh_fails_without_cookie(client: AsyncClient) -> None:
    """POST /auth/refresh with no cookie returns 401."""
    response = await client.post("/api/v1/auth/refresh")
    assert response.status_code == 401


async def test_refresh_fails_with_expired_token(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """POST /auth/refresh with an expired token returns 401."""
    raw_rt = await _create_refresh_token(db_session, expired=True)
    response = await client.post(
        "/api/v1/auth/refresh",
        cookies={"refresh_token": raw_rt},
    )
    assert response.status_code == 401


async def test_refresh_fails_with_revoked_token(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """POST /auth/refresh with a revoked token returns 401."""
    raw_rt = await _create_refresh_token(db_session)
    # Manually revoke the token
    from sqlalchemy import select
    result = await db_session.execute(
        select(RefreshToken).where(RefreshToken.user_id == USER_ID)
    )
    rt = result.scalar_one()
    rt.revoked = True
    await db_session.commit()

    response = await client.post(
        "/api/v1/auth/refresh",
        cookies={"refresh_token": raw_rt},
    )
    assert response.status_code == 401


# ─────────────────────────────────────────────────────────────────────────────
# POST /auth/logout
# ─────────────────────────────────────────────────────────────────────────────

async def test_logout_revokes_refresh_token(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """POST /auth/logout marks the refresh token as revoked and clears cookies."""
    raw_rt = await _create_refresh_token(db_session)

    response = await client.post(
        "/api/v1/auth/logout",
        cookies={"refresh_token": raw_rt},
    )

    assert response.status_code == 200
    assert response.json()["message"] == "Logged out"

    # Verify token is revoked in DB
    from sqlalchemy import select
    result = await db_session.execute(select(RefreshToken).where(RefreshToken.user_id == USER_ID))
    rt = result.scalar_one()
    assert rt.revoked is True


async def test_logout_without_cookie_is_graceful(client: AsyncClient) -> None:
    """POST /auth/logout without a cookie still succeeds (idempotent)."""
    response = await client.post("/api/v1/auth/logout")
    assert response.status_code == 200


# ─────────────────────────────────────────────────────────────────────────────
# POST /auth/sessions/revoke-all
# ─────────────────────────────────────────────────────────────────────────────

async def test_revoke_all_sessions(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """POST /auth/sessions/revoke-all revokes every active refresh token."""
    await seed_user(db_session)
    # Create two active tokens
    for _ in range(2):
        raw = secrets.token_urlsafe(64)
        hashed = hashlib.sha256(raw.encode()).hexdigest()
        db_session.add(RefreshToken(
            user_id=USER_ID,
            token_hash=hashed,
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
            revoked=False,
        ))
    await db_session.commit()

    response = await client.post("/api/v1/auth/sessions/revoke-all")

    assert response.status_code == 200
    assert response.json()["revoked_count"] == 2


# ─────────────────────────────────────────────────────────────────────────────
# GET /auth/me
# ─────────────────────────────────────────────────────────────────────────────

async def test_me_returns_user_profile(client: AsyncClient, mock_user: MagicMock) -> None:
    """GET /auth/me returns the current user's profile."""
    response = await client.get("/api/v1/auth/me")

    assert response.status_code == 200
    body = response.json()
    assert body["user_id"] == mock_user.kite_user_id
    assert body["name"] == mock_user.username
    assert body["email"] == mock_user.email
    assert "kite_session_valid" in body
    assert body["kite_session_valid"] is True  # token expires in +8 hours


async def test_me_returns_kite_session_invalid_when_token_expired(
    client: AsyncClient, mock_user: MagicMock
) -> None:
    """kite_session_valid=False when kite_token_expires_at is in the past."""
    mock_user.kite_token_expires_at = datetime.now(timezone.utc) - timedelta(hours=1)

    response = await client.get("/api/v1/auth/me")

    assert response.status_code == 200
    assert response.json()["kite_session_valid"] is False


# ─────────────────────────────────────────────────────────────────────────────
# Security: Refresh token replay attack
# ─────────────────────────────────────────────────────────────────────────────

async def test_refresh_token_replay_attack_blocked(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Replaying an already-rotated refresh token must return 401."""
    raw_rt = await _create_refresh_token(db_session)

    # First use — legitimate rotation
    r1 = await client.post(
        "/api/v1/auth/refresh",
        cookies={"refresh_token": raw_rt},
    )
    assert r1.status_code == 200, "First refresh must succeed"

    # Second use — replay attack with the now-revoked token
    r2 = await client.post(
        "/api/v1/auth/refresh",
        cookies={"refresh_token": raw_rt},
    )
    assert r2.status_code == 401, "Replayed (already-rotated) token must be rejected"


# ─────────────────────────────────────────────────────────────────────────────
# Callback: upsert — second login updates existing user, no duplicate
# ─────────────────────────────────────────────────────────────────────────────

async def test_callback_upsert_updates_existing_user(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Second login for the same Kite user_id updates the existing row; no duplicate created."""
    from sqlalchemy import select, func

    with (
        patch("backend.routers.auth.KiteConnect") as MockKite,
        patch("backend.routers.auth.encrypt_token", return_value="enc"),
    ):
        instance = MockKite.return_value
        instance.generate_session = MagicMock(return_value=_mock_kite_session("REPEAT_USER"))
        instance.profile = MagicMock(return_value=_mock_kite_profile("REPEAT_USER"))

        # First login
        await client.get("/api/v1/auth/callback", params={"request_token": "tok1"})

        # Second login — updated name (Kite allows name changes)
        instance.profile = MagicMock(return_value={
            **_mock_kite_profile("REPEAT_USER"),
            "user_name": "Updated Name",
        })
        await client.get("/api/v1/auth/callback", params={"request_token": "tok2"})

    # Must be exactly one row
    count = (await db_session.execute(
        select(func.count(User.id)).where(User.kite_user_id == "REPEAT_USER")
    )).scalar_one()
    assert count == 1, "Upsert must not create duplicate users"

    user = (await db_session.execute(
        select(User).where(User.kite_user_id == "REPEAT_USER")
    )).scalar_one()
    assert user.username == "Updated Name"
