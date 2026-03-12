import { useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, ExternalLink, Search, Copy, Check } from "lucide-react";

// ── Section components ────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-foreground border-b border-[#2a2a2a] pb-2">{title}</h2>
      {children}
    </section>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-[#0f0f0f] border border-[#2a2a2a] rounded px-1.5 py-0.5 text-xs font-mono text-[#FF6600]">
      {children}
    </code>
  );
}

function FormulaBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-[#0f0f0f] border border-[#2a2a2a] rounded px-4 py-3 text-xs font-mono text-green-400 overflow-x-auto whitespace-pre-wrap">
      {children}
    </pre>
  );
}

interface IndicatorRowProps {
  name: string;
  signature: string;
  description: string;
  params?: string;
  minCandles?: number;
  example: string;
  result: string;
  searchQ?: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      title="Copy formula to clipboard"
      className="p-0.5 rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function IndicatorRow({ name, signature, description, params, minCandles, example, result, searchQ }: IndicatorRowProps) {
  if (searchQ && ![name, description, example, params ?? ""].some((t) => t.toLowerCase().includes(searchQ))) {
    return null;
  }
  return (
    <div className="border border-[#2a2a2a] rounded-lg p-4 space-y-2 hover:border-[#3a3a3a] transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-[#FF6600]">{name}</span>
          <span className="font-mono text-sm text-muted-foreground">{signature}</span>
          <CopyButton text={`${name}${signature}`} />
        </div>
        {minCandles && (
          <span className="text-[10px] text-muted-foreground/60 shrink-0 mt-0.5">
            min {minCandles} candles
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      {params && (
        <p className="text-xs text-muted-foreground/70">
          <span className="text-foreground/60">Parameters: </span>{params}
        </p>
      )}
      <div className="flex items-center gap-2 pt-1">
        <span className="text-[10px] text-muted-foreground/50">Example →</span>
        <code className="text-xs font-mono text-blue-400">{example}</code>
        <CopyButton text={example} />
        <span className="text-[10px] text-muted-foreground/50">returns</span>
        <span className="text-xs text-green-400">{result}</span>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function KPIGuide() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const q = search.toLowerCase().trim();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[#2a2a2a] bg-[#121212] shrink-0">
        <button
          onClick={() => navigate("/kpis")}
          className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded"
          title="Back to KPI Builder"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">KPI Formula Guide</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Reference for building custom KPI formulas — no programming experience needed
          </p>
        </div>
        {/* KPI-GUIDE-SEARCH: search/filter indicators */}
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search indicators…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-[#FF6600] placeholder:text-muted-foreground/50"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-10">

          {/* ── What is a KPI? ── */}
          <Section title="What is a KPI?">
            <p className="text-sm text-muted-foreground leading-relaxed">
              A KPI (Key Performance Indicator) is a custom formula that runs automatically against each of your
              holdings and shows the result in the Dashboard. You define the formula once — the system computes
              it on every stock using historical price data and fundamental data from NSE.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              <div className="bg-[#0f0f0f] border border-blue-900/40 rounded-lg p-4 space-y-1">
                <Badge label="SCALAR" color="bg-blue-900/30 text-blue-400" />
                <p className="text-xs text-muted-foreground mt-2">Returns a <strong className="text-foreground">number</strong>.</p>
                <p className="text-xs text-muted-foreground/70">e.g. RSI value = 68.4, PE Ratio = 22.1</p>
              </div>
              <div className="bg-[#0f0f0f] border border-purple-900/40 rounded-lg p-4 space-y-1">
                <Badge label="BOOLEAN" color="bg-purple-900/30 text-purple-400" />
                <p className="text-xs text-muted-foreground mt-2">Returns <strong className="text-foreground">true or false</strong>.</p>
                <p className="text-xs text-muted-foreground/70">e.g. Is RSI overbought? Yes/No</p>
              </div>
              <div className="bg-[#0f0f0f] border border-amber-900/40 rounded-lg p-4 space-y-1">
                <Badge label="CATEGORICAL" color="bg-amber-900/30 text-amber-400" />
                <p className="text-xs text-muted-foreground mt-2">Returns a <strong className="text-foreground">text label</strong>.</p>
                <p className="text-xs text-muted-foreground/70">e.g. "Buy Signal", "Hold", "Overbought"</p>
              </div>
            </div>
          </Section>

          {/* ── Price Variables ── */}
          <Section title="Price &amp; Volume Variables">
            <p className="text-sm text-muted-foreground">
              These are the latest available OHLCV values for a stock. Write them in UPPERCASE with no parentheses.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm mt-3">
                <thead>
                  <tr className="border-b border-[#2a2a2a]">
                    <th className="text-left py-2 pr-6 text-xs text-muted-foreground font-medium">Name</th>
                    <th className="text-left py-2 pr-6 text-xs text-muted-foreground font-medium">Meaning</th>
                    <th className="text-left py-2 text-xs text-muted-foreground font-medium">Example use</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1a1a1a]">
                  {[
                    ["CLOSE", "Most recent closing price", "CLOSE > EMA(20)"],
                    ["OPEN", "Today's opening price", "CLOSE > OPEN"],
                    ["HIGH", "Today's high", "HIGH / CLOSE"],
                    ["LOW", "Today's low", "CLOSE - LOW"],
                    ["VOLUME", "Today's traded volume", "VOLUME > 1000000"],
                  ].map(([name, meaning, example]) => (
                    <tr key={name} className="hover:bg-[#0f0f0f]">
                      <td className="py-2.5 pr-6 font-mono text-[#FF6600] text-xs">{name}</td>
                      <td className="py-2.5 pr-6 text-xs text-muted-foreground">{meaning}</td>
                      <td className="py-2.5 font-mono text-xs text-blue-400">{example}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* ── Fundamental Variables ── */}
          <Section title="Fundamental Variables">
            <p className="text-sm text-muted-foreground">
              These come from NSE fundamental data, refreshed weekly. They may be <code className="text-xs font-mono">null</code> if data
              is unavailable for a stock — the KPI will show "—" in that case rather than an error.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm mt-3">
                <thead>
                  <tr className="border-b border-[#2a2a2a]">
                    <th className="text-left py-2 pr-6 text-xs text-muted-foreground font-medium">Name</th>
                    <th className="text-left py-2 pr-6 text-xs text-muted-foreground font-medium">Full name</th>
                    <th className="text-left py-2 text-xs text-muted-foreground font-medium">Example use</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1a1a1a]">
                  {[
                    ["PE_RATIO", "Price-to-Earnings ratio", "PE_RATIO < 15"],
                    ["EPS", "Earnings Per Share (₹)", "EPS > 50"],
                    ["BOOK_VALUE", "Book Value Per Share (₹)", "CLOSE / BOOK_VALUE"],
                    ["FACE_VALUE", "Face Value (₹)", "FACE_VALUE"],
                    ["WEEK_52_HIGH", "52-week high price", "CLOSE / WEEK_52_HIGH"],
                    ["WEEK_52_LOW", "52-week low price", "CLOSE / WEEK_52_LOW"],
                    ["PCT_FROM_52W_HIGH", "% below 52-week high (negative = below)", "PCT_FROM_52W_HIGH > -10"],
                    ["PCT_FROM_52W_LOW", "% above 52-week low (positive = above)", "PCT_FROM_52W_LOW < 20"],
                  ].map(([name, full, example]) => (
                    <tr key={name} className="hover:bg-[#0f0f0f]">
                      <td className="py-2.5 pr-6 font-mono text-[#FF6600] text-xs">{name}</td>
                      <td className="py-2.5 pr-6 text-xs text-muted-foreground">{full}</td>
                      <td className="py-2.5 font-mono text-xs text-blue-400">{example}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* ── Indicator Functions ── */}
          <Section title="Technical Indicator Functions">
            {!q && (
              <p className="text-sm text-muted-foreground">
                Functions take a <em>period</em> (number of candles to look back) as argument and compute a value
                from historical price data. They are calculated on daily candles.
              </p>
            )}

            <div className="space-y-3 mt-2">
              <IndicatorRow
                name="RSI"
                signature="( period )"
                description="Relative Strength Index. Measures overbought/oversold momentum on a scale of 0–100. Above 70 = overbought (potential sell). Below 30 = oversold (potential buy)."
                params="period — how many candles to use (common: 14)"
                minCandles={14}
                example="RSI(14)"
                searchQ={q}
                result="e.g. 68.4"
              />
              <IndicatorRow
                name="SMA"
                signature="( period )"
                description="Simple Moving Average — the plain average of closing prices over the last N candles. Good for identifying the overall trend direction."
                params="period — number of candles (common: 20, 50, 200)"
                minCandles={20}
                example="SMA(50)"
                searchQ={q}
                result="e.g. 2340.10"
              />
              <IndicatorRow
                name="EMA"
                signature="( period )"
                description="Exponential Moving Average — similar to SMA but gives more weight to recent prices, so it reacts faster to price changes. Often used for short-term signals."
                params="period — number of candles (common: 9, 20, 50)"
                minCandles={9}
                example="EMA(20)"
                searchQ={q}
                result="e.g. 2365.80"
              />
              <IndicatorRow
                name="MACD"
                signature="()"
                description="Moving Average Convergence Divergence line. The difference between a 12-period EMA and a 26-period EMA. Positive = bullish momentum. No arguments needed."
                minCandles={35}
                example="MACD()"
                searchQ={q}
                result="e.g. 12.5"
              />
              <IndicatorRow
                name="MACD_SIGNAL"
                signature="()"
                description="The 9-period EMA of the MACD line. Used in combination with MACD: when MACD crosses above MACD_SIGNAL it's a bullish signal."
                minCandles={35}
                example="MACD() > MACD_SIGNAL()"
                searchQ={q}
                result="true / false"
              />
              <IndicatorRow
                name="MACD_HIST"
                signature="()"
                description="MACD Histogram — the difference between MACD and MACD_SIGNAL. Positive and growing = increasing bullish momentum."
                minCandles={35}
                example="MACD_HIST()"
                searchQ={q}
                result="e.g. 3.2"
              />
              <IndicatorRow
                name="BB_UPPER"
                signature="( period )"
                description="Bollinger Band upper band. Price touching or breaking above this level may indicate overbought conditions."
                params="period — lookback (common: 20)"
                minCandles={20}
                example="BB_UPPER(20)"
                searchQ={q}
                result="e.g. 2520.0"
              />
              <IndicatorRow
                name="BB_MIDDLE"
                signature="( period )"
                description="Bollinger Band middle line — the SMA of the close. Acts as a mean-reversion target."
                params="period — same as BB_UPPER/BB_LOWER"
                minCandles={20}
                example="BB_MIDDLE(20)"
                searchQ={q}
                result="e.g. 2400.0"
              />
              <IndicatorRow
                name="BB_LOWER"
                signature="( period )"
                description="Bollinger Band lower band. Price touching or breaking below this level may indicate oversold conditions."
                params="period — lookback (common: 20)"
                minCandles={20}
                example="BB_LOWER(20)"
                searchQ={q}
                result="e.g. 2280.0"
              />
              <IndicatorRow
                name="ATR"
                signature="( period )"
                description="Average True Range — measures market volatility. Higher ATR = more volatile. Useful to compare volatility across stocks or set stop-loss levels."
                params="period — common: 14"
                minCandles={14}
                example="ATR(14)"
                searchQ={q}
                result="e.g. 45.3 (₹)"
              />
              <IndicatorRow
                name="OBV"
                signature="()"
                description="On-Balance Volume — cumulative indicator that uses volume to predict price direction. Rising OBV with rising price = strong trend. No arguments needed."
                minCandles={10}
                example="OBV()"
                searchQ={q}
                result="e.g. 1420500000"
              />
              <IndicatorRow
                name="STOCH_K"
                signature="( k, d )"
                description="Stochastic Oscillator %K line — compares a stock's closing price to its price range over a period. 0–100 scale. Above 80 = overbought, below 20 = oversold."
                params="k — smoothing period (common: 14), d — signal period (common: 3)"
                minCandles={20}
                example="STOCH_K(14, 3)"
                searchQ={q}
                result="e.g. 82.1"
              />
              <IndicatorRow
                name="STOCH_D"
                signature="( k, d )"
                description="Stochastic Oscillator %D line — the moving average of %K. When %K crosses %D from below 20, it's often a buy signal."
                params="k and d must match the STOCH_K call"
                minCandles={20}
                example="STOCH_D(14, 3)"
                searchQ={q}
                result="e.g. 78.4"
              />
            </div>
          </Section>

          {/* ── Math Operations ── */}
          <Section title="Math Operations">
            <p className="text-sm text-muted-foreground">
              You can combine indicators and scalars with standard arithmetic. These work in SCALAR formulas.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
              {[
                ["+", "Addition", "CLOSE + ATR(14)  →  price + volatility buffer"],
                ["-", "Subtraction", "CLOSE - SMA(20)  →  distance from moving average"],
                ["*", "Multiplication", "ATR(14) * 2  →  double the ATR"],
                ["/", "Division", "CLOSE / BOOK_VALUE  →  price-to-book ratio"],
                ["( )", "Grouping", "(SMA(20) - SMA(50)) / SMA(50) * 100  →  % gap between MAs"],
              ].map(([op, name, ex]) => (
                <div key={op} className="bg-[#0f0f0f] border border-[#2a2a2a] rounded p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[#FF6600] font-bold">{op}</span>
                    <span className="text-xs text-foreground/80">{name}</span>
                  </div>
                  <p className="text-[11px] font-mono text-muted-foreground/70">{ex}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Comparison Operators ── */}
          <Section title="Comparison Operators (for BOOLEAN & CATEGORICAL)">
            <p className="text-sm text-muted-foreground">
              Used to build conditions that evaluate to true or false.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm mt-3">
                <thead>
                  <tr className="border-b border-[#2a2a2a]">
                    <th className="text-left py-2 pr-8 text-xs text-muted-foreground font-medium">Operator</th>
                    <th className="text-left py-2 pr-8 text-xs text-muted-foreground font-medium">Meaning</th>
                    <th className="text-left py-2 text-xs text-muted-foreground font-medium">Example</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1a1a1a]">
                  {[
                    [">", "Greater than", "RSI(14) > 70"],
                    ["<", "Less than", "PE_RATIO < 15"],
                    [">=", "Greater than or equal to", "CLOSE >= BB_UPPER(20)"],
                    ["<=", "Less than or equal to", "CLOSE <= BB_LOWER(20)"],
                    ["==", "Exactly equal to", "VOLUME == 0"],
                  ].map(([op, meaning, ex]) => (
                    <tr key={op} className="hover:bg-[#0f0f0f]">
                      <td className="py-2.5 pr-8 font-mono text-[#FF6600] text-sm font-bold">{op}</td>
                      <td className="py-2.5 pr-8 text-xs text-muted-foreground">{meaning}</td>
                      <td className="py-2.5 font-mono text-xs text-blue-400">{ex}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bg-[#0f0f0f] border border-[#2a2a2a] rounded p-3 mt-3 space-y-2">
              <p className="text-xs text-muted-foreground font-medium">Combining conditions with AND / OR:</p>
              <div className="space-y-1.5">
                <p className="text-xs font-mono text-blue-400">RSI(14) &gt; 70 AND CLOSE &gt;= BB_UPPER(20)</p>
                <p className="text-[11px] text-muted-foreground/70">Both must be true → use when confirming a signal</p>
              </div>
              <div className="space-y-1.5 mt-2">
                <p className="text-xs font-mono text-blue-400">RSI(14) &lt; 30 OR CLOSE &lt;= BB_LOWER(20)</p>
                <p className="text-[11px] text-muted-foreground/70">Either being true is enough → use when casting a wider net</p>
              </div>
            </div>
          </Section>

          {/* ── Examples by type ── */}
          <Section title="Full Examples by Return Type">

            {/* SCALAR */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge label="SCALAR" color="bg-blue-900/30 text-blue-400" />
                <span className="text-xs text-muted-foreground">Returns a number shown in the KPI column</span>
              </div>
              <FormulaBlock>{`RSI(14)
→ Shows the 14-period RSI value for each holding. e.g. "68.4"

SMA(50) - SMA(200)
→ Distance between 50-day and 200-day moving average.
  Positive = 50-day is above 200-day (bullish).

(CLOSE - SMA(200)) / SMA(200) * 100
→ How far above/below the 200-day average the price is, in %.
  e.g. "+5.3" means 5.3% above the 200-day MA.

PCT_FROM_52W_HIGH
→ How much the stock is below its 52-week high in %.
  e.g. "-18.2" means 18.2% below the 52-week peak.

CLOSE / BOOK_VALUE
→ Price-to-book ratio computed from live price + fundamental data.

ATR(14) / CLOSE * 100
→ ATR as a percentage of price — normalised volatility.
  Useful to compare volatility across stocks of different prices.`}
              </FormulaBlock>
            </div>

            {/* BOOLEAN */}
            <div className="space-y-3 mt-6">
              <div className="flex items-center gap-2">
                <Badge label="BOOLEAN" color="bg-purple-900/30 text-purple-400" />
                <span className="text-xs text-muted-foreground">Returns true or false — shows as a checkmark in the Dashboard</span>
              </div>
              <FormulaBlock>{`RSI(14) > 70
→ true if RSI is overbought, false otherwise.

CLOSE > EMA(50)
→ true if the stock is trading above its 50-day EMA (uptrend signal).

RSI(14) < 30 AND CLOSE <= BB_LOWER(20)
→ true only when BOTH conditions hold — strong oversold confirmation.

MACD() > MACD_SIGNAL()
→ true when MACD line is above the signal line (bullish crossover zone).

PE_RATIO < 15 AND PCT_FROM_52W_HIGH > -20
→ true for value stocks that haven't fallen more than 20% from their peak.`}
              </FormulaBlock>
            </div>

            {/* CATEGORICAL */}
            <div className="space-y-3 mt-6">
              <div className="flex items-center gap-2">
                <Badge label="CATEGORICAL" color="bg-amber-900/30 text-amber-400" />
                <span className="text-xs text-muted-foreground">Returns a text label — use the structured condition editor in KPI Builder</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Conditions are checked top to bottom. The first one that is true determines the label.
                If none match, the Default label is used.
              </p>
              <FormulaBlock>{`Example: RSI Signal
  Condition 1:  RSI(14) > 70          →  "Overbought"
  Condition 2:  RSI(14) < 30          →  "Oversold"
  Default:                            →  "Neutral"

Example: Trend + Momentum
  Condition 1:  CLOSE > EMA(50) AND RSI(14) > 55   →  "Strong Buy"
  Condition 2:  CLOSE > EMA(50)                    →  "Uptrend"
  Condition 3:  CLOSE < EMA(50) AND RSI(14) < 45   →  "Weak"
  Default:                                         →  "Neutral"

Example: Bollinger Position
  Condition 1:  CLOSE >= BB_UPPER(20)  →  "Sell Signal"
  Condition 2:  CLOSE <= BB_LOWER(20)  →  "Buy Signal"
  Default:                             →  "Hold"

Example: Value Screen
  Condition 1:  PE_RATIO < 10          →  "Deep Value"
  Condition 2:  PE_RATIO < 20          →  "Fair Value"
  Condition 3:  PE_RATIO > 40          →  "Expensive"
  Default:                             →  "Normal"`}
              </FormulaBlock>
            </div>
          </Section>

          {/* ── Tips ── */}
          <Section title="Tips & Common Mistakes">
            <div className="space-y-3">
              {[
                {
                  tip: "Minimum candles",
                  detail: "Indicators need historical data. RSI(14) needs 14 days, SMA(200) needs 200 days. If a stock has fewer candles in the cache, the KPI will show -- (null) instead of an error.",
                  ok: true,
                },
                {
                  tip: "SCALAR vs BOOLEAN",
                  detail: "If your formula has >, <, >= or AND/OR, it must be BOOLEAN (or CATEGORICAL). A formula like RSI(14) > 70 cannot be SCALAR -- it returns true/false, not a number.",
                  ok: true,
                },
                {
                  tip: "Case sensitivity",
                  detail: "All indicator names and variables must be UPPERCASE: RSI, CLOSE, EMA, PE_RATIO. Lowercase will not work.",
                  ok: false,
                },
                {
                  tip: "No free-form Python",
                  detail: "Only the listed indicators and variables are allowed. You cannot call arbitrary functions like abs(), log(), or import libraries. ABS() is not supported -- use arithmetic instead.",
                  ok: false,
                },
                {
                  tip: "Fundamental data availability",
                  detail: "PE_RATIO, EPS, BOOK_VALUE etc. come from NSE India scraping, refreshed weekly on Sundays. For mid/small caps or newly listed stocks the data may not be available yet.",
                  ok: true,
                },
                {
                  tip: "Autocomplete in the formula field",
                  detail: "When typing a SCALAR or BOOLEAN formula in KPI Builder, start typing an indicator name and a dropdown will appear. Press down/up arrow to navigate, Enter or Tab to accept.",
                  ok: true,
                },
              ].map(({ tip, detail, ok }) => (
                <div key={tip} className="flex gap-3 bg-[#0f0f0f] border border-[#2a2a2a] rounded p-3">
                  <span className={`text-sm font-bold mt-0.5 shrink-0 ${ok ? "text-green-400" : "text-red-400"}`}>
                    {ok ? "✓" : "✗"}
                  </span>
                  <div className="space-y-0.5">
                    <p className="text-xs font-semibold text-foreground/80">{tip}</p>
                    <p className="text-xs text-muted-foreground">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Quick reference card ── */}
          <Section title="Quick Reference">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-[#0f0f0f] border border-[#2a2a2a] rounded p-4 space-y-2">
                <p className="text-xs font-semibold text-foreground/80 mb-2">Momentum indicators</p>
                {[
                  ["RSI(14)", "0–100 scale, overbought >70"],
                  ["STOCH_K(14,3)", "0–100 scale, overbought >80"],
                  ["MACD()", "positive = bullish momentum"],
                ].map(([f, d]) => (
                  <div key={f} className="flex justify-between gap-2">
                    <Code>{f}</Code>
                    <span className="text-[11px] text-muted-foreground/70 text-right">{d}</span>
                  </div>
                ))}
              </div>
              <div className="bg-[#0f0f0f] border border-[#2a2a2a] rounded p-4 space-y-2">
                <p className="text-xs font-semibold text-foreground/80 mb-2">Trend indicators</p>
                {[
                  ["SMA(200)", "200-day average — major trend"],
                  ["EMA(20)", "20-day EMA — short-term trend"],
                  ["BB_MIDDLE(20)", "20-day SMA (middle band)"],
                ].map(([f, d]) => (
                  <div key={f} className="flex justify-between gap-2">
                    <Code>{f}</Code>
                    <span className="text-[11px] text-muted-foreground/70 text-right">{d}</span>
                  </div>
                ))}
              </div>
              <div className="bg-[#0f0f0f] border border-[#2a2a2a] rounded p-4 space-y-2">
                <p className="text-xs font-semibold text-foreground/80 mb-2">Volatility indicators</p>
                {[
                  ["ATR(14)", "₹ amount of avg daily range"],
                  ["BB_UPPER(20)", "upper band = avg + 2×std"],
                  ["BB_LOWER(20)", "lower band = avg − 2×std"],
                ].map(([f, d]) => (
                  <div key={f} className="flex justify-between gap-2">
                    <Code>{f}</Code>
                    <span className="text-[11px] text-muted-foreground/70 text-right">{d}</span>
                  </div>
                ))}
              </div>
              <div className="bg-[#0f0f0f] border border-[#2a2a2a] rounded p-4 space-y-2">
                <p className="text-xs font-semibold text-foreground/80 mb-2">Fundamental &amp; position</p>
                {[
                  ["PE_RATIO", "lower = cheaper relative to earnings"],
                  ["PCT_FROM_52W_HIGH", "negative = below 52-week high"],
                  ["CLOSE / BOOK_VALUE", "P/B ratio (manual calculation)"],
                ].map(([f, d]) => (
                  <div key={f} className="flex justify-between gap-2">
                    <Code>{f}</Code>
                    <span className="text-[11px] text-muted-foreground/70 text-right">{d}</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>

          {/* Footer */}
          <div className="border-t border-[#2a2a2a] pt-6 pb-2 flex items-center justify-between">
            <p className="text-xs text-muted-foreground/50">
              Indicators powered by <span className="font-mono">pandas-ta</span>. Data from Kite Connect &amp; NSE India.
            </p>
            <a
              href="https://twopirllc.github.io/pandas-ta/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              pandas-ta docs <ExternalLink className="w-3 h-3" />
            </a>
          </div>

        </div>
      </div>
    </div>
  );
}
