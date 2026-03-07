# Product Requirements Document (PRD)
## StockPilot — Trading & Analysis Platform

**Version:** 5.1
**Author:** Prakruti Vavdiya
**Date:** 2026-03-07
**Status:** Draft

---

## 1. Overview

StockPilot is a multi-user web application that serves as an intelligent trading cockpit built on top of the Zerodha Kite API. Any Zerodha account holder can sign in with their own Kite credentials to analyze their portfolio using historical data, visualize charts with custom indicators, compute custom KPIs, and execute trades — all from one secure interface. Each user's data (KPIs, chart drawings, audit log) is fully isolated.

---

## 2. Goals

| # | Goal |
|---|------|
| G1 | Provide a consolidated view of portfolio health using real Kite data |
| G2 | Enable deep historical analysis (D-1 and beyond) for all held instruments |
| G3 | Support custom KPI creation on top of market data |
| G4 | Render interactive, editable charts (annotations, drawings, indicators) |
| G5 | Execute buy/sell orders directly via Kite API |
| G6 | Ensure the platform is secure and each user's data is strictly isolated from other users |

---

## 3. User Persona

| Attribute | Detail |
|-----------|--------|
| Who | Any Zerodha Kite account holder |
| Trading style | Equity investor (CNC) with optional intraday activity |
| Broker | Zerodha (Kite) |
| Portfolio size | Any size; typically a few to a few dozen NSE/BSE holdings |
| Exchanges | NSE, BSE |
| Products used | CNC, NRML, MIS |

---

## 4. Scope

### 4.1 In Scope
- Multi-user authentication via Kite OAuth (each user logs in with their own Zerodha account)
- Local session management with JWT (RS256)
- Options / F&O trading
- Portfolio dashboard with real-time and historical data
- Historical OHLCV data fetching and local caching (SQLite/PostgreSQL)
- Day-1 (previous trading day) data view as the default historical view
- Custom KPI builder (formula-based, computed on historical data)
- Interactive candlestick / line charts (editable: annotations, drawings, indicators)
- Trade execution (market, limit, SL, SL-M orders via Kite API)
- Order management (view, modify, cancel orders)
- GTT (Good Till Triggered) order management
- Audit log of all trade actions taken via the platform
- User profile display and settings panel (theme, default interval, notifications, session management)

### 4.2 Out of Scope (v1)
- Options / F&O strategy builder
- Mobile native app
- Strategy builder and backtesting engine
- Automated / programmatic strategy execution
- Mutual fund transaction execution
- AI/ML-based predictions

---

## 5. Domain Context & Trading Rules

These are non-negotiable constraints from the market, Zerodha broker, and SEBI. They are not product decisions — they are external facts the product must operate within.

### 5.1 Market Hours & Trading Days

| Rule | Detail |
|------|--------|
| Equity market hours | 09:15–15:30 IST, Monday–Friday |
| Pre-open session | 09:00–09:15 IST — AMO orders only during this window |
| Trading holidays | No trading on NSE/BSE-declared holidays (national + exchange holidays) |
| D-1 logic | Monday's D-1 is Friday; the system must resolve the previous trading day correctly across weekends and holidays |
| MIS square-off | Intraday (MIS) positions are auto-squared off by Kite at 15:20 IST; the platform must warn users with open MIS positions after 15:00 IST |

### 5.2 Product Types

| Product | Full Name | Behaviour |
|---------|-----------|-----------|
| CNC | Cash and Carry | Delivery equity. No auto-square-off. Full margin required. T+1 settlement. |
| MIS | Margin Intraday Square-off | Intraday only. Auto-squared off at 15:20 IST by Kite if not manually closed. |
| NRML | Normal | F&O carry-forward. Requires SPAN + exposure margin. |

MIS square-off warnings apply only to MIS positions. CNC positions carry forward automatically.

### 5.3 Order Types

| Order Type | When Allowed | Behaviour |
|-----------|-------------|-----------|
| MARKET | During market hours (not pre-open) | Executes at best available price |
| LIMIT | Anytime (AMO outside hours) | Executes at specified price or better |
| SL (Stop-Loss Limit) | During market hours | Trigger price activates a LIMIT order; both trigger and limit price required |
| SL-M (Stop-Loss Market) | During market hours | Trigger price activates a MARKET order; only trigger price required |

After-Market Orders (AMO) may be placed outside market hours using `variety = amo` and are executed at the next market open.

### 5.4 Order Validity

| Validity | Meaning |
|----------|---------|
| DAY | Valid for the current trading day only (default) |
| IOC | Immediate or Cancel — executes immediately; unfilled portion cancelled |
| TTL | Time To Live — valid for a specified number of minutes |

