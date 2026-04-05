# API Specification
## StockPilot Backend — FastAPI

**Version:** 6.0
**Date:** 2026-03-01
**Base URL:** `https://localhost:8000/api/v1`
**Auth:** All endpoints except `/auth/login` and `/auth/callback` require the httpOnly cookie `access_token` (set after login). Alternatively, `Authorization: Bearer <jwt>` is accepted for API clients.

---

## Endpoint Index

| # | Group | Count | Description |
|---|-------|-------|-------------|
| 1 | Auth | 6 | Kite OAuth, JWT, session, revoke |
| 2 | Portfolio | 4 | Holdings, positions, margins, summary |
| 3 | Historical Data | 4 | OHLCV fetch + cache management |
| 4 | Instruments | 2 | Search, lookup |
| 5 | Fundamentals | 2 | P/E, EPS, 52W data |
| 6 | KPIs | 6 | Define, compute, portfolio view |
| 7 | Charts | 5 | Drawings + indicator compute |
| 8 | Orders | 5 | Place, view, modify, cancel |
| 9 | GTT | 4 | Create, list, modify, delete |
| 10 | Audit | 1 | Read-only log |
| 11 | System | 1 | Health check |
| **Total** | | **40** | |

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
| 403 | Forbidden (Kite OAuth rejected or user not permitted) |
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
  "user": { "user_id": "ABC123", "name": "Jane Doe", "email": "jane@example.com" },
  "expires_in": 28800
}
```
A new `users` row is created on first login; subsequent logins update `last_login_at` and `kite_access_token_enc`.

On error (cancelled, wrong account): redirects to `/login?error=cancelled` or `/login?error=unauthorized`.

---

### `POST /auth/refresh`
Silent JWT renewal. Reads refresh token from cookie, issues new JWT + rotated refresh token.

**Response:** `{ "expires_in": 28800 }`
Errors: `401` if refresh token expired or revoked.

---

### `POST /auth/logout`
Revokes current session. Clears cookies.

**Response:** `{ "message": "Logged out" }`

---

### `POST /auth/sessions/revoke-all`
Revokes all refresh tokens for the authenticated user across all devices. Clears current session cookie.

**Response:** `{ "revoked_count": 3 }`

All other devices holding valid refresh tokens will receive `401` on their next silent renewal.

---

### `GET /auth/me`
Current user profile + Kite session status.

**Response:**
```json
{
  "user_id": "ABC123",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "exchange_memberships": ["NSE", "BSE"],
  "product_types": ["CNC", "MIS", "NRML"],
  "paper_trade_mode": false,
  "kite_session_valid": true,
  "kite_token_expires_at": "2026-02-25T23:59:59Z",
  "last_login_at": "2026-02-25T09:15:00Z"
}
```

---

## 2. Portfolio

All portfolio data is fetched live from Kite using the authenticated user's session token. Frontend caches with short TTL. Data is always scoped to the requesting user.

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
      "t1_quantity": 0,
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

`t1_quantity`: shares purchased today pending T+1 settlement; not available for CNC sell until the next trading day.

---

### `GET /portfolio/positions`

**Response:**
```json
{
  "positions": [
    {
      "tradingsymbol": "HCLTECH",
      "exchange": "NSE",
      "product": "MIS",
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
  "loss_count": 8,
  "xirr": 12.4
}
```

`xirr`: annualised return computed from `audit_logs` buy entries for current holdings. `null` when no purchase history exists in StockPilot's audit log (e.g., pre-existing holdings not placed through the platform).

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

## 5. Fundamentals

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
Trigger an on-demand refresh of fundamental data for all held instruments. Normally runs automatically on Sunday at 08:00 IST.

Rate-limited to 2 requests per user per hour to prevent repeated NSE scraping.

**Response:**
```json
{
  "refreshed": 18,
  "failed": [],
  "completed_at": "2026-02-27T10:05:00Z"
}
```

---

## 6. KPIs

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
`return_type`: `SCALAR` | `BOOLEAN` | `CATEGORICAL`

**Response:** `201` with KPI object.
Errors: `400` if formula is invalid (with a descriptive parse error message).

---

### `PUT /kpis/{kpi_id}`
Update KPI name, formula, return_type, description, is_active, or display_order.

**Response:** Updated KPI object.

---

### `DELETE /kpis/{kpi_id}`
**Response:** `204 No Content`

---

### `POST /kpis/{kpi_id}/compute`
Compute a single KPI for given instruments on a date. Result is returned to frontend for Zustand store caching — not stored in DB.

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
    "128053508": { "value": 52.1,        "return_type": "SCALAR" },
    "128046084": { "value": true,        "return_type": "BOOLEAN" },
    "128046085": { "value": "Buy Signal","return_type": "CATEGORICAL" }
  }
}
```
`using_live_price: true` when market is open and LTP is used for computation.

---

### `GET /kpis/portfolio`
Compute all active KPIs for all current holdings on D-1 in one call. Frontend caches the result in the Zustand store.

**Response:**
```json
{
  "as_of_date": "2026-02-24",
  "kpis": [{ "id": "uuid", "name": "RSI Overbought", "return_type": "BOOLEAN" }],
  "results": [
    {
      "tradingsymbol": "INFY",
      "instrument_token": 128053508,
      "kpi_values": {
        "RSI Overbought": { "value": false },
        "BB Position":    { "value": "Hold" }
      }
    }
  ]
}
```

---

## 7. Charts

**Chart engine note:** When using the TradingView Charting Library (primary), all chart indicators are computed client-side by TradingView — `/charts/indicators/compute` is **not called** for chart rendering. Drawings endpoints are called via TV's `saveChartToServer` / `loadChartFromServer` hooks. The indicator compute endpoint is used only by the KPI service (portfolio-level calculations) and the Lightweight Charts fallback.

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

**Response:** Updated drawing object.

---

### `DELETE /charts/{instrument_token}/drawings/{drawing_id}`
**Response:** `204 No Content`

---

### `GET /charts/indicators/compute`
Compute indicator series and return time-series data.

**Used by:** KPI portfolio computation (pandas-ta) and the Lightweight Charts fallback.
**Not called** when the TradingView Charting Library is active.

**Query Params:**
| Param | Type | Description |
|-------|------|-------------|
| `instrument_token` | integer | |
| `interval` | string | `5minute` `15minute` `30minute` `60minute` `day` |
| `from_date` | YYYY-MM-DD | |
| `to_date` | YYYY-MM-DD | |
| `indicators` | string | Comma-separated specs, e.g. `SMA_20,EMA_50,RSI_14,MACD,BB_20`. Any pandas-ta indicator is valid; period appended with `_`. |

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

## 8. Orders

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
      "variety": "regular",
      "quantity": 5,
      "price": 1280.0,
      "trigger_price": null,
      "validity": "DAY",
      "status": "COMPLETE",
      "filled_quantity": 5,
      "average_price": 1279.50,
      "placed_at": "2026-02-25T09:25:00Z"
    }
  ]
}
```

`variety` is required by PUT and DELETE — always included in the list response.

---

### `POST /orders`
Place a new order. Always writes to `audit_logs` regardless of outcome.

If `users.paper_trade_mode = true`, the order is **not** forwarded to Kite. It is recorded in `audit_logs` with `action_type = PAPER_TRADE` and a simulated order ID is returned.

**Request:**
```json
{
  "tradingsymbol": "INFY",
  "exchange": "NSE",
  "transaction_type": "BUY",
  "product": "MIS",
  "order_type": "LIMIT",
  "quantity": 5,
  "price": 1280.0,
  "trigger_price": null,
  "variety": "regular",
  "validity": "DAY",
  "paper_trade": false
}
```

`variety`: `"regular"` | `"co"` | `"amo"` | `"iceberg"` | `"auction"` | `"bo"`. Default `"regular"`.
`trigger_price`: required for `SL` and `SL-M` order types; `null` otherwise.
`paper_trade`: optional boolean override (default: reflects `users.paper_trade_mode`). When `true`, order is simulated regardless of account setting.

**Bracket orders (`variety="bo"`):**

Bracket orders wrap a LIMIT entry with an auto-target and auto-stop-loss. Kite restrictions:
- `exchange`: NSE or BSE equity only
- `product`: must be `MIS` (intraday; no overnight bracket)
- `order_type`: must be `LIMIT`
- Only available during market hours (09:15–15:30 IST); no AMO fallback

Extra required fields:
```json
{
  "variety": "bo",
  "product": "MIS",
  "order_type": "LIMIT",
  "squareoff": 10.0,
  "stoploss": 5.0,
  "trailing_stoploss": 2.0
}
```

`squareoff`: points above entry (for BUY) or below entry (for SELL) at which the position auto-squares off with profit. Must be > 0.
`stoploss`: points against entry at which the stop-loss fires. Must be > 0.
`trailing_stoploss`: optional trailing stop-loss in points. As price moves in your favor, the stop trails by this amount.

Returns `422` if `squareoff`/`stoploss` are missing, or if `product != MIS`.

**Response:** `201`
```json
{ "order_id": "241225000000001", "audit_log_id": "uuid", "paper_trade": false }
```
Errors: `422` for validation failures or Kite rejection with full Kite error message.

---

### `POST /orders/margins`
Pre-order SPAN + exposure margin calculation. Returns the margin required for a basket of orders before placing them. Best-effort: returns `200` with zero values if Kite margin API is unavailable.

**Request:**
```json
{
  "orders": [
    {
      "exchange": "NSE",
      "tradingsymbol": "INFY",
      "transaction_type": "BUY",
      "variety": "regular",
      "product": "MIS",
      "order_type": "LIMIT",
      "quantity": 10,
      "price": 1280.0,
      "trigger_price": 0
    }
  ]
}
```

**Response:** `200`
```json
{
  "equity": {
    "span": 0,
    "exposure": 1280.0,
    "option_premium": 0,
    "additional": 0,
    "bo": 0,
    "cash": 0,
    "var": 128.0,
    "total": 1408.0
  },
  "commodity": {
    "span": 0, "exposure": 0, "option_premium": 0, "additional": 0,
    "bo": 0, "cash": 0, "var": 0, "total": 0
  }
}
```

Rate limit: same as `POST /orders` (20 req/min per user).

---

### `PUT /orders/{order_id}`
Modify a pending order.

**Request:**
```json
{ "variety": "regular", "order_type": "LIMIT", "quantity": 10, "price": 1285.0, "trigger_price": null }
```
**Response:** `{ "order_id": "...", "status": "updated" }`

---

### `DELETE /orders/{order_id}?variety=regular`
Cancel a pending order.

**Response:** `{ "order_id": "...", "status": "CANCELLED" }`

---

### `GET /orders/{order_id}/history`
Full status history from Kite.

**Response:** `{ "order_id": "...", "history": [ { "status": "...", "timestamp": "..." } ] }`

---

## 9. GTT Orders

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
Modify a GTT. Always writes to `audit_logs`.

**Response:** `{ "trigger_id": 12345, "status": "updated" }`

---

### `DELETE /gtt/{trigger_id}`
Delete a GTT. Always writes to `audit_logs`.

**Response:** `204 No Content`

---

## 10. Audit

### `GET /audit`
Read-only. No write endpoints exist.

**Query Params:**

| Param | Type | Description |
|-------|------|-------------|
| `from_date` | YYYY-MM-DD | |
| `to_date` | YYYY-MM-DD | |
| `tradingsymbol` | string | |
| `action_type` | string | One of: `PLACE_ORDER` `MODIFY_ORDER` `CANCEL_ORDER` `PLACE_GTT` `MODIFY_GTT` `DELETE_GTT` `PAPER_TRADE` |
| `limit` | integer | Default 50, max 200 |
| `offset` | integer | Default 0 |

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

## 11. User Preferences (PD-09)

### `GET /user/preferences`

Returns the authenticated user's UI preferences. Defaults are returned if no preferences have been saved yet.

**Response `200`:**
```json
{
  "preferences": {
    "visible_holdings_columns": ["quantity", "ltp", "pnl"],
    "holdings_sort": { "column": "pnlPercent", "direction": "desc" }
  }
}
```

---

### `PUT /user/preferences`

Overwrites the user's UI preferences.

**Request Body:**
```json
{
  "visible_holdings_columns": ["quantity", "ltp", "pnl"],
  "holdings_sort": { "column": "pnlPercent", "direction": "desc" }
}
```

**Response `200`:** Same shape as `GET /user/preferences`.

---

## 12. System

### `GET /health`
No auth required. Used by Docker health checks.

**Response:**
```json
{
  "status": "healthy",
  "db": "connected",
  "version": "1.0.0"
}
```

`db`: `"connected"` | `"unreachable"`. No user-specific fields — this is a system-level check.

---

## Rate Limits

| Endpoint Group | Key | Limit |
|---------------|-----|-------|
| `/auth/login`, `/auth/callback` | Per IP | 10 req / minute |
| `/auth/refresh`, `/auth/logout`, `/auth/sessions/revoke-all` | Per user | 20 req / minute |
| `POST/PUT/DELETE /orders` | Per user | 20 req / minute |
| `POST/PUT/DELETE /gtt` | Per user | 20 req / minute |
| `GET /historical/*` | Per user | 60 req / minute |
| `POST /fundamentals/refresh` | Per user | 2 req / hour |
| All other authenticated | Per user | 120 req / minute |

Response headers on every request: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
