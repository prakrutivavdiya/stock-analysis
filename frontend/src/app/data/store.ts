/**
 * Global client-side state — Zustand store
 *
 * Single source of truth for all live data and session caches.
 * In-memory only: data resets on page refresh (no browser DB).
 *
 * Replaces the former Dexie.js IndexedDB layer per user preference.
 * User preferences (theme, intervals, column order) are still in
 * localStorage via localPrefs.ts — those are the right place for
 * persisted UI settings.
 *
 * Slices:
 *   holdings        — live portfolio holdings (TTL 60s)
 *   positions       — intraday positions (TTL 60s)
 *   ordersToday     — today's orders (TTL 30s)
 *   margins         — available/used margin (TTL 30s)
 *   kpiValues       — computed KPI results per instrument per day
 *   ohlcvSession    — OHLCV candles fetched this session (by token+interval)
 *   indicatorValues — computed indicator series for the active chart
 */

import { create } from "zustand";
import type { Holding, Position, Order, Margin, GTTOrder } from "./mockData";
import type { MeResponse } from "../api/types";

// ---------------------------------------------------------------------------
// TTL constants — match DATA_MODEL spec
// ---------------------------------------------------------------------------

export const TTL_MS = {
  holdings: 60_000,
  positions: 60_000,
  ordersToday: 30_000,
  gttOrders: 30_000,
  margins: 30_000,
} as const;

/** Returns true when a cached timestamp is still within its TTL. */
export function isFresh(fetchedAt: number, ttlMs: number): boolean {
  return Date.now() - fetchedAt < ttlMs;
}

// ---------------------------------------------------------------------------
// OHLCV candle type
// ---------------------------------------------------------------------------

export interface OhlcvCandle {
  time: number;   // epoch seconds UTC (candle open time)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ---------------------------------------------------------------------------
// KPI value record
// ---------------------------------------------------------------------------

export interface KpiValueRecord {
  kpiId: string;
  instrumentToken: number;
  date: string;          // YYYY-MM-DD
  value: number | boolean | string;
}

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface CacheSlice<T> {
  data: T | null;
  fetchedAt: number; // 0 = never fetched
}

interface AppStore {
  // --- Authenticated user ---
  user: MeResponse | null;
  setUser: (u: MeResponse) => void;
  clearUser: () => void;

  // --- Live data caches ---
  holdings: CacheSlice<Holding[]>;
  positions: CacheSlice<Position[]>;
  ordersToday: CacheSlice<Order[]>;
  gttOrders: CacheSlice<GTTOrder[]>;
  margins: CacheSlice<Margin>;

  // --- KPI computed values (until next D-1 refresh) ---
  // Key: `${kpiId}::${instrumentToken}::${date}`
  kpiValues: Record<string, KpiValueRecord>;

  // --- OHLCV session cache (browser session; resets on refresh) ---
  // Key: `${instrumentToken}::${interval}`
  ohlcvSession: Record<string, OhlcvCandle[]>;

  // --- Computed indicator series for the active chart ---
  // Key: e.g. "EMA_20_408065_day"
  indicatorValues: Record<string, unknown[]>;

  // --- Actions: live data ---
  setHoldings: (data: Holding[]) => void;
  setPositions: (data: Position[]) => void;
  setOrdersToday: (data: Order[]) => void;
  setGttOrders: (data: GTTOrder[]) => void;
  setMargins: (data: Margin) => void;

  // --- Actions: KPI values ---
  setKpiValue: (
    kpiId: string,
    instrumentToken: number,
    date: string,
    value: number | boolean | string,
  ) => void;
  /** Remove all KPI values older than the given date (YYYY-MM-DD). */
  purgeStaleKpiValues: (beforeDate: string) => void;

  // --- Actions: OHLCV ---
  setOhlcv: (instrumentToken: number, interval: string, candles: OhlcvCandle[]) => void;
  getOhlcv: (instrumentToken: number, interval: string) => OhlcvCandle[] | undefined;

  // --- Actions: indicators ---
  setIndicatorSeries: (key: string, series: unknown[]) => void;
  getIndicatorSeries: (key: string) => unknown[] | undefined;
  clearIndicatorValues: () => void;

  // --- TTL helpers ---
  isHoldingsFresh: () => boolean;
  isPositionsFresh: () => boolean;
  isOrdersTodayFresh: () => boolean;
  isGttOrdersFresh: () => boolean;
  isMarginsFresh: () => boolean;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

const emptyCache = <T>(): CacheSlice<T> => ({ data: null, fetchedAt: 0 });

export const useAppStore = create<AppStore>((set, get) => ({
  // Initial state
  user: null,
  setUser: (u) => set({ user: u }),
  clearUser: () => set({ user: null }),

  // Initial state — all caches empty
  holdings: emptyCache<Holding[]>(),
  positions: emptyCache<Position[]>(),
  ordersToday: emptyCache<Order[]>(),
  gttOrders: emptyCache<GTTOrder[]>(),
  margins: emptyCache<Margin>(),
  kpiValues: {},
  ohlcvSession: {},
  indicatorValues: {},

  // --- Live data setters ---
  setHoldings: (data) =>
    set({ holdings: { data, fetchedAt: Date.now() } }),

  setPositions: (data) =>
    set({ positions: { data, fetchedAt: Date.now() } }),

  setOrdersToday: (data) =>
    set({ ordersToday: { data, fetchedAt: Date.now() } }),

  setGttOrders: (data) =>
    set({ gttOrders: { data, fetchedAt: Date.now() } }),

  setMargins: (data) =>
    set({ margins: { data, fetchedAt: Date.now() } }),

  // --- KPI value actions ---
  setKpiValue: (kpiId, instrumentToken, date, value) => {
    const key = `${kpiId}::${instrumentToken}::${date}`;
    set((state) => ({
      kpiValues: { ...state.kpiValues, [key]: { kpiId, instrumentToken, date, value } },
    }));
  },

  purgeStaleKpiValues: (beforeDate) => {
    set((state) => {
      const next: Record<string, KpiValueRecord> = {};
      for (const [k, v] of Object.entries(state.kpiValues)) {
        if (v.date >= beforeDate) next[k] = v;
      }
      return { kpiValues: next };
    });
  },

  // --- OHLCV actions ---
  setOhlcv: (instrumentToken, interval, candles) => {
    const key = `${instrumentToken}::${interval}`;
    set((state) => ({
      ohlcvSession: { ...state.ohlcvSession, [key]: candles },
    }));
  },

  getOhlcv: (instrumentToken, interval) => {
    const key = `${instrumentToken}::${interval}`;
    return get().ohlcvSession[key];
  },

  // --- Indicator actions ---
  setIndicatorSeries: (key, series) => {
    set((state) => ({
      indicatorValues: { ...state.indicatorValues, [key]: series },
    }));
  },

  getIndicatorSeries: (key) => get().indicatorValues[key],

  clearIndicatorValues: () => set({ indicatorValues: {} }),

  // --- TTL helpers ---
  isHoldingsFresh: () => isFresh(get().holdings.fetchedAt, TTL_MS.holdings),
  isPositionsFresh: () => isFresh(get().positions.fetchedAt, TTL_MS.positions),
  isOrdersTodayFresh: () => isFresh(get().ordersToday.fetchedAt, TTL_MS.ordersToday),
  isGttOrdersFresh: () => isFresh(get().gttOrders.fetchedAt, TTL_MS.gttOrders),
  isMarginsFresh: () => isFresh(get().margins.fetchedAt, TTL_MS.margins),
}));