### 5.5 GTT (Good Till Triggered) Orders

| Rule | Detail |
|------|--------|
| Not a regular order | GTTs are price-condition triggers that generate an order when a price level is hit |
| Single-leg | One trigger price (e.g., buy at ₹1,200 if INFY falls to ₹1,200) |
| Two-leg | Upper trigger (target) + lower trigger (stop-loss) — used for managing existing positions |
| Expiry | GTT orders expire after 1 year or upon trigger, whichever is earlier |
| Server-side | GTT triggers are monitored by Zerodha's servers — StockPilot does not need to be running for a GTT to fire |

### 5.6 Settlement & Holdings

| Rule | Detail |
|------|--------|
| T+1 settlement | Buy today; shares credited next trading day |
| T1 quantity | Shares bought today are not available for CNC sell until T+1 |

### 5.7 Brokerage & Charges Reference

Informational — used by the platform to display estimated charges before order confirmation.

| Charge | Rate |
|--------|------|
| Brokerage — CNC | ₹0 (Zerodha charges zero on CNC delivery) |
| Brokerage — MIS/NRML | 0.03% or ₹20 per order, whichever is lower |
| STT — Buy CNC | 0.1% of trade value |
| STT — Sell CNC | 0.1% of trade value |
| STT — MIS sell | 0.025% of sell-side value |
| Exchange charges | ~0.00345% NSE / ~0.00375% BSE |
| GST | 18% on brokerage + exchange charges |
| SEBI charges | ₹10 per crore |
| Stamp duty | 0.015% on buy-side |

All displayed charges are estimates. Actual charges are determined by Zerodha post-execution.

### 5.8 Historical Data Availability (Kite API)

| Interval | Availability |
|----------|-------------|
| Intraday (5m, 15m, 30m, 1hr) | Last 60 days only |
| Daily candles | Up to ~3 years |

> **Note — Kite historical data add-on:** The Kite Connect historical data API requires a separately purchased add-on subscription. If the add-on is not active, the backend falls back to Yahoo Finance (`yfinance`) to serve the same OHLCV data for NSE (`.NS`) and BSE (`.BO`) instruments. The fallback is transparent to the frontend — data is written to the same `ohlcv_cache` table and subsequent requests are served from cache.

### 5.9 KPI Data Sourcing Rule

KPI values use live price when the market is open. When the market is closed or live data is unavailable, D-1 closing data is used.

### 5.10 Fundamental Data

| Rule | Detail |
|------|--------|
| Source | NSE India public data endpoints |
| Refresh | Weekly — every Sunday at 08:00 IST |
| Dependency | Soft — all platform features function normally if fundamental data is unavailable |

---

## 6. Key Workflows

### 6.1 Morning Routine (Primary Use Case)
```
Market opens at 09:15 IST
    │
    ├─ 09:20 IST — Scheduled job fetches D-1 daily candle for all held instruments (all users)
    ├─ 09:25 IST — Scheduled job recomputes all active KPIs for all users' holdings
    │
User opens StockPilot
    │
    ├─ Dashboard loads: portfolio summary (live from Kite) + D-1 KPI values
    ├─ User scans KPI columns for signals (RSI, MACD, Bollinger Band Position, etc.)
    ├─ User clicks a stock → chart view opens with D-1 data + saved annotations
    ├─ User reviews chart, overlays additional indicators
    ├─ User decides to act → order form → estimated charges → confirmation modal
    └─ Order placed via Kite → audit log written → orders view refreshes
```

### 6.2 GTT Setup Flow (Passive Order Management)
```
User holds LT (bought at ₹3,433, current ₹4,298)
    │
    ├─ User wants: take profit at ₹4,700, stop loss at ₹4,000
    ├─ User creates two-leg GTT:
    │     Lower trigger: ₹4,000 → SELL limit ₹3,990
    │     Upper trigger: ₹4,700 → SELL limit ₹4,690
    ├─ GTT submitted to Kite → Kite monitors 24/7 regardless of StockPilot state
    └─ Audit log written
```

---

## 7. Features & Requirements

