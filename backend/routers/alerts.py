"""
Alerts router — 8 endpoints

  GET    /alerts                      → list user's alerts (newest first)
  POST   /alerts                      → create alert; rejects if condition already met
  GET    /alerts/{alert_id}           → single alert detail
  PUT    /alerts/{alert_id}           → update condition/threshold/note/status
  DELETE /alerts/{alert_id}           → delete alert
  PATCH  /alerts/{alert_id}/toggle    → flip ACTIVE↔DISABLED
  GET    /alerts/notifications        → paginated notification history
  POST   /alerts/notifications/read-all → placeholder (future)
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select

from backend.alert_engine import already_met, already_met_error
from backend.deps import CurrentUser, DBSession, KiteClient
from backend.models import Alert, AlertNotification
from backend.schemas.alerts import (
    AlertCreate,
    AlertNotificationsListResponse,
    AlertNotificationOut,
    AlertOut,
    AlertsListResponse,
    AlertUpdate,
)

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _to_out(alert: Alert) -> AlertOut:
    last_notif = alert.notifications[0] if alert.notifications else None
    return AlertOut(
        id=alert.id,
        tradingsymbol=alert.tradingsymbol,
        exchange=alert.exchange,
        instrument_token=alert.instrument_token,
        condition_type=alert.condition_type,
        threshold=alert.threshold,
        note=alert.note,
        status=alert.status,
        triggered_at=alert.triggered_at,
        created_at=alert.created_at,
        updated_at=alert.updated_at,
        last_notification=(
            AlertNotificationOut.model_validate(last_notif) if last_notif else None
        ),
    )


async def _get_alert_or_404(alert_id: uuid.UUID, user_id: uuid.UUID, db: DBSession) -> Alert:
    alert = (await db.execute(
        select(Alert).where(Alert.id == alert_id, Alert.user_id == user_id)
    )).scalar_one_or_none()
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


def _invalidate_cache() -> None:
    """Invalidate the in-memory alert cache in ticker.py so it reloads on next tick."""
    try:
        import backend.ticker as _ticker
        _ticker.invalidate_alert_cache()
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────────────────
# GET /alerts
# ─────────────────────────────────────────────────────────────────────────────

@router.get("", response_model=AlertsListResponse)
async def list_alerts(
    current_user: CurrentUser,
    db: DBSession,
    status: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> AlertsListResponse:
    q = select(Alert).where(Alert.user_id == current_user.id)
    if status:
        q = q.where(Alert.status == status.upper())
    q = q.order_by(Alert.created_at.desc()).limit(limit).offset(offset)

    alerts = (await db.execute(q)).scalars().all()
    # Eagerly load notifications for each alert (last 1)
    for a in alerts:
        await db.refresh(a, ["notifications"])

    total = (await db.execute(
        select(func.count(Alert.id)).where(Alert.user_id == current_user.id)
    )).scalar_one()

    return AlertsListResponse(alerts=[_to_out(a) for a in alerts], total=total)


# ─────────────────────────────────────────────────────────────────────────────
# POST /alerts
# ─────────────────────────────────────────────────────────────────────────────

@router.post("", response_model=AlertOut, status_code=201)
async def create_alert(
    body: AlertCreate,
    current_user: CurrentUser,
    db: DBSession,
    kite: KiteClient,
) -> AlertOut:
    # 1. Fetch current price snapshot from Kite
    instrument_key = f"{body.exchange}:{body.tradingsymbol}"
    try:
        ohlc_data: dict = await asyncio.to_thread(kite.ohlc, [instrument_key])
        snap = ohlc_data.get(instrument_key) or {}
        ltp = float(snap.get("last_price", 0))
        day_open = float((snap.get("ohlc") or {}).get("open", ltp) or ltp)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not fetch current price for {body.tradingsymbol}: {exc}",
        )

    if ltp == 0:
        raise HTTPException(
            status_code=422,
            detail=f"Could not determine current price for {body.tradingsymbol}.",
        )

    # 2. Reject if condition already met
    if already_met(body.condition_type, float(body.threshold), ltp, day_open):
        raise HTTPException(
            status_code=422,
            detail=already_met_error(
                body.tradingsymbol, body.condition_type, float(body.threshold), ltp
            ),
        )

    # 3. Persist
    alert = Alert(
        user_id=current_user.id,
        tradingsymbol=body.tradingsymbol,
        exchange=body.exchange,
        instrument_token=body.instrument_token,
        condition_type=body.condition_type,
        threshold=body.threshold,
        note=body.note,
        status="ACTIVE",
    )
    db.add(alert)
    await db.commit()
    await db.refresh(alert)
    await db.refresh(alert, ["notifications"])

    _invalidate_cache()
    return _to_out(alert)


# ─────────────────────────────────────────────────────────────────────────────
# GET /alerts/notifications   (must be BEFORE /{alert_id} to avoid route clash)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/notifications", response_model=AlertNotificationsListResponse)
async def list_notifications(
    current_user: CurrentUser,
    db: DBSession,
    limit: int = 50,
    offset: int = 0,
) -> AlertNotificationsListResponse:
    rows = (await db.execute(
        select(AlertNotification)
        .where(AlertNotification.user_id == current_user.id)
        .order_by(AlertNotification.triggered_at.desc())
        .limit(limit).offset(offset)
    )).scalars().all()

    total = (await db.execute(
        select(func.count(AlertNotification.id))
        .where(AlertNotification.user_id == current_user.id)
    )).scalar_one()

    return AlertNotificationsListResponse(
        notifications=[AlertNotificationOut.model_validate(n) for n in rows],
        total=total,
    )


@router.post("/notifications/read-all", status_code=204)
async def mark_notifications_read(current_user: CurrentUser) -> None:
    """Placeholder — returns 204. Frontend uses this to reset unread badge."""
    return None


# ─────────────────────────────────────────────────────────────────────────────
# GET /alerts/{alert_id}
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{alert_id}", response_model=AlertOut)
async def get_alert(
    alert_id: uuid.UUID,
    current_user: CurrentUser,
    db: DBSession,
) -> AlertOut:
    alert = await _get_alert_or_404(alert_id, current_user.id, db)
    await db.refresh(alert, ["notifications"])
    return _to_out(alert)


# ─────────────────────────────────────────────────────────────────────────────
# PUT /alerts/{alert_id}  — update condition/threshold/note/status
# ─────────────────────────────────────────────────────────────────────────────

@router.put("/{alert_id}", response_model=AlertOut)
async def update_alert(
    alert_id: uuid.UUID,
    body: AlertUpdate,
    current_user: CurrentUser,
    db: DBSession,
    kite: KiteClient,
) -> AlertOut:
    alert = await _get_alert_or_404(alert_id, current_user.id, db)

    new_condition = body.condition_type or alert.condition_type
    new_threshold = body.threshold if body.threshold is not None else alert.threshold

    # If condition or threshold changed, re-validate "already met"
    if (
        (body.condition_type and body.condition_type != alert.condition_type)
        or (body.threshold is not None and body.threshold != alert.threshold)
        or (body.status == "ACTIVE" and alert.status != "ACTIVE")
    ):
        instrument_key = f"{alert.exchange}:{alert.tradingsymbol}"
        try:
            ohlc_data = await asyncio.to_thread(kite.ohlc, [instrument_key])
            snap = ohlc_data.get(instrument_key) or {}
            ltp = float(snap.get("last_price", 0))
            day_open = float((snap.get("ohlc") or {}).get("open", ltp) or ltp)
        except Exception as exc:
            raise HTTPException(502, detail=f"Could not fetch current price: {exc}")

        if ltp > 0 and already_met(new_condition, float(new_threshold), ltp, day_open):
            raise HTTPException(
                422,
                detail=already_met_error(
                    alert.tradingsymbol, new_condition, float(new_threshold), ltp
                ),
            )

    if body.condition_type is not None:
        alert.condition_type = body.condition_type
    if body.threshold is not None:
        alert.threshold = body.threshold
    if body.note is not None:
        alert.note = body.note
    if body.status is not None:
        alert.status = body.status
        if body.status == "ACTIVE":
            alert.triggered_at = None  # reset so it can fire again
    alert.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(alert)
    await db.refresh(alert, ["notifications"])

    _invalidate_cache()
    return _to_out(alert)


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /alerts/{alert_id}
# ─────────────────────────────────────────────────────────────────────────────

@router.delete("/{alert_id}", status_code=204)
async def delete_alert(
    alert_id: uuid.UUID,
    current_user: CurrentUser,
    db: DBSession,
) -> None:
    alert = await _get_alert_or_404(alert_id, current_user.id, db)
    await db.delete(alert)
    await db.commit()
    _invalidate_cache()


# ─────────────────────────────────────────────────────────────────────────────
# PATCH /alerts/{alert_id}/toggle  — flip ACTIVE ↔ DISABLED
# ─────────────────────────────────────────────────────────────────────────────

@router.patch("/{alert_id}/toggle", response_model=AlertOut)
async def toggle_alert(
    alert_id: uuid.UUID,
    current_user: CurrentUser,
    db: DBSession,
    kite: KiteClient,
) -> AlertOut:
    alert = await _get_alert_or_404(alert_id, current_user.id, db)

    if alert.status == "ACTIVE":
        alert.status = "DISABLED"
    elif alert.status in ("TRIGGERED", "DISABLED"):
        # Re-activate: validate condition not already met
        instrument_key = f"{alert.exchange}:{alert.tradingsymbol}"
        try:
            ohlc_data = await asyncio.to_thread(kite.ohlc, [instrument_key])
            snap = ohlc_data.get(instrument_key) or {}
            ltp = float(snap.get("last_price", 0))
            day_open = float((snap.get("ohlc") or {}).get("open", ltp) or ltp)
        except Exception as exc:
            raise HTTPException(502, detail=f"Could not fetch current price: {exc}")

        if ltp > 0 and already_met(alert.condition_type, float(alert.threshold), ltp, day_open):
            raise HTTPException(
                422,
                detail=already_met_error(
                    alert.tradingsymbol, alert.condition_type, float(alert.threshold), ltp
                ),
            )
        alert.status = "ACTIVE"
        alert.triggered_at = None

    alert.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(alert)
    await db.refresh(alert, ["notifications"])

    _invalidate_cache()
    return _to_out(alert)
