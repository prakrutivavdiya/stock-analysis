# User Stories
## StockPilot — Trading & Analysis Platform

**Version:** 5.0
**Date:** 2026-02-28

---

## Epic 1: Authentication & Session Management

### US-001 — Kite OAuth Login
> **As** a user,
> **I want to** log in using my Zerodha Kite credentials via OAuth,
> **So that** my Zerodha password is never stored in this application and my session remains secure.

**Acceptance Criteria:**
- Clicking "Login with Kite" redirects me to Zerodha's OAuth page
- After a successful Zerodha login, I am redirected back to StockPilot and a session is created
- A signed JWT (RS256) is issued and stored in an httpOnly cookie
- A failed or cancelled login displays a clear error message

---

### US-002 — Session Persistence
> **As** a user,
> **I want my** login session to persist for 8 hours,
> **So that** I do not need to log in again during a trading day.

**Acceptance Criteria:**
- The JWT expires after 8 hours
- A refresh token (30-day expiry) silently renews the JWT in the background
- If the refresh token has expired, I am redirected to the login page

---

### US-003 — Logout
> **As** a user,
> **I want to** explicitly log out,
> **So that** my session is fully terminated on the server.

**Acceptance Criteria:**
- Clicking "Logout" revokes the server-side session record
- The httpOnly cookie is cleared
- Subsequent API calls with the old token return 401

---

## Epic 2: Portfolio Dashboard

### US-010 — Holdings Overview
> **As** a user,
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
> **As** a user,
> **I want to** see top-level portfolio metrics,
> **So that** I know my overall financial position at a glance.

**Acceptance Criteria:**
- Displayed metrics: Total Invested, Current Market Value, Overall P&L (₹ and %), Available Margin
- XIRR is computed and displayed when purchase date data is available
- Metrics update whenever holdings data refreshes

---

### US-012 — Intraday Positions View
> **As** a user,
> **I want to** see my current intraday positions (if any),
> **So that** I can monitor open MIS/NRML trades.

**Acceptance Criteria:**
- Displays: Symbol, Product, Qty, Avg Price, LTP, Unrealised P&L, M2M P&L
- Clearly separated from long-term holdings
- Auto-refreshes every 60 seconds while the market is open

---

## Epic 3: Historical Data

### US-020 — View D-1 Data
> **As** a user,
> **I want to** see the previous trading day's OHLCV data for any of my holdings,
> **So that** I can review what happened yesterday.

**Acceptance Criteria:**
- The default date on the historical view is the most recent completed trading day (D-1)
- Candle data is shown at the selected interval (default: 15m)
- Data is fetched from Kite and cached locally for future loads

---

### US-021 — Select Custom Date Range & Interval
> **As** a user,
> **I want to** query historical data for any date range and candle interval,
> **So that** I can perform deep analysis over weeks or months.

**Acceptance Criteria:**
- Date picker allows any range within the past 3 years for daily candles, and within the past 60 days for intraday candles
- Supported intervals: 5m, 15m, 30m, 1hr, day
- API returns an OHLCV array for the requested range
- Cached data is served if already fetched; only missing ranges are fetched from Kite

---

### US-022 — Bulk D-1 Refresh
> **As** a user,
> **I want** the app to automatically fetch D-1 data for all my holdings at market open,
> **So that** my dashboard is always pre-populated with fresh data.

**Acceptance Criteria:**
- A scheduled job runs at 09:20 IST on trading days
- Fetches the D-1 daily candle for all held instruments
- Logs success or failure per instrument

---

## Epic 4: KPI Builder

### US-030 — Create a Custom KPI
> **As** a user,
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
> **As** a user,
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
> **As** a user,
> **I want to** save, rename, and delete my KPIs,
> **So that** I can build a library of reusable indicators.

**Acceptance Criteria:**
- KPIs are listed in a management screen with name, formula, return type, and created date
- Edit and delete actions are available for each KPI
- Deleting a KPI removes it from all views

---

## Epic 5: Charts

### US-040 — View Candlestick Chart
> **As** a user,
> **I want to** view an interactive candlestick chart for any instrument,
> **So that** I can visually analyse price action.

**Acceptance Criteria:**
- Chart renders OHLCV candles for the selected instrument and interval
- Crosshair displays OHLCV values on hover
- Chart supports zoom (scroll) and pan (drag)
- Volume histogram is rendered below the price chart

---

### US-041 — Overlay Indicators
> **As** a user,
> **I want to** overlay technical indicators on the chart,
> **So that** I can see signals visually alongside price.

**Acceptance Criteria:**
- User can add any indicator from the full supported indicator library
- Each indicator is configurable (e.g., period for SMA, standard deviations for Bollinger Bands)
- Indicators are rendered as overlays on the price chart or as separate panels below it
- Multiple indicators can be active simultaneously

---

### US-042 — Draw on Chart
> **As** a user,
> **I want to** draw trendlines, horizontal levels, and rectangles on the chart,
> **So that** I can annotate my analysis.

**Acceptance Criteria:**
- Available drawing tools: horizontal line, trend line, rectangle, text label
- Drawings are saved to the database per instrument and interval
- Drawings persist across page reloads and browser sessions
- Drawings can be selected and deleted

---

### US-043 — Switch Instruments from Chart
> **As** a user,
> **I want to** switch to a different stock without leaving the chart view,
> **So that** my workflow is uninterrupted.

