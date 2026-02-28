# API Specification
## StockPilot Backend — FastAPI

**Version:** 3.0
**Date:** 2026-02-28
**Base URL:** `https://localhost:8000/api/v1`
**Auth:** All endpoints except `/auth/login` and `/auth/callback` require `Authorization: Bearer <jwt>` OR the httpOnly cookie `access_token`.

---

## Endpoint Index

| # | Group | Count | Description |
|---|-------|-------|-------------|
| 1 | Auth | 5 | Kite OAuth, JWT, session |
| 2 | Portfolio | 4 | Holdings, positions, margins, summary |
| 3 | Historical Data | 4 | OHLCV fetch + cache management |
| 4 | Instruments | 2 | Search, lookup |
| 4a | Fundamentals | 2 | P/E, EPS, 52W data |
| 5 | KPIs | 6 | Define, compute, portfolio view |
| 6 | Charts | 5 | Drawings + indicator compute |
| 7 | Strategies | 5 | CRUD + versioning |
| 8 | Backtests | 5 | Run, results, trades |
| 9 | Orders | 5 | Place, view, modify, cancel |
| 10 | GTT | 4 | Create, list, modify, delete |
| 11 | Audit | 1 | Read-only log |
| 12 | System | 1 | Health check |
| **Total** | | **49** | |

---

## Standard Error Format

```json
{
  "error": {
    "code": "KITE_ORDER_REJECTED",
    "message": "Insufficient funds",
    "details": { "available": 4486.60, "required": 12900.00 },
    "request_id": "uuid"
  }
}
```

| HTTP Code | Meaning |
|-----------|---------|
| 200 | Success |
| 201 | Created |
| 202 | Accepted (async job queued) |
| 204 | No Content |
| 400 | Validation / bad request |
| 401 | Not authenticated |
| 403 | Wrong user (not BBQ846) |
| 404 | Not found |
| 422 | Kite API rejection (valid request, Kite refused) |
| 429 | Rate limited |
| 500 | Server error |

---

## 1. Auth

### `GET /auth/login`
Returns the Kite OAuth URL. Frontend redirects user there.

**Response:**
```json
{ "login_url": "https://kite.zerodha.com/connect/login?api_key=..." }
```

---

### `GET /auth/callback?request_token=<token>`
Kite redirects here post-login. Exchanges token, issues JWT + refresh token as httpOnly cookies.

**Response:**
```json
{
  "user": { "user_id": "BBQ846", "name": "Prakruti Vavdiya", "email": "prakrutivavdiya@gmail.com" },
  "expires_in": 28800
}
```
Errors: `403` if `kite_user_id != ALLOWED_KITE_USER_ID`

---

### `POST /auth/refresh`
Silent JWT renewal. Reads refresh token from cookie, issues new JWT + rotated refresh token.

**Response:** `{ "expires_in": 28800 }`
Errors: `401` if refresh token expired or revoked

---

### `POST /auth/logout`
Revokes session. Clears cookies.

**Response:** `{ "message": "Logged out" }`

---

### `GET /auth/me`
Current user profile + Kite session status.

**Response:**
```json
{
  "user_id": "BBQ846",
  "name": "Prakruti Vavdiya",
  "email": "prakrutivavdiya@gmail.com",
  "kite_session_valid": true,
  "kite_token_expires_at": "2026-02-25T23:59:59Z",
  "last_login_at": "2026-02-25T09:15:00Z"
}
```

---

## 2. Portfolio

All portfolio data is fetched live from Kite. Frontend caches with short TTL.

### `GET /portfolio/holdings`

**Response:**
```json
{
  "holdings": [
    {
      "tradingsymbol": "INFY",
      "exchange": "BSE",
      "instrument_token": 128053508,
      "quantity": 110,
      "average_price": 1493.64,
      "last_price": 1290.35,
      "close_price": 1276.55,
      "pnl": -22362.40,
      "pnl_pct": -13.60,
      "day_change": 13.80,
      "day_change_pct": 1.08,
      "current_value": 141938.50,
      "invested_value": 164300.90
    }
  ],
  "summary": {
    "total_invested": 1234567.00,
    "total_current_value": 1356789.00,
    "total_pnl": 122222.00,
    "total_pnl_pct": 9.90,
    "total_day_change": -5678.00,
    "total_day_change_pct": -0.42
  }
}
```

