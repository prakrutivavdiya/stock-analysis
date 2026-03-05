import { apiFetch } from "./client";
import type {
  HoldingsResponse,
  PositionsResponse,
  MarginsResponse,
  PortfolioSummary,
  ApiHolding,
  ApiPosition,
} from "./types";
import type { Holding, Position, Margin } from "../data/mockData";

export function getHoldings(): Promise<HoldingsResponse> {
  return apiFetch<HoldingsResponse>("/portfolio/holdings");
}

export function getPositions(): Promise<PositionsResponse> {
  return apiFetch<PositionsResponse>("/portfolio/positions");
}

export function getMargins(): Promise<MarginsResponse> {
  return apiFetch<MarginsResponse>("/portfolio/margins");
}

export function getPortfolioSummary(): Promise<PortfolioSummary> {
  return apiFetch<PortfolioSummary>("/portfolio/summary");
}

// ---------------------------------------------------------------------------
// Mappers: snake_case API → camelCase frontend types
// ---------------------------------------------------------------------------

export function mapHolding(h: ApiHolding): Holding {
  return {
    symbol: h.tradingsymbol,
    exchange: h.exchange,
    quantity: h.quantity,
    t1Quantity: h.t1_quantity,
    avgPrice: h.average_price,
    ltp: h.last_price,
    dayChange: h.day_change,
    dayChangePercent: h.day_change_pct,
    pnl: h.pnl,
    pnlPercent: h.pnl_pct,
    currentValue: h.current_value,
    investedValue: h.invested_value,
    kpis: {},
  };
}

export function mapPosition(p: ApiPosition): Position {
  return {
    symbol: p.tradingsymbol,
    exchange: p.exchange,
    product: p.product,
    quantity: p.quantity,
    avgPrice: p.average_price,
    ltp: p.last_price,
    unrealisedPnl: p.unrealised,
    m2mPnl: p.pnl,
  };
}

export function mapMargins(m: MarginsResponse): Margin {
  return {
    available: m.equity.available_cash,
    used: m.equity.used_debits,
    total: m.equity.opening_balance,
  };
}