**Acceptance Criteria:**
- A search box within the chart view allows switching instruments
- The chart reloads data for the new instrument while retaining the same interval
- Previously applied indicators remain active after switching instruments

---

## Epic 6: Trade Execution

### US-070 — Place an Order
> **As** a user,
> **I want to** place a buy or sell order directly from the app,
> **So that** I do not need to switch to the Kite app for execution.

**Acceptance Criteria:**
- Order form includes: symbol, exchange, transaction type, product, order type, quantity, price (for LIMIT/SL orders), and trigger price (for SL/SL-M orders)
- A confirmation dialog displays the full order summary, including estimated charges, before submission
- Success displays the order ID; failure displays the Kite error message
- Every order attempt is logged in the audit table, regardless of outcome

---

### US-071 — View Today's Orders
> **As** a user,
> **I want to** see all orders placed today with their status,
> **So that** I can monitor executions.

**Acceptance Criteria:**
- Table displays: Order ID, Symbol, Type, Product, Qty, Price, Status, and Time
- Auto-refreshes every 30 seconds during market hours

---

### US-072 — Modify or Cancel an Order
> **As** a user,
> **I want to** modify or cancel a pending order,
> **So that** I can react to changing market conditions.

**Acceptance Criteria:**
- Modify: allows changing quantity, price, or trigger price for pending orders
- Cancel: available for any open or pending order
- Both actions require a confirmation step
- The result (success or error) is displayed clearly

---

### US-073 — Manage GTT Orders
> **As** a user,
> **I want to** create, view, modify, and delete GTT orders,
> **So that** I can set long-term price triggers without monitoring the market continuously.

**Acceptance Criteria:**
- GTT list shows all active triggers with their current status
- Create supports both single-leg and two-leg GTT orders
- Modify and delete actions are available for each GTT
- All GTT actions are logged in the audit table

---

## Epic 7: Audit & Observability

### US-080 — Audit Log
> **As** a user,
> **I want to** see a log of all orders and GTTs placed via this app,
> **So that** I have a permanent record of all actions taken.

**Acceptance Criteria:**
- Log displays: timestamp, action type, instrument, order details, outcome, and order ID
- Filterable by date range and instrument
- Read-only — entries cannot be modified or deleted from the UI

---

## Epic 8: Settings & User Profile

### US-090 — View My Profile
> **As** a user,
> **I want to** see my Kite account profile details inside StockPilot,
> **So that** I can confirm which account is connected and understand its capabilities.

**Acceptance Criteria:**
- Settings > Profile section displays: full name, Kite user ID, email address, exchange memberships (NSE / BSE), and product types (CNC / NRML / MIS)
- Data is sourced from the Kite profile API (stored at first login; no re-fetch needed unless stale)
- Profile is read-only — fields cannot be edited within StockPilot

---

### US-091 — View and Re-authenticate Kite Session
> **As** a user,
> **I want to** see the current status of my Kite session and re-authenticate when it expires,
> **So that** my live data access is never silently broken.

**Acceptance Criteria:**
- Settings > Profile section shows Kite session status: "Active" (green) or "Expired" (red) with expiry time
- A "Re-authenticate with Kite" button is always visible in the profile section
- Clicking re-authenticate initiates the Kite OAuth flow and refreshes the daily access token without requiring a full logout
- When the session is expired, a warning banner appears on every page below the topbar

---

### US-092 — User Dropdown in Topbar
> **As** a user,
> **I want to** see my name and Kite session status in the topbar at all times,
> **So that** I always know who is logged in and whether my session is healthy.

**Acceptance Criteria:**
- Topbar shows a chip with the Kite user ID and a dropdown arrow
- Clicking the chip opens a dropdown with: full name, Kite user ID, email, Kite session status, a link to Settings, and a Logout button
- Session status in the dropdown updates in real time (green Active / red Expired)

---

### US-093 — Set UI Preferences
> **As** a user,
> **I want to** customise the app's appearance and default behaviour,
> **So that** I do not have to make the same choices on every visit.

**Acceptance Criteria:**
- Settings > Preferences offers: theme (Dark / Light), default chart interval (5m / 15m / 30m / 1H / Day), default chart type (Candlestick / Bar / Line / Area), holdings refresh interval (30s / 60s / 90s / Off), positions refresh interval
- A "Save Preferences" button commits all changes; a "Reset to Defaults" button reverts everything
- Preferences persist in `localStorage` and apply immediately without a page reload
- Preferences are per-browser (not synced across devices)

---

### US-094 — Notification Preferences
> **As** a user,
> **I want to** control which toast notifications are shown,
> **So that** I get alerts I care about and suppress ones I don't.

**Acceptance Criteria:**
- Toggle for: successful order toast, rejected/error order toast, Kite session expiry warning (shown 30 minutes before expiry)
- Changes take effect immediately
- Kite session expiry warning cannot be permanently suppressed (it resets to enabled on each login for safety)

---

### US-095 — Session Management & Revoke All
> **As** a user,
> **I want to** see my active sessions and be able to revoke all of them,
> **So that** I can secure my account if I suspect unauthorised access.

**Acceptance Criteria:**
- Settings > Session section shows JWT time remaining, refresh token validity, and last activity timestamp
- "Logout this device" button logs out the current session only
- "Revoke All Sessions" button invalidates all refresh tokens for the account (server-side), logs out all devices, and redirects to the login page
- A confirmation dialog is shown before revoke all is executed