---

### `GET /portfolio/positions`

**Response:**
```json
{
  "positions": [
    {
      "tradingsymbol": "HCLTECH",
      "exchange": "NSE",
      "product": "CNC",
      "quantity": 20,
      "average_price": 1373.00,
      "last_price": 1376.85,
      "pnl": 77.00,
      "unrealised": 77.00,
      "realised": 0.00
    }
  ]
}
```

---

### `GET /portfolio/margins`

**Response:**
```json
{
  "equity": {
    "available_cash": 4486.60,
    "opening_balance": 44600.60,
    "used_debits": 40114.00
  }
}
```

---

### `GET /portfolio/summary`
Aggregated view: holdings summary + margin in one call.

**Response:**
```json
{
  "total_invested": 1234567.00,
  "current_value": 1356789.00,
  "total_pnl": 122222.00,
  "total_pnl_pct": 9.90,
  "available_margin": 4486.60,
  "holdings_count": 18,
  "profitable_count": 10,
  "loss_count": 8
}
```

---

## 3. Historical Data

### `GET /historical/{instrument_token}`
Fetch OHLCV candles. Returns from `ohlcv_cache` if available; fetches from Kite if not.

**Query Params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `interval` | string | `day` | `5minute` `15minute` `30minute` `60minute` `day` |
| `from_date` | YYYY-MM-DD | D-1 | |
| `to_date` | YYYY-MM-DD | D-1 | |

**Response:**
```json
{
  "instrument_token": 128053508,
  "tradingsymbol": "INFY",
  "interval": "15minute",
  "from_date": "2026-02-24",
  "to_date": "2026-02-24",
  "candles": [
    { "timestamp": "2026-02-24T09:15:00+05:30", "open": 1280.0, "high": 1295.0, "low": 1278.0, "close": 1290.0, "volume": 145230 }
  ],
  "source": "cache"
}
```

---

### `POST /historical/bulk`
Fetch D-1 daily candle for multiple instruments at once. Used by dashboard on load.

**Request:**
```json
{ "instrument_tokens": [128053508, 128046084], "interval": "day", "date": "2026-02-24" }
```

**Response:**
```json
{
  "date": "2026-02-24",
  "results": {
    "128053508": { "open": 1275.0, "high": 1298.0, "low": 1270.0, "close": 1290.35, "volume": 1250000 }
  },
  "errors": {}
}
```

---

### `GET /historical/cache/status`
How much data is cached.

**Response:**
```json
{ "cached_instruments": 18, "total_candles": 125400, "oldest": "2023-01-02", "newest": "2026-02-24" }
```

---

### `DELETE /historical/cache/{instrument_token}`
Invalidate cache for an instrument (forces re-fetch).

**Response:** `{ "deleted_rows": 4520 }`

---

## 4. Instruments

### `GET /instruments/search?q=<query>&exchange=<NSE|BSE>`

**Response:**
```json
{
  "results": [
    { "instrument_token": 128053508, "tradingsymbol": "INFY", "name": "Infosys Limited", "exchange": "BSE", "instrument_type": "EQ" }
  ]
}
```

---

### `GET /instruments/{instrument_token}`

**Response:**
```json
{
  "instrument_token": 128053508,
  "tradingsymbol": "INFY",
  "name": "Infosys Limited",
  "exchange": "BSE",
  "isin": "INE009A01021",
  "lot_size": 1,
  "tick_size": 0.05
}
```

---

## 4a. Fundamentals

### `GET /fundamentals/{instrument_token}`
Retrieve cached fundamental data for a single instrument.

**Response:**
```json
{
  "instrument_token": 128053508,
  "tradingsymbol": "INFY",
  "pe_ratio": 28.4,
  "eps": 58.92,
  "book_value": 215.10,
  "face_value": 5.0,
  "week_52_high": 1953.90,
  "week_52_low": 1218.45,
  "fetched_at": "2026-02-23T08:05:00Z",
  "data_date": "2026-02-21",
  "staleness_warning": false
}
```
Returns `404` if fundamental data has never been fetched for this instrument.

