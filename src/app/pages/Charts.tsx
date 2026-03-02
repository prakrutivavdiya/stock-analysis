import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { mockHoldings } from "../data/mockData";

// PRD HD-03: 5m, 15m, 30m, 1hr, Day only (no weekly)
const INTERVALS: { label: string; value: string }[] = [
  { label: "5m", value: "5" },
  { label: "15m", value: "15" },
  { label: "30m", value: "30" },
  { label: "1hr", value: "60" },
  { label: "D", value: "D" },
];

// PRD CH-01: Candlestick, Bar, Line, Area chart types
// TradingView widget style codes: 1=Candles, 0=Bars, 4=Line, 5=Area
const CHART_TYPES: { label: string; value: string }[] = [
  { label: "Candles", value: "1" },
  { label: "Bars", value: "0" },
  { label: "Line", value: "4" },
  { label: "Area", value: "5" },
];

declare global {
  interface Window {
    TradingView: {
      widget: new (config: Record<string, unknown>) => unknown;
    };
  }
}

export default function Charts() {
  const { symbol: paramSymbol } = useParams();
  const navigate = useNavigate();

  const [symbol, setSymbol] = useState(paramSymbol || "INFY");
  const [exchange, setExchange] = useState("NSE");
  const [interval, setInterval] = useState("D");
  // CH-01: chart type selector
  const [chartStyle, setChartStyle] = useState("1");
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const holdingSymbols = mockHoldings.map((h) => ({
    symbol: h.symbol,
    exchange: h.exchange,
  }));

  const filteredSymbols = search
    ? holdingSymbols.filter((h) =>
        h.symbol.toLowerCase().includes(search.toLowerCase())
      )
    : holdingSymbols;

  const selectSymbol = (sym: string, exch: string) => {
    setSymbol(sym);
    setExchange(exch);
    setSearch("");
    navigate(`/charts/${sym}`, { replace: true });
  };

  // Load TradingView widget — re-runs on symbol, exchange, interval, or chartStyle change
  useEffect(() => {
    if (!containerRef.current) return;

    const containerId = "tv_chart_container";
    const load = () => {
      if (!window.TradingView) return;
      new window.TradingView.widget({
        container_id: containerId,
        autosize: true,
        symbol: `${exchange}:${symbol}`,
        interval,
        timezone: "Asia/Kolkata",
        theme: "dark",
        style: chartStyle,
        locale: "en",
        toolbar_bg: "#121212",
        enable_publishing: false,
        hide_side_toolbar: false,
        allow_symbol_change: false,
        save_image: false,
        backgroundColor: "#0a0a0a",
        gridColor: "#1a1a1a",
      });
    };

    // Clear previous widget content
    if (containerRef.current) {
      containerRef.current.innerHTML = `<div id="${containerId}" style="height:100%;width:100%"></div>`;
    }

    if (window.TradingView) {
      load();
    } else {
      if (!document.getElementById("tv-script")) {
        const script = document.createElement("script");
        script.id = "tv-script";
        script.src = "https://s3.tradingview.com/tv.js";
        script.async = true;
        script.onload = load;
        document.head.appendChild(script);
      } else {
        widgetRef.current = setTimeout(load, 500);
      }
    }

    return () => {
      if (widgetRef.current) clearTimeout(widgetRef.current);
    };
  }, [symbol, exchange, interval, chartStyle]);

  return (
    <div className="flex h-full">
      {/* Symbol sidebar */}
      <aside className="w-48 shrink-0 border-r border-[#2a2a2a] flex flex-col bg-[#0f0f0f]">
        <div className="p-3 border-b border-[#2a2a2a]">
          <input
            type="text"
            placeholder="Search holdings…"
            value={search}
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
                symbol === h.symbol
                  ? "bg-[#2a2a2a] text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-[#1a1a1a]"
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
        {/* Toolbar: symbol label + chart type + intervals */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-[#2a2a2a] bg-[#121212]">
          <span className="text-sm font-medium mr-2">
            {exchange}:{symbol}
          </span>

          {/* CH-01: Chart type selector */}
          <div className="flex items-center gap-1 border-r border-[#2a2a2a] pr-3 mr-1">
            {CHART_TYPES.map((ct) => (
              <button
                key={ct.value}
                onClick={() => setChartStyle(ct.value)}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${
                  chartStyle === ct.value
                    ? "bg-[#FF6600] text-white"
                    : "text-muted-foreground hover:text-foreground hover:bg-[#2a2a2a]"
                }`}
              >
                {ct.label}
              </button>
            ))}
          </div>

          {/* Interval buttons */}
          <div className="flex items-center gap-1 ml-auto">
            {INTERVALS.map((iv) => (
              <button
                key={iv.value}
                onClick={() => setInterval(iv.value)}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  interval === iv.value
                    ? "bg-[#FF6600] text-white"
                    : "text-muted-foreground hover:text-foreground hover:bg-[#2a2a2a]"
                }`}
              >
                {iv.label}
              </button>
            ))}
          </div>
        </div>

        {/* TradingView widget mount point */}
        <div className="flex-1 min-h-0" ref={containerRef} />
      </div>
    </div>
  );
}