### 7.1 Authentication & Security
| ID | Requirement |
|----|-------------|
| AU-01 | User must authenticate via Zerodha Kite OAuth flow |
| AU-02 | On successful Kite login, a signed JWT (RS256, 8h expiry) is issued |
| AU-03 | All API endpoints require a valid JWT delivered as an `access_token` httpOnly cookie (preferred) or as an `Authorization: Bearer` header fallback |
| AU-04 | JWT refresh is supported; refresh tokens are stored server-side (hashed) |
| AU-05 | Session can be explicitly logged out (server-side token revocation) |
| AU-06 | All Kite API tokens are stored encrypted at rest (AES-256-GCM); tokens are user-scoped and never shared |
| AU-07 | HTTPS-only enforcement; HSTS header set |
| AU-08 | CORS restricted to a single allowed origin (frontend URL) |
| AU-09 | Rate limiting on auth and trading endpoints (per-user) |
| AU-10 | All trade actions are logged with timestamp in a per-user audit table |
| AU-11 | All data returned by the API is scoped to the authenticated user; no cross-user data leakage |

### 7.2 Portfolio Dashboard
| ID | Requirement |
|----|-------------|
| PD-01 | Display all holdings with quantity, avg price, LTP, P&L, day change, and user-defined KPI columns |
| PD-02 | Display current intraday positions |
| PD-03 | Display available margin (equity) |
| PD-04 | Show portfolio-level metrics: total invested, current value, overall P&L%, XIRR |
| PD-05 | Holdings table is sortable by any column; columns are individually addable or removable by the user |
| PD-06 | Colour-coded gain/loss indicators |
| PD-07 | Holdings data auto-refreshes at a configurable interval and on manual refresh |
| PD-08 | Holdings table displays `t1_quantity` (shares pending T+1 settlement) in a dedicated column, separate from sellable quantity, to prevent accidental over-selling |
| PD-09 | Column visibility selection and sort preference (column + direction) for the holdings table are persisted **per user** in the backend database (`users.ui_preferences` JSON column) so that preferences survive across devices and browser sessions. The frontend reads them via `GET /user/preferences` on mount (falling back to defaults if unavailable) and writes them via `PUT /user/preferences` on every change. The persisted fields are: `visible_holdings_columns` (list of column IDs) and `holdings_sort` (`{column, direction}`). All other user preferences (theme, chart interval, notification toggles) remain in browser `localStorage` per ST-08. |