---

### `POST /fundamentals/refresh`
Trigger an on-demand refresh of fundamental data for all held instruments. (Normally runs automatically on Sunday.)

**Response:**
```json
{
  "refreshed": 18,
  "failed": [],
  "completed_at": "2026-02-27T10:05:00Z"
}
```

---

## 5. KPIs

### `GET /kpis`

**Response:**
```json
{
  "kpis": [
    { "id": "uuid", "name": "RSI Overbought", "formula": "RSI(14) > 70", "return_type": "BOOLEAN", "is_active": true, "display_order": 1 }
  ]
}
```

---

### `POST /kpis`

**Request:**
```json
{
  "name": "RSI Overbought",
  "formula": "RSI(14) > 70",
  "return_type": "BOOLEAN",
  "description": "Signal when RSI crosses above 70"
}
```
`return_type` must be one of: `SCALAR`, `BOOLEAN`, `CATEGORICAL`.
**Response:** `201` with KPI object. Errors: `400` if formula is invalid (with a descriptive parse error).

---

### `PUT /kpis/{kpi_id}`
Update KPI definition.
**Response:** Updated KPI object.

---

### `DELETE /kpis/{kpi_id}`
**Response:** `204 No Content`

---

### `POST /kpis/{kpi_id}/compute`
Compute a single KPI for given instruments on a date. Result is returned to frontend for IndexedDB caching — not stored in DB.

**Request:**
```json
{ "instrument_tokens": [128053508, 128046084], "as_of_date": "2026-02-24", "interval": "day" }
```

**Response:**
```json
{
  "kpi_id": "uuid",
  "as_of_date": "2026-02-24",
  "using_live_price": false,
  "results": {
    "128053508": { "scalar": 52.1,  "boolean": false, "categorical": null },
    "128046084": { "scalar": 73.4,  "boolean": true,  "categorical": null },
    "128046085": { "scalar": null,  "boolean": null,  "categorical": "Buy Signal" }
  }
}
```
`using_live_price: true` when market is open and LTP is used for computation.

---

### `GET /kpis/portfolio`
Compute all active KPIs for all current holdings on D-1 in one call. Frontend caches the result in IndexedDB.

**Response:**
```json
{
  "as_of_date": "2026-02-24",
  "kpis": [{ "id": "uuid", "name": "RSI Overbought" }],
  "results": [
    {
      "tradingsymbol": "INFY",
      "instrument_token": 128053508,
      "kpi_values": {
        "RSI Overbought": { "value": false, "scalar": 52.1 },
        "Above 50 EMA":   { "value": true,  "scalar": 1295.0 }
      }
    }
  ]
}
```

---

## 6. Charts

### `GET /charts/{instrument_token}/drawings?interval=<interval>`
Fetch all saved drawings for an instrument + interval combo.

**Response:**
```json
{
  "instrument_token": 128053508,
  "interval": "day",
  "drawings": [
    { "id": "uuid", "drawing_type": "hline", "label": "Support", "drawing_data": { "price": 1250.0, "color": "#FF0000" }, "created_at": "..." }
  ]
}
```

---

### `POST /charts/{instrument_token}/drawings`

**Request:**
```json
{ "interval": "day", "drawing_type": "hline", "label": "Support", "drawing_data": { "price": 1250.0, "color": "#FF0000", "width": 1 } }
```
**Response:** `201` with drawing object.

---

### `PUT /charts/{instrument_token}/drawings/{drawing_id}`
Update drawing data or label.

---

### `DELETE /charts/{instrument_token}/drawings/{drawing_id}`
**Response:** `204 No Content`

---

### `GET /charts/indicators/compute`
Compute indicator series for chart overlay. Returns time series — frontend renders as overlay and caches in IndexedDB for the session.

**Query Params:**
| Param | Type | Description |
|-------|------|-------------|
| `instrument_token` | integer | |
| `interval` | string | `5minute` `15minute` `30minute` `60minute` `day` |
| `from_date` | YYYY-MM-DD | |
| `to_date` | YYYY-MM-DD | |
| `indicators` | string | Comma-separated indicator specs, e.g. `SMA_20,EMA_50,RSI_14,MACD,BB_20,ATR_14,VWAP,STOCH_14`. Any indicator supported by the pandas-ta library is valid. Period is appended with `_` (e.g. `SMA_50`). |

