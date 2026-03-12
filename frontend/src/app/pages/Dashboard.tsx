import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Plus,
  X,
  AlertTriangle,
  SlidersHorizontal,
  RefreshCw,
  Filter,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import type { Holding } from "../data/mockData";
import { useAppStore, TTL_MS, isFresh } from "../data/store";
import {
  getHoldings,
  getPositions,
  getMargins,
  getPortfolioSummary,
  mapHolding,
  mapPosition,
  mapMargins,
} from "../api/portfolio";
import { getKpiPortfolio } from "../api/kpis";
import { getPreferences, savePreferences } from "../api/preferences";
import { visibleHoldingsColumns, holdingsSort } from "../data/localPrefs";
import { ApiError } from "../api/client";

// ── Column definitions ─────────────────────────────────────────────────────

type ColId =
  // Standard columns
  | "exchange"
  | "quantity"
  | "t1Quantity"
  | "avgPrice"
  | "ltp"
  | "dayChange"
  | "dayChangePercent"
  | "pnl"
  | "pnlPercent"
  | "currentValue"
  | "investedValue"
  // KPI columns
  | "dailyRSI"
  | "rsiOverbought"
  | "bbPosition"
  | "peRatio"
  | "from52WeekHigh"
  | "eps";

interface ColDef {
  id: ColId;
  label: string;
  group: "standard" | "kpi";
  align?: "right";
  format?: (h: Holding) => React.ReactNode;
}

