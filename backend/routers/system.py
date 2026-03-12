"""
System router — 1 endpoint

  GET /health  → health check (no auth required)
"""
from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from backend.database import AsyncSessionLocal

router = APIRouter()


@router.get("/health")
async def health_check() -> dict:
    """
    Health check for Docker and load balancer probes.
    No authentication required (AU-03 exception).
    """
    from backend.config import settings

    db_status = "connected"
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
    except Exception:
        db_status = "unreachable"

    from backend.data_source import get_ohlcv_source

    ohlcv_source = get_ohlcv_source()

    # If not yet set by a live fetch, infer from active Kite sessions
    if ohlcv_source == "unknown" and db_status == "connected":
        try:
            from sqlalchemy import select
            from backend.models import User
            async with AsyncSessionLocal() as session:
                from datetime import datetime
                now = datetime.utcnow()  # naive UTC matches stored format
                result = await session.execute(
                    select(User).where(
                        User.is_active == True,           # noqa: E712
                        User.kite_token_expires_at > now,
                    ).limit(1)
                )
                ohlcv_source = "kite" if result.scalar_one_or_none() else "yfinance"
        except Exception:
            pass

    return {
        "status": "healthy" if db_status == "connected" else "unhealthy",
        "db": db_status,
        "version": settings.VERSION,
        "datasource": ohlcv_source,
    }
