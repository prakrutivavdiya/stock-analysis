# Data Model Document
## StockPilot — Trading & Analysis Platform

**Version:** 7.0
**Date:** 2026-02-28
**Changes from v5:** Removed `strategies`, `backtest_runs`, and `backtest_trades` tables (strategy building and backtesting out of scope). Down to 7 tables.

---

## Overview

```
Backend PostgreSQL: 7 tables
Frontend IndexedDB:  7 stores   (derived + live data)
Frontend localStorage: simple key-value preferences
```

See [STORAGE_STRATEGY.md](STORAGE_STRATEGY.md) for the decision rationale.

---

## Backend Tables

---

### 1. `users`

One row per registered user. Each user authenticates with their own Zerodha Kite account via OAuth.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | Primary key |
| `kite_user_id` | VARCHAR(20) | NOT NULL, UNIQUE | Zerodha user ID (e.g., `BBQ846`) |
| `username` | VARCHAR(100) | NOT NULL | Full name from Kite profile |
| `email` | VARCHAR(255) | NOT NULL, UNIQUE | Email from Kite profile |
| `kite_access_token_enc` | TEXT | NOT NULL | Kite access token — AES-256-GCM encrypted |
| `kite_token_expires_at` | TIMESTAMPTZ | NOT NULL | When the Kite session expires (~midnight IST daily) |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| `last_login_at` | TIMESTAMPTZ | | Last successful OAuth login |
| `exchange_memberships` | JSONB | NOT NULL | Exchanges enabled for this account (e.g. `["NSE","BSE"]`) — from Kite profile, stored at first login |
| `product_types` | JSONB | NOT NULL | Products enabled (e.g. `["CNC","MIS","NRML"]`) — from Kite profile, stored at first login |
| `paper_trade_mode` | BOOLEAN | NOT NULL DEFAULT FALSE | When TRUE, orders are simulated locally and never sent to Kite |
| `is_active` | BOOLEAN | NOT NULL DEFAULT TRUE | FALSE = user banned; blocked at `get_current_user` dependency |

**Indexes:** `kite_user_id` (unique), `email` (unique), `kite_token_expires_at` (for health check job)

---

### 2. `refresh_tokens`

Server-side refresh token records for silent JWT renewal.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → users.id, NOT NULL | |
| `token_hash` | VARCHAR(128) | NOT NULL, UNIQUE | SHA-256 hash of the raw refresh token |
| `expires_at` | TIMESTAMPTZ | NOT NULL | 30 days from creation |
| `revoked` | BOOLEAN | NOT NULL DEFAULT FALSE | Revoked on use (rotation) or explicit logout |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| `user_agent` | TEXT | | Browser identifier |
| `ip_address` | INET | | Client IP |

**Indexes:** `token_hash` (unique), `user_id`

---

### 3. `audit_logs`

Immutable record of every trade action taken via StockPilot.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → users.id, NOT NULL | |
| `action_type` | VARCHAR(50) | NOT NULL | `PLACE_ORDER` `MODIFY_ORDER` `CANCEL_ORDER` `PLACE_GTT` `MODIFY_GTT` `DELETE_GTT` `PAPER_TRADE` |
| `tradingsymbol` | VARCHAR(30) | NOT NULL | |
| `exchange` | VARCHAR(10) | NOT NULL | |
| `order_params` | JSONB | NOT NULL | Full payload sent to Kite |
| `kite_order_id` | VARCHAR(50) | | Kite order ID on success |
| `kite_gtt_id` | BIGINT | | Kite GTT trigger ID |
| `outcome` | VARCHAR(20) | NOT NULL | `SUCCESS` `FAILURE` |
| `error_message` | TEXT | | Kite error if outcome = FAILURE |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| `request_id` | UUID | | Correlation ID for log tracing |

**Indexes:** `user_id`, `tradingsymbol`, `created_at`
**Rule:** No UPDATE or DELETE permitted (application + DB policy enforced)

---

### 4. `ohlcv_cache`

