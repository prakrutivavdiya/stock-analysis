# Storage Strategy
## StockPilot — What Lives Where and Why

**Version:** 4.0
**Date:** 2026-03-02
**Changes from v3:** Replaced Dexie.js / IndexedDB with Zustand in-memory store as the frontend single source of truth.

---

## 1. The Core Question

For every piece of data we store, we ask:

| Test | Verdict |
|------|---------|
| Is it needed **server-side** (KPI compute, Kite API calls)? | → Backend DB |
| Is it **financially significant** or part of the audit trail? | → Backend DB |
| Would losing it cause real harm to the user's workflow? | → Backend DB |
| Is it **derived** and cheaply recomputable from backend data? | → Zustand store |
| Is it **UI state** (zoom levels, preferences, visible columns)? | → Frontend localStorage |
| Is it a **temporary session cache** of data the backend already owns? | → Zustand store |

---

## 2. Decision Table — Every Data Entity

| Data Entity | Decision | Where | Reason |
|-------------|----------|-------|--------|
| User session + encrypted Kite token | Backend | PostgreSQL `users` | Security — tokens must never touch the browser |
| JWT refresh tokens | Backend | PostgreSQL `refresh_tokens` | Server-side revocation required |
| Historical OHLCV candles | Backend | PostgreSQL `ohlcv_cache` | Kite rate limits (3 req/sec); millions of rows; needed server-side for KPI computation |
| KPI formula definitions | Backend | PostgreSQL `kpis` | User's authored work; must survive browser clears; needed server-side for computation |
| KPI computed values | **Frontend** | Zustand store | Derived from OHLCV — cheap to recompute per session; no reason to persist server-side |
| Chart drawings (trendlines, levels) | Backend | PostgreSQL `chart_drawings` | User's analysis work; must persist across browser sessions and devices |
| Chart UI state (zoom, active indicators, panel sizes) | **Frontend** | localStorage | Pure UI preference; per-browser is correct; no cross-device need |
| User preferences (theme, default interval, column order) | **Frontend** | localStorage | Per-browser UI preference; no cross-device need; no server round-trip needed |
| Paper trade mode on/off | Backend | PostgreSQL `users.paper_trade_mode` | Must be enforced server-side — the backend must check this flag before forwarding any order to Kite |
| Holdings / Positions snapshot | **Frontend** | Zustand store (short TTL ~60s) | Always fetched live from Kite; in-memory cache avoids repeated API calls during navigation |
| Today's orders | **Frontend** | Zustand store (short TTL ~30s) | Live from Kite; session cache only |
| Margins | **Frontend** | Zustand store (short TTL ~30s) | Live from Kite; session cache only |
| OHLCV session cache | **Frontend** | Zustand store (session) | Avoids repeat chart API calls within one session |
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

### 4.1 Zustand Store — `src/app/data/store.ts` (in-memory, session-scoped)

Single source of truth for all live and derived client-side data.
All slices reset on page refresh — data is always re-fetched from the API on reload.

| Slice | Data | TTL | Notes |
|-------|------|-----|-------|
| `holdings` | Live holdings from `/portfolio/holdings` | 60 seconds | Refreshed on tab focus or manual refresh |
| `positions` | Live positions from `/portfolio/positions` | 60 seconds | Refreshed every 60s during market hours |
| `ordersToday` | Today's orders from `/orders` | 30 seconds | Refreshed every 30s during market hours |
| `margins` | Margin data from `/portfolio/margins` | 30 seconds | |
| `kpiValues` | Computed KPI results per instrument per day | Session | Recomputed on next D-1 refresh |
| `ohlcvSession` | OHLCV candles fetched in this session | Session | Avoids repeat API calls while navigating charts |
| `indicatorValues` | Computed indicator series for active chart | Session | Cleared when instrument or interval changes |

TTL is enforced via `fetchedAt` timestamp + `isFresh()` helper — not browser storage expiry.

### 4.2 localStorage — `src/app/data/localPrefs.ts` (persisted across sessions)

Tiny, synchronous key-value storage for preferences that should survive page refreshes.

| Key | Data |
|-----|------|
| `pref_theme` | `dark` \| `light` |
| `pref_default_interval` | e.g., `D` (TradingView interval code) |
| `pref_default_chart_style` | e.g., `Candles` |
| `pref_visible_kpi_columns` | Array of KPI IDs to show in portfolio table |
| `pref_visible_holdings_columns` | Array of standard column IDs shown in the portfolio table |
| `pref_holdings_sort` | `{ column, direction }` — last sort state |
| `pref_holdings_refresh_interval` | `"30"` \| `"60"` \| `"90"` \| `"off"` |
| `pref_positions_refresh_interval` | `"30"` \| `"60"` \| `"90"` \| `"off"` |
| `pref_notify_order_success` | `"true"` \| `"false"` |
| `pref_notify_order_rejected` | `"true"` \| `"false"` |
| `pref_notify_gtt_trigger` | `"true"` \| `"false"` |
| `chart_{token}_{interval}` | Zoom range, active indicators, panel layout per chart |

---

## 5. Data Flow Summary

```
Kite API
  │
  ├── Live (always fetched fresh, short-lived in-memory cache)
  │     Holdings, Positions, Orders, Margins
  │     └──▶ Zustand store (TTL: 30-60s)
  │
  ├── Historical OHLCV (cached server-side indefinitely)
  │     └──▶ Backend ohlcv_cache (PostgreSQL)
  │               │
  │               ├──▶ Chart API ──▶ Zustand ohlcvSession (session)
  │               └──▶ KPI compute ──▶ Zustand kpiValues (session)
  │
  └── OAuth ──▶ users table (per user) ──▶ JWT ──▶ Frontend httpOnly cookie only

User-created content (no Kite involvement):
  KPIs ──▶ PostgreSQL kpis (per user)
  Chart drawings ──▶ PostgreSQL chart_drawings (per user)
  Trades placed ──▶ Kite API + PostgreSQL audit_logs (per user)
```

---

## 6. What Changed from v3

| Change | From | To | Reason |
|--------|------|----|--------|
| Live data cache | Dexie.js IndexedDB | Zustand store | Simpler single source of truth; no browser DB API; data is always re-fetched on reload anyway |
| KPI values cache | Dexie.js IndexedDB | Zustand store | Same data, lighter implementation |
| OHLCV session cache | Dexie.js IndexedDB | Zustand store | Session-only; no persistence benefit |
| `kpi_values` table | Frontend IndexedDB | Frontend Zustand | Derived data; cheap to recompute |
| `strategies` table | Out of scope | — | Strategy building removed from v1 scope |
| `backtest_runs` table | Out of scope | — | Backtesting removed from v1 scope |
