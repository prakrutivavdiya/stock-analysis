"""
FastAPI dependency functions used across all routers.

  get_db        → yields an AsyncSession per request
  get_current_user → validates JWT from httpOnly cookie or Bearer header
  get_kite_client  → returns an authenticated KiteConnect instance for the user
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from kiteconnect import KiteConnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.crypto import decrypt_token
from backend.database import get_db
from backend.models import User

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
) -> User:
    """
    Extract and validate JWT.
    Priority: httpOnly cookie 'access_token' → Authorization: Bearer header.
    """
    token: str | None = request.cookies.get("access_token")
    if not token and credentials:
        token = credentials.credentials
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = jwt.decode(
            token,
            settings.JWT_PUBLIC_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        user_id_str: str | None = payload.get("sub")
        if not user_id_str:
            raise HTTPException(status_code=401, detail="Invalid token payload")
    except JWTError as exc:
        raise HTTPException(status_code=401, detail=f"Token validation failed: {exc}") from exc

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id_str)))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account deactivated")
    return user


def get_kite_client(user: Annotated[User, Depends(get_current_user)]) -> KiteConnect:
    """
    Return an authenticated KiteConnect instance scoped to the requesting user.
    The Kite access token is decrypted from the database on every request.
    """
    if not user.kite_access_token_enc:
        raise HTTPException(status_code=503, detail="Kite session not available — please re-authenticate")
    try:
        access_token = decrypt_token(user.kite_access_token_enc, settings.KITE_ENCRYPTION_KEY)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Kite session invalid — please re-authenticate") from exc
    kc = KiteConnect(api_key=settings.KITE_API_KEY)
    kc.set_access_token(access_token)
    return kc


# ── Type aliases for clean dependency injection in routers ────────────────────
DBSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
KiteClient = Annotated[KiteConnect, Depends(get_kite_client)]
