"""
Audit router — 1 read-only endpoint

  GET /audit  → paginated, filterable audit log for the current user
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Query
from sqlalchemy import and_, func, select

from backend.deps import CurrentUser, DBSession
from backend.models import AuditLog
from backend.schemas.audit import AuditLogOut, AuditResponse

router = APIRouter()

VALID_ACTIONS = {
    "PLACE_ORDER", "MODIFY_ORDER", "CANCEL_ORDER",
    "PLACE_GTT", "MODIFY_GTT", "DELETE_GTT", "PAPER_TRADE",
}


@router.get("", response_model=AuditResponse)
async def get_audit_log(
    current_user: CurrentUser,
    db: DBSession,
    from_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    to_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    tradingsymbol: str | None = Query(default=None),
    action_type: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> AuditResponse:
    """
    Read-only audit log with filtering and pagination.
    Always scoped to the authenticated user (AU-11).
    """
    filters = [AuditLog.user_id == current_user.id]

    if from_date:
        filters.append(
            AuditLog.created_at >= datetime.fromisoformat(f"{from_date}T00:00:00").replace(tzinfo=timezone.utc)
        )

    if to_date:
        filters.append(
            AuditLog.created_at <= datetime.fromisoformat(f"{to_date}T23:59:59").replace(tzinfo=timezone.utc)
        )

    if tradingsymbol:
        filters.append(AuditLog.tradingsymbol.ilike(f"%{tradingsymbol}%"))

    if action_type and action_type in VALID_ACTIONS:
        filters.append(AuditLog.action_type == action_type)

    # Total count
    total_q = await db.execute(
        select(func.count()).select_from(AuditLog).where(and_(*filters))
    )
    total = total_q.scalar() or 0

    # Paginated rows
    rows = (await db.execute(
        select(AuditLog)
        .where(and_(*filters))
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .offset(offset)
    )).scalars().all()

    return AuditResponse(
        total=total,
        logs=[AuditLogOut.model_validate(r) for r in rows],
    )
