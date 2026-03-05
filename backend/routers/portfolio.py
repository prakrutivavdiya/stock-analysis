"""
Portfolio router — 4 endpoints

  GET /portfolio/holdings   → live holdings from Kite + computed P&L
  GET /portfolio/positions  → live intraday positions from Kite
  GET /portfolio/margins    → equity margin from Kite
  GET /portfolio/summary    → aggregated view + XIRR
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone

# IST offset for date calculations
_IST = timezone(timedelta(hours=5, minutes=30))

from fastapi import APIRouter, HTTPException
from sqlalchemy import and_, select

from backend.deps import CurrentUser, DBSession, KiteClient
from backend.models import AuditLog
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
        avg = h.get("average_price", 0.0)
        ltp = h.get("last_price", 0.0)
        close = h.get("close_price", ltp)
        current_val = qty * ltp
        invested_val = qty * avg
        pnl = current_val - invested_val
        pnl_pct = (pnl / invested_val * 100) if invested_val else 0.0
        day_change = (ltp - close) * qty
        day_change_pct = ((ltp - close) / close * 100) if close else 0.0

        holdings.append(Holding(
            tradingsymbol=h.get("tradingsymbol", ""),
            exchange=h.get("exchange", ""),
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
    current_user: CurrentUser,
    db: DBSession,
) -> PortfolioSummary:
    """Holdings summary + available margin + XIRR from audit log."""
    try:
        holdings_raw, margins_raw = await asyncio.gather(
            asyncio.to_thread(kite.holdings),
            asyncio.to_thread(kite.margins),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Kite API error: {exc}") from exc

    total_invested = total_current = 0.0
    profitable = loss_count = 0
    held_symbols: set[str] = set()

    for h in holdings_raw:
        qty = h.get("quantity", 0)
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
        held_symbols.add(h.get("tradingsymbol", ""))

    total_pnl = total_current - total_invested
    total_pnl_pct = (total_pnl / total_invested * 100) if total_invested else 0.0

    eq = margins_raw.get("equity", {}).get("available", {})
    available_margin = eq.get("cash", 0.0)

    # XIRR from audit_logs BUY entries for current holdings
    xirr_val: float | None = None
    try:
        result = await db.execute(
            select(AuditLog).where(
                and_(
                    AuditLog.user_id == current_user.id,
                    AuditLog.action_type == "PLACE_ORDER",
                    AuditLog.outcome == "SUCCESS",
                    AuditLog.tradingsymbol.in_(held_symbols),
                )
            )
        )
        buy_logs = result.scalars().all()
        if buy_logs:
            cashflows = []
            cf_dates = []
            for log_row in buy_logs:
                params = log_row.order_params or {}
                if params.get("transaction_type") == "BUY":
                    qty = params.get("quantity", 0)
                    price = params.get("average_price") or params.get("price") or 0.0
                    amount = -(qty * price)  # outflow is negative
                    if amount and log_row.created_at:
                        cashflows.append(amount)
                        ts = log_row.created_at
                        if ts.tzinfo is None:
                            ts = ts.replace(tzinfo=timezone.utc)
                        cf_dates.append(ts.date())
            if cashflows and total_current > 0:
                # Terminal cash flow = current portfolio value (positive inflow)
                # Use IST date to stay consistent with market dates
                cashflows.append(total_current)
                cf_dates.append(datetime.now(_IST).date())
                from pyxirr import xirr as _xirr
                xirr_val = _xirr(cf_dates, cashflows)
                if xirr_val is not None:
                    xirr_val = round(xirr_val * 100, 2)  # convert to %
    except Exception:
        xirr_val = None  # XIRR is best-effort; never block the summary

    return PortfolioSummary(
        total_invested=round(total_invested, 2),
        current_value=round(total_current, 2),
        total_pnl=round(total_pnl, 2),
        total_pnl_pct=round(total_pnl_pct, 2),
        available_margin=round(available_margin, 2),
        holdings_count=len(holdings_raw),
        profitable_count=profitable,
        loss_count=loss_count,
        xirr=xirr_val,
    )