### 7.3 Historical Data
| ID | Requirement |
|----|-------------|
| HD-01 | Fetch OHLCV data for any held instrument for any date range |
| HD-02 | Default view is D-1 (previous trading day's candles) |
| HD-03 | Supported intervals: 5m, 15m, 30m, 1hr, day |
| HD-04 | Fetched data is cached locally to avoid repeated API calls |
| HD-05 | Cache invalidation: intraday cache expires after market close; daily cache is permanent |
| HD-06 | Bulk fetch: fetch D-1 data for all holdings in one dashboard refresh |

### 7.4 KPI Builder
| ID | Requirement |
|----|-------------|
| KP-01 | User can define KPIs using a formula editor with autocomplete |
| KP-02 | Supported indicator library: full pandas-ta indicator set plus pre-built defaults: daily RSI, P/E Ratio, EPS, % change from 52-week high, % change from 52-week low, Bollinger Band Position Signal |
| KP-03 | KPIs are computed on-demand by the backend; P/E and EPS require the fundamental data cache (sourced from NSE India); all other indicators computed from OHLCV cache |
| KP-04 | KPI values reflect live price if market is open; otherwise D-1 data is used |
| KP-05 | KPI computed values are returned via API and cached by the frontend in the Zustand in-memory store (session-scoped; resets on page refresh; not stored in the backend DB) |
| KP-06 | KPI definitions (formulas) are saved in the backend database |
| KP-07 | KPI return types: SCALAR (numeric), BOOLEAN (true/false badge), CATEGORICAL (descriptive label). BOOLEAN formulas may combine multiple conditions using `AND` / `OR` (e.g. `RSI(14) > 70 AND CLOSE > SMA(20)`). CATEGORICAL formulas are user-defined IF chains (`IF(expr op expr, "label", IF(..., "default"))`); each IF condition may also use AND / OR (e.g. `IF(CLOSE >= BB_UPPER(20) AND RSI(14) > 70, "Strong Sell", "Hold")`). The legacy shorthand `BB_POSITION(period)` is also accepted for CATEGORICAL and is equivalent to a two-condition template. |
| KP-08 | KPIs are displayed as toggleable, user-ordered columns in the portfolio table |
| KP-09 | KPI formulas are validated on save against the indicator whitelist. SCALAR formulas must not contain comparison operators or AND/OR. BOOLEAN formulas require at least one comparison operator; multiple conditions may be chained with `AND` / `OR` (AND binds before OR). CATEGORICAL formulas must be either `BB_POSITION(period)` (legacy) or a nested `IF(condition, "label", ...)` chain; each condition may be a compound AND/OR expression of atomic `expr op expr` comparisons; the final else clause must be a double-quoted string literal. Arbitrary expressions or unknown identifiers are rejected with a descriptive error. |
| KP-10 | Boolean KPIs support compound conditions using `AND` / `OR`, e.g. `RSI(14) > 70 AND CLOSE > SMA(20)`. Single-condition formulas (e.g. `RSI(14) > 70`) remain valid. AND binds before OR (standard precedence). |
| KP-11 | The default CATEGORICAL template for a new Bollinger Band signal KPI pre-fills two conditions: `CLOSE >= BB_UPPER(20)` → "Sell Signal" and `CLOSE <= BB_LOWER(20)` → "Buy Signal", with "Hold" as the default. Users can edit the thresholds, labels, operator, and add or remove conditions directly in the KPI Builder condition editor. The conditions are stored as a nested IF chain string in the database. The legacy `BB_POSITION(period)` shorthand (which applies a ±5% band-height tolerance) continues to evaluate correctly for KPIs created before the IF chain editor was introduced. |
| KP-12 | When P/E or EPS data is unavailable from the fundamental cache, the corresponding KPI column displays "N/A" rather than an error |

### 7.5 Charts
| ID | Requirement |
|----|-------------|
| CH-01 | Render candlestick, bar, line, and area charts for any instrument and interval |
| CH-02 | 30 standard technical indicators available via an Indicators dropdown; organised into four categories — Trend, Momentum, Volatility, Volume; computed by the backend (pandas-ta) and rendered via Lightweight Charts; overlays are drawn on the price pane, oscillators open in synced sub-panes below; indicators include: MA, EMA, DEMA, TEMA, Hull MA, VWMA, VWAP, Supertrend, Parabolic SAR, ADX/DMI, Aroon, RSI, Stochastic, Stoch RSI, MACD, CCI, ROC, Williams %R, Momentum, Bollinger Bands, Keltner Channel, Donchian Channel, ATR, BB Bandwidth, BB %B, Std Deviation, OBV, MFI, CMF |
| CH-03 | Basic drawing toolkit: horizontal lines, trendlines, rectangles, and text annotations — persisted per instrument per interval to the backend database; full Fibonacci / pitchfork / channel tools are deferred to a future version |
| CH-04 | Drawings are persisted per instrument per interval to the backend database via `/charts/{token}/drawings`; loaded on chart open and saved on creation/edit/delete |
| CH-05 | Chart supports zoom, pan, crosshair, OHLCV legend, and sub-pane indicators (RSI, MACD, etc.) — provided by Lightweight Charts |
| CH-06 | The chart page has a left sidebar listing the user's held instruments with a live search/filter box; clicking an instrument loads its chart; switching instruments does not require leaving the page |
| CH-07 | Drawings (horizontal lines, trendlines, rectangles, text annotations) are persisted to the backend database and reloaded on each chart open; indicator selections are session-only (not persisted); zoom and pan state is managed natively by Lightweight Charts but is not saved across sessions |
| CH-08 | Right-click context menu extended with "Buy at price" / "Sell at price" actions that pre-fill the order form |

### 7.6 Settings & User Profile
| ID | Requirement |
|----|-------------|
| ST-01 | A Settings page (`/settings`) is accessible from the sidebar gear icon and from the topbar user dropdown |
| ST-02 | The User Profile section displays: full name, Kite user ID, email, exchange memberships, and product types — all sourced from the Kite profile API on first login and stored in the `users` table |
| ST-03 | The User Profile section displays the Kite session status (Active / Expired) and the token expiry time |
| ST-04 | A "Re-authenticate with Kite" button is available in the profile section to trigger a new Kite OAuth flow and refresh the daily Kite access token |
| ST-05 | The topbar shows a persistent user chip (`Kite user ID ▾`) that opens a dropdown with: name, Kite ID, email, Kite session status, link to Settings, and Logout |
| ST-06 | When the Kite session has expired, a dismissible warning banner is displayed below the topbar on all pages, with a re-authentication link |
| ST-07 | The Preferences section allows the user to set: UI theme (Dark / Light), default chart interval, holdings refresh interval, positions refresh interval, and notification toast preferences |
| ST-08 | All preferences are stored in browser `localStorage` — they are per-browser and require no backend changes |
| ST-09 | The Session section displays StockPilot JWT status (time remaining), refresh token validity, and a "Revoke all sessions" option that server-side revokes all refresh tokens for the user |

### 7.7 Trade Execution
| ID | Requirement |
|----|-------------|
| TR-01 | Place orders: MARKET, LIMIT, SL, SL-M |
| TR-02 | Supported products: CNC, MIS, NRML |
| TR-03 | Order confirmation dialog with full order details before submission |
| TR-04 | View today's orders with status |
| TR-05 | Modify pending orders |
| TR-06 | Cancel pending orders |
| TR-07 | Place and manage GTT orders |
| TR-08 | All placed orders are recorded in audit log |
| TR-09 | Default product type in the order form is CNC |
| TR-10 | Default order validity is DAY |
| TR-11 | For SL orders: BUY SL requires `trigger_price < limit_price`; SELL SL requires `trigger_price > limit_price`; the order form validates this before allowing submission |
| TR-12 | MARKET orders display a slippage warning ("Market orders execute at best available price and may result in slippage") that must be acknowledged before reaching the confirmation step |
| TR-13 | When placing an order outside market hours, the system defaults to AMO variety |
| TR-14 | The order confirmation dialog includes an estimated charges breakdown (brokerage, STT, exchange charges, GST, SEBI charges, stamp duty) |
| TR-15 | The system warns the user if a single order's notional value exceeds 20% of available margin |
| TR-16 | The system warns the user if a sell order quantity exceeds the authorised (sellable) quantity for the holding |
| TR-17 | Paper trade mode: when enabled by the user, orders are simulated locally (logged to audit trail as `PAPER_TRADE`) and never sent to Kite |

---

## 8. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| Performance | Dashboard load < 3s; chart render < 1s for up to 5000 candles |
| Security | HTTPS, JWT RS256, encrypted token storage, rate limiting, CSRF protection |
| Reliability | Kite API errors surfaced clearly; graceful degradation if Kite is down |
| Observability | Structured JSON logs; request ID tracing |
| Portability | Docker-compose for local self-hosting on macOS |
| Data Retention | Historical data cache retained indefinitely; audit logs retained 5 years |

---

## 9. Tech Stack (Proposed)

| Layer | Technology |
|-------|-----------|
| Backend API | Python 3.12, FastAPI |
| Database | PostgreSQL (production) / SQLite (dev) — 7 tables |
| ORM | SQLAlchemy 2.0 async + Alembic (migrations) |
| Kite Client | `kiteconnect` Python SDK |
| Auth | Kite OAuth + JWT (python-jose, RS256) |
| Encryption | `cryptography` library (AES-256-GCM for Kite token at rest) |
| Scheduled Jobs | APScheduler (D-1 data fetch, KPI recompute at market open) |
| TA Library | `pandas-ta` (no C dependencies, runs on Python DataFrames) |
| Frontend | React + TypeScript |
| Frontend State | Zustand (single source of truth for all live + session data) |
| Charting | TradingView Lightweight Charts v5 (Apache 2.0, open source) — candlestick / bar / line / area price series; overlays and sub-pane indicator series rendered from backend-computed data |
| Indicator compute | `pandas-ta` (backend) — 30 indicators across Trend / Momentum / Volatility / Volume categories; results served via `GET /charts/indicators/compute` |
| Historical data fallback | `yfinance` — used automatically when Kite historical data add-on is not active; transparent to the frontend |
| Containerization | Docker + Docker Compose |

### Storage split summary
- **Backend PostgreSQL:** Auth state (per user), OHLCV cache (global market data), KPI definitions (per user), chart drawings (per user), fundamental cache (global), audit log (per user)
- **Frontend Zustand store:** Live portfolio data (TTL), KPI computed values (session), OHLCV session cache, indicator series — all in-memory; resets on page refresh
- **Frontend localStorage:** User preferences (theme, intervals, column order), chart UI state per instrument

---

## 10. Milestones

| Phase | Scope | Deliverable |
|-------|-------|-------------|
| Phase 1 | Auth + Portfolio Dashboard + Historical Data | Working backend APIs |
| Phase 2 | KPI Builder + Charts | Chart APIs + indicator computation |
| Phase 3 | Trade Execution | Live trading APIs |
| Phase 4 | Frontend | Full web UI |

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Kite API rate limits (3 req/sec historical) | Local caching; request queue with throttling |
| Kite session expiry (daily) | Detect 403, prompt re-login via OAuth |
| Incorrect trade execution | Order confirmation dialog; audit log; paper-trade mode flag |
| Data loss | DB backups; WAL mode for SQLite |
| NSE fundamental data unavailable or stale | Graceful fallback — show "N/A" for P/E and EPS columns; retry on next scheduled refresh |
| NSE India API changes (unofficial endpoints) | Monitor and update scraper; fundamental data is a soft dependency — app functions without it |
| Kite historical data add-on not subscribed | Backend automatically falls back to Yahoo Finance (`yfinance`) for OHLCV data; yfinance data is cached identically so future requests are fast; no user action required |
