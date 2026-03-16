import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router";
import {
  createChart,
  ColorType,
  LineStyle,
  CandlestickSeries,
  BarSeries,
  LineSeries,
  AreaSeries,
  HistogramSeries,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { ChevronDown, Check, Search } from "lucide-react";
import { useAppStore } from "../data/store";
import { searchInstruments } from "../api/instruments";
import { apiFetch } from "../api/client";
import type { InstrumentResult } from "../api/types";
import { getChartPreferences, saveChartPreferences } from "../api/preferences";

// ---------------------------------------------------------------------------
// Intervals & chart types
// ---------------------------------------------------------------------------

const INTERVALS = [
  { label: "5m",  value: "5",   backend: "5minute"  },
  { label: "15m", value: "15",  backend: "15minute" },
  { label: "30m", value: "30",  backend: "30minute" },
  { label: "1hr", value: "60",  backend: "60minute" },
  { label: "2hr", value: "120", backend: "60minute" }, // aggregated client-side
  { label: "4hr", value: "240", backend: "60minute" }, // aggregated client-side
  { label: "D",   value: "D",   backend: "day"      },
  { label: "W",   value: "W",   backend: "day"      }, // aggregated client-side
  { label: "M",   value: "M",   backend: "day"      }, // aggregated client-side
];

const CHART_TYPES = [
  { label: "Candles", value: "candle" },
  { label: "Bars",    value: "bar"    },
  { label: "Line",    value: "line"   },
  { label: "Area",    value: "area"   },
] as const;

// ---------------------------------------------------------------------------
// Indicator catalog
// ---------------------------------------------------------------------------

type IndicatorCategory = "Trend" | "Momentum" | "Volatility" | "Volume";
type IndicatorGroup    = "overlay" | "oscillator";

interface IndicatorDef {
  key: string;
  label: string;
  category: IndicatorCategory;
  group: IndicatorGroup;
  color: string;
}

export const INDICATOR_CATALOG: IndicatorDef[] = [
  // ── Trend overlays ────────────────────────────────────────────────────────
  { key: "MA_20",          label: "MA (20)",              category: "Trend",      group: "overlay",    color: "#f59e0b" },
  { key: "MA_50",          label: "MA (50)",              category: "Trend",      group: "overlay",    color: "#fbbf24" },
  { key: "MA_200",         label: "MA (200)",             category: "Trend",      group: "overlay",    color: "#fde68a" },
  { key: "EMA_20",         label: "EMA (20)",             category: "Trend",      group: "overlay",    color: "#3b82f6" },
  { key: "EMA_50",         label: "EMA (50)",             category: "Trend",      group: "overlay",    color: "#60a5fa" },
  { key: "EMA_200",        label: "EMA (200)",            category: "Trend",      group: "overlay",    color: "#93c5fd" },
  { key: "DEMA_20",        label: "DEMA (20)",            category: "Trend",      group: "overlay",    color: "#a855f7" },
  { key: "TEMA_20",        label: "TEMA (20)",            category: "Trend",      group: "overlay",    color: "#d946ef" },
  { key: "HMA_20",         label: "Hull MA (20)",         category: "Trend",      group: "overlay",    color: "#06b6d4" },
  { key: "VWMA_20",        label: "VWMA (20)",            category: "Trend",      group: "overlay",    color: "#14b8a6" },
  { key: "VWAP",           label: "VWAP",                 category: "Trend",      group: "overlay",    color: "#fb923c" },
  { key: "SUPERTREND_7_3", label: "Supertrend (7, 3)",    category: "Trend",      group: "overlay",    color: "#22c55e" },
  { key: "PSAR",           label: "Parabolic SAR",        category: "Trend",      group: "overlay",    color: "#94a3b8" },
  // ── Trend oscillators ─────────────────────────────────────────────────────
  { key: "ADX_14",         label: "ADX / DMI (14)",       category: "Trend",      group: "oscillator", color: "#f59e0b" },
  { key: "AROON_14",       label: "Aroon (14)",           category: "Trend",      group: "oscillator", color: "#22c55e" },
  // ── Momentum oscillators ──────────────────────────────────────────────────
  { key: "RSI_14",         label: "RSI (14)",             category: "Momentum",   group: "oscillator", color: "#f59e0b" },
  { key: "STOCH_14_3",     label: "Stochastic (14, 3)",   category: "Momentum",   group: "oscillator", color: "#3b82f6" },
  { key: "STOCHRSI_14",    label: "Stoch RSI (14)",       category: "Momentum",   group: "oscillator", color: "#06b6d4" },
  { key: "MACD",           label: "MACD",                 category: "Momentum",   group: "oscillator", color: "#3b82f6" },
  { key: "CCI_20",         label: "CCI (20)",             category: "Momentum",   group: "oscillator", color: "#a855f7" },
  { key: "ROC_14",         label: "ROC (14)",             category: "Momentum",   group: "oscillator", color: "#ec4899" },
  { key: "WILLR_14",       label: "Williams %R (14)",     category: "Momentum",   group: "oscillator", color: "#f97316" },
  { key: "MOM_10",         label: "Momentum (10)",        category: "Momentum",   group: "oscillator", color: "#84cc16" },
  // ── Volatility overlays ───────────────────────────────────────────────────
  { key: "BB_20",          label: "Bollinger Bands (20)", category: "Volatility", group: "overlay",    color: "#6366f1" },
  { key: "KC_20",          label: "Keltner Channel (20)", category: "Volatility", group: "overlay",    color: "#8b5cf6" },
  { key: "DC_20",          label: "Donchian Channel (20)",category: "Volatility", group: "overlay",    color: "#7c3aed" },
  // ── Volatility oscillators ────────────────────────────────────────────────
  { key: "ATR_14",         label: "ATR (14)",             category: "Volatility", group: "oscillator", color: "#06b6d4" },
  { key: "BB_BW_20",       label: "BB Bandwidth (20)",    category: "Volatility", group: "oscillator", color: "#4f46e5" },
  { key: "BB_PCT_20",      label: "BB %B (20)",           category: "Volatility", group: "oscillator", color: "#6366f1" },
  { key: "STDEV_20",       label: "Std Deviation (20)",   category: "Volatility", group: "oscillator", color: "#94a3b8" },
  // ── Volume oscillators ────────────────────────────────────────────────────
  { key: "VOLUME",         label: "Volume",               category: "Volume",     group: "oscillator", color: "#64748b" },
  { key: "OBV",            label: "OBV",                  category: "Volume",     group: "oscillator", color: "#22d3ee" },
  { key: "MFI_14",         label: "MFI (14)",             category: "Volume",     group: "oscillator", color: "#34d399" },
  { key: "CMF_20",         label: "CMF (20)",             category: "Volume",     group: "oscillator", color: "#4ade80" },
];

const CATEGORIES: IndicatorCategory[] = ["Trend", "Momentum", "Volatility", "Volume"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CandleData {
  timestamp: string;
  open: number; high: number; low: number; close: number; volume: number;
}

interface CandleCache {
  symbol: string; exchange: string; interval: string;
  token: number;  from: string;     to: string;
  candles: CandleData[];
}

export function getDateRange(backend: string, interval?: string): { from: string; to: string } {
  const now = new Date();
  const to  = now.toISOString().slice(0, 10);
  const from = new Date(now);
  if      (interval === "M") from.setFullYear(from.getFullYear() - 5);
  else if (interval === "W") from.setFullYear(from.getFullYear() - 3);
  else if (backend === "day") from.setFullYear(from.getFullYear() - 1);
  else                        from.setDate(from.getDate() - 60);
  return { from: from.toISOString().slice(0, 10), to };
}

/** Extract NAME from spec, handling multi-part names like BB_PCT, STOCHRSI etc. */
export function getIndicatorName(spec: string): string {
  const s = spec.toUpperCase();
  for (const multi of ["BB_PCT", "BB_BW", "STOCHRSI", "SUPERTREND"]) {
    if (s === multi || s.startsWith(multi + "_")) return multi;
  }
  return s.split("_")[0];
}

// ---------------------------------------------------------------------------
// Period helpers — indicators with _N suffix support custom period editing
// ---------------------------------------------------------------------------

/** Extract the primary period number from a key like RSI_14, BB_20, STOCH_14_3 */
function parsePeriod(key: string): number | null {
  const m = key.match(/_(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Replace the first numeric segment: RSI_14 + 9 → RSI_9 */
function applyPeriod(key: string, period: number): string {
  return key.replace(/_(\d+)/, `_${period}`);
}

// ---------------------------------------------------------------------------
// Client-side candle aggregation helpers
// ---------------------------------------------------------------------------

function aggregateToNMinutes(candles: CandleData[], minutes: number): CandleData[] {
  const ms = minutes * 60 * 1000;
  const buckets = new Map<number, CandleData>();
  for (const c of candles) {
    const t = new Date(c.timestamp).getTime();
    const key = Math.floor(t / ms) * ms;
    const ex = buckets.get(key);
    if (!ex) buckets.set(key, { ...c, timestamp: new Date(key).toISOString() });
    else { ex.high = Math.max(ex.high, c.high); ex.low = Math.min(ex.low, c.low); ex.close = c.close; ex.volume += c.volume; }
  }
  return [...buckets.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function aggregateToWeekly(candles: CandleData[]): CandleData[] {
  const buckets = new Map<string, CandleData>();
  for (const c of candles) {
    const d = new Date(c.timestamp);
    const day = d.getUTCDay();
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
    const key = monday.toISOString().slice(0, 10);
    const ex = buckets.get(key);
    if (!ex) buckets.set(key, { ...c, timestamp: key + "T00:00:00.000Z" });
    else { ex.high = Math.max(ex.high, c.high); ex.low = Math.min(ex.low, c.low); ex.close = c.close; ex.volume += c.volume; }
  }
  return [...buckets.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function aggregateToMonthly(candles: CandleData[]): CandleData[] {
  const buckets = new Map<string, CandleData>();
  for (const c of candles) {
    const d = new Date(c.timestamp);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const ex = buckets.get(key);
    if (!ex) buckets.set(key, { ...c, timestamp: key + "T00:00:00.000Z" });
    else { ex.high = Math.max(ex.high, c.high); ex.low = Math.min(ex.low, c.low); ex.close = c.close; ex.volume += c.volume; }
  }
  return [...buckets.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Charts() {
  const { symbol: paramSymbol } = useParams();
  const navigate = useNavigate();

  const [symbol,    setSymbol]    = useState(paramSymbol || "INFY");
  const [exchange,  setExchange]  = useState("NSE");
  const [interval,  setInterval]  = useState("D");
  const [chartType, setChartType] = useState("candle");
  const [search,    setSearch]    = useState("");

  const [activeIndicators, setActiveIndicators] = useState<string[]>([]);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = (prefs: { interval: string; chart_type: string; active_indicators: string[] }) => {
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      saveChartPreferences(prefs).catch(() => { /* silently ignore */ });
    }, 800);
  };
  const [indicatorSearch,  setIndicatorSearch]  = useState("");
  const [showPanel,        setShowPanel]        = useState(false);
  // IND-PARAMS: inline period editing for active indicator badges
  const [editingPeriod, setEditingPeriod] = useState<{ key: string; value: string } | null>(null);

  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const containerRef   = useRef<HTMLDivElement>(null);
  const chartRef       = useRef<IChartApi | null>(null);
  const roRef          = useRef<ResizeObserver | null>(null);
  const panelRef       = useRef<HTMLDivElement>(null);
  const candleCacheRef = useRef<CandleCache | null>(null);
  // Live candle update refs — written by chart useEffect, read by tick subscriber
  const seriesRef  = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);
  const tokenRef   = useRef<number | null>(null);

  const holdingsData    = useAppStore((s) => s.holdings.data);
  const storeHoldings   = holdingsData ?? [];
  const holdingSymbols  = storeHoldings.map((h) => ({ symbol: h.symbol, exchange: h.exchange }));
  const filteredSymbols = search
    ? holdingSymbols.filter((h) => h.symbol.toLowerCase().includes(search.toLowerCase()))
    : holdingSymbols;

  const toggleIndicator = (key: string) =>
    setActiveIndicators((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      scheduleSave({ interval, chart_type: chartType, active_indicators: next });
      return next;
    });

  const selectSymbol = (sym: string, exch: string) => {
    setSymbol(sym); setExchange(exch); setSearch("");
    navigate(`/charts/${sym}`, { replace: true });
  };

  // Close panel on outside click
  useEffect(() => {
    if (!showPanel) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node))
        setShowPanel(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPanel]);

  // Load per-user chart prefs from the backend once on mount
  useEffect(() => {
    getChartPreferences()
      .then(({ chart_prefs }) => {
        setInterval(chart_prefs.interval ?? "D");
        setChartType(chart_prefs.chart_type ?? "candle");
        setActiveIndicators(chart_prefs.active_indicators ?? []);
      })
      .catch(() => { /* silently keep defaults */ })
      .finally(() => setPrefsLoaded(true));
  }, []);

  // ── Main chart effect ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !prefsLoaded) return;
    const container  = containerRef.current;
    const backendInterval = INTERVALS.find((iv) => iv.value === interval)?.backend ?? "day";
    const isIntraday = backendInterval !== "day";
    let cancelled    = false;

    const toTime = (ts: string): UTCTimestamp =>
      isIntraday
        ? (Math.floor(new Date(ts).getTime() / 1000) as UTCTimestamp)
        : (ts.slice(0, 10) as unknown as UTCTimestamp);

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // ── 1. Candles (from local cache if symbol/exchange/interval match) ──
        let token: number;
        let from:  string;
        let to:    string;
        let candles: CandleData[];

        const cached = candleCacheRef.current;
        if (
          cached &&
          cached.symbol   === symbol &&
          cached.exchange === exchange &&
          cached.interval === interval
        ) {
          ({ token, from, to, candles } = cached);
        } else {
          const { results } = await searchInstruments(symbol, exchange);
          const inst: InstrumentResult | undefined =
            results.find((r) => r.tradingsymbol === symbol && r.exchange === exchange) ?? results[0];
          if (!inst) {
            if (!cancelled) setError(`Instrument ${exchange}:${symbol} not found`);
            return;
          }
          token        = inst.instrument_token;
          ({ from, to } = getDateRange(backendInterval, interval));
          const qs = new URLSearchParams({
            interval: backendInterval, from_date: from, to_date: to,
            tradingsymbol: inst.tradingsymbol, exchange: inst.exchange,
          });
          const res = await apiFetch<{ candles: CandleData[] }>(
            `/historical/${token}?${qs}`
          );
          candles = res.candles;
          // Apply client-side aggregation for synthetic intervals
          if      (interval === "120") candles = aggregateToNMinutes(candles, 120);
          else if (interval === "240") candles = aggregateToNMinutes(candles, 240);
          else if (interval === "W")   candles = aggregateToWeekly(candles);
          else if (interval === "M")   candles = aggregateToMonthly(candles);
          candleCacheRef.current = { symbol, exchange, interval, token, from, to, candles };
        }

        if (cancelled || !containerRef.current) return;

        // ── 2. Rebuild chart ──────────────────────────────────────────────
        chartRef.current?.remove();
        chartRef.current = null;
        roRef.current?.disconnect();
        roRef.current = null;

        const chart = createChart(container, {
          layout: {
            background: { type: ColorType.Solid, color: "#0a0a0a" },
            textColor: "#9CA3AF",
            attributionLogo: false,
          },
          grid:           { vertLines: { color: "#1a1a1a" }, horzLines: { color: "#1a1a1a" } },
          rightPriceScale: { borderColor: "#2a2a2a" },
          timeScale:      { borderColor: "#2a2a2a", timeVisible: isIntraday, secondsVisible: false },
          width:  container.offsetWidth,
          height: container.offsetHeight,
        });
        chartRef.current = chart;

        // ── 3. Price series ───────────────────────────────────────────────
        const sorted   = [...candles].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        const ohlcData = sorted.map((c) => ({ time: toTime(c.timestamp), open: c.open, high: c.high, low: c.low, close: c.close }));
        const lineData = ohlcData.map((c) => ({ time: c.time, value: c.close }));

        let priceSeries: ReturnType<IChartApi["addSeries"]>;
        if      (chartType === "candle") priceSeries = chart.addSeries(CandlestickSeries, { upColor: "#22c55e", downColor: "#ef4444", borderVisible: false, wickUpColor: "#22c55e", wickDownColor: "#ef4444" });
        else if (chartType === "bar")    priceSeries = chart.addSeries(BarSeries, { upColor: "#22c55e", downColor: "#ef4444" });
        else if (chartType === "line")   priceSeries = chart.addSeries(LineSeries, { color: "#FF6600", lineWidth: 2 });
        else                             priceSeries = chart.addSeries(AreaSeries, { lineColor: "#FF6600", topColor: "rgba(255,102,0,0.4)", bottomColor: "rgba(255,102,0,0)" });
        priceSeries.setData(chartType === "candle" || chartType === "bar" ? ohlcData : lineData);
        seriesRef.current = priceSeries;
        tokenRef.current  = token;

        // ── 4. Indicators ─────────────────────────────────────────────────
        if (activeIndicators.length > 0) {
          try {
            // VOLUME is computed client-side from candle data — exclude from backend request
            const backendIndicators = activeIndicators.filter((i) => i !== "VOLUME");
            const qs2 = new URLSearchParams({
              instrument_token: String(token),
              interval: backendInterval, from_date: from, to_date: to,
              indicators: backendIndicators.join(","),
              tradingsymbol: symbol,
              exchange: exchange,
            });
            type Row = Record<string, unknown>;
            const indData: Record<string, Row[]> = backendIndicators.length > 0
              ? await apiFetch<Record<string, Row[]>>(`/charts/indicators/compute?${qs2}`)
              : {};
            if (cancelled || !chartRef.current) return;

            let oscPane = 1;

            const addLine = (data: { time: UTCTimestamp; value: number }[], color: string, pane = 0, opts: Record<string, unknown> = {}) =>
              chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: pane === 0, ...opts } as Parameters<typeof chart.addSeries>[1], pane).setData(data);

            const valueList = (rows: Row[], f = "value") =>
              (rows ?? []).filter((r) => r[f] != null).map((r) => ({ time: toTime(r.timestamp as string), value: r[f] as number }));

            for (const spec of activeIndicators) {
              const name  = getIndicatorName(spec);
              const def   = INDICATOR_CATALOG.find((d) => d.key === spec);
              const color = def?.color ?? "#9CA3AF";
              const rows  = (indData[spec] ?? []) as Row[];

              // ── Overlays ────────────────────────────────────────────────
              if (["MA", "SMA", "EMA", "DEMA", "TEMA", "HMA", "VWMA", "VWAP"].includes(name)) {
                addLine(valueList(rows), color, 0);

              } else if (["BB", "KC", "DC"].includes(name)) {
                const baseOpts = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false };
                chart.addSeries(LineSeries, { ...baseOpts, color }, 0).setData(valueList(rows, "upper"));
                chart.addSeries(LineSeries, { ...baseOpts, color, lineStyle: LineStyle.Dashed }, 0).setData(valueList(rows, "middle"));
                chart.addSeries(LineSeries, { ...baseOpts, color }, 0).setData(valueList(rows, "lower"));

              } else if (name === "SUPERTREND") {
                type STRow = { timestamp: string; value: number | null; direction: number | null };
                const stRows = rows as STRow[];
                const bullish = stRows.filter((r) => r.value != null && r.direction === 1).map((r) => ({ time: toTime(r.timestamp), value: r.value! }));
                const bearish = stRows.filter((r) => r.value != null && r.direction === -1).map((r) => ({ time: toTime(r.timestamp), value: r.value! }));
                if (bullish.length) addLine(bullish, "#22c55e", 0, { lineWidth: 2 });
                if (bearish.length) addLine(bearish, "#ef4444", 0, { lineWidth: 2 });

              } else if (name === "PSAR") {
                type PSARRow = { timestamp: string; long: number | null; short: number | null };
                const pRows = rows as PSARRow[];
                const dotOpts = { lineWidth: 1 as const, lineStyle: LineStyle.SparseDotted, priceLineVisible: false, lastValueVisible: false };
                const longPts  = pRows.filter((r) => r.long  != null).map((r) => ({ time: toTime(r.timestamp), value: r.long!  }));
                const shortPts = pRows.filter((r) => r.short != null).map((r) => ({ time: toTime(r.timestamp), value: r.short! }));
                if (longPts.length)  chart.addSeries(LineSeries, { ...dotOpts, color: "#22c55e" }, 0).setData(longPts);
                if (shortPts.length) chart.addSeries(LineSeries, { ...dotOpts, color: "#ef4444" }, 0).setData(shortPts);

              // ── Trend oscillators ────────────────────────────────────────
              } else if (name === "ADX") {
                const pane = oscPane++;
                addLine(valueList(rows, "adx"), "#f59e0b", pane);
                addLine(valueList(rows, "dip"), "#22c55e", pane);
                addLine(valueList(rows, "din"), "#ef4444", pane);

              } else if (name === "AROON") {
                const pane = oscPane++;
                addLine(valueList(rows, "up"),   "#22c55e", pane);
                addLine(valueList(rows, "down"),  "#ef4444", pane);

              // ── Momentum oscillators ─────────────────────────────────────
              } else if (name === "RSI") {
                const pane = oscPane++;
                const s = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false }, pane);
                s.setData(valueList(rows));
                s.createPriceLine({ price: 70, color: "#ef4444", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "OB" });
                s.createPriceLine({ price: 30, color: "#22c55e", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "OS" });

              } else if (name === "STOCH" || name === "STOCHRSI") {
                const pane = oscPane++;
                const s = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false }, pane);
                s.setData(valueList(rows, "k"));
                addLine(valueList(rows, "d"), "#f59e0b", pane);
                s.createPriceLine({ price: 80, color: "#ef4444", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
                s.createPriceLine({ price: 20, color: "#22c55e", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });

              } else if (name === "MACD") {
                type MACDRow = { timestamp: string; macd: number | null; signal: number | null; histogram: number | null };
                const mRows = (indData["MACD"] ?? []) as MACDRow[];
                const valid  = mRows.filter((r) => r.macd != null);
                const pane   = oscPane++;
                addLine(valid.map((r) => ({ time: toTime(r.timestamp), value: r.macd!   })), "#3b82f6", pane);
                addLine(valid.map((r) => ({ time: toTime(r.timestamp), value: r.signal! })), "#f59e0b", pane);
                chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane)
                  .setData(valid.map((r) => ({ time: toTime(r.timestamp), value: r.histogram!, color: (r.histogram ?? 0) >= 0 ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.6)" })));

              } else if (name === "CCI") {
                const pane = oscPane++;
                const s = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false }, pane);
                s.setData(valueList(rows));
                s.createPriceLine({ price:  100, color: "#ef4444", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "+100" });
                s.createPriceLine({ price: -100, color: "#22c55e", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "-100" });

              } else if (name === "WILLR") {
                const pane = oscPane++;
                const s = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false }, pane);
                s.setData(valueList(rows));
                s.createPriceLine({ price: -20, color: "#ef4444", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "-20" });
                s.createPriceLine({ price: -80, color: "#22c55e", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "-80" });

              // ── Volume histogram (client-side, no backend call needed) ───
              } else if (name === "VOLUME") {
                const volData = sorted.map((c) => ({ time: toTime(c.timestamp), value: c.volume ?? 0 }));
                chart.addSeries(HistogramSeries, {
                  color: "#64748b",
                  priceFormat: { type: "volume" },
                  priceScaleId: "vol",
                } as Parameters<typeof chart.addSeries>[1], oscPane++).setData(volData);

              // ── Generic single-line oscillator ───────────────────────────
              } else {
                addLine(valueList(rows), color, oscPane++);
              }
            }
          } catch {
            // Non-fatal — price chart still renders
          }
        }

        chart.timeScale().fitContent();

        // ── Resize observer ───────────────────────────────────────────────
        const ro = new ResizeObserver(() => {
          if (containerRef.current && chartRef.current)
            chartRef.current.resize(containerRef.current.offsetWidth, containerRef.current.offsetHeight);
        });
        ro.observe(container);
        roRef.current = ro;

      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load chart");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      chartRef.current?.remove();  chartRef.current = null;
      roRef.current?.disconnect(); roRef.current    = null;
    };
  }, [symbol, exchange, interval, chartType, activeIndicators, retryKey, prefsLoaded]);

  // ── Live candle updates from KiteTicker ───────────────────────────────────
  useEffect(() => {
    const backendInterval = INTERVALS.find((iv) => iv.value === interval)?.backend ?? "day";
    const isIntraday = backendInterval !== "day";
    // Use the interval value directly (e.g. "120" → 120 min for 2hr), not the backend string
    const intervalMins = isIntraday ? parseInt(interval) : 0;

    return useAppStore.subscribe((state, prevState) => {
      const token = tokenRef.current ?? -1;
      if (token === -1) return;
      const tick = state.livePrices[token];
      if (!tick || tick === prevState.livePrices[token] || !seriesRef.current) return;
      const tradeTime = tick.last_trade_time ? new Date(tick.last_trade_time) : new Date();
      let t: UTCTimestamp;
      if (!isIntraday) {
        t = tradeTime.toISOString().slice(0, 10) as unknown as UTCTimestamp;
      } else {
        const ms = intervalMins * 60 * 1000;
        t = (Math.floor(tradeTime.getTime() / ms) * ms / 1000) as UTCTimestamp;
      }
      try {
        seriesRef.current.update({ time: t, open: tick.open, high: tick.high, low: tick.low, close: tick.ltp });
      } catch {
        // series may have been removed during chart rebuild
      }
    });
  }, [interval]);

  // ── Filtered indicator list for panel ─────────────────────────────────────
  const filteredCatalog = indicatorSearch
    ? INDICATOR_CATALOG.filter((d) =>
        d.label.toLowerCase().includes(indicatorSearch.toLowerCase()) ||
        d.key.toLowerCase().includes(indicatorSearch.toLowerCase())
      )
    : INDICATOR_CATALOG;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex h-full">
      {/* Symbol sidebar */}
      <aside className="w-48 shrink-0 border-r border-[#2a2a2a] flex flex-col bg-[#0f0f0f]">
        <div className="p-3 border-b border-[#2a2a2a]">
          <input
            type="text" placeholder="Search holdings…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:border-[#FF6600]"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredSymbols.map((h) => (
            <button
              key={`${h.exchange}:${h.symbol}`}
              onClick={() => selectSymbol(h.symbol, h.exchange)}
              className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                symbol === h.symbol ? "bg-[#2a2a2a] text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-[#1a1a1a]"
              }`}
            >
              <div className="font-medium">{h.symbol}</div>
              <div className="text-xs text-muted-foreground">{h.exchange}</div>
            </button>
          ))}
        </div>
      </aside>

      {/* Chart area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-[#2a2a2a] bg-[#121212]">
          <span className="text-sm font-medium mr-2">{exchange}:{symbol}</span>

          {/* Chart type */}
          <div className="flex items-center gap-1 border-r border-[#2a2a2a] pr-3 mr-1">
            {CHART_TYPES.map((ct) => (
              <button key={ct.value} onClick={() => {
                setChartType(ct.value);
                scheduleSave({ interval, chart_type: ct.value, active_indicators: activeIndicators });
              }}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${chartType === ct.value ? "bg-[#FF6600] text-white" : "text-muted-foreground hover:text-foreground hover:bg-[#2a2a2a]"}`}>
                {ct.label}
              </button>
            ))}
          </div>

          {/* Indicators button + dropdown */}
          <div className="relative" ref={panelRef}>
            <button
              onClick={() => setShowPanel((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded border transition-colors ${showPanel ? "border-[#FF6600] text-foreground bg-[#1a1a1a]" : "border-[#2a2a2a] text-muted-foreground hover:text-foreground hover:bg-[#1a1a1a]"}`}
            >
              Indicators
              {activeIndicators.length > 0 && (
                <span className="bg-[#FF6600] text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                  {activeIndicators.length}
                </span>
              )}
              <ChevronDown className="w-3 h-3" />
            </button>

            {showPanel && (
              <div className="absolute top-full left-0 mt-1 w-72 bg-[#121212] border border-[#2a2a2a] rounded-lg shadow-2xl z-50 flex flex-col" style={{ maxHeight: "560px" }}>
                {/* Search */}
                <div className="p-2 border-b border-[#2a2a2a] shrink-0">
                  <div className="flex items-center gap-1.5 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1">
                    <Search className="w-3 h-3 text-muted-foreground shrink-0" />
                    <input
                      type="text" placeholder="Search indicators…" value={indicatorSearch}
                      onChange={(e) => setIndicatorSearch(e.target.value)}
                      className="bg-transparent text-xs w-full focus:outline-none placeholder:text-muted-foreground"
                      autoFocus
                    />
                  </div>
                </div>

                {/* Scrollable list */}
                <div className="overflow-y-auto flex-1">
                  {CATEGORIES.map((cat) => {
                    const items = filteredCatalog.filter((d) => d.category === cat);
                    if (items.length === 0) return null;
                    return (
                      <div key={cat}>
                        <p className="px-3 pt-2.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {cat}
                        </p>
                        {items.map((ind) => {
                          const active = activeIndicators.includes(ind.key);
                          return (
                            <button key={ind.key} onClick={() => toggleIndicator(ind.key)}
                              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#1a1a1a] transition-colors">
                              <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${active ? "bg-[#FF6600] border-[#FF6600]" : "border-[#3a3a3a]"}`}>
                                {active && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                              </div>
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ind.color }} />
                              <span className="text-xs text-foreground text-left">{ind.label}</span>
                              <span className={`ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded border ${ind.group === "overlay" ? "text-amber-400 border-amber-900/50 bg-amber-950/30" : "text-sky-400 border-sky-900/50 bg-sky-950/30"}`}>
                                {ind.group === "overlay" ? "Overlay" : "Indicator"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                  {filteredCatalog.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-6">No indicators found</p>
                  )}
                  <div className="h-2" />
                </div>
              </div>
            )}
          </div>

          {/* Intervals */}
          <div className="flex items-center gap-1 ml-auto">
            {INTERVALS.map((iv) => (
              <button key={iv.value} onClick={() => {
                setInterval(iv.value);
                scheduleSave({ interval: iv.value, chart_type: chartType, active_indicators: activeIndicators });
              }}
                className={`px-3 py-1 text-xs rounded transition-colors ${interval === iv.value ? "bg-[#FF6600] text-white" : "text-muted-foreground hover:text-foreground hover:bg-[#2a2a2a]"}`}>
                {iv.label}
              </button>
            ))}
          </div>
        </div>

        {/* Active indicator badges — click period to edit inline */}
        {activeIndicators.length > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-[#2a2a2a] bg-[#0f0f0f] flex-wrap">
            {activeIndicators.map((key) => {
              const def = INDICATOR_CATALOG.find((d) => d.key === key);
              const period = parsePeriod(key);
              const isEditing = editingPeriod?.key === key;
              return (
                <span key={key} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-[#1a1a1a] border border-[#2a2a2a]">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: def?.color }} />
                  <span>{def?.label?.replace(/\s*\(\d+.*\)$/, "") ?? key.replace(/_\d+.*$/, "")}</span>
                  {period !== null && (
                    isEditing ? (
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={editingPeriod.value}
                        onChange={(e) => setEditingPeriod({ key, value: e.target.value })}
                        onBlur={() => {
                          const n = parseInt(editingPeriod.value, 10);
                          if (n > 0) {
                            setActiveIndicators((prev) => {
                              const next = prev.map((k) => k === key ? applyPeriod(k, n) : k);
                              scheduleSave({ interval, chart_type: chartType, active_indicators: next });
                              return next;
                            });
                          }
                          setEditingPeriod(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setEditingPeriod(null);
                        }}
                        autoFocus
                        className="w-10 bg-[#0a0a0a] border border-[#FF6600] rounded px-1 text-[11px] text-center focus:outline-none"
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`period-input-${key}`}
                      />
                    ) : (
                      <button
                        onClick={() => setEditingPeriod({ key, value: String(period) })}
                        title="Click to change period"
                        className="text-[#FF6600] hover:text-[#ff7700] font-mono leading-none"
                        data-testid={`period-btn-${key}`}
                      >
                        ({period})
                      </button>
                    )
                  )}
                  <button onClick={() => toggleIndicator(key)} className="ml-0.5 text-muted-foreground hover:text-foreground leading-none">×</button>
                </span>
              );
            })}
          </div>
        )}

        {/* Chart mount point */}
        <div className="flex-1 min-h-0 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a] z-10">
              <span className="text-sm text-muted-foreground animate-pulse">Loading chart…</span>
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10">
              <span className="text-sm text-red-400">{error}</span>
              <button onClick={() => setRetryKey((k) => k + 1)} className="text-xs text-[#FF6600] hover:underline">Retry</button>
            </div>
          )}
          <div ref={containerRef} className="w-full h-full" />
        </div>
      </div>
    </div>
  );
}
