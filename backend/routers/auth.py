"""
Auth router — 6 endpoints

  GET  /auth/login                  → Kite OAuth URL
  GET  /auth/callback               → exchange request_token, issue JWT + refresh token
  POST /auth/refresh                → silent JWT renewal (token rotation)
  POST /auth/logout                 → revoke current session
  POST /auth/sessions/revoke-all    → revoke all sessions for current user
  GET  /auth/me                     → current user profile + Kite session status
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from jose import jwt
from kiteconnect import KiteConnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.crypto import decrypt_token, encrypt_token
from backend.database import get_db
from backend.deps import CurrentUser
from backend.models import RefreshToken, User
from backend.schemas.auth import (
    CallbackResponse,
    CallbackUser,
    LoginResponse,
    LogoutResponse,
    MeResponse,
    RefreshResponse,
    RevokeAllResponse,
)

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _create_access_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(seconds=settings.JWT_EXPIRY_SECONDS),
    }
    return jwt.encode(payload, settings.JWT_PRIVATE_KEY, algorithm=settings.JWT_ALGORITHM)


def _make_refresh_token() -> tuple[str, str]:
    """Returns (raw_token, sha256_hex_hash)."""
    raw = secrets.token_urlsafe(64)
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    return raw, hashed


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    is_secure = not settings.DEBUG
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        samesite="strict",
        secure=is_secure,
        max_age=settings.JWT_EXPIRY_SECONDS,
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        samesite="strict",
        secure=is_secure,
        max_age=settings.REFRESH_TOKEN_EXPIRY_DAYS * 86400,
        path="/api/v1/auth",   # limit cookie scope to auth endpoints
    )


def _clear_auth_cookies(response: Response) -> None:
    is_secure = not settings.DEBUG
    response.delete_cookie(
        "access_token",
        httponly=True,
        samesite="strict",
        secure=is_secure,
    )
    response.delete_cookie(
        "refresh_token",
        path="/api/v1/auth",
        httponly=True,
        samesite="strict",
        secure=is_secure,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/login", response_model=LoginResponse)
async def login() -> LoginResponse:
    """Return the Kite OAuth URL. Frontend redirects the user to this URL."""
    kc = KiteConnect(api_key=settings.KITE_API_KEY)
    return LoginResponse(login_url=kc.login_url())


@router.get("/callback")
async def callback(
    request: Request,
    request_token: str,
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """
    Kite redirects here post-login.
    Exchanges request_token, upserts user, issues JWT + refresh token as httpOnly cookies,
    then redirects browser to the frontend dashboard.
    On error: redirects to /login?error=unauthorized.
    """
    kc = KiteConnect(api_key=settings.KITE_API_KEY)

    try:
        session_data = await asyncio.to_thread(
            kc.generate_session, request_token, settings.KITE_API_SECRET
        )
        # Some Kite error responses come back as dicts with status=="error"
        if isinstance(session_data, dict) and session_data.get("status") == "error":
            raise ValueError(session_data.get("message", "Kite authentication failed"))
    except Exception:
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/login?error=unauthorized",
            status_code=302,
        )

    access_token_raw: str = session_data["access_token"]
    kc.set_access_token(access_token_raw)

    try:
        profile = await asyncio.to_thread(kc.profile)
    except Exception:
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/login?error=unauthorized",
            status_code=302,
        )

    kite_user_id: str = profile["user_id"]
    name: str = profile.get("user_name", "")
    email: str = profile.get("email", "")
    exchanges: list[str] = profile.get("exchanges", [])
    products: list[str] = profile.get("products", [])

    # Token expires at ~midnight IST next day; Kite returns the exact expiry
    token_expires_at: datetime = session_data.get(
        "token_expiry",
        datetime.now(timezone.utc) + timedelta(hours=16),
    )
    if token_expires_at.tzinfo is None:
        token_expires_at = token_expires_at.replace(tzinfo=timezone.utc)

    enc_token = encrypt_token(access_token_raw, settings.KITE_ENCRYPTION_KEY)

    now_utc = datetime.now(timezone.utc)

    # Upsert user
    result = await db.execute(select(User).where(User.kite_user_id == kite_user_id))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(
            kite_user_id=kite_user_id,
            username=name,
            email=email,
            kite_access_token_enc=enc_token,
            kite_token_expires_at=token_expires_at,
            exchange_memberships=exchanges,
            product_types=products,
            last_login_at=now_utc,
        )
        db.add(user)
    else:
        user.username = name
        user.email = email
        user.kite_access_token_enc = enc_token
        user.kite_token_expires_at = token_expires_at
        user.exchange_memberships = exchanges
        user.product_types = products
        user.last_login_at = now_utc

    await db.flush()

    # Issue JWT + refresh token
    access_token = _create_access_token(str(user.id))
    raw_rt, hashed_rt = _make_refresh_token()

    db.add(RefreshToken(
        user_id=user.id,
        token_hash=hashed_rt,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRY_DAYS),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    ))
    await db.commit()

    redirect = RedirectResponse(url=f"{settings.FRONTEND_URL}/dashboard", status_code=302)
    _set_auth_cookies(redirect, access_token, raw_rt)
    return redirect


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_token(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> RefreshResponse:
    """
    Silent JWT renewal.
    Reads refresh_token cookie, issues new JWT + rotated refresh token.
    """
    if not refresh_token:
        raise HTTPException(status_code=401, detail="No refresh token")

    hashed = hashlib.sha256(refresh_token.encode()).hexdigest()
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == hashed,
            RefreshToken.revoked == False,  # noqa: E712
        )
    )
    rt_row = result.scalar_one_or_none()

    if rt_row is None or rt_row.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Refresh token expired or revoked")

    # Rotate: revoke old, issue new
    rt_row.revoked = True
    raw_new, hashed_new = _make_refresh_token()
    db.add(RefreshToken(
        user_id=rt_row.user_id,
        token_hash=hashed_new,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRY_DAYS),
    ))

    new_access = _create_access_token(str(rt_row.user_id))
    await db.commit()

    _set_auth_cookies(response, new_access, raw_new)
    return RefreshResponse(expires_in=settings.JWT_EXPIRY_SECONDS)


@router.post("/logout", response_model=LogoutResponse)
async def logout(
    response: Response,
    current_user: CurrentUser,
    refresh_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> LogoutResponse:
    """Revoke current session, invalidate Kite token, and clear httpOnly cookies."""
    # Invalidate Kite access token so the session is truly dead
    try:
        kite_token = decrypt_token(
            current_user.kite_access_token_enc, settings.KITE_ENCRYPTION_KEY
        )
        kc = KiteConnect(api_key=settings.KITE_API_KEY)
        kc.set_access_token(kite_token)
        await asyncio.to_thread(kc.invalidate_access_token, kite_token)
    except Exception as exc:
        logger.warning("Failed to invalidate Kite token for user %s: %s", current_user.kite_user_id, exc)
        # Best-effort — don't block logout if Kite is unreachable

    if refresh_token:
        hashed = hashlib.sha256(refresh_token.encode()).hexdigest()
        result = await db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hashed)
        )
        rt_row = result.scalar_one_or_none()
        if rt_row:
            rt_row.revoked = True
            await db.commit()

    _clear_auth_cookies(response)
    return LogoutResponse(message="Logged out")


@router.post("/sessions/revoke-all", response_model=RevokeAllResponse)
async def revoke_all_sessions(
    response: Response,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> RevokeAllResponse:
    """Revoke all refresh tokens for the current user across all devices."""
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.user_id == current_user.id,
            RefreshToken.revoked == False,  # noqa: E712
        )
    )
    tokens = result.scalars().all()
    for t in tokens:
        t.revoked = True
    await db.commit()

    _clear_auth_cookies(response)
    return RevokeAllResponse(revoked_count=len(tokens))


@router.get("/me", response_model=MeResponse)
async def me(current_user: CurrentUser) -> MeResponse:
    """Current user profile + Kite session status."""
    now = datetime.now(timezone.utc)
    expires = current_user.kite_token_expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)

    return MeResponse(
        user_id=current_user.kite_user_id,
        name=current_user.username,
        email=current_user.email,
        exchange_memberships=current_user.exchange_memberships,
        product_types=current_user.product_types,
        paper_trade_mode=current_user.paper_trade_mode,
        kite_session_valid=expires > now,
        kite_token_expires_at=expires,
        last_login_at=current_user.last_login_at,
    )