**Response:**
```json
{
  "SMA_20":  [{ "timestamp": "2026-02-24T09:15:00Z", "value": 1287.45 }],
  "RSI_14":  [{ "timestamp": "2026-02-24T09:15:00Z", "value": 52.1 }],
  "MACD":    [{ "timestamp": "...", "macd": 5.2, "signal": 4.8, "histogram": 0.4 }],
  "BB_20":   [{ "timestamp": "...", "upper": 1310.0, "middle": 1287.0, "lower": 1264.0 }]
}
```

---

## 7. Strategies

### `GET /strategies`

**Response:**
```json
{
  "strategies": [
    { "id": "uuid", "name": "EMA Crossover", "version": 2, "is_active": true, "backtest_count": 5, "updated_at": "..." }
  ]
}
```

---

### `POST /strategies`

**Request:**
```json
{
  "name": "EMA Crossover",
  "description": "Buy when EMA20 crosses above EMA50",
  "position_sizing_type": "FIXED_QTY",
  "position_sizing_value": 10,
  "stop_loss_pct": 3.0,
  "target_pct": 9.0,
  "entry_conditions": [
    { "group": 1, "left": "EMA(20)", "operator": "crosses_above", "right": "EMA(50)" }
  ],
  "exit_conditions": [
    { "group": 1, "left": "EMA(20)", "operator": "crosses_below", "right": "EMA(50)" }
  ]
}
```
**Response:** `201` with full strategy.

---

### `GET /strategies/{strategy_id}`
Full strategy with conditions.

---

### `PUT /strategies/{strategy_id}`
Creates a new version (previous version preserved).
**Response:** New version of strategy.

---

### `DELETE /strategies/{strategy_id}`
Soft-delete (sets `is_active = false`).
**Response:** `204 No Content`

---

## 8. Backtests

### `POST /backtests`
Queue a backtest run.

**Request:**
```json
{
  "strategy_id": "uuid",
  "instrument_token": 128053508,
  "interval": "day",
  "from_date": "2024-01-01",
  "to_date": "2025-12-31",
  "initial_capital": 100000
}
```
**Response:** `202 Accepted`
```json
{ "backtest_run_id": "uuid", "status": "PENDING" }
```

---

### `GET /backtests/{run_id}`
Poll for completion. When `status = COMPLETED`, includes all summary metrics.

**Response:**
```json
{
  "id": "uuid",
  "strategy_name": "EMA Crossover",
  "tradingsymbol": "INFY",
  "interval": "day",
  "from_date": "2024-01-01",
  "to_date": "2025-12-31",
  "initial_capital": 100000,
  "final_capital": 127450,
  "total_return_pct": 27.45,
  "cagr": 13.12,
  "max_drawdown": -8.45,
  "sharpe_ratio": 1.34,
  "win_rate": 58.33,
  "total_trades": 12,
  "status": "COMPLETED",
  "run_at": "2026-02-25T10:00:00Z",
  "completed_at": "2026-02-25T10:00:05Z"
}
```

---

### `GET /backtests/{run_id}/trades`
Trade log. Frontend uses this to compute and render the equity curve.

**Response:**
```json
{
  "initial_capital": 100000,
  "trades": [
    {
      "entry_timestamp": "2024-03-15T09:15:00Z",
      "entry_price": 1450.0,
      "exit_timestamp": "2024-04-20T15:30:00Z",
      "exit_price": 1580.0,
      "quantity": 10,
      "direction": "LONG",
      "pnl": 1300.0,
      "pnl_pct": 8.97,
      "exit_reason": "SIGNAL"
    }
  ]
}
```
**Note:** The equity curve is computed client-side from this response. No separate endpoint needed.

---

### `GET /backtests`
List all runs, optionally filtered.

**Query Params:** `strategy_id`, `tradingsymbol`, `limit` (default 20), `offset` (default 0)

