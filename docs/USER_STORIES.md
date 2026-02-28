# User Stories
## StockPilot — Personal Trading & Analysis Platform

**Version:** 2.0
**Date:** 2026-02-27

---

## Epic 1: Authentication & Session Management

### US-001 — Kite OAuth Login
> **As** Prakruti,
> **I want to** log in using my Zerodha Kite credentials via OAuth,
> **So that** my Zerodha password is never stored in this application and my session remains secure.

**Acceptance Criteria:**
- Clicking "Login with Kite" redirects me to Zerodha's OAuth page
- After a successful Zerodha login, I am redirected back to StockPilot and a session is created
- A signed JWT (RS256) is issued and stored in an httpOnly cookie
- A failed or cancelled login displays a clear error message

---

### US-002 — Session Persistence
> **As** Prakruti,
> **I want my** login session to persist for 8 hours,
> **So that** I do not need to log in again during a trading day.

**Acceptance Criteria:**
- The JWT expires after 8 hours
- A refresh token (30-day expiry) silently renews the JWT in the background
- If the refresh token has expired, I am redirected to the login page

---

### US-003 — Logout
> **As** Prakruti,
> **I want to** explicitly log out,
> **So that** my session is fully terminated on the server.

**Acceptance Criteria:**
- Clicking "Logout" revokes the server-side session record
- The httpOnly cookie is cleared
- Subsequent API calls with the old token return 401

---

## Epic 2: Portfolio Dashboard

### US-010 — Holdings Overview
> **As** Prakruti,
> **I want to** see all my current holdings in a single configurable view,
> **So that** I can understand my portfolio at a glance.

**Acceptance Criteria:**
- Table displays: Symbol, Exchange, Qty, Avg Buy Price, LTP, Current Value, P&L (₹), P&L (%), Day Change (₹), Day Change (%), and any KPIs defined by the user
- Gains are shown in green; losses are shown in red
- Table is sortable by any column
- Columns can be individually added or removed by the user
- Data refreshes automatically at a set interval, on page load, and on manual refresh

---

### US-011 — Portfolio Summary KPIs
> **As** Prakruti,
> **I want to** see top-level portfolio metrics,
> **So that** I know my overall financial position at a glance.

**Acceptance Criteria:**
- Displayed metrics: Total Invested, Current Market Value, Overall P&L (₹ and %), Available Margin
- XIRR is computed and displayed when purchase date data is available
- Metrics update whenever holdings data refreshes

---

### US-012 — Intraday Positions View
> **As** Prakruti,
> **I want to** see my current intraday positions (if any),
> **So that** I can monitor open MIS/NRML trades.

**Acceptance Criteria:**
- Displays: Symbol, Product, Qty, Avg Price, LTP, Unrealised P&L, M2M P&L
- Clearly separated from long-term holdings
- Auto-refreshes every 60 seconds while the market is open

---

## Epic 3: Historical Data

### US-020 — View D-1 Data
> **As** Prakruti,
> **I want to** see the previous trading day's OHLCV data for any of my holdings,
> **So that** I can review what happened yesterday.

**Acceptance Criteria:**
- The default date on the historical view is the most recent completed trading day (D-1)
- Candle data is shown at the selected interval (default: 15m)
- Data is fetched from Kite and cached locally for future loads

---

### US-021 — Select Custom Date Range & Interval
> **As** Prakruti,
> **I want to** query historical data for any date range and candle interval,
> **So that** I can perform deep analysis over weeks or months.

**Acceptance Criteria:**
- Date picker allows any range within the past 3 years for daily candles, and within the past 60 days for intraday candles
- Supported intervals: 5m, 15m, 30m, 1hr, day
- API returns an OHLCV array for the requested range
- Cached data is served if already fetched; only missing ranges are fetched from Kite

---

### US-022 — Bulk D-1 Refresh
> **As** Prakruti,
> **I want** the app to automatically fetch D-1 data for all my holdings at market open,
> **So that** my dashboard is always pre-populated with fresh data.

