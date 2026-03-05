"""
Shared slowapi Limiter instance and key functions.

Imported by main.py (for app setup) and routers that need per-user rate limits.
Kept in a separate module to avoid circular imports.
"""
from __future__ import annotations

from fastapi import Request
from jose import JWTError, jwt
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.config import settings


def get_user_key(request: Request) -> str:
    """
    Per-user rate-limiting key extracted from the JWT access_token cookie.
    Falls back to remote IP if the token is absent or invalid (e.g. for
    unauthenticated endpoints that still need rate-limiting).
    """
    token = request.cookies.get("access_token", "")
    if not token:
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]

    if token:
        try:
            payload = jwt.decode(
                token,
                settings.JWT_PUBLIC_KEY,
                algorithms=[settings.JWT_ALGORITHM],
                options={"verify_exp": False},  # key lookup only; expiry checked by deps
            )
            user_id = payload.get("sub")
            if user_id:
                return f"user:{user_id}"
        except JWTError:
            pass

    return f"ip:{get_remote_address(request)}"


# Global limiter — default limit 120 req/min per remote IP.
# Individual routes override with @limiter.limit(..., key_func=get_user_key).
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
