import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Plus,
  X,
  AlertTriangle,
  SlidersHorizontal,
} from "lucide-react";
import {
  mockHoldings,
  mockPositions,
  mockMargin,
  mockXirr,
  type Holding,
} from "../data/mockData";

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
  { id: "avgPrice", label: "Avg Price", group: "standard", align: "right", format: (h) => `₹${h.avgPrice.toFixed(2)}` },
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
    format: (h) => h.kpis?.dailyRSI?.toFixed(1) ?? "—",
  },
  {
    id: "rsiOverbought",
    label: "RSI >70",
    group: "kpi",
    align: "right",
    format: (h) => {
      const val = h.kpis?.rsiOverbought;
      if (val === undefined) return "—";
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
      if (v === undefined) return "N/A";
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

type SortKey = "symbol" | ColId;
type SortDir = "asc" | "desc";
type FilterKey = "all" | "gainers" | "losers" | "rsiOverbought" | "bbBuy" | "bbSell";

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

export default function Dashboard() {
  const navigate = useNavigate();
  const [visibleCols, setVisibleCols] = useState<ColId[]>(DEFAULT_COLS);
  const [showColPicker, setShowColPicker] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showPositions, setShowPositions] = useState(true);

  const [sortKey, setSortKey] = useState<SortKey>("symbol");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");

  const handleHeaderSort = (col: SortKey) => {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(col); setSortDir("asc"); }
  };

  const handleQuickSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const filteredAndSorted = useMemo(() => {
    let rows = [...mockHoldings];

    if (activeFilter === "gainers") rows = rows.filter((h) => h.dayChangePercent > 0);
    else if (activeFilter === "losers") rows = rows.filter((h) => h.dayChangePercent < 0);
    else if (activeFilter === "rsiOverbought") rows = rows.filter((h) => h.kpis?.rsiOverbought);
    // PRD KP-11: title-case filter values
    else if (activeFilter === "bbBuy") rows = rows.filter((h) => h.kpis?.bbPosition === "Buy Signal");
    else if (activeFilter === "bbSell") rows = rows.filter((h) => h.kpis?.bbPosition === "Sell Signal");

    rows.sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      if (sortKey === "symbol") { av = a.symbol; bv = b.symbol; }
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
      else if (sortKey === "peRatio") { av = a.kpis?.peRatio ?? -Infinity; bv = b.kpis?.peRatio ?? -Infinity; }
      else if (sortKey === "from52WeekHigh") { av = a.kpis?.from52WeekHigh ?? -Infinity; bv = b.kpis?.from52WeekHigh ?? -Infinity; }
      else if (sortKey === "eps") { av = a.kpis?.eps ?? -Infinity; bv = b.kpis?.eps ?? -Infinity; }

      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [sortKey, sortDir, activeFilter]);

  // PD-04: Portfolio summary totals
  const totals = useMemo(() => {
    const invested = mockHoldings.reduce((s, h) => s + h.investedValue, 0);
    const current = mockHoldings.reduce((s, h) => s + h.currentValue, 0);
    const pnl = current - invested;
    const pnlPct = (pnl / invested) * 100;
    return { invested, current, pnl, pnlPct };
  }, []);

  // PD-02: Intraday auto-square warning
  const intradayPositions = mockPositions.filter((p) => p.product === "MIS");
  const showAutoSquareWarning = intradayPositions.length > 0;

  const toggleCol = (id: ColId) => {
    setVisibleCols((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const colDef = (id: ColId) => ALL_COLUMNS.find((c) => c.id === id)!;

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3 h-3 ml-1 text-[#FF6600]" />
      : <ChevronDown className="w-3 h-3 ml-1 text-[#FF6600]" />;
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
          value={mockXirr != null ? `${mockXirr.toFixed(1)}%` : "N/A"}
          valueClass={mockXirr != null && mockXirr >= 0 ? "text-green-400" : undefined}
          hint="Annualised return on invested capital"
        />
        {/* PD-03: Available margin */}
        <SummaryCard
          label="Available Margin"
          value={`₹${mockMargin.available.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
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
            {filteredAndSorted.length} of {mockHoldings.length} holdings
          </span>

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
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                  Standard
                </p>
                {ALL_COLUMNS.filter((c) => c.group === "standard").map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 px-1 py-1 text-xs cursor-pointer hover:bg-[#2a2a2a] rounded"
                  >
                    <input
                      type="checkbox"
                      checked={visibleCols.includes(c.id)}
                      onChange={() => toggleCol(c.id)}
                      className="accent-[#FF6600]"
                    />
                    {c.label}
                  </label>
                ))}
                <p className="text-xs font-medium text-muted-foreground mb-2 mt-3 uppercase tracking-wider">
                  KPI Columns
                </p>
                {ALL_COLUMNS.filter((c) => c.group === "kpi").map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 px-1 py-1 text-xs cursor-pointer hover:bg-[#2a2a2a] rounded"
                  >
                    <input
                      type="checkbox"
                      checked={visibleCols.includes(c.id)}
                      onChange={() => toggleCol(c.id)}
                      className="accent-[#FF6600]"
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-auto">
        {/* Holdings table */}
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#121212] border-b border-[#2a2a2a]">
            <tr>
              <th
                className="px-4 py-2.5 text-left text-muted-foreground font-medium text-xs cursor-pointer hover:text-foreground"
                onClick={() => handleHeaderSort("symbol")}
              >
                <span className="flex items-center">
                  Symbol <SortIcon col="symbol" />
                </span>
              </th>
              {visibleCols.map((id) => {
                const col = colDef(id);
                const sortable = SORT_OPTIONS.some((s) => s.value === id);
                return (
                  <th
                    key={id}
                    className={`px-4 py-2.5 text-xs text-muted-foreground font-medium ${
                      col.align === "right" ? "text-right" : "text-left"
                    } ${sortable ? "cursor-pointer hover:text-foreground" : ""}`}
                    onClick={sortable ? () => handleHeaderSort(id) : undefined}
                  >
                    <span className={`flex items-center ${col.align === "right" ? "justify-end" : ""}`}>
                      {sortable && col.align === "right" && <SortIcon col={id} />}
                      {col.label}
                      {sortable && col.align !== "right" && <SortIcon col={id} />}
                    </span>
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
              </tr>
            ))}
            {filteredAndSorted.length === 0 && (
              <tr>
                <td
                  colSpan={visibleCols.length + 1}
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
              {mockPositions.length > 0 && (
                <span className="text-xs bg-[#2a2a2a] text-muted-foreground px-1.5 py-0.5 rounded">
                  {mockPositions.length}
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
            mockPositions.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="bg-[#121212] border-b border-[#2a2a2a]">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-muted-foreground font-medium text-xs">Symbol</th>
                    <th className="px-4 py-2.5 text-left text-muted-foreground font-medium text-xs">Product</th>
                    <th className="px-4 py-2.5 text-right text-muted-foreground font-medium text-xs">Qty</th>
                    <th className="px-4 py-2.5 text-right text-muted-foreground font-medium text-xs">Avg Price</th>
                    <th className="px-4 py-2.5 text-right text-muted-foreground font-medium text-xs">LTP</th>
                    <th className="px-4 py-2.5 text-right text-muted-foreground font-medium text-xs">Unrealised P&L</th>
                    <th className="px-4 py-2.5 text-right text-muted-foreground font-medium text-xs">M2M P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {mockPositions.map((pos) => (
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
                      <td className="px-4 py-2.5 text-right font-mono text-xs">₹{pos.ltp.toFixed(2)}</td>
                      <td className={`px-4 py-2.5 text-right text-xs ${pos.unrealisedPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {pos.unrealisedPnl >= 0 ? "+" : ""}₹{pos.unrealisedPnl.toFixed(2)}
                      </td>
                      <td className={`px-4 py-2.5 text-right text-xs ${pos.m2mPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {pos.m2mPnl >= 0 ? "+" : ""}₹{pos.m2mPnl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
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