**Acceptance Criteria:**
- A scheduled job runs at 09:20 IST on trading days
- Fetches the D-1 daily candle for all held instruments
- Logs success or failure per instrument

---

## Epic 4: KPI Builder

### US-030 — Create a Custom KPI
> **As** Prakruti,
> **I want to** define a custom KPI using a formula,
> **So that** I can compute meaningful signals for each stock.

**Acceptance Criteria:**
- Formula editor with autocomplete for all supported functions and price fields
- Supported functions include all standard technical indicators (full indicator library) plus the following pre-built defaults:
  - Daily RSI
  - P/E Ratio (sourced from NSE fundamental data)
  - EPS — Earnings Per Share (sourced from NSE fundamental data)
  - % Change from 52-Week High
  - % Change from 52-Week Low
  - Bollinger Band Position Signal: returns "Sell Signal" when price is above the upper band or within 5% of the upper band from above; returns "Buy Signal" when price is below the lower band or within 5% of the lower band from below; returns "Hold" otherwise
- A KPI can return a scalar number, a boolean (true/false), or a categorical label (e.g., "Buy Signal", "Sell Signal", "No Action")
- Formulas are validated before saving; invalid formulas display a descriptive error message

---

### US-031 — View KPIs on Holdings Table
> **As** Prakruti,
> **I want to** see my saved KPIs as extra columns in the holdings table,
> **So that** I can screen stocks at a glance.

**Acceptance Criteria:**
- Each saved KPI appears as a toggleable column in the holdings table
- KPI values reflect the live price if the market is open; otherwise they use D-1 data
- Boolean KPIs are shown as colour-coded badges (ON / OFF)
- Categorical KPIs are shown as labelled badges (e.g., green "Buy Signal", red "Sell Signal", grey "Hold")
- KPI columns can be shown or hidden per user preference

---

### US-032 — Save and Manage KPIs
> **As** Prakruti,
> **I want to** save, rename, and delete my KPIs,
> **So that** I can build a library of reusable indicators.

**Acceptance Criteria:**
- KPIs are listed in a management screen with name, formula, return type, and created date
- Edit and delete actions are available for each KPI
- Deleting a KPI removes it from all views

---

## Epic 5: Charts

### US-040 — View Candlestick Chart
> **As** Prakruti,
> **I want to** view an interactive candlestick chart for any instrument,
> **So that** I can visually analyse price action.

**Acceptance Criteria:**
- Chart renders OHLCV candles for the selected instrument and interval
- Crosshair displays OHLCV values on hover
- Chart supports zoom (scroll) and pan (drag)
- Volume histogram is rendered below the price chart

---

### US-041 — Overlay Indicators
> **As** Prakruti,
> **I want to** overlay technical indicators on the chart,
> **So that** I can see signals visually alongside price.

**Acceptance Criteria:**
- User can add any indicator from the full supported indicator library
- Each indicator is configurable (e.g., period for SMA, standard deviations for Bollinger Bands)
- Indicators are rendered as overlays on the price chart or as separate panels below it
- Multiple indicators can be active simultaneously

---

### US-042 — Draw on Chart
> **As** Prakruti,
> **I want to** draw trendlines, horizontal levels, and rectangles on the chart,
> **So that** I can annotate my analysis.

**Acceptance Criteria:**
- Available drawing tools: horizontal line, trend line, rectangle, text label
- Drawings are saved to the database per instrument and interval
- Drawings persist across page reloads and browser sessions
- Drawings can be selected and deleted

---

### US-043 — Switch Instruments from Chart
> **As** Prakruti,
> **I want to** switch to a different stock without leaving the chart view,
> **So that** my workflow is uninterrupted.

**Acceptance Criteria:**
- A search box within the chart view allows switching instruments
- The chart reloads data for the new instrument while retaining the same interval
- Previously applied indicators remain active after switching instruments

---

## Epic 6: Strategy Builder

### US-050 — Create a Strategy
> **As** Prakruti,
> **I want to** define a trading strategy with entry and exit rules,
> **So that** I can formalise my trading logic.

