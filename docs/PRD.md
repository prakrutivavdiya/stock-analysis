# Product Requirements Document (PRD)
## StockPilot — Personal Trading & Analysis Platform

**Version:** 2.0
**Author:** Prakruti Vavdiya
**Date:** 2026-02-27
**Status:** Draft

---

## 1. Overview

StockPilot is a personal, single-user web application that serves as an intelligent trading cockpit built on top of the Zerodha Kite API. It enables Prakruti to analyze her portfolio using historical data, build and backtest strategies, visualize charts, compute custom KPIs, and execute trades — all from one secure, self-hosted interface.

---

## 2. Goals

| # | Goal |
|---|------|
| G1 | Provide a consolidated view of portfolio health using real Kite data |
| G2 | Enable deep historical analysis (D-1 and beyond) for all held instruments |
| G3 | Support custom KPI creation on top of market data |
| G4 | Allow building, saving, and backtesting custom trading strategies |
| G5 | Render interactive, editable charts (annotations, drawings, indicators) |
| G6 | Execute buy/sell orders directly via Kite API |
| G7 | Ensure the platform is private, secure, and accessible only to one user |

---

## 3. User Persona

| Attribute | Detail |
|-----------|--------|
| Name | Prakruti Vavdiya |
| Role | Sole user and owner of the platform |
| Trading style | Long-term equity investor (CNC) with some intraday activity |
| Broker | Zerodha (Kite) |
| Portfolio size | ~18 holdings across NSE/BSE |
| Exchanges | NSE, BSE, MF |
| Products used | CNC, NRML, MIS, BO, CO |

---

## 4. Scope

### 4.1 In Scope
- Single-user authentication via Kite OAuth (Zerodha login)
- Local session management with JWT (RS256)
- Portfolio dashboard with real-time and historical data
- Historical OHLCV data fetching and local caching (SQLite/PostgreSQL)
- Day-1 (previous trading day) data view as the default historical view
- Custom KPI builder (formula-based, computed on historical data)
- Interactive candlestick / line charts (editable: annotations, drawings, indicators)
- Strategy builder (rule-based: entry/exit conditions using indicators)
- Backtesting engine (event-driven simulation on historical OHLCV data)
- Trade execution (market, limit, SL, SL-M orders via Kite API)
- Order management (view, modify, cancel orders)
- GTT (Good Till Triggered) order management
- Audit log of all trade actions taken via the platform

### 4.2 Out of Scope (v1)
- Multi-user support
- Options / F&O strategy builder
- Mobile native app
- Automated / programmatic strategy execution (live strategy runs)
- Running multiple strategies on the same instrument simultaneously
- Mutual fund transaction execution
- AI/ML-based predictions

---

## 5. Features & Requirements

### 5.1 Authentication & Security
| ID | Requirement |
|----|-------------|
| AU-01 | User must authenticate via Zerodha Kite OAuth flow |
| AU-02 | On successful Kite login, a signed JWT (RS256, 8h expiry) is issued |
| AU-03 | All API endpoints require a valid JWT in the Authorization header |
| AU-04 | JWT refresh is supported; refresh tokens are stored server-side (hashed) |
| AU-05 | Session can be explicitly logged out (server-side token revocation) |
| AU-06 | All Kite API tokens are stored encrypted at rest (AES-256-GCM) |
| AU-07 | HTTPS-only enforcement; HSTS header set |
| AU-08 | CORS restricted to a single allowed origin (frontend URL) |
| AU-09 | Rate limiting on auth and trading endpoints |
| AU-10 | All trade actions are logged with timestamp in an audit table |

### 5.2 Portfolio Dashboard
| ID | Requirement |
|----|-------------|
| PD-01 | Display all holdings with quantity, avg price, LTP, P&L, day change, and user-defined KPI columns |
| PD-02 | Display current intraday positions |
| PD-03 | Display available margin (equity) |
| PD-04 | Show portfolio-level metrics: total invested, current value, overall P&L%, XIRR |
| PD-05 | Holdings table is sortable by any column; columns are individually addable or removable by the user |
| PD-06 | Colour-coded gain/loss indicators |
| PD-07 | Holdings data auto-refreshes at a configurable interval and on manual refresh |

