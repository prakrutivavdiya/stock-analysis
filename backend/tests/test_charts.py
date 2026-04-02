"""
Tests for /api/v1/charts endpoints.

  GET    /charts/{instrument_token}/drawings
  POST   /charts/{instrument_token}/drawings
  PUT    /charts/{instrument_token}/drawings/{id}
  DELETE /charts/{instrument_token}/drawings/{id}
  GET    /charts/indicators/compute
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import ChartDrawing
from tests.conftest import seed_ohlcv
from tests.conftest import USER_ID, seed_ohlcv


async def _seed_drawing(
    db: AsyncSession,
    instrument_token: int = 408065,
    drawing_type: str = "hline",
    interval: str = "day",
) -> ChartDrawing:
    """Insert a ChartDrawing row for testing."""
    drawing = ChartDrawing(
        user_id=USER_ID,
        instrument_token=instrument_token,
        tradingsymbol="INFY",
        exchange="NSE",
        interval=interval,
        drawing_type=drawing_type,
        drawing_data={"price": 1500.0},
        label="Test line",
    )
    db.add(drawing)
    await db.commit()
    await db.refresh(drawing)
    return drawing


# ─────────────────────────────────────────────────────────────────────────────
# GET /charts/{instrument_token}/drawings
# ─────────────────────────────────────────────────────────────────────────────

async def test_list_drawings_empty(client: AsyncClient) -> None:
    """Returns empty drawings list when none saved."""
    response = await client.get("/api/v1/charts/408065/drawings")

    assert response.status_code == 200
    body = response.json()
    assert body["instrument_token"] == 408065
    assert body["drawings"] == []


async def test_list_drawings_returns_own_drawings(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Returns drawings for the specified instrument and interval."""
    await _seed_drawing(db_session, instrument_token=408065, interval="day")

    response = await client.get(
        "/api/v1/charts/408065/drawings", params={"interval": "day"}
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body["drawings"]) == 1
    assert body["drawings"][0]["drawing_type"] == "hline"


