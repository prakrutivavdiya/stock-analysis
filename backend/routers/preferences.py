"""
Preferences router — 4 endpoints (PD-09)

  GET  /user/preferences          → fetch current user's full UI preferences
  PUT  /user/preferences          → save full UI preferences
  GET  /user/preferences/chart    → fetch chart sub-preferences (interval, chart_type, active_indicators)
  PUT  /user/preferences/chart    → save chart sub-preferences (merges into ui_preferences JSON)
"""
from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy.ext.asyncio import AsyncSession

from backend.deps import CurrentUser, DBSession
from backend.schemas.preferences import (
    ChartPreferences,
    ChartPreferencesResponse,
    UIPreferences,
    UIPreferencesResponse,
)

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
    """Save UI preferences, preserving chart_prefs (managed by PUT /chart)."""
    existing_raw = current_user.ui_preferences or {}
    existing = UIPreferences.model_validate(existing_raw)
    # chart_prefs is owned by PUT /chart — preserve whatever is currently stored
    body.chart_prefs = existing.chart_prefs
    current_user.ui_preferences = body.model_dump()
    await db.commit()
    await db.refresh(current_user)
    return UIPreferencesResponse(preferences=body)


@router.get("/chart", response_model=ChartPreferencesResponse)
async def get_chart_preferences(
    current_user: CurrentUser,
    db: DBSession,
) -> ChartPreferencesResponse:
    """Return only the chart sub-preferences (interval, chart_type, active_indicators)."""
    raw = current_user.ui_preferences or {}
    prefs = UIPreferences.model_validate(raw)
    return ChartPreferencesResponse(chart_prefs=prefs.chart_prefs)


@router.put("/chart", response_model=ChartPreferencesResponse)
async def save_chart_preferences(
    body: ChartPreferences,
    current_user: CurrentUser,
    db: DBSession,
) -> ChartPreferencesResponse:
    """Merge chart sub-preferences into ui_preferences, leaving all other prefs intact."""
    raw = current_user.ui_preferences or {}
    full = UIPreferences.model_validate(raw)
    full.chart_prefs = body
    current_user.ui_preferences = full.model_dump()
    await db.commit()
    await db.refresh(current_user)
    return ChartPreferencesResponse(chart_prefs=body)
