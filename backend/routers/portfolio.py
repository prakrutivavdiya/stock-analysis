"""
Portfolio router — 4 endpoints

  GET /portfolio/holdings   → live holdings from Kite + computed P&L
  GET /portfolio/positions  → live intraday positions from Kite
  GET /portfolio/margins    → equity margin from Kite
  GET /portfolio/summary    → aggregated view
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from backend.deps import KiteClient
from backend.schemas.portfolio import (
    EquityMargin,
    Holding,
    HoldingsResponse,
    HoldingsSummary,
    MarginsResponse,
    PortfolioSummary,
    Position,
    PositionsResponse,
)

router = APIRouter()


@router.get("/holdings", response_model=HoldingsResponse)
async def get_holdings(kite: KiteClient) -> HoldingsResponse:
    """Fetch live holdings from Kite and compute portfolio-level summary."""
    try:
        raw = await asyncio.to_thread(kite.holdings)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Kite API error: {exc}") from exc

    holdings: list[Holding] = []
    total_invested = total_current = total_pnl = total_day_change = 0.0

    for h in raw:
        qty = h.get("quantity", 0)
        t1_qty = h.get("t1_quantity", 0)
        total_qty = qty + t1_qty
        avg = h.get("average_price", 0.0)
        ltp = h.get("last_price", 0.0)
        close = h.get("close_price", ltp)
        current_val = total_qty * ltp
        invested_val = total_qty * avg
        # Use Kite's pre-computed pnl (already accounts for qty + t1_qty precisely)
        pnl = h.get("pnl", current_val - invested_val)
        pnl_pct = (pnl / invested_val * 100) if invested_val else 0.0
        # Kite's day_change is per-share; multiply by total_qty for portfolio ₹ value
        day_change = h.get("day_change", ltp - close) * total_qty
        day_change_pct = h.get("day_change_percentage", ((ltp - close) / close * 100) if close else 0.0)

        holdings.append(Holding(
            tradingsymbol=h.get("tradingsymbol", ""),
            exchange=h.get("exchange", ""),
            isin=h.get("isin", ""),
            instrument_token=h.get("instrument_token", 0),
            quantity=qty,
            t1_quantity=h.get("t1_quantity", 0),
            average_price=avg,
            last_price=ltp,
            close_price=close,
            pnl=round(pnl, 2),
            pnl_pct=round(pnl_pct, 2),
            day_change=round(day_change, 2),
            day_change_pct=round(day_change_pct, 2),
            current_value=round(current_val, 2),
            invested_value=round(invested_val, 2),
        ))

        total_invested += invested_val
        total_current += current_val
        total_pnl += pnl
        total_day_change += day_change

    total_pnl_pct = (total_pnl / total_invested * 100) if total_invested else 0.0
    total_day_change_pct = (
        (total_day_change / (total_current - total_day_change) * 100)
        if (total_current - total_day_change) else 0.0
    )

    return HoldingsResponse(
        holdings=holdings,
        summary=HoldingsSummary(
            total_invested=round(total_invested, 2),
            total_current_value=round(total_current, 2),
            total_pnl=round(total_pnl, 2),
            total_pnl_pct=round(total_pnl_pct, 2),
            total_day_change=round(total_day_change, 2),
            total_day_change_pct=round(total_day_change_pct, 2),
        ),
    )


@router.get("/positions", response_model=PositionsResponse)
async def get_positions(kite: KiteClient) -> PositionsResponse:
    """Fetch current intraday and carry-forward positions from Kite."""
    try:
        raw = await asyncio.to_thread(kite.positions)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Kite API error: {exc}") from exc

    # Kite returns {"net": [...], "day": [...]}; we use "net" for current state
    net = raw.get("net", [])
    positions = [
        Position(
            tradingsymbol=p.get("tradingsymbol", ""),
            exchange=p.get("exchange", ""),
            product=p.get("product", ""),
            instrument_token=p.get("instrument_token", 0),
            quantity=p.get("quantity", 0),
            average_price=p.get("average_price", 0.0),
            last_price=p.get("last_price", 0.0),
            pnl=round(p.get("pnl", 0.0), 2),
            unrealised=round(p.get("unrealised", 0.0), 2),
            realised=round(p.get("realised", 0.0), 2),
        )
        for p in net
    ]
    return PositionsResponse(positions=positions)


@router.get("/margins", response_model=MarginsResponse)
async def get_margins(kite: KiteClient) -> MarginsResponse:
    """Fetch equity margin details from Kite."""
    try:
        raw = await asyncio.to_thread(kite.margins)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Kite API error: {exc}") from exc

    eq = raw.get("equity", {})
    available = eq.get("available", {})
    utilised = eq.get("utilised", {})

    return MarginsResponse(
        equity=EquityMargin(
            available_cash=round(available.get("cash", 0.0), 2),
            opening_balance=round(available.get("opening_balance", 0.0), 2),
            used_debits=round(utilised.get("debits", 0.0), 2),
        )
    )


@router.get("/summary", response_model=PortfolioSummary)
async def get_summary(
    kite: KiteClient,
) -> PortfolioSummary:
    """Holdings summary + available margin."""
    try:
        holdings_raw, margins_raw = await asyncio.gather(
            asyncio.to_thread(kite.holdings),
            asyncio.to_thread(kite.margins),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Kite API error: {exc}") from exc

    total_invested = total_current = 0.0
    profitable = loss_count = 0

    for h in holdings_raw:
        qty = h.get("quantity", 0) + h.get("t1_quantity", 0)
        avg = h.get("average_price", 0.0)
        ltp = h.get("last_price", 0.0)
        inv = qty * avg
        cur = qty * ltp
        total_invested += inv
        total_current += cur
        if cur >= inv:
            profitable += 1
        else:
            loss_count += 1

    total_pnl = total_current - total_invested
    total_pnl_pct = (total_pnl / total_invested * 100) if total_invested else 0.0

    eq = margins_raw.get("equity", {}).get("available", {})
    available_margin = eq.get("cash", 0.0)

    return PortfolioSummary(
        total_invested=round(total_invested, 2),
        current_value=round(total_current, 2),
        total_pnl=round(total_pnl, 2),
        total_pnl_pct=round(total_pnl_pct, 2),
        available_margin=round(available_margin, 2),
        holdings_count=len(holdings_raw),
        profitable_count=profitable,
        loss_count=loss_count,
    )
