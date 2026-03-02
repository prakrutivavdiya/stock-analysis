# System Architecture
## StockPilot — Trading & Analysis Platform

**Version:** 5.0
**Date:** 2026-02-28

See [AUTH_IMPL.md](AUTH_IMPL.md) for Kite OAuth flow, multi-user KiteConnect management, `get_current_user` dependency, and rate limiter implementation.

---

## 1. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              USER BROWSER                                    │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                   React + TypeScript Frontend                        │   │
│  │                                                                      │   │
│  │  Dashboard │ Charts │ KPIs │ Trade │ Audit                               │   │
│  │            (TradingView Lightweight Charts)                          │   │
│  │                                                                      │   │
│  │  ┌─────────────────────────┐  ┌────────────────────────────────┐    │   │
│  │  │  Frontend State Layer   │  │   Frontend Storage             │    │   │
│  │  │  (Zustand / React Query)│  │                                │    │   │
│  │  │                         │  │  IndexedDB (Dexie.js)          │    │   │
│  │  │  - API response caching │  │  - holdings (TTL 60s)          │    │   │
│  │  │  - Optimistic updates   │  │  - positions (TTL 60s)         │    │   │
│  │  │  - TV DataFeed adapter  │  │  - orders (TTL 30s)            │    │   │
│  │  │    (IBasicDataFeed)     │  │  - kpi_values (daily)          │    │   │
│  │  │    bridges TV↔backend  │  │  - ohlcv_session (session)     │    │   │
│  │  │  - TV computes chart    │  │                                │    │   │
│  │  └─────────────────────────┘  │                                │    │   │
│  │                               │  localStorage                  │    │   │
│  │                               │  - theme, defaults             │    │   │
│  │                               │  - chart state per instrument  │    │   │
│  │                               │  - column preferences          │    │   │
│  │                               └────────────────────────────────┘    │   │
│  └───────────────────────────┬──────────────────────────────────────────┘   │
└──────────────────────────────│───────────────────────────────────────────────┘
                               │ HTTPS + JWT (httpOnly cookie)
                               │