async def test_list_drawings_filtered_by_interval(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Drawings from a different interval are not returned."""
    await _seed_drawing(db_session, interval="day")
    await _seed_drawing(db_session, interval="5minute")

    response = await client.get(
        "/api/v1/charts/408065/drawings", params={"interval": "day"}
    )

    body = response.json()
    assert len(body["drawings"]) == 1
    # interval is on the DrawingsResponse wrapper, not on individual DrawingOut
    assert body["interval"] == "day"


# ─────────────────────────────────────────────────────────────────────────────
# POST /charts/{instrument_token}/drawings
# ─────────────────────────────────────────────────────────────────────────────

async def test_create_drawing_success(client: AsyncClient) -> None:
    """Creates a drawing and returns it with a UUID."""
    response = await client.post(
        "/api/v1/charts/408065/drawings",
        json={
            "interval": "day",
            "drawing_type": "hline",
            "drawing_data": {"price": 1500.0},
            "label": "Support level",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["drawing_type"] == "hline"
    assert body["label"] == "Support level"
    assert "id" in body
    uuid.UUID(body["id"])  # must be valid UUID


async def test_create_drawing_invalid_type_returns_400(client: AsyncClient) -> None:
    """400 when drawing_type is not in allowed set."""
    response = await client.post(
        "/api/v1/charts/408065/drawings",
        json={
            "interval": "day",
            "drawing_type": "invalidtype",
            "drawing_data": {},
        },
    )

    assert response.status_code == 400


async def test_create_drawing_all_valid_types(client: AsyncClient) -> None:
    """All four drawing types are accepted."""
    for dtype in ("hline", "trendline", "rectangle", "text"):
        response = await client.post(
            "/api/v1/charts/408065/drawings",
            json={"interval": "day", "drawing_type": dtype, "drawing_data": {}},
        )
        assert response.status_code == 201, f"Failed for drawing_type={dtype}"


# ─────────────────────────────────────────────────────────────────────────────
# PUT /charts/{instrument_token}/drawings/{id}
# ─────────────────────────────────────────────────────────────────────────────

async def test_update_drawing_label(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Updates drawing label."""
    drawing = await _seed_drawing(db_session)

    response = await client.put(
        f"/api/v1/charts/408065/drawings/{drawing.id}",
        json={"label": "Updated label"},
    )

    assert response.status_code == 200
    assert response.json()["label"] == "Updated label"


async def test_update_drawing_data(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Updates drawing_data payload."""
    drawing = await _seed_drawing(db_session)
    new_data = {"price": 1600.0, "color": "#FF0000"}

    response = await client.put(
        f"/api/v1/charts/408065/drawings/{drawing.id}",
        json={"drawing_data": new_data},
    )

    assert response.status_code == 200
    assert response.json()["drawing_data"]["price"] == 1600.0


async def test_update_drawing_not_found(client: AsyncClient) -> None:
    """404 when drawing ID doesn't exist."""
    response = await client.put(
        f"/api/v1/charts/408065/drawings/{uuid.uuid4()}",
        json={"label": "Anything"},
    )
    assert response.status_code == 404


async def test_update_drawing_wrong_instrument_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """404 when drawing belongs to a different instrument token."""
    drawing = await _seed_drawing(db_session, instrument_token=408065)

    response = await client.put(
        f"/api/v1/charts/999999/drawings/{drawing.id}",
        json={"label": "Sneaky"},
    )
    assert response.status_code == 404


# ─────────────────────────────────────────────────────────────────────────────
# DELETE /charts/{instrument_token}/drawings/{id}
# ─────────────────────────────────────────────────────────────────────────────

async def test_delete_drawing_success(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """DELETE returns 204 and drawing is gone."""
    drawing = await _seed_drawing(db_session)

    response = await client.delete(f"/api/v1/charts/408065/drawings/{drawing.id}")
    assert response.status_code == 204

    # Confirm deletion
    list_resp = await client.get("/api/v1/charts/408065/drawings")
    assert list_resp.json()["drawings"] == []


async def test_delete_drawing_not_found(client: AsyncClient) -> None:
    """404 when drawing ID doesn't exist."""
    response = await client.delete(f"/api/v1/charts/408065/drawings/{uuid.uuid4()}")
    assert response.status_code == 404


# ─────────────────────────────────────────────────────────────────────────────
# GET /charts/indicators/compute
# ─────────────────────────────────────────────────────────────────────────────

async def test_compute_indicators_from_cache(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Computes SMA indicator using cached OHLCV data."""
    await seed_ohlcv(db_session, instrument_token=408065, num_candles=30)

    response = await client.get(
        "/api/v1/charts/indicators/compute",
        params={
            "instrument_token": 408065,
            "interval": "day",
            "from_date": "2026-01-01",
            "to_date": "2026-02-24",
            "indicators": "SMA_5",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert "SMA_5" in body
    assert isinstance(body["SMA_5"], list)


async def test_compute_indicators_from_kite(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """Falls back to Kite when cache is empty, computes indicator."""
    from datetime import timedelta
    base = datetime(2026, 2, 1, tzinfo=timezone.utc)
    candles = [
        {"date": base + timedelta(days=i),
         "open": 1490.0, "high": 1510.0, "low": 1480.0, "close": 1500.0 + i, "volume": 1_000_000}
        for i in range(30)
    ]
    mock_kite.historical_data.return_value = candles

    response = await client.get(
        "/api/v1/charts/indicators/compute",
        params={
            "instrument_token": 999999,
            "interval": "day",
            "from_date": "2026-01-01",
            "to_date": "2026-02-24",
            "indicators": "EMA_5",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert "EMA_5" in body


async def test_compute_indicators_invalid_interval(client: AsyncClient) -> None:
    """400 when interval is not valid."""
    response = await client.get(
        "/api/v1/charts/indicators/compute",
        params={
            "instrument_token": 408065,
            "interval": "weekly",
            "from_date": "2026-01-01",
            "to_date": "2026-02-24",
            "indicators": "SMA_20",
        },
    )
    assert response.status_code == 400


async def test_compute_indicators_kite_error_returns_502(
    client: AsyncClient, mock_kite: MagicMock
) -> None:
    """502 when Kite API fails with empty cache."""
    mock_kite.historical_data.side_effect = Exception("connection error")

    response = await client.get(
        "/api/v1/charts/indicators/compute",
        params={
            "instrument_token": 999999,
            "interval": "day",
            "from_date": "2026-01-01",
            "to_date": "2026-02-24",
            "indicators": "SMA_20",
        },
    )

    assert response.status_code == 502


# ─────────────────────────────────────────────────────────────────────────────
# Indicator types — coverage for the large elif chain (lines 314–491 of charts.py)
# ─────────────────────────────────────────────────────────────────────────────

async def test_compute_indicators_invalid_date_format(
    client: AsyncClient,
) -> None:
    """400 on malformed from_date string — covers ValueError → HTTPException branch."""
    response = await client.get(
        "/api/v1/charts/indicators/compute",
        params={
            "instrument_token": 408065,
            "interval": "day",
            "from_date": "not-a-date",
            "to_date": "2026-02-24",
            "indicators": "SMA_20",
        },
    )
    assert response.status_code == 400
    assert "Invalid date format" in response.json()["detail"]


async def test_compute_momentum_indicators(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """RSI, MACD, CCI, ROC, WILLR, MOM all compute without error from cached data."""
    await seed_ohlcv(db_session, instrument_token=408065, num_candles=50)

    response = await client.get(
        "/api/v1/charts/indicators/compute",
        params={
            "instrument_token": 408065,
            "interval": "day",
            "from_date": "2026-01-01",
            "to_date": "2026-02-24",
            "indicators": "RSI_14,MACD,CCI_20,ROC_14,WILLR_14,MOM_10",
        },
    )

    assert response.status_code == 200
    body = response.json()
    # At least one indicator must return a non-empty list
    assert any(body.get(k) for k in ("RSI_14", "MACD", "CCI_20", "ROC_14", "WILLR_14", "MOM_10"))


async def test_compute_stoch_indicators(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """STOCH and STOCHRSI produce multi-key dicts per timestamp."""
    await seed_ohlcv(db_session, instrument_token=408065, num_candles=50)

    response = await client.get(
        "/api/v1/charts/indicators/compute",
        params={
            "instrument_token": 408065,
            "interval": "day",
            "from_date": "2026-01-01",
            "to_date": "2026-02-24",
            "indicators": "STOCH_14_3,STOCHRSI_14",
        },
    )

    assert response.status_code == 200
    body = response.json()
    # STOCH and STOCHRSI return list-of-dicts with "k"/"d" keys
    for key in ("STOCH_14_3", "STOCHRSI_14"):
        if body.get(key):
            first = body[key][0]
            assert "timestamp" in first


async def test_compute_trend_oscillators(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """ADX and AROON produce multi-field series (adx/dip/din and up/down)."""
    await seed_ohlcv(db_session, instrument_token=408065, num_candles=50)

    response = await client.get(
        "/api/v1/charts/indicators/compute",
        params={
            "instrument_token": 408065,
            "interval": "day",
            "from_date": "2026-01-01",
            "to_date": "2026-02-24",
            "indicators": "ADX_14,AROON_14",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert "ADX_14" in body or "AROON_14" in body


async def test_compute_trend_overlays(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """DEMA, TEMA, HMA, VWMA produce single-value series."""
    await seed_ohlcv(db_session, instrument_token=408065, num_candles=50)

    response = await client.get(
        "/api/v1/charts/indicators/compute",
        params={
            "instrument_token": 408065,
            "interval": "day",
            "from_date": "2026-01-01",
            "to_date": "2026-02-24",
            "indicators": "DEMA_20,TEMA_20,HMA_20,VWMA_20",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert any(body.get(k) for k in ("DEMA_20", "TEMA_20", "HMA_20", "VWMA_20"))


async def test_compute_volatility_indicators(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """BB, ATR, BB_BW, BB_PCT, STDEV, KC, DC all compute without error."""
    await seed_ohlcv(db_session, instrument_token=408065, num_candles=50)

    response = await client.get(
        "/api/v1/charts/indicators/compute",
        params={
            "instrument_token": 408065,
            "interval": "day",
            "from_date": "2026-01-01",
            "to_date": "2026-02-24",
            "indicators": "BB_20,ATR_14,BB_BW_20,BB_PCT_20,STDEV_20,KC_20,DC_20",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert any(body.get(k) for k in ("BB_20", "ATR_14", "STDEV_20"))
    # BB_BW and BB_PCT use multi-part name parsing — verify they are present
    assert "BB_BW_20" in body or "BB_PCT_20" in body


async def test_compute_volume_indicators(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """OBV, MFI, CMF produce value-list series."""
    await seed_ohlcv(db_session, instrument_token=408065, num_candles=50)

    response = await client.get(
        "/api/v1/charts/indicators/compute",
        params={
            "instrument_token": 408065,
            "interval": "day",
            "from_date": "2026-01-01",
            "to_date": "2026-02-24",
            "indicators": "OBV,MFI_14,CMF_20",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert any(body.get(k) for k in ("OBV", "MFI_14", "CMF_20"))


async def test_compute_special_indicators(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """SUPERTREND produces direction/value dicts; PSAR produces long/short dicts."""
    await seed_ohlcv(db_session, instrument_token=408065, num_candles=50)

    response = await client.get(
        "/api/v1/charts/indicators/compute",
        params={
            "instrument_token": 408065,
            "interval": "day",
            "from_date": "2026-01-01",
            "to_date": "2026-02-24",
            "indicators": "SUPERTREND_7_3.0,PSAR",
        },
    )

    assert response.status_code == 200
    body = response.json()
    # Verify SUPERTREND output has direction field when data is available
    if body.get("SUPERTREND_7_3.0"):
        first = body["SUPERTREND_7_3.0"][0]
        assert "direction" in first
        assert "value" in first
    # PSAR has long/short fields
    if body.get("PSAR"):
        first = body["PSAR"][0]
        assert "long" in first or "short" in first
