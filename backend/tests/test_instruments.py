"""
Tests for /api/v1/instruments endpoints.

  GET /instruments/search?q=<query>&exchange=<NSE|BSE>
  GET /instruments/{instrument_token}
"""
from __future__ import annotations

from unittest.mock import patch

import pytest
from httpx import AsyncClient


# Helper: patch the in-memory instrument cache directly
_SAMPLE_INSTRUMENTS = {
    408065: {
        "instrument_token": 408065,
        "tradingsymbol": "INFY",
        "name": "INFOSYS LTD",
        "exchange": "NSE",
        "instrument_type": "EQ",
        "isin": "INE009A01021",
        "lot_size": 1,
        "tick_size": 0.05,
    },
    738561: {
        "instrument_token": 738561,
        "tradingsymbol": "RELIANCE",
        "name": "RELIANCE INDUSTRIES LTD",
        "exchange": "NSE",
        "instrument_type": "EQ",
        "isin": "INE002A01018",
        "lot_size": 1,
        "tick_size": 0.05,
    },
    3861249: {
        "instrument_token": 3861249,
        "tradingsymbol": "INFY",
        "name": "INFOSYS LTD",
        "exchange": "BSE",
        "instrument_type": "EQ",
        "isin": "INE009A01021",
        "lot_size": 1,
        "tick_size": 0.05,
    },
    # Non-EQ instrument — should never appear in search results
    123456: {
        "instrument_token": 123456,
        "tradingsymbol": "NIFTY23JANFUT",
        "name": "NIFTY JAN FUT",
        "exchange": "NFO",
        "instrument_type": "FUT",
        "isin": None,
        "lot_size": 50,
        "tick_size": 0.05,
    },
}


def _with_cache(instruments: dict):
    """Patch the instruments router's in-memory cache and mark it as loaded."""
    eq_list = [
        inst for inst in instruments.values()
        if inst.get("instrument_type") in ("EQ", "ETF")
    ]
    return patch.multiple(
        "backend.routers.instruments",
        _instrument_cache=instruments,
        _instrument_eq_list=eq_list,
        _cache_loaded=True,
    )


# ─────────────────────────────────────────────────────────────────────────────
# GET /instruments/search
# ─────────────────────────────────────────────────────────────────────────────

async def test_search_returns_matching_instruments(client: AsyncClient) -> None:
    """Search by symbol prefix returns matching EQ/ETF instruments."""
    with _with_cache(_SAMPLE_INSTRUMENTS):
        response = await client.get("/api/v1/instruments/search", params={"q": "INFY"})

    assert response.status_code == 200
    body = response.json()
    assert len(body["results"]) >= 1
    symbols = [r["tradingsymbol"] for r in body["results"]]
    assert "INFY" in symbols


async def test_search_filters_by_exchange(client: AsyncClient) -> None:
    """exchange filter restricts results to that exchange."""
    with _with_cache(_SAMPLE_INSTRUMENTS):
        response = await client.get(
            "/api/v1/instruments/search", params={"q": "INFY", "exchange": "BSE"}
        )

    assert response.status_code == 200
    body = response.json()
    # Only BSE INFY should appear
    exchanges = {r["exchange"] for r in body["results"]}
    assert exchanges == {"BSE"}


async def test_search_excludes_non_eq_instruments(client: AsyncClient) -> None:
    """FUT/OPT instruments must never appear in search results."""
    with _with_cache(_SAMPLE_INSTRUMENTS):
        response = await client.get("/api/v1/instruments/search", params={"q": "NIFTY"})

    assert response.status_code == 200
    instrument_types = [r.get("instrument_type") for r in response.json()["results"]]
    for t in instrument_types:
        assert t in ("EQ", "ETF", None)


async def test_search_case_insensitive(client: AsyncClient) -> None:
    """Search query is case-insensitive."""
    with _with_cache(_SAMPLE_INSTRUMENTS):
        response = await client.get("/api/v1/instruments/search", params={"q": "infy"})

    assert response.status_code == 200
    assert len(response.json()["results"]) >= 1


async def test_search_no_results(client: AsyncClient) -> None:
    """Search with no matches returns empty results list."""
    with _with_cache(_SAMPLE_INSTRUMENTS):
        response = await client.get(
            "/api/v1/instruments/search", params={"q": "XYZNOTEXIST"}
        )

    assert response.status_code == 200
    assert response.json()["results"] == []


async def test_search_exact_symbol_sorted_first(client: AsyncClient) -> None:
    """Exact symbol match appears at the top of results."""
    with _with_cache(_SAMPLE_INSTRUMENTS):
        response = await client.get("/api/v1/instruments/search", params={"q": "INFY"})

    body = response.json()
    assert body["results"][0]["tradingsymbol"] == "INFY"


async def test_search_requires_q_param(client: AsyncClient) -> None:
    """Missing q parameter returns 422."""
    response = await client.get("/api/v1/instruments/search")
    assert response.status_code == 422


# ─────────────────────────────────────────────────────────────────────────────
# GET /instruments/{instrument_token}
# ─────────────────────────────────────────────────────────────────────────────

async def test_get_instrument_returns_detail(client: AsyncClient) -> None:
    """Returns instrument detail for a known token."""
    with _with_cache(_SAMPLE_INSTRUMENTS):
        response = await client.get("/api/v1/instruments/408065")

    assert response.status_code == 200
    body = response.json()
    assert body["instrument_token"] == 408065
    assert body["tradingsymbol"] == "INFY"
    assert body["exchange"] == "NSE"
    assert body["lot_size"] == 1
    assert body["tick_size"] == pytest.approx(0.05)


async def test_get_instrument_not_found(client: AsyncClient) -> None:
    """404 when instrument token is not in cache."""
    with _with_cache(_SAMPLE_INSTRUMENTS):
        response = await client.get("/api/v1/instruments/999999999")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()