const ALL_COLUMNS: ColDef[] = [
  // Standard
  { id: "exchange", label: "Exchange", group: "standard" },
  { id: "quantity", label: "Qty", group: "standard", align: "right", format: (h) => h.quantity },
  { id: "t1Quantity", label: "T+1 Qty", group: "standard", align: "right", format: (h) => h.t1Quantity > 0 ? <span className="text-amber-400">{h.t1Quantity}</span> : h.t1Quantity },
  { id: "avgPrice", label: "Avg Buy Price", group: "standard", align: "right", format: (h) => `₹${h.avgPrice.toFixed(2)}` },
  { id: "ltp", label: "LTP", group: "standard", align: "right", format: (h) => `₹${h.ltp.toFixed(2)}` },
  // PD-01 / US-010: Day Change (₹)
  {
    id: "dayChange",
    label: "Day Chg (₹)",
    group: "standard",
    align: "right",
    format: (h) => (
      <span className={h.dayChange >= 0 ? "text-green-400" : "text-red-400"}>
        {h.dayChange >= 0 ? "+" : ""}₹{h.dayChange.toFixed(2)}
      </span>
    ),
  },
  {
    id: "dayChangePercent",
    label: "Day Chg%",
    group: "standard",
    align: "right",
    format: (h) => (
      <span className={h.dayChangePercent >= 0 ? "text-green-400" : "text-red-400"}>
        {h.dayChangePercent >= 0 ? "+" : ""}{h.dayChangePercent.toFixed(2)}%
      </span>
    ),
  },
  {
    id: "pnl",
    label: "Total P&L",
    group: "standard",
    align: "right",
    format: (h) => (
      <span className={h.pnl >= 0 ? "text-green-400" : "text-red-400"}>
        {h.pnl >= 0 ? "+" : ""}₹{h.pnl.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
      </span>
    ),
  },
  {
    id: "pnlPercent",
    label: "P&L%",
    group: "standard",
    align: "right",
    format: (h) => (
      <span className={h.pnlPercent >= 0 ? "text-green-400" : "text-red-400"}>
        {h.pnlPercent >= 0 ? "+" : ""}{h.pnlPercent.toFixed(2)}%
      </span>
    ),
  },
  {
    id: "currentValue",
    label: "Curr Value",
    group: "standard",
    align: "right",
    format: (h) => `₹${h.currentValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
  },
  {
    id: "investedValue",
    label: "Invested",
    group: "standard",
    align: "right",
    format: (h) => `₹${h.investedValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
  },
  // KPI columns
  {
    id: "dailyRSI",
    label: "RSI (14)",
    group: "kpi",
    align: "right",
    format: (h) => (h.kpis?.dailyRSI != null ? (h.kpis.dailyRSI as number).toFixed(1) : "—"),
  },
  {
    id: "rsiOverbought",
    label: "RSI >70",
    group: "kpi",
    align: "right",
    format: (h) => {
      const val = h.kpis?.rsiOverbought;
      if (val == null) return "—";
      return val ? (
        <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-red-900/30 text-red-400">
          true
        </span>
      ) : (
        <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-[#2a2a2a] text-muted-foreground">
          false
        </span>
      );
    },
  },
  {
    id: "bbPosition",
    label: "BB Signal",
    group: "kpi",
    align: "right",
    format: (h) => {
      const v = h.kpis?.bbPosition;
      if (!v) return "—";
      // PRD KP-11: title-case values
      const styles: Record<"Buy Signal" | "Sell Signal" | "Hold", string> = {
        "Buy Signal": "bg-green-900/30 text-green-400",
        "Sell Signal": "bg-red-900/30 text-red-400",
        "Hold": "bg-[#2a2a2a] text-muted-foreground",
      };
      return (
        <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${styles[v]}`}>
          {v}
        </span>
      );
    },
  },
  {
    id: "peRatio",
    label: "P/E",
    group: "kpi",
    align: "right",
    // PRD KP-12: show "N/A" when fundamental data unavailable
    format: (h) => h.kpis?.peRatio != null ? h.kpis.peRatio.toFixed(1) : "N/A",
  },
  {
    id: "from52WeekHigh",
    label: "% from 52W High",
    group: "kpi",
    align: "right",
    format: (h) => {
      const v = h.kpis?.from52WeekHigh;
      if (v == null) return "N/A";
      return (
        <span className={v >= 0 ? "text-green-400" : "text-red-400"}>
          {v >= 0 ? "+" : ""}{v.toFixed(1)}%
        </span>
      );
    },
  },
  {
    id: "eps",
    label: "EPS",
    group: "kpi",
    align: "right",
    // PRD KP-12: "N/A" for unavailable fundamental data
    format: (h) => h.kpis?.eps != null ? h.kpis.eps.toFixed(2) : "N/A",
  },
];

const DEFAULT_COLS: ColId[] = [
  "quantity",
  "avgPrice",
  "ltp",
  "dayChange",
  "dayChangePercent",
  "pnl",
  "pnlPercent",
  "currentValue",
];

type SortKey = string;
type SortDir = "asc" | "desc";
type FilterKey = "all" | "gainers" | "losers" | "rsiOverbought" | "bbBuy" | "bbSell";
type ColFilterType = "text" | "range" | "boolean" | "categorical";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "symbol", label: "Symbol" },
  { value: "dayChangePercent", label: "Day Change %" },
  { value: "pnlPercent", label: "Total P&L %" },
  { value: "pnl", label: "Total P&L (₹)" },
  { value: "ltp", label: "LTP" },
  { value: "currentValue", label: "Current Value" },
];

const FILTER_OPTIONS: { value: FilterKey; label: string }[] = [
  { value: "all", label: "All holdings" },
  { value: "gainers", label: "Gainers today" },
  { value: "losers", label: "Losers today" },
  { value: "rsiOverbought", label: "RSI Overbought" },
  { value: "bbBuy", label: "BB Buy Signal" },
  { value: "bbSell", label: "BB Sell Signal" },
];

const COL_FILTER_TYPES: Record<string, ColFilterType> = {
  symbol: "text",
  exchange: "text",
  quantity: "range",
  t1Quantity: "range",
  avgPrice: "range",
  ltp: "range",
  dayChange: "range",
  dayChangePercent: "range",
  pnl: "range",
  pnlPercent: "range",
  currentValue: "range",
  investedValue: "range",
  dailyRSI: "range",
  rsiOverbought: "boolean",
  bbPosition: "categorical",
  peRatio: "range",
  from52WeekHigh: "range",
  eps: "range",
};

const BB_POSITION_VALUES = ["Buy Signal", "Sell Signal", "Hold"];

export default function Dashboard() {
  const navigate = useNavigate();
  const [visibleCols, setVisibleCols] = useState<ColId[]>(() => {
    const saved = visibleHoldingsColumns.get();
    return saved.length > 0 ? (saved as ColId[]) : DEFAULT_COLS;
  });
  const [userKpis, setUserKpis] = useState<{ name: string; returnType: string }[]>([]);
  const [visibleUserKpis, setVisibleUserKpis] = useState<string[]>([]);
  const [showColPicker, setShowColPicker] = useState(false);
  const [dragColId, setDragColId] = useState<ColId | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [showPositions, setShowPositions] = useState(true);
  const [loading, setLoading] = useState(false);
  const [xirr, setXirr] = useState<number | null>(null);

  const savedSort = holdingsSort.get();
  const [sortKey, setSortKey] = useState<SortKey>((savedSort.column as SortKey) || "symbol");
  const [sortDir, setSortDir] = useState<SortDir>(savedSort.direction);

  // PD-09: Load preferences from backend on mount; fall back to localStorage
  useEffect(() => {
    getPreferences()
      .then(({ preferences: p }) => {
        if (p.visible_holdings_columns.length > 0) {
          setVisibleCols(p.visible_holdings_columns as ColId[]);
          visibleHoldingsColumns.set(p.visible_holdings_columns);
        }
        if (p.holdings_sort.column) {
          setSortKey(p.holdings_sort.column as SortKey);
          setSortDir(p.holdings_sort.direction);
          holdingsSort.set(p.holdings_sort);
        }
      })
      .catch(() => { /* offline or unauthenticated — use localStorage values already set */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // PD-09: Persist column visibility to localStorage + backend after every change (skip first mount)
  const colsInitialized = useRef(false);
  useEffect(() => {
    if (!colsInitialized.current) { colsInitialized.current = true; return; }
    visibleHoldingsColumns.set(visibleCols);
    savePreferences({
      visible_holdings_columns: visibleCols,
      holdings_sort: { column: sortKey, direction: sortDir },
    }).catch(() => {}); // best-effort — localStorage is the fallback
  }, [visibleCols]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortInitialized = useRef(false);
  useEffect(() => {
    if (!sortInitialized.current) { sortInitialized.current = true; return; }
    holdingsSort.set({ column: sortKey, direction: sortDir });
    savePreferences({
      visible_holdings_columns: visibleCols,
      holdings_sort: { column: sortKey, direction: sortDir },
    }).catch(() => {}); // best-effort
  }, [sortKey, sortDir]); // eslint-disable-line react-hooks/exhaustive-deps
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [filterPopover, setFilterPopover] = useState<string | null>(null);

  // Close filter popover on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest("[data-filter-popover]")) {
        setFilterPopover(null);
      }
    };
    if (filterPopover !== null) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [filterPopover]);

  // Zustand store
  const storeHoldings = useAppStore((s) => s.holdings);
  const storePositions = useAppStore((s) => s.positions);
  const storeMargins = useAppStore((s) => s.margins);
  const livePrices = useAppStore((s) => s.livePrices);
  const setStoreHoldings = useAppStore((s) => s.setHoldings);
  const setStorePositions = useAppStore((s) => s.setPositions);
  const setStoreMargins = useAppStore((s) => s.setMargins);

  const holdings: Holding[] = storeHoldings.data ?? [];
  const positions = storePositions.data ?? [];
  const margin = storeMargins.data;

  const fetchData = async () => {
    setLoading(true);
    try {
      const promises: Promise<void>[] = [];

      if (!isFresh(storeHoldings.fetchedAt, TTL_MS.holdings)) {
        promises.push(
          getHoldings().then((res) => {
            setStoreHoldings(res.holdings.map(mapHolding));
          })
        );
      }

      if (!isFresh(storePositions.fetchedAt, TTL_MS.positions)) {
        promises.push(
          getPositions().then((res) => {
            setStorePositions(res.positions.map(mapPosition));
          })
        );
      }

      if (!isFresh(storeMargins.fetchedAt, TTL_MS.margins)) {
        promises.push(
          Promise.all([getMargins(), getPortfolioSummary()]).then(
            ([marginsRes, summaryRes]) => {
              setStoreMargins(mapMargins(marginsRes));
              setXirr(summaryRes.xirr);
            }
          )
        );
      }

      await Promise.all(promises);

      // Fetch KPI portfolio values and merge into holdings
      try {
        const kpiRes = await getKpiPortfolio();
        // Build a map: tradingsymbol → flat kpi values (extract .value from each entry)
        const kpiMap = new Map(
          kpiRes.results.map((r) => {
            const flat: Record<string, unknown> = {};
            for (const [name, data] of Object.entries(r.kpi_values)) {
              flat[name] = (data as { value: unknown }).value;
            }
            return [r.tradingsymbol, flat];
          })
        );
        // Update holdings in store with merged kpi data
        const currentHoldings = useAppStore.getState().holdings.data ?? [];
        if (currentHoldings.length > 0) {
          const merged = currentHoldings.map((h) => ({
            ...h,
            kpis: { ...h.kpis, ...(kpiMap.get(h.symbol) ?? {}) },
          }));
          setStoreHoldings(merged);
        }
        // Store user-defined KPI metadata for dynamic columns
        if (kpiRes.kpis?.length > 0) {
          setUserKpis(kpiRes.kpis.map((k) => ({ name: k.name, returnType: k.return_type })));
          setVisibleUserKpis((prev) =>
            prev.length > 0 ? prev : kpiRes.kpis.map((k) => k.name)
          );
        }
      } catch {
        // KPI portfolio is non-critical; ignore failures silently
      }
    } catch (err) {
      if (err instanceof ApiError && err.status !== 401) {
        toast.error(err.message || "Failed to load portfolio data");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleHeaderSort = (col: string) => {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(col); setSortDir("asc"); }
  };

  const handleQuickSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const filteredAndSorted = useMemo(() => {
    let rows = [...holdings];

    // Global quick-filter
    if (activeFilter === "gainers") rows = rows.filter((h) => h.dayChangePercent > 0);
    else if (activeFilter === "losers") rows = rows.filter((h) => h.dayChangePercent < 0);
    else if (activeFilter === "rsiOverbought") rows = rows.filter((h) => h.kpis?.rsiOverbought);
    else if (activeFilter === "bbBuy") rows = rows.filter((h) => h.kpis?.bbPosition === "Buy Signal");
    else if (activeFilter === "bbSell") rows = rows.filter((h) => h.kpis?.bbPosition === "Sell Signal");

    // Per-column text filters
    if (colFilters["symbol"]) {
      const v = colFilters["symbol"].toLowerCase();
      rows = rows.filter((h) => h.symbol.toLowerCase().includes(v));
    }
    if (colFilters["exchange"]) {
      const v = colFilters["exchange"].toLowerCase();
      rows = rows.filter((h) => h.exchange.toLowerCase().includes(v));
    }

    // Per-column numeric range filters
    const NUMERIC_GETTERS: Record<string, (h: Holding) => number | null | undefined> = {
      quantity: (h) => h.quantity,
      t1Quantity: (h) => h.t1Quantity,
      avgPrice: (h) => h.avgPrice,
      ltp: (h) => h.ltp,
      dayChange: (h) => h.dayChange,
      dayChangePercent: (h) => h.dayChangePercent,
      pnl: (h) => h.pnl,
      pnlPercent: (h) => h.pnlPercent,
      currentValue: (h) => h.currentValue,
      investedValue: (h) => h.investedValue,
      dailyRSI: (h) => h.kpis?.dailyRSI ?? null,
      peRatio: (h) => h.kpis?.peRatio ?? null,
      from52WeekHigh: (h) => h.kpis?.from52WeekHigh ?? null,
      eps: (h) => h.kpis?.eps ?? null,
    };
    for (const [id, getter] of Object.entries(NUMERIC_GETTERS)) {
      const minStr = colFilters[`${id}_min`];
      const maxStr = colFilters[`${id}_max`];
      if (!minStr && !maxStr) continue;
      const minN = minStr ? parseFloat(minStr) : -Infinity;
      const maxN = maxStr ? parseFloat(maxStr) : Infinity;
      rows = rows.filter((h) => { const v = getter(h); return v != null && v >= minN && v <= maxN; });
    }

    // Per-column boolean / categorical filters
    if (colFilters["rsiOverbought"]) {
      const target = colFilters["rsiOverbought"] === "true";
      rows = rows.filter((h) => h.kpis?.rsiOverbought === target);
    }
    if (colFilters["bbPosition"]) {
      rows = rows.filter((h) => h.kpis?.bbPosition === colFilters["bbPosition"]);
    }

    // User KPI column filters
    for (const kpi of userKpis) {
      const kpiId = `kpi_${kpi.name}`;
      if (kpi.returnType === "BOOLEAN" && colFilters[kpiId]) {
        const target = colFilters[kpiId] === "true";
        rows = rows.filter((h) => (h.kpis as Record<string, unknown> | undefined)?.[kpi.name] === target);
      } else if (kpi.returnType === "SCALAR" && (colFilters[`${kpiId}_min`] || colFilters[`${kpiId}_max`])) {
        const minN = colFilters[`${kpiId}_min`] ? parseFloat(colFilters[`${kpiId}_min`]) : -Infinity;
        const maxN = colFilters[`${kpiId}_max`] ? parseFloat(colFilters[`${kpiId}_max`]) : Infinity;
        rows = rows.filter((h) => { const v = (h.kpis as Record<string, unknown> | undefined)?.[kpi.name]; return typeof v === "number" && v >= minN && v <= maxN; });
      } else if (colFilters[kpiId]) {
        const v = colFilters[kpiId].toLowerCase();
        rows = rows.filter((h) => String((h.kpis as Record<string, unknown> | undefined)?.[kpi.name] ?? "").toLowerCase().includes(v));
      }
    }

    rows.sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      if (sortKey === "symbol") { av = a.symbol; bv = b.symbol; }
      else if (sortKey === "exchange") { av = a.exchange; bv = b.exchange; }
      else if (sortKey === "dayChangePercent") { av = a.dayChangePercent; bv = b.dayChangePercent; }
      else if (sortKey === "dayChange") { av = a.dayChange; bv = b.dayChange; }
      else if (sortKey === "pnlPercent") { av = a.pnlPercent; bv = b.pnlPercent; }
      else if (sortKey === "pnl") { av = a.pnl; bv = b.pnl; }
      else if (sortKey === "ltp") { av = a.ltp; bv = b.ltp; }
      else if (sortKey === "currentValue") { av = a.currentValue; bv = b.currentValue; }
      else if (sortKey === "avgPrice") { av = a.avgPrice; bv = b.avgPrice; }
      else if (sortKey === "quantity") { av = a.quantity; bv = b.quantity; }
      else if (sortKey === "t1Quantity") { av = a.t1Quantity; bv = b.t1Quantity; }
      else if (sortKey === "investedValue") { av = a.investedValue; bv = b.investedValue; }
      else if (sortKey === "dailyRSI") { av = a.kpis?.dailyRSI ?? -Infinity; bv = b.kpis?.dailyRSI ?? -Infinity; }
      else if (sortKey === "rsiOverbought") { av = a.kpis?.rsiOverbought ? 1 : 0; bv = b.kpis?.rsiOverbought ? 1 : 0; }
      else if (sortKey === "bbPosition") { av = a.kpis?.bbPosition ?? ""; bv = b.kpis?.bbPosition ?? ""; }
      else if (sortKey === "peRatio") { av = a.kpis?.peRatio ?? -Infinity; bv = b.kpis?.peRatio ?? -Infinity; }
      else if (sortKey === "from52WeekHigh") { av = a.kpis?.from52WeekHigh ?? -Infinity; bv = b.kpis?.from52WeekHigh ?? -Infinity; }
      else if (sortKey === "eps") { av = a.kpis?.eps ?? -Infinity; bv = b.kpis?.eps ?? -Infinity; }
      else if (sortKey.startsWith("kpi_")) {
        const kpiName = sortKey.slice(4);
        const valA = (a.kpis as Record<string, unknown> | undefined)?.[kpiName];
        const valB = (b.kpis as Record<string, unknown> | undefined)?.[kpiName];
        av = typeof valA === "number" ? valA : typeof valA === "boolean" ? (valA ? 1 : 0) : String(valA ?? "");
        bv = typeof valB === "number" ? valB : typeof valB === "boolean" ? (valB ? 1 : 0) : String(valB ?? "");
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [holdings, sortKey, sortDir, activeFilter, colFilters, userKpis]);

  // PD-04: Portfolio summary totals
  const totals = useMemo(() => {
    const invested = holdings.reduce((s, h) => s + h.investedValue, 0);
    const current = holdings.reduce((s, h) => s + h.currentValue, 0);
    const pnl = current - invested;
    const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
    return { invested, current, pnl, pnlPct };
  }, [holdings]);

  // PD-02: Intraday auto-square warning
  const intradayPositions = positions.filter((p) => p.product === "MIS");
  const showAutoSquareWarning = intradayPositions.length > 0;

  const toggleCol = useCallback((id: ColId) => {
    setVisibleCols((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }, []);

  const toggleUserKpi = useCallback((name: string) => {
    setVisibleUserKpis((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  }, []);

  const colDef = (id: ColId) => ALL_COLUMNS.find((c) => c.id === id)!;

  const SortIcon = ({ col }: { col: string }) => {
    if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 opacity-40" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3 h-3 text-[#FF6600]" />
      : <ChevronDown className="w-3 h-3 text-[#FF6600]" />;
  };

  return (
    <div className="flex flex-col h-full">
      {/* PD-02: MIS auto-square warning */}
      {showAutoSquareWarning && (
        <div className="bg-amber-900/20 border-b border-amber-500/30 px-4 py-2 flex items-center gap-2 text-sm text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            You have {intradayPositions.length} open intraday (MIS) position
            {intradayPositions.length > 1 ? "s" : ""}. These will be auto-squared off at 15:20 IST.
          </span>
        </div>
      )}

      {/* PD-04: Summary cards — 6 metrics */}
      <div className="grid grid-cols-6 gap-3 px-4 py-3 border-b border-[#2a2a2a]">
        <SummaryCard label="Invested" value={`₹${totals.invested.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`} />
        <SummaryCard label="Current Value" value={`₹${totals.current.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`} />
        <SummaryCard
          label="Total P&L"
          value={`${totals.pnl >= 0 ? "+" : ""}₹${totals.pnl.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
          valueClass={totals.pnl >= 0 ? "text-green-400" : "text-red-400"}
        />
        <SummaryCard
          label="Returns"
          value={`${totals.pnlPct >= 0 ? "+" : ""}${totals.pnlPct.toFixed(2)}%`}
          valueClass={totals.pnlPct >= 0 ? "text-green-400" : "text-red-400"}
        />
        {/* PD-04: XIRR */}
        <SummaryCard
          label="XIRR"
          value={xirr != null ? `${xirr.toFixed(1)}%` : "N/A"}
          valueClass={xirr != null && xirr >= 0 ? "text-green-400" : undefined}
          hint="Annualised return on invested capital"
        />
        {/* PD-03: Available margin */}
        <SummaryCard
          label="Available Margin"
          value={
            margin
              ? `₹${margin.available.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
              : loading ? "…" : "—"
          }
        />
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[#2a2a2a] bg-[#0f0f0f]">
        {/* Sort dropdown */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Sort:</span>
          <select
            value={sortKey}
            onChange={(e) => handleQuickSort(e.target.value as SortKey)}
            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-xs focus:outline-none focus:border-[#FF6600]"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="p-1 hover:bg-[#2a2a2a] rounded transition-colors text-muted-foreground hover:text-foreground"
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            {sortDir === "asc" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Filter */}
        <div className="relative">
          <button
            onClick={() => setShowFilter((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border transition-colors ${
              activeFilter !== "all"
                ? "border-[#FF6600] text-[#FF6600] bg-[#FF6600]/10"
                : "border-[#2a2a2a] text-muted-foreground hover:text-foreground hover:border-[#3a3a3a]"
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            {activeFilter === "all" ? "Filter" : FILTER_OPTIONS.find((f) => f.value === activeFilter)?.label}
            {activeFilter !== "all" && (
              <span
                onClick={(e) => { e.stopPropagation(); setActiveFilter("all"); }}
                className="ml-0.5 hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </span>
            )}
          </button>
          {showFilter && (
            <div className="absolute top-full mt-1 left-0 bg-[#1a1a1a] border border-[#2a2a2a] rounded shadow-lg z-10 py-1 min-w-[160px]">
              {FILTER_OPTIONS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => { setActiveFilter(f.value); setShowFilter(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                    activeFilter === f.value
                      ? "text-[#FF6600] bg-[#FF6600]/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-[#2a2a2a]"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {filteredAndSorted.length} of {holdings.length} holdings
          </span>
          {/* KPI refresh button */}
          <button
            onClick={() => fetchData()}
            disabled={loading}
            className="p-1 hover:bg-[#2a2a2a] rounded transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
            title="Refresh data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>

          {/* Column picker */}
          <div className="relative">
            <button
              onClick={() => setShowColPicker((v) => !v)}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs border border-[#2a2a2a] text-muted-foreground hover:text-foreground hover:border-[#3a3a3a] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Columns
            </button>
            {showColPicker && (
              <div className="absolute top-full mt-1 right-0 bg-[#1a1a1a] border border-[#2a2a2a] rounded shadow-lg z-10 p-3 w-56">
                {/* Visible columns — drag to reorder */}
                <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                  Visible (drag to reorder)
                </p>
                {visibleCols.map((id) => {
                  const c = ALL_COLUMNS.find((col) => col.id === id);
                  if (!c || c.group !== "standard") return null;
                  return (
                    <div
                      key={id}
                      draggable
                      onDragStart={() => setDragColId(id)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (!dragColId || dragColId === id) return;
                        setVisibleCols((prev) => {
                          const next = [...prev];
                          const from = next.indexOf(dragColId);
                          const to = next.indexOf(id);
                          if (from === -1 || to === -1) return prev;
                          next.splice(from, 1);
                          next.splice(to, 0, dragColId);
                          return next;
                        });
                      }}
                      onDragEnd={() => setDragColId(null)}
                      className={`flex items-center gap-2 px-1 py-1 text-xs rounded select-none ${
                        dragColId === id ? "opacity-40" : "hover:bg-[#2a2a2a]"
                      }`}
                    >
                      <GripVertical className="w-3 h-3 text-muted-foreground/40 cursor-grab shrink-0" />
                      <input
                        type="checkbox"
                        checked
                        onChange={() => toggleCol(id)}
                        className="accent-[#FF6600]"
                      />
                      <span className="cursor-grab">{c.label}</span>
                    </div>
                  );
                })}
                {/* Hidden columns — click to add */}
                {ALL_COLUMNS.filter((c) => c.group === "standard" && !visibleCols.includes(c.id)).length > 0 && (
                  <>
                    <p className="text-xs font-medium text-muted-foreground mb-1 mt-3 uppercase tracking-wider">
                      Hidden (click to add)
                    </p>
                    {ALL_COLUMNS.filter((c) => c.group === "standard" && !visibleCols.includes(c.id)).map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-2 px-1 py-1 text-xs cursor-pointer hover:bg-[#2a2a2a] rounded"
                      >
                        <span className="w-3 shrink-0" />
                        <input
                          type="checkbox"
                          checked={false}
                          onChange={() => toggleCol(c.id)}
                          className="accent-[#FF6600]"
                        />
                        {c.label}
                      </label>
                    ))}
                  </>
                )}
                {userKpis.length > 0 && (
                  <>
                    <p className="text-xs font-medium text-muted-foreground mb-2 mt-3 uppercase tracking-wider">
                      My KPIs
                    </p>
                    {userKpis.map((k) => (
                      <label
                        key={k.name}
                        className="flex items-center gap-2 px-1 py-1 text-xs cursor-pointer hover:bg-[#2a2a2a] rounded"
                      >
                        <span className="w-3 shrink-0" />
                        <input
                          type="checkbox"
                          checked={visibleUserKpis.includes(k.name)}
                          onChange={() => toggleUserKpi(k.name)}
                          className="accent-[#FF6600]"
                        />
                        {k.name}
                      </label>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-auto">
        {/* Holdings table */}
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#121212] border-b border-[#2a2a2a] z-10">
            <tr>
              {/* Symbol column */}
              <th className="px-4 py-2.5 text-left text-muted-foreground font-medium text-xs">
                <div className="flex items-center gap-1">
                  <button className="flex items-center gap-1 hover:text-foreground" onClick={() => handleHeaderSort("symbol")}>
                    Symbol <SortIcon col="symbol" />
                  </button>
                  <ColFilterBtn colId="symbol" filterType="text" filterPopover={filterPopover} setFilterPopover={setFilterPopover} colFilters={colFilters} setColFilters={setColFilters} />
                </div>
              </th>
              {visibleCols.map((id) => {
                const col = colDef(id);
                const filterType = COL_FILTER_TYPES[id] ?? "text";
                const isRight = col.align === "right";
                return (
                  <th key={id} className={`px-4 py-2.5 text-xs text-muted-foreground font-medium ${isRight ? "text-right" : "text-left"}`}>
                    <div className={`flex items-center gap-1 ${isRight ? "flex-row-reverse" : ""}`}>
                      <button className="flex items-center gap-1 hover:text-foreground" onClick={() => handleHeaderSort(id)}>
                        {isRight && <SortIcon col={id} />}
                        {col.label}
                        {!isRight && <SortIcon col={id} />}
                      </button>
                      <ColFilterBtn colId={id} filterType={filterType} filterPopover={filterPopover} setFilterPopover={setFilterPopover} colFilters={colFilters} setColFilters={setColFilters} options={id === "bbPosition" ? BB_POSITION_VALUES : undefined} align={isRight ? "right" : undefined} />
                    </div>
                  </th>
                );
              })}
              {visibleUserKpis.map((name) => {
                const kpi = userKpis.find((k) => k.name === name);
                const filterType: ColFilterType = kpi?.returnType === "BOOLEAN" ? "boolean" : kpi?.returnType === "SCALAR" ? "range" : "text";
                const kpiId = `kpi_${name}`;
                return (
                  <th key={`kpi-${name}`} className="px-4 py-2.5 text-xs text-muted-foreground font-medium text-right">
                    <div className="flex items-center gap-1 flex-row-reverse">
                      <button className="flex items-center gap-1 hover:text-foreground" onClick={() => handleHeaderSort(kpiId)}>
                        <SortIcon col={kpiId} />
                        {name}
                      </button>
                      <ColFilterBtn colId={kpiId} filterType={filterType} filterPopover={filterPopover} setFilterPopover={setFilterPopover} colFilters={colFilters} setColFilters={setColFilters} align="right" />
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filteredAndSorted.map((holding) => (
              <tr
                key={holding.symbol}
                className="border-b border-[#1a1a1a] hover:bg-[#141414] cursor-pointer transition-colors"
                onClick={() => navigate(`/charts/${holding.symbol}`)}
              >
                <td className="px-4 py-2.5">
                  <div className="font-medium">{holding.symbol}</div>
                  <div className="text-xs text-muted-foreground">{holding.exchange}</div>
                </td>
                {visibleCols.map((id) => {
                  const col = colDef(id);
                  if (id === "exchange") return (
                    <td key={id} className="px-4 py-2.5 text-muted-foreground text-xs">
                      {holding.exchange}
                    </td>
                  );
                  // Live price overrides for ltp / dayChange / dayChangePercent / pnl / currentValue
                  const tick = holding.instrumentToken != null ? livePrices[holding.instrumentToken] : undefined;
                  if (id === "ltp" && tick) return (
                    <td key={id} className="px-4 py-2.5 text-right font-mono">
                      <span className={tick.change >= 0 ? "text-green-400" : "text-red-400"}>
                        ₹{tick.ltp.toFixed(2)}
                      </span>
                    </td>
                  );
                  if (id === "dayChangePercent" && tick) return (
                    <td key={id} className="px-4 py-2.5 text-right">
                      <span className={tick.change >= 0 ? "text-green-400" : "text-red-400"}>
                        {tick.change >= 0 ? "+" : ""}{tick.change.toFixed(2)}%
                      </span>
                    </td>
                  );
                  if (id === "dayChange" && tick) return (
                    <td key={id} className="px-4 py-2.5 text-right">
                      <span className={tick.change >= 0 ? "text-green-400" : "text-red-400"}>
                        {tick.change >= 0 ? "+" : ""}₹{((tick.ltp - tick.close) * holding.quantity).toFixed(2)}
                      </span>
                    </td>
                  );
                  if (id === "currentValue" && tick) {
                    const cv = tick.ltp * holding.quantity;
                    return (
                      <td key={id} className="px-4 py-2.5 text-right font-mono">
                        ₹{cv.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                    );
                  }
                  if (id === "pnl" && tick) {
                    const livePnl = (tick.ltp - holding.avgPrice) * holding.quantity;
                    return (
                      <td key={id} className="px-4 py-2.5 text-right">
                        <span className={livePnl >= 0 ? "text-green-400" : "text-red-400"}>
                          {livePnl >= 0 ? "+" : ""}₹{livePnl.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                      </td>
                    );
                  }
                  if (id === "pnlPercent" && tick && holding.avgPrice > 0) {
                    const livePnlPct = ((tick.ltp - holding.avgPrice) / holding.avgPrice) * 100;
                    return (
                      <td key={id} className="px-4 py-2.5 text-right">
                        <span className={livePnlPct >= 0 ? "text-green-400" : "text-red-400"}>
                          {livePnlPct >= 0 ? "+" : ""}{livePnlPct.toFixed(2)}%
                        </span>
                      </td>
                    );
                  }
                  const rendered = col.format
                    ? col.format(holding)
                    : (holding[id as keyof Holding] as React.ReactNode);
                  return (
                    <td
                      key={id}
                      className={`px-4 py-2.5 ${col.align === "right" ? "text-right" : ""}`}
                    >
                      {rendered}
                    </td>
                  );
                })}
                {visibleUserKpis.map((name) => {
                  const val = (holding.kpis as Record<string, unknown> | undefined)?.[name];
                  const displayVal = val == null ? "—"
                    : typeof val === "boolean" ? (val ? "Yes" : "No")
                    : typeof val === "number" ? val.toFixed(2)
                    : String(val);
                  return (
                    <td key={`kpi-${name}`} className="px-4 py-2.5 text-right text-xs">
                      {displayVal}
                    </td>
                  );
                })}
              </tr>
            ))}
            {filteredAndSorted.length === 0 && (
              <tr>
                <td
                  colSpan={visibleCols.length + visibleUserKpis.length + 1}
                  className="px-4 py-12 text-center text-muted-foreground"
                >
                  No holdings match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* PD-02: Intraday Positions section */}
        <div className="border-t-2 border-[#2a2a2a]">
          <div className="sticky top-0 bg-[#0f0f0f] px-4 py-2 flex items-center justify-between border-b border-[#2a2a2a]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Intraday Positions
              </span>
              {positions.length > 0 && (
                <span className="text-xs bg-[#2a2a2a] text-muted-foreground px-1.5 py-0.5 rounded">
                  {positions.length}
                </span>
              )}
            </div>
            <button
              onClick={() => setShowPositions((v) => !v)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPositions ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {showPositions && (
            positions.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="bg-[#121212] border-b border-[#2a2a2a]">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-muted-foreground font-medium text-xs">Symbol</th>
                    <th className="px-4 py-2.5 text-left text-muted-foreground font-medium text-xs">Product</th>
                    <th className="px-4 py-2.5 text-right text-muted-foreground font-medium text-xs">Qty</th>
                    <th className="px-4 py-2.5 text-right text-muted-foreground font-medium text-xs">Avg Buy Price</th>
                    <th className="px-4 py-2.5 text-right text-muted-foreground font-medium text-xs">LTP</th>
                    <th className="px-4 py-2.5 text-right text-muted-foreground font-medium text-xs">Unrealised P&L</th>
                    <th className="px-4 py-2.5 text-right text-muted-foreground font-medium text-xs">M2M P&L</th>
                    <th className="px-4 py-2.5 text-center text-muted-foreground font-medium text-xs">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((pos) => {
                    const posTick = pos.instrumentToken != null ? livePrices[pos.instrumentToken] : undefined;
                    const posLtp = posTick?.ltp ?? pos.ltp;
                    const posUnrealisedPnl = posTick != null && pos.quantity !== 0
                      ? (posTick.ltp - pos.avgPrice) * pos.quantity
                      : pos.unrealisedPnl;
                    const posM2mPnl = posTick != null && pos.quantity !== 0
                      ? (posTick.ltp - posTick.close) * pos.quantity
                      : pos.m2mPnl;
                    // KITE-SQUARE-OFF: reverse direction to square off
                    const sqOffTx = pos.quantity > 0 ? "SELL" : "BUY";
                    const sqOffQty = Math.abs(pos.quantity);
                    return (
                    <tr key={`${pos.symbol}-${pos.product}`} className="border-b border-[#1a1a1a] hover:bg-[#141414] transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{pos.symbol}</div>
                        <div className="text-xs text-muted-foreground">{pos.exchange}</div>
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        <span className="bg-[#2a2a2a] text-muted-foreground px-1.5 py-0.5 rounded">
                          {pos.product}
                        </span>
                      </td>
                      <td className={`px-4 py-2.5 text-right ${pos.quantity >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {pos.quantity > 0 ? "+" : ""}{pos.quantity}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">₹{pos.avgPrice.toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">₹{posLtp.toFixed(2)}</td>
                      <td className={`px-4 py-2.5 text-right text-xs ${posUnrealisedPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {posUnrealisedPnl >= 0 ? "+" : ""}₹{posUnrealisedPnl.toFixed(2)}
                      </td>
                      <td className={`px-4 py-2.5 text-right text-xs ${posM2mPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {posM2mPnl >= 0 ? "+" : ""}₹{posM2mPnl.toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {sqOffQty > 0 && (
                          <button
                            onClick={() => navigate(
                              `/orders?squareOff=1&symbol=${encodeURIComponent(pos.symbol)}&exchange=${encodeURIComponent(pos.exchange)}&product=${encodeURIComponent(pos.product)}&txType=${sqOffTx}&quantity=${sqOffQty}&orderType=MARKET`
                            )}
                            className="text-xs px-2 py-0.5 rounded border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Square off this position at market price"
                          >
                            Square Off
                          </button>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                No open intraday positions.
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function ColFilterBtn({
  colId,
  filterType,
  filterPopover,
  setFilterPopover,
  colFilters,
  setColFilters,
  options,
  align,
}: {
  colId: string;
  filterType: ColFilterType;
  filterPopover: string | null;
  setFilterPopover: React.Dispatch<React.SetStateAction<string | null>>;
  colFilters: Record<string, string>;
  setColFilters: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  options?: string[];
  align?: "right";
}) {
  const isActive = !!(colFilters[colId] || colFilters[`${colId}_min`] || colFilters[`${colId}_max`]);
  return (
    <div className="relative shrink-0" data-filter-popover>
      <button
        className={`p-0.5 rounded hover:bg-[#2a2a2a] transition-colors ${isActive ? "text-[#FF6600]" : "opacity-30 hover:opacity-100"}`}
        onClick={(e) => { e.stopPropagation(); setFilterPopover(filterPopover === colId ? null : colId); }}
        title="Filter"
      >
        <Filter className="w-2.5 h-2.5" />
      </button>
      {filterPopover === colId && (
        <FilterPopover
          colId={colId}
          filterType={filterType}
          colFilters={colFilters}
          setColFilters={setColFilters}
          options={options}
          align={align}
        />
      )}
    </div>
  );
}

function FilterPopover({
  colId,
  filterType,
  colFilters,
  setColFilters,
  options,
  align,
}: {
  colId: string;
  filterType: ColFilterType;
  colFilters: Record<string, string>;
  setColFilters: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  options?: string[];
  align?: "right";
}) {
  const update = (key: string, value: string) => {
    setColFilters((prev) => {
      if (!value) { const { [key]: _, ...rest } = prev; return rest; }
      return { ...prev, [key]: value };
    });
  };
  const clear = () => setColFilters((prev) => {
    const next = { ...prev };
    delete next[colId]; delete next[`${colId}_min`]; delete next[`${colId}_max`];
    return next;
  });
  const hasValue = !!(colFilters[colId] || colFilters[`${colId}_min`] || colFilters[`${colId}_max`]);
  const cls = "w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-2 py-1 text-xs focus:outline-none focus:border-[#FF6600]";

  return (
    <div
      className={`absolute top-full mt-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded shadow-xl z-50 p-2 w-36 ${align === "right" ? "right-0" : "left-0"}`}
      onClick={(e) => e.stopPropagation()}
    >
      {filterType === "range" && (
        <div className="flex flex-col gap-1">
          <input type="number" placeholder="Min" value={colFilters[`${colId}_min`] ?? ""} onChange={(e) => update(`${colId}_min`, e.target.value)} className={cls} autoFocus />
          <input type="number" placeholder="Max" value={colFilters[`${colId}_max`] ?? ""} onChange={(e) => update(`${colId}_max`, e.target.value)} className={cls} />
        </div>
      )}
      {filterType === "boolean" && (
        <select value={colFilters[colId] ?? ""} onChange={(e) => update(colId, e.target.value)} className={cls} autoFocus>
          <option value="">All</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      )}
      {filterType === "categorical" && (
        <select value={colFilters[colId] ?? ""} onChange={(e) => update(colId, e.target.value)} className={cls} autoFocus>
          <option value="">All</option>
          {(options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      {filterType === "text" && (
        <input type="text" placeholder="Search…" value={colFilters[colId] ?? ""} onChange={(e) => update(colId, e.target.value)} className={cls} autoFocus />
      )}
      {hasValue && (
        <button onClick={clear} className="mt-1.5 w-full text-[10px] text-muted-foreground hover:text-foreground text-center py-0.5 hover:bg-[#2a2a2a] rounded">
          Clear
        </button>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  valueClass,
  hint,
}: {
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
}) {
  return (
    <div className="bg-[#121212] border border-[#2a2a2a] rounded px-3 py-2.5" title={hint}>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-sm font-semibold ${valueClass ?? ""}`}>{value}</p>
    </div>
  );
}