**Acceptance Criteria:**
- A strategy comprises: name, description, entry conditions (list of rules), exit conditions (list of rules), and a position sizing rule
- Rules reference indicators, price fields, and operators (>, <, crosses above, crosses below, etc.)
- Multiple conditions can be combined using AND / OR logic
- Each saved strategy is assigned a version number

---

### US-051 — List and Edit Strategies
> **As** Prakruti,
> **I want to** manage my saved strategies,
> **So that** I can iterate and improve them over time.

**Acceptance Criteria:**
- Strategy list displays: name, version, last modified date, and number of backtest runs
- Editing a strategy creates a new version while preserving the previous one
- Strategies can be duplicated or deleted

---

## Epic 7: Backtesting

### US-060 — Run a Backtest
> **As** Prakruti,
> **I want to** backtest a strategy on a specific stock over a date range,
> **So that** I can evaluate its historical performance.

**Acceptance Criteria:**
- User selects: strategy, instrument, date range, interval, and initial capital
- Backtest runs server-side using cached OHLCV data
- Results include: Total Return (%), CAGR, Max Drawdown, Win Rate, Sharpe Ratio, and number of trades
- The trade log shows each entry and exit with timestamps, prices, and P&L

---

### US-061 — View Equity Curve
> **As** Prakruti,
> **I want to** see the equity curve from a backtest,
> **So that** I can visualise drawdowns and performance over time.

**Acceptance Criteria:**
- A line chart of portfolio value over time is rendered from the trade log returned by the API
- Buy and sell markers are shown on the price chart
- The chart is interactive (zoom and pan)

---

### US-062 — Compare Backtest Results
> **As** Prakruti,
> **I want to** compare multiple backtest runs,
> **So that** I can identify which strategy version performs best.

**Acceptance Criteria:**
- Saved backtest results are listed per strategy
- A side-by-side comparison table shows key metrics across runs
- Equity curves from multiple runs can be overlaid on a single chart

---

## Epic 8: Trade Execution

### US-070 — Place an Order
> **As** Prakruti,
> **I want to** place a buy or sell order directly from the app,
> **So that** I do not need to switch to the Kite app for execution.

**Acceptance Criteria:**
- Order form includes: symbol, exchange, transaction type, product, order type, quantity, price (for LIMIT/SL orders), and trigger price (for SL/SL-M orders)
- A confirmation dialog displays the full order summary, including estimated charges, before submission
- Success displays the order ID; failure displays the Kite error message
- Every order attempt is logged in the audit table, regardless of outcome

---

### US-071 — View Today's Orders
> **As** Prakruti,
> **I want to** see all orders placed today with their status,
> **So that** I can monitor executions.

**Acceptance Criteria:**
- Table displays: Order ID, Symbol, Type, Product, Qty, Price, Status, and Time
- Auto-refreshes every 30 seconds during market hours

---

### US-072 — Modify or Cancel an Order
> **As** Prakruti,
> **I want to** modify or cancel a pending order,
> **So that** I can react to changing market conditions.

**Acceptance Criteria:**
- Modify: allows changing quantity, price, or trigger price for pending orders
- Cancel: available for any open or pending order
- Both actions require a confirmation step
- The result (success or error) is displayed clearly

---

### US-073 — Manage GTT Orders
> **As** Prakruti,
> **I want to** create, view, modify, and delete GTT orders,
> **So that** I can set long-term price triggers without monitoring the market continuously.

**Acceptance Criteria:**
- GTT list shows all active triggers with their current status
- Create supports both single-leg and two-leg GTT orders
- Modify and delete actions are available for each GTT
- All GTT actions are logged in the audit table

---

## Epic 9: Audit & Observability

### US-080 — Audit Log
> **As** Prakruti,
> **I want to** see a log of all orders and GTTs placed via this app,
> **So that** I have a permanent record of all actions taken.

**Acceptance Criteria:**
- Log displays: timestamp, action type, instrument, order details, outcome, and order ID
- Filterable by date range and instrument
- Read-only — entries cannot be modified or deleted from the UI
