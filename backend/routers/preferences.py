"""
Preferences router — 2 endpoints (PD-09)

  GET  /user/preferences  → fetch current user's UI preferences
  PUT  /user/preferences  → save UI preferences
"""
from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy.ext.asyncio import AsyncSession

from backend.deps import CurrentUser, DBSession
from backend.schemas.preferences import UIPreferences, UIPreferencesResponse

router = APIRouter()


@router.get("", response_model=UIPreferencesResponse)
async def get_preferences(
    current_user: CurrentUser,
    db: DBSession,
) -> UIPreferencesResponse:
    """Return the current user's UI preferences. Returns defaults if none saved."""
    raw = current_user.ui_preferences or {}
    prefs = UIPreferences.model_validate(raw)
    return UIPreferencesResponse(preferences=prefs)


@router.put("", response_model=UIPreferencesResponse)
async def save_preferences(
    body: UIPreferences,
    current_user: CurrentUser,
    db: DBSession,
) -> UIPreferencesResponse:
    """Overwrite the user's UI preferences with the supplied values."""
    current_user.ui_preferences = body.model_dump()
    await db.commit()
    await db.refresh(current_user)
    return UIPreferencesResponse(preferences=body)