**Response:** Paginated list of backtest summaries (no trade details).

---

### `DELETE /backtests/{run_id}`
Delete a backtest run and its trade records.
**Response:** `204 No Content`

---

## 9. Orders

### `GET /orders`
Today's orders from Kite (live).

**Response:**
```json
{
  "orders": [
    {
      "order_id": "241225000000001",
      "tradingsymbol": "INFY",
      "exchange": "BSE",
      "transaction_type": "BUY",
      "product": "CNC",
      "order_type": "LIMIT",
      "quantity": 5,
      "price": 1280.0,
      "status": "COMPLETE",
      "filled_quantity": 5,
      "average_price": 1279.50,
      "placed_at": "2026-02-25T09:25:00Z"
    }
  ]
}
```

---

### `POST /orders`
Place a new order. Always writes to audit_log.

**Request:**
```json
{
  "tradingsymbol": "INFY",
  "exchange": "BSE",
  "transaction_type": "BUY",
  "product": "CNC",
  "order_type": "LIMIT",
  "quantity": 5,
  "price": 1280.0,
  "variety": "regular",
  "validity": "DAY"
}
```
**Response:** `201`
```json
{ "order_id": "241225000000001", "audit_log_id": "uuid" }
```
Errors: `422` for Kite rejection with full Kite error message.

---

### `PUT /orders/{order_id}`
Modify a pending order.

**Request:** `{ "variety": "regular", "order_type": "LIMIT", "quantity": 10, "price": 1285.0, "trigger_price": null }`
**Response:** `{ "order_id": "...", "status": "updated" }`

---

### `DELETE /orders/{order_id}?variety=regular`
Cancel a pending order.

**Response:** `{ "order_id": "...", "status": "CANCELLED" }`

---

### `GET /orders/{order_id}/history`
Full status history from Kite.

---

## 10. GTT Orders

### `GET /gtt`

**Response:**
```json
{
  "gtts": [
    { "trigger_id": 12345, "tradingsymbol": "INFY", "trigger_type": "single", "trigger_value": 1200.0, "limit_price": 1195.0, "quantity": 10, "transaction_type": "BUY", "status": "active" }
  ]
}
```

---

### `POST /gtt`

**Request:**
```json
{
  "tradingsymbol": "INFY", "exchange": "BSE", "transaction_type": "BUY", "product": "CNC",
  "trigger_type": "single", "last_price": 1290.35, "trigger_value": 1200.0, "limit_price": 1195.0, "quantity": 10
}
```
**Response:** `201` `{ "trigger_id": 12345, "audit_log_id": "uuid" }`

---

### `PUT /gtt/{trigger_id}`
Modify a GTT. Always writes to audit_log.

---

### `DELETE /gtt/{trigger_id}`
Delete a GTT. Always writes to audit_log.
**Response:** `200`

---

## 11. Audit

### `GET /audit`
Read-only. No write endpoints exist.

**Query Params:** `from_date`, `to_date`, `tradingsymbol`, `action_type`, `limit` (default 50), `offset`

**Response:**
```json
{
  "total": 87,
  "logs": [
    {
      "id": "uuid",
      "action_type": "PLACE_ORDER",
      "tradingsymbol": "INFY",
      "exchange": "BSE",
      "order_params": { "transaction_type": "BUY", "quantity": 5, "price": 1280.0 },
      "kite_order_id": "241225000000001",
      "outcome": "SUCCESS",
      "created_at": "2026-02-25T09:25:00Z"
    }
  ]
}
```

---

## 12. System

### `GET /health`
No auth required. Used by Docker health checks.

**Response:**
```json
{
  "status": "healthy",
  "db": "connected",
  "kite_session": "valid",
  "version": "1.0.0"
}
```

---

## Rate Limits

| Endpoint Group | Limit |
|---------------|-------|
| `/auth/*` | 10 req / minute |
| `POST/PUT/DELETE /orders` | 20 req / minute |
| `POST/PUT/DELETE /gtt` | 20 req / minute |
| `GET /historical/*` | 60 req / minute (Kite enforces 3 req/sec internally) |
| Everything else | 120 req / minute |

Response headers on every request: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