### 5.3 Historical Data
| ID | Requirement |
|----|-------------|
| HD-01 | Fetch OHLCV data for any held instrument for any date range |
| HD-02 | Default view is D-1 (previous trading day's candles) |
| HD-03 | Supported intervals: 5m, 15m, 30m, 1hr, day |
| HD-04 | Fetched data is cached locally to avoid repeated API calls |
| HD-05 | Cache invalidation: intraday cache expires after market close; daily cache is permanent |
| HD-06 | Bulk fetch: fetch D-1 data for all holdings in one dashboard refresh |

### 5.4 KPI Builder
| ID | Requirement |
|----|-------------|
| KP-01 | User can define KPIs using a formula editor with autocomplete |
| KP-02 | Supported indicator library: full pandas-ta indicator set plus pre-built defaults: daily RSI, P/E Ratio, EPS, % change from 52-week high, % change from 52-week low, Bollinger Band Position Signal |
| KP-03 | KPIs are computed on-demand by the backend; P/E and EPS require the fundamental data cache (sourced from NSE India); all other indicators computed from OHLCV cache |
| KP-04 | KPI values reflect live price if market is open; otherwise D-1 data is used |
| KP-05 | KPI computed values are returned via API and cached by the frontend in IndexedDB (not stored in the backend DB) |
| KP-06 | KPI definitions (formulas) are saved in the backend database |
| KP-07 | KPI return types: SCALAR (numeric), BOOLEAN (true/false badge), CATEGORICAL (descriptive label e.g. "Buy Signal", "Sell Signal", "Hold") |
| KP-08 | KPIs are displayed as toggleable, user-ordered columns in the portfolio table |

### 5.5 Charts
| ID | Requirement |
|----|-------------|
| CH-01 | Render candlestick and line charts for any instrument and interval |
| CH-02 | Overlay any indicator from the full supported indicator library on the chart; each indicator is individually configurable (period, parameters) |
| CH-03 | User can draw on charts: trendlines, horizontal levels, rectangles, text annotations |
| CH-04 | Drawings are persisted per instrument per timeframe in the database |
| CH-05 | Chart supports zoom, pan, crosshair, OHLCV tooltip |
| CH-06 | User can switch between instruments from within the chart view |
| CH-07 | Chart state (zoom level, visible indicators) is preserved in browser local storage |

### 5.6 Strategy Builder
| ID | Requirement |
|----|-------------|
| SB-01 | User can create rule-based strategies with entry and exit conditions |
| SB-02 | Conditions reference built-in indicators and price fields |
| SB-03 | Supported operators: >, <, >=, <=, ==, crosses above, crosses below |
| SB-04 | Strategies are saved with a name, description, and version |
| SB-05 | Strategy can be applied to any instrument or a watchlist |
| SB-06 | Strategy supports position sizing: fixed quantity or % of available capital |

### 5.7 Backtesting
| ID | Requirement |
|----|-------------|
| BT-01 | Backtest a strategy on any instrument over a user-defined date range |
| BT-02 | Backtesting uses locally cached OHLCV data (fetches if not cached) |
| BT-03 | Outputs: trade log, total return, max drawdown, win rate, Sharpe ratio, CAGR |
| BT-04 | Backtest summary metrics and trade log are saved in the backend database |
| BT-05 | Equity curve is computed client-side from the trade log returned by the API (not stored in DB) |
| BT-06 | Each simulated trade is shown on the chart as entry/exit markers |
| BT-07 | Backtest results can be compared across strategy versions using saved summaries |

### 5.8 Trade Execution
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

---

## 6. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| Performance | Dashboard load < 3s; chart render < 1s for up to 5000 candles |
| Security | HTTPS, JWT RS256, encrypted token storage, rate limiting, CSRF protection |
| Reliability | Kite API errors surfaced clearly; graceful degradation if Kite is down |
| Observability | Structured JSON logs; request ID tracing |
| Portability | Docker-compose for local self-hosting on macOS |
| Data Retention | Historical data cache retained indefinitely; audit logs retained 5 years |

---

## 7. Tech Stack (Proposed)

| Layer | Technology |
|-------|-----------|
| Backend API | Python 3.12, FastAPI |
| Database | PostgreSQL (production) / SQLite (dev) — 9 tables |
| ORM | SQLAlchemy 2.0 async + Alembic (migrations) |
| Kite Client | `kiteconnect` Python SDK |
| Auth | Kite OAuth + JWT (python-jose, RS256) |
| Encryption | `cryptography` library (AES-256-GCM for Kite token at rest) |
| Scheduled Jobs | APScheduler (D-1 data fetch, KPI recompute at market open) |
| TA Library | `pandas-ta` (no C dependencies, runs on Python DataFrames) |
| Backtesting | Custom event-driven engine (server-side) |
| Frontend | React + TypeScript |
| Frontend State | Zustand + React Query |
| Frontend DB | Dexie.js (IndexedDB) — for live data caching + session data |
| Charting | TradingView Lightweight Charts |
| Containerization | Docker + Docker Compose |

### Storage split summary
- **Backend PostgreSQL:** Auth state, OHLCV cache, KPI definitions, strategies, backtest results, chart drawings, audit log
- **Frontend IndexedDB:** Live portfolio data (TTL), KPI computed values (daily), OHLCV session cache, indicator series
- **Frontend localStorage:** User preferences, chart UI state per instrument

---

## 8. Milestones

| Phase | Scope | Deliverable |
|-------|-------|-------------|
| Phase 1 | Auth + Portfolio Dashboard + Historical Data | Working backend APIs |
| Phase 2 | KPI Builder + Charts | Chart APIs + indicator computation |
| Phase 3 | Strategy Builder + Backtesting | Backtest engine |
| Phase 4 | Trade Execution | Live trading APIs |
| Phase 5 | Frontend | Full web UI |

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Kite API rate limits (3 req/sec historical) | Local caching; request queue with throttling |
| Kite session expiry (daily) | Detect 403, prompt re-login via OAuth |
| Incorrect trade execution | Order confirmation dialog; audit log; paper-trade mode flag |
| Data loss | DB backups; WAL mode for SQLite |
| NSE fundamental data unavailable or stale | Graceful fallback — show "N/A" for P/E and EPS columns; retry on next scheduled refresh |
| NSE India API changes (unofficial endpoints) | Monitor and update scraper; fundamental data is a soft dependency — app functions without it |