Global cache of historical OHLCV data from Kite. Market data is shared across all users — not user-scoped. The largest table.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGINT | PK AUTOINCREMENT | |
| `instrument_token` | BIGINT | NOT NULL | Kite instrument token |
| `tradingsymbol` | VARCHAR(30) | NOT NULL | For human readability |
| `exchange` | VARCHAR(10) | NOT NULL | |
| `interval` | VARCHAR(10) | NOT NULL | `5minute` `15minute` `30minute` `60minute` `day` |
| `candle_timestamp` | TIMESTAMPTZ | NOT NULL | Candle open time (IST stored as UTC) |
| `open` | NUMERIC(18,4) | NOT NULL | |
| `high` | NUMERIC(18,4) | NOT NULL | |
| `low` | NUMERIC(18,4) | NOT NULL | |
| `close` | NUMERIC(18,4) | NOT NULL | |
| `volume` | BIGINT | NOT NULL | |
| `fetched_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | When this row was inserted |

**Unique constraint:** `(instrument_token, interval, candle_timestamp)`
**Primary index:** Composite `(instrument_token, interval, candle_timestamp)` — covering for all typical queries

---

### 5. `kpis`

User-defined KPI formula definitions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → users.id, NOT NULL | |
| `name` | VARCHAR(100) | NOT NULL | e.g., "RSI Overbought" |
| `formula` | TEXT | NOT NULL | e.g., `RSI(14) > 70` |
| `return_type` | VARCHAR(20) | NOT NULL | `SCALAR` (numeric) · `BOOLEAN` (true/false badge) · `CATEGORICAL` (descriptive label e.g. "Buy Signal") |
| `description` | TEXT | | Optional notes |
| `is_active` | BOOLEAN | NOT NULL DEFAULT TRUE | Whether shown in portfolio table |
| `display_order` | INTEGER | DEFAULT 0 | Column order in portfolio view |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

**Note:** KPI definitions are per-user — each user maintains their own KPI library. Computed KPI values are NOT stored in the DB. They are computed on demand via the `/kpis/portfolio` endpoint (using `ohlcv_cache` for TA indicators and `fundamental_cache` for P/E and EPS) and cached in frontend IndexedDB for the session.

---

### 6. `chart_drawings`

User-created chart annotations, persisted per instrument and interval.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | |
| `user_id` | UUID | FK → users.id, NOT NULL | |
| `instrument_token` | BIGINT | NOT NULL | |
| `tradingsymbol` | VARCHAR(30) | NOT NULL | |
| `exchange` | VARCHAR(10) | NOT NULL | |
| `interval` | VARCHAR(10) | NOT NULL | |
| `drawing_type` | VARCHAR(20) | NOT NULL | `hline` `trendline` `rectangle` `text` |
| `drawing_data` | JSONB | NOT NULL | Coordinates and style |
| `label` | VARCHAR(200) | | Optional user label |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

**Index:** `(instrument_token, interval)` — covers all chart load queries

**`drawing_data` schema by type:**
```json
// hline
{ "price": 1500.0, "color": "#FF0000", "width": 1, "style": "solid" }

// trendline
{ "p1": { "time": "2026-01-01T09:15:00Z", "price": 1400.0 },
  "p2": { "time": "2026-01-15T15:30:00Z", "price": 1600.0 },
  "color": "#00AA00", "width": 2 }

// rectangle
{ "topLeft":     { "time": "...", "price": 1600 },
  "bottomRight": { "time": "...", "price": 1400 },
  "fillColor": "#FFFF0020", "borderColor": "#FFFF00" }

// text
{ "time": "...", "price": 1500, "text": "Support", "color": "#FFF", "fontSize": 12 }
```

---

### 7. `fundamental_cache`

Cached fundamental data (P/E ratio, EPS) sourced from NSE India. Refreshed weekly.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `instrument_token` | BIGINT | PK | Kite instrument token — one row per instrument |
| `tradingsymbol` | VARCHAR(30) | NOT NULL | |
| `exchange` | VARCHAR(10) | NOT NULL | |
| `isin` | VARCHAR(12) | | ISIN code — used to match with NSE data |
| `pe_ratio` | NUMERIC(10,4) | | Price-to-Earnings ratio |
| `eps` | NUMERIC(14,4) | | Earnings Per Share (TTM) |
| `book_value` | NUMERIC(14,4) | | Book value per share |
| `face_value` | NUMERIC(10,4) | | Face value per share |
| `week_52_high` | NUMERIC(18,4) | | 52-week high price (from NSE) |
| `week_52_low` | NUMERIC(18,4) | | 52-week low price (from NSE) |
| `fetched_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | When this row was last refreshed |
| `data_date` | DATE | | The date the fundamental data is as of |

**Index:** `tradingsymbol`

**Notes:**
- Refreshed every Sunday at 08:00 IST via a scheduled job
- P/E Ratio is stored as fetched from NSE (pre-computed); not derived from `close / eps` locally to avoid stale price mismatch
- 52-week high/low from NSE is stored as a reference, but the backend also computes these independently from the `ohlcv_cache` daily data for consistency in KPI computations
- If a fetch fails, the previous values remain and a `staleness_warning` flag is raised in the API response

---

## Frontend Storage (IndexedDB via Dexie.js)

These are NOT database tables — they are client-side stores. See [STORAGE_STRATEGY.md](STORAGE_STRATEGY.md).

| Store | Schema | TTL |
|-------|--------|-----|
| `holdings` | `{ fetchedAt, data[] }` | 60 seconds |
| `positions` | `{ fetchedAt, data[] }` | 60 seconds |
| `orders_today` | `{ fetchedAt, data[] }` | 30 seconds |
| `margins` | `{ fetchedAt, data }` | 30 seconds |
| `kpi_values` | `{ kpiId, instrumentToken, date, value }` | Until next D-1 |
| `ohlcv_session` | `{ instrumentToken, interval, candles[] }` | Browser session |
| `indicator_values` | `{ key, series[] }` | Browser session |

## Frontend (localStorage)

| Key | Type | Description |
|-----|------|-------------|
| `pref_theme` | string | `dark` / `light` |
| `pref_default_interval` | string | e.g., `15m` |
| `pref_visible_kpi_columns` | JSON array | KPI IDs shown as columns in the portfolio table |
| `pref_visible_holdings_columns` | JSON array | Standard column IDs shown in the portfolio table (allows hiding e.g. Exchange) |
| `pref_holdings_sort` | JSON | `{ column, direction }` |
| `chart_{token}_{interval}` | JSON | Zoom, active indicators, panel sizes per chart |
