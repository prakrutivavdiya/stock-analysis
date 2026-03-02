# Storage Strategy
## StockPilot — What Lives Where and Why

**Version:** 3.0
**Date:** 2026-02-25

---

## 1. The Core Question

For every piece of data we store, we ask:

| Test | Verdict |
|------|---------|
| Is it needed **server-side** (backtest engine, KPI compute, Kite API calls)? | → Backend DB |
| Is it **financially significant** or part of the audit trail? | → Backend DB |
| Would losing it cause real harm to the user's workflow? | → Backend DB |
| Is it **derived** and cheaply recomputable from backend data? | → Frontend cache |
| Is it **UI state** (zoom levels, preferences, visible columns)? | → Frontend localStorage |
| Is it a **temporary session cache** of data the backend already owns? | → Frontend IndexedDB |

---

## 2. Decision Table — Every Data Entity

| Data Entity | Decision | Where | Reason |
|-------------|----------|-------|--------|
| User session + encrypted Kite token | Backend | PostgreSQL `users` | Security — tokens must never touch the browser |
| JWT refresh tokens | Backend | PostgreSQL `refresh_tokens` | Server-side revocation required |
| Historical OHLCV candles | Backend | PostgreSQL `ohlcv_cache` | Kite rate limits (3 req/sec); millions of rows; needed server-side for backtests |
| KPI formula definitions | Backend | PostgreSQL `kpis` | User's authored work; must survive browser clears; needed server-side for computation |
| KPI computed values | **Frontend** | IndexedDB | Derived from OHLCV — cheap to recompute per session; no reason to persist server-side |
| Chart drawings (trendlines, levels) | Backend | PostgreSQL `chart_drawings` | User's analysis work; must persist across browser sessions and devices |
| Chart UI state (zoom, active indicators, panel sizes) | **Frontend** | localStorage | Pure UI preference; per-browser is correct; no cross-device need |
| User preferences (theme, default interval, column order) | **Frontend** | localStorage | Per-browser UI preference; no cross-device need; no server round-trip needed |
| Paper trade mode on/off | Backend | PostgreSQL `users.paper_trade_mode` | Must be enforced server-side — the backend must check this flag before forwarding any order to Kite |
| Holdings / Positions snapshot | **Frontend** | IndexedDB (short TTL ~60s) | Always fetched live from Kite; frontend caches to avoid repeated API calls during navigation |
| Today's orders | **Frontend** | IndexedDB (short TTL ~30s) | Live from Kite; session cache only |
| Margins | **Frontend** | IndexedDB (short TTL ~30s) | Live from Kite; session cache only |
| Audit log | Backend | PostgreSQL `audit_logs` | Financial record; must be append-only and server-controlled; immutable |

---

## 3. Backend Tables — 7 Tables

```
┌─────────────────────┐
│       users         │  ← Auth + encrypted Kite token (one row per user)
├─────────────────────┤
│   refresh_tokens    │  ← JWT session management (per user)
├─────────────────────┤
│    audit_logs       │  ← Immutable trade audit trail (per user)
├─────────────────────┤
│    ohlcv_cache      │  ← Historical market data — global, not user-scoped
├─────────────────────┤
│  fundamental_cache  │  ← P/E, EPS, 52W data — global, not user-scoped
├─────────────────────┤
│       kpis          │  ← KPI formula definitions (per user)
├─────────────────────┤
│   chart_drawings    │  ← Persisted chart annotations (per user)
└─────────────────────┘
```

---

## 4. Frontend Storage Map

### 4.1 IndexedDB (via Dexie.js — handles large structured data)

| Store | Data | TTL | Notes |
|-------|------|-----|-------|
| `holdings` | Live holdings from `/portfolio/holdings` | 60 seconds | Refreshed on tab focus or manual refresh |
| `positions` | Live positions from `/portfolio/positions` | 60 seconds | Refreshed every 60s during market hours |
| `orders_today` | Today's orders from `/orders` | 30 seconds | Refreshed every 30s during market hours |
| `margins` | Margin data from `/portfolio/margins` | 30 seconds | |
| `kpi_values` | Computed KPI results per instrument per day | End of trading day | Recomputed on next D-1 refresh |
| `ohlcv_session` | OHLCV candles fetched in this session | Browser session | Avoids repeat API calls while navigating charts |
| `indicator_values` | Computed indicator series for active chart | Browser session | Discarded when instrument/interval changes |

### 4.2 localStorage (tiny, synchronous — for simple preferences)

| Key | Data |
|-----|------|
| `pref_theme` | `dark` \| `light` |
| `pref_default_interval` | e.g., `15minute` |
| `pref_visible_kpi_columns` | Array of KPI IDs to show in portfolio table |
| `pref_visible_holdings_columns` | Array of standard column IDs shown in the portfolio table |
| `pref_holdings_sort` | `{ column, direction }` — last sort state |
| `chart_{token}_{interval}` | Zoom range, active indicators, panel layout per chart |

---

## 5. Data Flow Summary

```
Kite API
  │
  ├── Live (always fetched fresh, short-lived frontend cache)
  │     Holdings, Positions, Orders, Margins
  │     └──▶ Frontend IndexedDB (TTL: 30-60s)
  │
  ├── Historical OHLCV (cached server-side indefinitely)
  │     └──▶ Backend ohlcv_cache (PostgreSQL)
  │               │
  │               ├──▶ Chart API ──▶ Frontend IndexedDB (session)
  │               └──▶ KPI compute ──▶ Frontend IndexedDB (daily)
  │
  └── OAuth ──▶ users table (per user) ──▶ JWT ──▶ Frontend httpOnly cookie only

User-created content (no Kite involvement):
  KPIs ──▶ PostgreSQL kpis (per user)
  Chart drawings ──▶ PostgreSQL chart_drawings (per user)
  Trades placed ──▶ Kite API + PostgreSQL audit_logs (per user)
```

---

## 6. What Changed from v1 Docs

| Removed from Backend | Moved to | Reason |
|---------------------|----------|--------|
| `kpi_values` table | Frontend IndexedDB | Derived data; cheap to recompute; no cross-session value |
| `strategies` table | Out of scope | Strategy building removed from v1 scope |
| `backtest_runs` table | Out of scope | Backtesting removed from v1 scope |
| `backtest_trades` table | Out of scope | Backtesting removed from v1 scope |
