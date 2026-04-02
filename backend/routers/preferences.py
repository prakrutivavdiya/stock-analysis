"""
Preferences router — 5 endpoints (PD-09)

  GET  /user/columns              → static list of standard holdings column definitions
  GET  /user/preferences          → fetch current user's full UI preferences
  PUT  /user/preferences          → save full UI preferences
  GET  /user/preferences/chart    → fetch chart sub-preferences (interval, chart_type, active_indicators)
  PUT  /user/preferences/chart    → save chart sub-preferences (merges into ui_preferences JSON)
"""
from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy.orm.attributes import flag_modified

from backend.deps import CurrentUser, DBSession
from backend.schemas.preferences import (
    ChartPreferences,
    ChartPreferencesResponse,
    ColumnDefinition,
    ColumnsResponse,
    UIPreferences,
    UIPreferencesResponse,
)

router = APIRouter()

# ── Static column registry — single source of truth for the holdings table ───
# Column format functions live on the frontend; only serialisable metadata here.

columns_router = APIRouter()

STANDARD_COLUMNS: list[ColumnDefinition] = [
    ColumnDefinition(id="exchange",          label="Exchange",       align="left",  default_visible=False, filter_type="text"),
    ColumnDefinition(id="quantity",          label="Qty",            align="right", default_visible=True,  filter_type="range"),
    ColumnDefinition(id="t1Quantity",        label="T+1 Qty",        align="right", default_visible=False, filter_type="range"),
    ColumnDefinition(id="avgPrice",          label="Avg Buy Price",  align="right", default_visible=True,  filter_type="range"),
    ColumnDefinition(id="ltp",              label="LTP",            align="right", default_visible=True,  filter_type="range"),
    ColumnDefinition(id="dayChange",         label="Day Chg (₹)",    align="right", default_visible=True,  filter_type="range"),
    ColumnDefinition(id="dayChangePercent",  label="Day Chg%",       align="right", default_visible=True,  filter_type="range"),
    ColumnDefinition(id="pnl",              label="Total P&L",      align="right", default_visible=True,  filter_type="range"),
    ColumnDefinition(id="pnlPercent",        label="P&L%",           align="right", default_visible=True,  filter_type="range"),
    ColumnDefinition(id="currentValue",      label="Curr Value",     align="right", default_visible=True,  filter_type="range"),
    ColumnDefinition(id="investedValue",     label="Invested",       align="right", default_visible=False, filter_type="range"),
]


@columns_router.get("", response_model=ColumnsResponse)
async def get_columns() -> ColumnsResponse:
    """Return the static list of standard holdings table column definitions."""
    return ColumnsResponse(columns=STANDARD_COLUMNS)


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
    flag_modified(current_user, "ui_preferences")
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
    flag_modified(current_user, "ui_preferences")
    await db.commit()
    await db.refresh(current_user)
    return ChartPreferencesResponse(chart_prefs=body)