┌──────────────────────────────▼───────────────────────────────────────────────┐
│                          Nginx Reverse Proxy                                 │
│              TLS termination · CORS · HSTS · Static serving                 │
└──────────────────────────────┬───────────────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────────────────────┐
│                       FastAPI Application (Python 3.12)                      │
│                         Uvicorn · async · RS256 JWT auth                     │
│                                                                              │
│  Routers:  auth · portfolio · historical · instruments · kpis                │
│            charts · orders · gtt · audit                                    │
│                                                                              │
│  ┌────────────────────────────┐   ┌──────────────────────────────────────┐  │
│  │      Service Layer         │   │         Kite API Client              │  │
│  │                            │   │  (kiteconnect SDK wrapper)           │  │
│  │  - AuthService             │   │                                      │  │
│  │  - PortfolioService        │   │  - Per-user token decrypt per call   │  │
│  │  - HistoricalService       │   │  - Rate limiter (3 req/sec bucket)   │  │
│  │  - KPIService              │   │  - Retry with exponential backoff    │  │
│  │  - IndicatorEngine         │   │  - Session expiry detection → 401    │  │
│  │  - OrderService            │   └──────────────────────────────────────┘  │
│  │  - AuditService            │                                              │
│  │                            │   ┌──────────────────────────────────────┐  │
│  │                            │   │          Database Layer               │  │
│  │                            │   │  SQLAlchemy 2.0 async + Alembic      │  │
│  │                            │   │                                      │  │
│  └────────────────────────────┘   │  PostgreSQL (prod) / SQLite (dev)    │  │
│                                   │                                      │  │
│  ┌─────────────────────────────┐  │  7 tables — see DATA_MODEL.md        │  │
│  │  APScheduler (background)   │  └──────────────────────────────────────┘  │
│  │  - D-1 fetch: 09:20 IST     │                                             │
│  │    (all users' holdings)    │                                             │
│  │  - KPI recompute: 09:25 IST │                                             │
│  │    (all users' active KPIs) │                                             │
│  │  - Kite health: every 30m   │                                             │
│  │  - Fundamentals: Sun 08:00  │                                             │
│  └─────────────────────────────┘                                             │
└──────────────────────────────────────────────────────────────────────────────┘
                               │
                               │ Kite Connect REST API (HTTPS)
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Zerodha Kite API                                    │
│         Holdings · Positions · Orders · GTT · Historical Data · Profile      │
└──────────────────────────────────────────────────────────────────────────────┘

                               │ NSE India Public API (HTTPS)
                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                       NSE India (Fundamental Data)                           │
│              P/E Ratio · EPS · Book Value · 52-Week High/Low                 │
│              Refreshed weekly (Sunday 08:00 IST) → fundamental_cache         │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Storage Responsibility Matrix

```
                        ┌─────────────┬──────────────────┬──────────────┐
                        │  Kite API   │  Backend DB      │  Frontend    │
                        │  (live)     │  (PostgreSQL)    │  (IDB/LS)    │
┌───────────────────────┼─────────────┼──────────────────┼──────────────┤
│ Holdings              │     ✓       │                  │  Cache 60s   │
│ Positions             │     ✓       │                  │  Cache 60s   │
│ Orders (today)        │     ✓       │                  │  Cache 30s   │
│ Margins               │     ✓       │                  │  Cache 30s   │
│ OHLCV candles         │  source     │  ✓ cached        │  Session     │
│ User auth state       │             │  ✓ users (multi) │              │
│ JWT refresh tokens    │             │  ✓               │  Cookie only │
│ Audit log             │             │  ✓ append-only   │              │
│ KPI definitions       │             │  ✓ kpis          │              │
│ Fundamental data      │  NSE India  │  ✓ fund_cache    │              │
│ KPI computed values   │             │                  │  ✓ IDB daily │
│ Chart drawings        │             │  ✓ chart_drawings│              │
│ Chart UI state        │             │                  │  ✓ LS        │
│ User preferences      │             │                  │  ✓ LS        │
│ Indicator series      │             │  computed        │  ✓ Session   │
└───────────────────────┴─────────────┴──────────────────┴──────────────┘
```

LS = localStorage · IDB = IndexedDB

---

## 3. Project Structure

```
stock-analysis/
├── docs/                          ← All documentation
│
├── backend/
│   ├── alembic/                   ← DB migrations
│   │   └── versions/
│   ├── app/
│   │   ├── main.py                ← FastAPI app factory, middleware
│   │   ├── config.py              ← Pydantic Settings (.env)
│   │   ├── database.py            ← Async SQLAlchemy engine + session
│   │   │
│   │   ├── models/                ← SQLAlchemy ORM (7 models)
│   │   │   ├── user.py
│   │   │   ├── refresh_token.py
│   │   │   ├── audit_log.py
│   │   │   ├── ohlcv_cache.py
│   │   │   ├── fundamental_cache.py
│   │   │   ├── kpi.py
│   │   │   └── chart_drawing.py
│   │   │
│   │   ├── schemas/               ← Pydantic request/response models
│   │   │   ├── auth.py
│   │   │   ├── portfolio.py
│   │   │   ├── historical.py
│   │   │   ├── kpi.py
│   │   │   ├── order.py
│   │   │   ├── gtt.py
│   │   │   └── audit.py
│   │   │
│   │   ├── routers/               ← Route handlers (thin layer)
│   │   │   ├── auth.py
│   │   │   ├── portfolio.py
│   │   │   ├── historical.py
│   │   │   ├── instruments.py
│   │   │   ├── kpis.py
│   │   │   ├── charts.py
│   │   │   ├── orders.py
│   │   │   ├── gtt.py
│   │   │   └── audit.py
│   │   │
│   │   ├── services/              ← All business logic
│   │   │   ├── auth_service.py
│   │   │   ├── portfolio_service.py
│   │   │   ├── historical_service.py    ← cache-or-fetch logic (intervals: 5m/15m/30m/1hr/day)
│   │   │   ├── fundamental_service.py   ← NSE India fetch + fundamental_cache management
│   │   │   ├── kpi_service.py           ← routes to indicator_engine or fundamental_service
│   │   │   ├── indicator_engine.py      ← full pandas-ta wrapper; SCALAR/BOOLEAN/CATEGORICAL
│   │   │   ├── order_service.py
│   │   │   ├── gtt_service.py
│   │   │   └── audit_service.py
│   │   │
│   │   └── core/                  ← Cross-cutting concerns
│   │       ├── security.py        ← JWT RS256, AES-256-GCM encryption
│   │       ├── kite_client.py     ← SDK wrapper + rate limiter
│   │       ├── dependencies.py    ← FastAPI DI: get_db, get_current_user
│   │       ├── rate_limiter.py    ← Token bucket per endpoint group
│   │       ├── scheduler.py       ← APScheduler jobs
│   │       ├── logging.py         ← Structured JSON logs + request ID
│   │       └── exceptions.py      ← Custom exception hierarchy
│   │
│   ├── tests/
│   │   ├── unit/
│   │   └── integration/
│   ├── .env.example
│   ├── pyproject.toml
│   └── Dockerfile
│
├── frontend/                      ← React + TypeScript (Phase 5)
│   ├── src/
│   │   ├── api/                   ← API client (Axios / React Query)
│   │   ├── components/
│   │   ├── pages/
│   │   ├── store/                 ← Zustand state
│   │   ├── db/                    ← Dexie.js IndexedDB setup
│   │   │   └── index.ts           ← Store definitions + TTL helpers
│   │   └── utils/
│   └── ...
│
├── nginx/nginx.conf
├── docker-compose.yml
└── docker-compose.dev.yml
```

---

## 4. Key Data Flows

### 4.1 Chart Load with Indicators
```
User opens chart for INFY, 15m, last 30 days
  │
  ├─ Check IndexedDB ohlcv_session for (INFY, 15m, date range)
  │        HIT → render immediately
  │        MISS ↓
  │
  ├─ GET /historical/128053508?interval=15minute&from=...&to=...
  │        Backend checks ohlcv_cache
  │              HIT → return from DB
  │              MISS → fetch from Kite API → store in ohlcv_cache → return
  │
  ├─ Store candles in IndexedDB ohlcv_session
  ├─ Render chart (TradingView Lightweight Charts)
  │
  └─ For each active indicator (e.g., EMA(20)):
       GET /charts/indicators/compute?instrument_token=...&indicators=EMA_20
       Backend computes from ohlcv_cache using pandas-ta
       Store in IndexedDB indicator_values (session)
       Render overlay on chart
```

### 4.2 Order Placement
```
User fills order form → clicks "Review Order"
Frontend shows confirmation modal with full order details
User confirms
  │
  POST /orders { tradingsymbol, exchange, type, qty, price, ... }
  │
  Backend:
    ├─ Validate schema (Pydantic)
    ├─ call kite_client.place_order(...)
    │        SUCCESS → kite_order_id
    │        FAILURE → kite error message
    ├─ write audit_logs (always, success or failure)
    └─ return { order_id, status } or { error }
  │
  Frontend:
    └─ Invalidate orders_today in IndexedDB → re-fetch
```

---

## 5. Kite API Integration Constraints

### 5.1 Historical Data

| Constraint | Detail |
|-----------|--------|
| Rate limit | 3 requests/second; enforced by a token bucket in `kite_client.py` |
| Intraday availability | Last 60 days only; the backend shall never request intraday data older than 60 days |
| Max date range per call | 60 days for intraday intervals; no hard limit for daily candles |
| Partial candles | During market hours, today's intraday candles are in-progress; API responses must flag these (`is_live: true`) so the frontend can render them as incomplete |

### 5.2 GTT Orders

| Constraint | Detail |
|-----------|--------|
| `last_price` requirement | When creating or modifying a GTT, `last_price` must be passed to Kite; Kite uses it to validate that the trigger price is reasonable relative to the current price |

### 5.3 Holdings Fields

| Constraint | Detail |
|-----------|--------|
| `authorised_quantity` | Per Kite API: `authorised_quantity = realised_quantity + t1_quantity` — this is the actual sellable quantity for a holding |

### 5.4 Indicator Engine

| Constraint | Detail |
|-----------|--------|
| Minimum data requirement | At least 2× the longest indicator period must be present in `ohlcv_cache` for a valid result (e.g., EMA(200) requires ≥400 daily candles); if not met, the KPI computation returns a `data_insufficient` error |
| Formula security | KPI formulas are parsed server-side using a whitelist of allowed function names (pandas-ta indicators + OHLCV fields); arbitrary Python expressions are never evaluated; validation occurs at formula save time |
| P/E storage | P/E Ratio is stored as fetched from NSE India (pre-computed); it is not re-derived locally from `close / eps` to avoid stale price mismatch |

---

## 6. Architectural Decisions (Revised)

| Decision | Choice | Reason |
|----------|--------|--------|
| KPI values | Not persisted | Derived from ohlcv_cache (TA) or fundamental_cache (P/E, EPS) in ~50ms; frontend caches for session |
| KPI return types | SCALAR / BOOLEAN / CATEGORICAL | Three types needed to express numeric signals, flag signals, and descriptive labels (Buy/Sell/Hold) |
| Supported intervals | 5m, 15m, 30m, 1hr, day | Simplified from original 8 intervals; covers all practical use cases |
| Holdings/Positions | Never persisted | Always real-time Kite data; frontend caches with short TTL per user session |
| OHLCV data | Backend only, global | Too large for IndexedDB; shared across users — fetched once, served to all |
| Frontend data lib | Dexie.js (IndexedDB) | Typed, promise-based, excellent TTL support |
| Chart library (primary) | TradingView Charting Library | Full indicator library (100+), drawing tools (50+), sub-panes — all built-in; indicators computed client-side by TV, not by backend; free for non-commercial use (apply at tradingview.com) |
| Chart library (fallback) | TradingView Lightweight Charts | Open source (MIT); used if Charting Library access denied; indicators computed by backend pandas-ta and sent as series |
| Chart data bridge | JS DataFeed adapter (IBasicDataFeed) | Frontend-only; translates TV data requests to StockPilot backend calls: getBars()→/historical, resolveSymbol()→/instruments, searchSymbols()→/instruments/search |

---

## 6. Docker Compose (Local Dev)

```yaml
services:
  api:
    build: ./backend
    ports: ["8000:8000"]
    environment:
      DATABASE_URL: sqlite+aiosqlite:///./dev.db
      # (all other env vars from .env)
    volumes:
      - ./backend:/app
    command: uvicorn app.main:app --reload --host 0.0.0.0

  # Production only:
  db:
    image: postgres:16-alpine
    volumes: [postgres_data:/var/lib/postgresql/data]

  nginx:
    image: nginx:alpine
    volumes: [./nginx/nginx.conf:/etc/nginx/nginx.conf]
    ports: ["443:443", "80:80"]
```
