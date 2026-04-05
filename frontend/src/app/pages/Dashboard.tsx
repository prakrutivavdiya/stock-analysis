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
import { getColumns, getPreferences, savePreferences } from "../api/preferences";
import { visibleHoldingsColumns, holdingsSort } from "../data/localPrefs";
import { ApiError } from "../api/client";
import type { ColumnDefinition, ColFilterType } from "../api/types";

// ── Format functions (frontend-only JSX renderers keyed by column id) ───────
// Column metadata (id/label/align/filter_type) comes from GET /user/columns.
// Only the React render logic lives here — not repeated in the backend schema.

type FormatFn = (h: Holding) => React.ReactNode;

const FORMAT_FNS: Record<string, FormatFn> = {
  t1Quantity: (h) => h.t1Quantity > 0
    ? <span className="text-amber-400">{h.t1Quantity}</span>
    : h.t1Quantity,
  avgPrice:     (h) => `₹${h.avgPrice.toFixed(2)}`,
  ltp:          (h) => `₹${h.ltp.toFixed(2)}`,
  dayChange: (h) => (
    <span className={h.dayChange >= 0 ? "text-green-400" : "text-red-400"}>
      {h.dayChange >= 0 ? "+" : ""}₹{h.dayChange.toFixed(2)}
    </span>
  ),
  dayChangePercent: (h) => (
    <span className={h.dayChangePercent >= 0 ? "text-green-400" : "text-red-400"}>
      {h.dayChangePercent >= 0 ? "+" : ""}{h.dayChangePercent.toFixed(2)}%
    </span>
  ),
  pnl: (h) => (
    <span className={h.pnl >= 0 ? "text-green-400" : "text-red-400"}>
      {h.pnl >= 0 ? "+" : ""}₹{h.pnl.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
    </span>
  ),
  pnlPercent: (h) => (
    <span className={h.pnlPercent >= 0 ? "text-green-400" : "text-red-400"}>
      {h.pnlPercent >= 0 ? "+" : ""}{h.pnlPercent.toFixed(2)}%
    </span>
  ),
  currentValue:  (h) => `₹${(h.ltp * (h.quantity + h.t1Quantity)).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
  investedValue: (h) => `₹${(h.avgPrice * (h.quantity + h.t1Quantity)).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
};

// ── Static UI config ────────────────────────────────────────────────────────

type SortKey = string;
type SortDir = "asc" | "desc";
type FilterKey = "all" | "gainers" | "losers";

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
];

export default function Dashboard() {
  const navigate = useNavigate();
  const [allColumns, setAllColumns] = useState<ColumnDefinition[]>([]);
  const [visibleCols, setVisibleCols] = useState<string[]>(() => {
    // Fast sync init from localStorage; overwritten by backend on mount
    const saved = visibleHoldingsColumns.get();
    return saved.length > 0 ? saved : [];
  });
  const [userKpis, setUserKpis] = useState<{ name: string; returnType: string }[]>([]);
  const [visibleUserKpis, setVisibleUserKpis] = useState<string[]>([]);
  const [showColPicker, setShowColPicker] = useState(false);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragKpiId, setDragKpiId] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [showPositions, setShowPositions] = useState(true);
  const [loading, setLoading] = useState(false);
  const [xirr, setXirr] = useState<number | null>(null);

  const savedSort = holdingsSort.get();
  const [sortKey, setSortKey] = useState<SortKey>((savedSort.column as SortKey) || "symbol");
  const [sortDir, setSortDir] = useState<SortDir>(savedSort.direction);

  // Load column definitions + user preferences together so defaults from DB
  // are used when the user has no saved prefs (source of truth is always DB).
  const prefsLoadedFromBackend = useRef(false);
  useEffect(() => {
    Promise.all([getColumns(), getPreferences()])
      .then(([{ columns }, { preferences: p }]) => {
        setAllColumns(columns);
        const defaultCols = columns.filter((c) => c.default_visible).map((c) => c.id);
        const cols = p.visible_holdings_columns.length > 0
          ? p.visible_holdings_columns
          : defaultCols;
        setVisibleCols(cols);
        visibleHoldingsColumns.set(cols);
        if (p.holdings_sort.column) {
          setSortKey(p.holdings_sort.column as SortKey);
          setSortDir(p.holdings_sort.direction);
          holdingsSort.set(p.holdings_sort);
        }
        if (p.visible_user_kpi_columns && p.visible_user_kpi_columns.length > 0) {
          setVisibleUserKpis(p.visible_user_kpi_columns);
        }
        // Mark load complete — enables the save effect below
        prefsLoadedFromBackend.current = true;
      })
      .catch(() => { /* offline — keep localStorage values */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // PD-09: Persist all preferences together in one effect so nothing gets erased.
  // Only fires after the initial backend load to avoid overwriting with defaults.
  useEffect(() => {
    if (!prefsLoadedFromBackend.current) return;
    visibleHoldingsColumns.set(visibleCols);
    holdingsSort.set({ column: sortKey, direction: sortDir });
    savePreferences({
      visible_holdings_columns: visibleCols,
      visible_user_kpi_columns: visibleUserKpis,
      holdings_sort: { column: sortKey, direction: sortDir },
    }).catch(() => {});
  }, [visibleCols, visibleUserKpis, sortKey, sortDir]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const setLivePrices = useAppStore((s) => s.setLivePrices);
  const setStoreHoldings = useAppStore((s) => s.setHoldings);
  const setStorePositions = useAppStore((s) => s.setPositions);
  const setStoreMargins = useAppStore((s) => s.setMargins);

  const holdings: Holding[] = storeHoldings.data ?? [];
  const positions = storePositions.data ?? [];
  const margin = storeMargins.data;

  // ── REST polling fallback for live prices ──────────────────────────────────
  // When the WebSocket delivers no ticks for >4 s (e.g. KiteTicker unavailable),
  // poll GET /portfolio/holdings every 5 s and inject last_price as live ticks.
  const lastTickTimeRef = useRef<number>(0);

  useEffect(() => {
    if (Object.keys(livePrices).length > 0) lastTickTimeRef.current = Date.now();
  }, [livePrices]);

  useEffect(() => {
    const id = setInterval(async () => {
      if (Date.now() - lastTickTimeRef.current < 4_000) return; // WS is live
      const currentHoldings = useAppStore.getState().holdings.data ?? [];
      if (currentHoldings.length === 0) return;
      try {
        const res = await getHoldings();
        const ticks = res.holdings
          .filter((h) => h.instrument_token)
          .map((h) => ({
            instrument_token: h.instrument_token,
            ltp: h.last_price,
            open: 0,
            high: 0,
            low: 0,
            close: h.close_price,
            change: h.day_change_pct,
            volume: 0,
            last_trade_time: null,
          }));
        if (ticks.length > 0) setLivePrices(ticks);
      } catch {
        // best-effort; ignore errors
      }
    }, 5_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setLivePrices]);
  // ──────────────────────────────────────────────────────────────────────────

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
      currentValue: (h) => h.ltp * (h.quantity + h.t1Quantity),
      investedValue: (h) => h.avgPrice * (h.quantity + h.t1Quantity),
    };
    for (const [id, getter] of Object.entries(NUMERIC_GETTERS)) {
      const minStr = colFilters[`${id}_min`];
      const maxStr = colFilters[`${id}_max`];
      if (!minStr && !maxStr) continue;
      const minN = minStr ? parseFloat(minStr) : -Infinity;
      const maxN = maxStr ? parseFloat(maxStr) : Infinity;
      rows = rows.filter((h) => { const v = getter(h); return v != null && v >= minN && v <= maxN; });
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
      else if (sortKey === "currentValue") { av = a.ltp * (a.quantity + a.t1Quantity); bv = b.ltp * (b.quantity + b.t1Quantity); }
      else if (sortKey === "avgPrice") { av = a.avgPrice; bv = b.avgPrice; }
      else if (sortKey === "quantity") { av = a.quantity; bv = b.quantity; }
      else if (sortKey === "t1Quantity") { av = a.t1Quantity; bv = b.t1Quantity; }
      else if (sortKey === "investedValue") { av = a.investedValue; bv = b.investedValue; }
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

  // PD-04: Portfolio summary totals — use live prices when available (mirrors Kite behaviour)
  const totals = useMemo(() => {
    const invested = holdings.reduce((s, h) => s + h.avgPrice * (h.quantity + h.t1Quantity), 0);
    const current = holdings.reduce((s, h) => {
      const tick = h.instrumentToken != null ? livePrices[h.instrumentToken] : undefined;
      const ltp = tick?.ltp ?? h.ltp;
      return s + ltp * (h.quantity + h.t1Quantity);
    }, 0);
    const pnl = current - invested;
    const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
    return { invested, current, pnl, pnlPct };
  }, [holdings, livePrices]);

  // PD-02: Intraday auto-square warning
  const intradayPositions = positions.filter((p) => p.product === "MIS");
  const showAutoSquareWarning = intradayPositions.length > 0;

  const toggleCol = useCallback((id: string) => {
    setVisibleCols((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }, []);

  const toggleUserKpi = useCallback((name: string) => {
    setVisibleUserKpis((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  }, []);

  const colDef = (id: string): ColumnDefinition =>
    allColumns.find((c) => c.id === id) ?? { id, label: id, align: "left", default_visible: false, filter_type: "text" };

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
        <div className="bg-amber-900/20 border-b border-amber-500/30 px-4 py-2 flex items-center gap-2 text-xs text-amber-400">
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
          value={xirr != null ? `${xirr.toFixed(2)}%` : "N/A"}
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
            <div className="absolute top-full mt-1 left-0 bg-[#1a1a1a] border border-[#2a2a2a] rounded shadow-lg z-20 py-1 min-w-[160px]">
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
              <div className="absolute top-full mt-1 right-0 bg-[#1a1a1a] border border-[#2a2a2a] rounded shadow-lg z-20 p-3 w-56">
                {/* Visible columns — drag to reorder */}
                <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">
                  Visible (drag to reorder)
                </p>
                {visibleCols.map((id) => {
                  const c = allColumns.find((col) => col.id === id);
                  if (!c) return null;
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
                {allColumns.filter((c) => !visibleCols.includes(c.id)).length > 0 && (
                  <>
                    <p className="text-xs font-medium text-muted-foreground mb-1 mt-3 uppercase tracking-wider">
                      Hidden (click to add)
                    </p>
                    {allColumns.filter((c) => !visibleCols.includes(c.id)).map((c) => (
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
                    {visibleUserKpis.length > 0 && (
                      <>
                        <p className="text-xs font-medium text-muted-foreground mb-1 mt-3 uppercase tracking-wider">
                          My KPIs (drag to reorder)
                        </p>
                        {visibleUserKpis.map((name) => (
                          <div
                            key={name}
                            draggable
                            onDragStart={() => setDragKpiId(name)}
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (!dragKpiId || dragKpiId === name) return;
                              setVisibleUserKpis((prev) => {
                                const next = [...prev];
                                const from = next.indexOf(dragKpiId);
                                const to = next.indexOf(name);
                                if (from === -1 || to === -1) return prev;
                                next.splice(from, 1);
                                next.splice(to, 0, dragKpiId);
                                return next;
                              });
                            }}
                            onDragEnd={() => setDragKpiId(null)}
                            className={`flex items-center gap-2 px-1 py-1 text-xs rounded select-none ${
                              dragKpiId === name ? "opacity-40" : "hover:bg-[#2a2a2a]"
                            }`}
                          >
                            <GripVertical className="w-3 h-3 text-muted-foreground/40 cursor-grab shrink-0" />
                            <input
                              type="checkbox"
                              checked
                              onChange={() => toggleUserKpi(name)}
                              className="accent-[#FF6600]"
                            />
                            <span className="cursor-grab">{name}</span>
                          </div>
                        ))}
                      </>
                    )}
                    {userKpis.filter((k) => !visibleUserKpis.includes(k.name)).length > 0 && (
                      <>
                        <p className="text-xs font-medium text-muted-foreground mb-1 mt-3 uppercase tracking-wider">
                          Hidden KPIs (click to add)
                        </p>
                        {userKpis.filter((k) => !visibleUserKpis.includes(k.name)).map((k) => (
                          <label
                            key={k.name}
                            className="flex items-center gap-2 px-1 py-1 text-xs cursor-pointer hover:bg-[#2a2a2a] rounded"
                          >
                            <span className="w-3 shrink-0" />
                            <input
                              type="checkbox"
                              checked={false}
                              onChange={() => toggleUserKpi(k.name)}
                              className="accent-[#FF6600]"
                            />
                            {k.name}
                          </label>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-auto min-h-0">
        {/* Holdings table */}
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[#121212] border-b border-[#2a2a2a] z-10">
            <tr>
              {/* Symbol column */}
              <th className="px-4 py-2.5 text-left text-muted-foreground font-medium text-xs">
                <div className="flex items-center gap-1">
                  <button className="flex items-center gap-1 hover:text-foreground font-medium text-xs" onClick={() => handleHeaderSort("symbol")}>
                    Symbol <SortIcon col="symbol" />
                  </button>
                  <ColFilterBtn colId="symbol" filterType="text" filterPopover={filterPopover} setFilterPopover={setFilterPopover} colFilters={colFilters} setColFilters={setColFilters} />
                </div>
              </th>
              {visibleCols.map((id) => {
                const col = colDef(id);
                const filterType = col.filter_type;
                const isRight = col.align === "right";
                return (
                  <th key={id} className={`px-4 py-2.5 text-xs text-muted-foreground font-medium ${isRight ? "text-right" : "text-left"}`}>
                    <div className={`flex items-center gap-1 ${isRight ? "flex-row-reverse" : ""}`}>
                      <button className="flex items-center gap-1 hover:text-foreground font-medium text-xs" onClick={() => handleHeaderSort(id)}>
                        {isRight && <SortIcon col={id} />}
                        {col.label}
                        {!isRight && <SortIcon col={id} />}
                      </button>
                      <ColFilterBtn colId={id} filterType={filterType} filterPopover={filterPopover} setFilterPopover={setFilterPopover} colFilters={colFilters} setColFilters={setColFilters} align={isRight ? "right" : undefined} />
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
                      <button className="flex items-center gap-1 hover:text-foreground font-medium text-xs" onClick={() => handleHeaderSort(kpiId)}>
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
                <td className="px-4 py-2">
                  <div className="font-medium text-xs">{holding.symbol}</div>
                  <div className="text-xs text-muted-foreground">{holding.exchange}</div>
                </td>
                {visibleCols.map((id) => {
                  const col = colDef(id);
                  if (id === "exchange") return (
                    <td key={id} className="px-4 py-2 text-muted-foreground font-medium text-xs">
                      {holding.exchange}
                    </td>
                  );
                  // Live price overrides for ltp / dayChange / dayChangePercent / pnl / currentValue
                  const tick = holding.instrumentToken != null ? livePrices[holding.instrumentToken] : undefined;
                  if (id === "ltp" && tick) return (
                    <td key={id} className="px-4 py-2 text-right font-medium text-xs">
                      <span className={tick.change >= 0 ? "text-green-400" : "text-red-400"}>
                        ₹{tick.ltp.toFixed(2)}
                      </span>
                    </td>
                  );
                  if (id === "dayChangePercent" && tick) return (
                    <td key={id} className="px-4 py-2 text-right font-medium text-xs">
                      <span className={tick.change >= 0 ? "text-green-400" : "text-red-400"}>
                        {tick.change >= 0 ? "+" : ""}{tick.change.toFixed(2)}%
                      </span>
                    </td>
                  );
                  if (id === "dayChange" && tick) return (
                    <td key={id} className="px-4 py-2 text-right">
                      <span className={tick.change >= 0 ? "text-green-400" : "text-red-400"}>
                        {tick.change >= 0 ? "+" : ""}₹{((tick.ltp - tick.close) * (holding.quantity + holding.t1Quantity)).toFixed(2)}
                      </span>
                    </td>
                  );
                  if (id === "currentValue" && tick) {
                    const cv = tick.ltp * (holding.quantity + holding.t1Quantity);
                    return (
                      <td key={id} className="px-4 py-2 text-right font-medium text-xs">
                        ₹{cv.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                    );
                  }
                  if (id === "pnl" && tick) {
                    const livePnl = (tick.ltp - holding.avgPrice) * (holding.quantity + holding.t1Quantity);
                    return (
                      <td key={id} className="px-4 py-2 text-right font-medium text-xs">
                        <span className={livePnl >= 0 ? "text-green-400" : "text-red-400"}>
                          {livePnl >= 0 ? "+" : ""}₹{livePnl.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                      </td>
                    );
                  }
                  if (id === "pnlPercent" && tick && holding.avgPrice > 0) {
                    const livePnlPct = ((tick.ltp - holding.avgPrice) / holding.avgPrice) * 100;
                    return (
                      <td key={id} className="px-4 py-2 text-right font-medium text-xs">
                        <span className={livePnlPct >= 0 ? "text-green-400" : "text-red-400"}>
                          {livePnlPct >= 0 ? "+" : ""}{livePnlPct.toFixed(2)}%
                        </span>
                      </td>
                    );
                  }
                  const formatFn = FORMAT_FNS[id];
                  const rendered = formatFn
                    ? formatFn(holding)
                    : (holding[id as keyof Holding] as React.ReactNode);
                  return (
                    <td
                      key={id}
                      className={`px-4 py-2 font-medium text-xs ${col.align === "right" ? "text-right" : ""}`}
                    >
                      {rendered}
                    </td>
                  );
                })}
                {visibleUserKpis.map((name) => {
                  const val = (holding.kpis as Record<string, unknown> | undefined)?.[name];
                  const displayVal = val == null ? "—"
                    : typeof val === "boolean" ? (
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${val ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"}`}>
                          {val ? "true" : "false"}
                        </span>
                      )
                    : typeof val === "number" ? val.toFixed(2)
                    : String(val);
                  return (
                    <td key={`kpi-${name}`} className="px-4 py-2 text-right text-xs">
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

      </div>

      {/* PD-02: Intraday Positions — sticky bottom panel */}
      <div className="flex-shrink-0 border-t-2 border-[#2a2a2a] bg-[#0f0f0f]">
        {/* Panel header */}
        <div className="px-4 py-1.5 flex items-center justify-between border-b border-[#2a2a2a]">
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
            {showPositions ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>

        {/* Scrollable content — max 3 rows visible (~180px), overflow scrolls */}
        {showPositions && (
          <div className="overflow-auto max-h-[180px]">
            {positions.length > 0 ? (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#121212] border-b border-[#2a2a2a] z-10">
                  <tr>
                    <th className="px-4 py-1 text-left text-muted-foreground font-medium text-xs">Symbol</th>
                    <th className="px-4 py-1 text-left text-muted-foreground font-medium text-xs">Product</th>
                    <th className="px-4 py-1 text-right text-muted-foreground font-medium text-xs">Qty</th>
                    <th className="px-4 py-1 text-right text-muted-foreground font-medium text-xs">Avg Buy Price</th>
                    <th className="px-4 py-1 text-right text-muted-foreground font-medium text-xs">LTP</th>
                    <th className="px-4 py-1 text-right text-muted-foreground font-medium text-xs">Unrealised P&L</th>
                    <th className="px-4 py-1 text-right text-muted-foreground font-medium text-xs">M2M P&L</th>
                    <th className="px-4 py-1 text-center text-muted-foreground font-medium text-xs">Action</th>
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
                    const sqOffTx = pos.quantity > 0 ? "SELL" : "BUY";
                    const sqOffQty = Math.abs(pos.quantity);
                    return (
                      <tr key={`${pos.symbol}-${pos.product}`} className="border-b border-[#1a1a1a] hover:bg-[#141414] transition-colors">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-xs">{pos.symbol}</div>
                          <div className="text-xs text-muted-foreground">{pos.exchange}</div>
                        </td>
                      <td className="px-4 py-1.5 text-xs">
                          <span className="bg-[#2a2a2a] text-muted-foreground px-1.5 py-0.5 rounded">
                            {pos.product}
                          </span>
                        </td>
                      <td className={`px-4 py-2.5 text-right ${pos.quantity >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {pos.quantity > 0 ? "+" : ""}{pos.quantity}
                        </td>
                      <td className="px-4 py-1.5 text-right font-mono text-xs">₹{pos.avgPrice.toFixed(2)}</td>
                      <td className="px-4 py-1.5 text-right font-mono text-xs">₹{posLtp.toFixed(2)}</td>
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
            )}
          </div>
        )}
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
      <p className={`text-xs font-semibold ${valueClass ?? ""}`}>{value}</p>
    </div>
  );
}
