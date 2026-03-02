import { useState, useMemo } from "react";
import { mockAuditEntries, type AuditEntry } from "../data/mockData";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

// M-05: Action type labels aligned with PRD naming
const ACTION_LABELS: Record<AuditEntry["action"], string> = {
  PLACE_ORDER: "Place Order",
  MODIFY_ORDER: "Modify Order",
  CANCEL_ORDER: "Cancel Order",
  PLACE_GTT: "Place GTT",
  MODIFY_GTT: "Modify GTT",
  DELETE_GTT: "Delete GTT",
};

// M-05: Filter options use correct naming (not ORDER_PLACE format)
const ACTION_FILTER_OPTIONS: Array<{ value: AuditEntry["action"] | "ALL"; label: string }> = [
  { value: "ALL", label: "All Actions" },
  { value: "PLACE_ORDER", label: "Place Order" },
  { value: "MODIFY_ORDER", label: "Modify Order" },
  { value: "CANCEL_ORDER", label: "Cancel Order" },
  { value: "PLACE_GTT", label: "Place GTT" },
  { value: "MODIFY_GTT", label: "Modify GTT" },
  { value: "DELETE_GTT", label: "Delete GTT" },
];

type SortKey = "timestamp" | "action" | "symbol" | "outcome";
type SortDir = "asc" | "desc";

export default function AuditLog() {
  const [actionFilter, setActionFilter] = useState<AuditEntry["action"] | "ALL">("ALL");
  const [outcomeFilter, setOutcomeFilter] = useState<"ALL" | "SUCCESS" | "FAILURE">("ALL");
  // US-080: date range and instrument filters
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [symbolFilter, setSymbolFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expanded, setExpanded] = useState<string | null>(null);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const clearFilters = () => {
    setActionFilter("ALL");
    setOutcomeFilter("ALL");
    setFromDate("");
    setToDate("");
    setSymbolFilter("");
  };

  const hasFilters =
    actionFilter !== "ALL" ||
    outcomeFilter !== "ALL" ||
    fromDate !== "" ||
    toDate !== "" ||
    symbolFilter !== "";

  const filtered = useMemo(() => {
    let rows = [...mockAuditEntries];
    if (actionFilter !== "ALL") rows = rows.filter((r) => r.action === actionFilter);
    if (outcomeFilter !== "ALL") rows = rows.filter((r) => r.outcome === outcomeFilter);
    // US-080: filter by date range — timestamp format "YYYY-MM-DD HH:MM:SS"
    if (fromDate) rows = rows.filter((r) => r.timestamp.slice(0, 10) >= fromDate);
    if (toDate) rows = rows.filter((r) => r.timestamp.slice(0, 10) <= toDate);
    // US-080: filter by instrument (symbol)
    if (symbolFilter.trim()) {
      const q = symbolFilter.trim().toLowerCase();
      rows = rows.filter((r) => r.symbol.toLowerCase().includes(q));
    }
    rows.sort((a, b) => {
      const av = a[sortKey] as string;
      const bv = b[sortKey] as string;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [actionFilter, outcomeFilter, fromDate, toDate, symbolFilter, sortKey, sortDir]);

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3 h-3 ml-1 text-[#FF6600]" />
    ) : (
      <ChevronDown className="w-3 h-3 ml-1 text-[#FF6600]" />
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-4 border-b border-[#2a2a2a] bg-[#121212]">
        <h1 className="text-lg font-semibold mr-auto">Audit Log</h1>

        {/* US-080: Instrument filter */}
        <input
          type="text"
          placeholder="Symbol…"
          value={symbolFilter}
          onChange={(e) => setSymbolFilter(e.target.value)}
          className="w-28 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-[#FF6600]"
        />

        {/* US-080: Date range filter */}
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground">From</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600] [color-scheme:dark]"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground">To</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600] [color-scheme:dark]"
          />
        </div>

        {/* M-05: Filter by action using correct naming */}
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value as typeof actionFilter)}
          className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]"
        >
          {ACTION_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={outcomeFilter}
          onChange={(e) => setOutcomeFilter(e.target.value as typeof outcomeFilter)}
          className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-3 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]"
        >
          <option value="ALL">All Outcomes</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILURE">Failure</option>
        </select>

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#121212] border-b border-[#2a2a2a]">
            <tr>
              <th
                className="px-4 py-3 text-left text-muted-foreground font-medium cursor-pointer hover:text-foreground"
                onClick={() => handleSort("timestamp")}
              >
                <span className="flex items-center">
                  Timestamp <SortIcon col="timestamp" />
                </span>
              </th>
              <th
                className="px-4 py-3 text-left text-muted-foreground font-medium cursor-pointer hover:text-foreground"
                onClick={() => handleSort("action")}
              >
                <span className="flex items-center">
                  Action <SortIcon col="action" />
                </span>
              </th>
              <th
                className="px-4 py-3 text-left text-muted-foreground font-medium cursor-pointer hover:text-foreground"
                onClick={() => handleSort("symbol")}
              >
                <span className="flex items-center">
                  Symbol <SortIcon col="symbol" />
                </span>
              </th>
              <th className="px-4 py-3 text-left text-muted-foreground font-medium">
                Exchange
              </th>
              <th
                className="px-4 py-3 text-left text-muted-foreground font-medium cursor-pointer hover:text-foreground"
                onClick={() => handleSort("outcome")}
              >
                <span className="flex items-center">
                  Outcome <SortIcon col="outcome" />
                </span>
              </th>
              <th className="px-4 py-3 text-left text-muted-foreground font-medium">
                Kite Order ID
              </th>
              <th className="px-4 py-3 text-left text-muted-foreground font-medium">
                Request ID
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
              <>
                <tr
                  key={entry.id}
                  className="border-b border-[#1a1a1a] hover:bg-[#141414] cursor-pointer transition-colors"
                  onClick={() =>
                    setExpanded(expanded === entry.id ? null : entry.id)
                  }
                >
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                    {entry.timestamp}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {ACTION_LABELS[entry.action]}
                  </td>
                  <td className="px-4 py-3 font-medium">{entry.symbol}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {entry.exchange}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        entry.outcome === "SUCCESS"
                          ? "bg-green-900/30 text-green-400"
                          : "bg-red-900/30 text-red-400"
                      }`}
                    >
                      {entry.outcome}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                    {entry.kiteOrderId ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                    {entry.requestId}
                  </td>
                </tr>
                {expanded === entry.id && (
                  <tr key={`${entry.id}-detail`} className="bg-[#0f0f0f] border-b border-[#1a1a1a]">
                    <td colSpan={7} className="px-6 py-4">
                      <div className="space-y-2">
                        {entry.errorMessage && (
                          <p className="text-sm text-red-400">
                            Error: {entry.errorMessage}
                          </p>
                        )}
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">
                            Request Params
                          </p>
                          <pre className="text-xs bg-[#1a1a1a] border border-[#2a2a2a] rounded p-3 overflow-x-auto text-foreground">
                            {JSON.stringify(entry.orderParams, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-muted-foreground"
                >
                  No audit entries match the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-6 py-2 border-t border-[#2a2a2a] text-xs text-muted-foreground">
        {filtered.length} of {mockAuditEntries.length} entries
      </div>
    </div>
  );
}
