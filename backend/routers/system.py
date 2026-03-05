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

    return {
        "status": "healthy" if db_status == "connected" else "unhealthy",
        "db": db_status,
        "version": settings.VERSION,
    }
