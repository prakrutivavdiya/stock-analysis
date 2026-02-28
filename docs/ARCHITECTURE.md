# System Architecture
## StockPilot — Personal Trading & Analysis Platform

**Version:** 3.0
**Date:** 2026-02-28

---

## 1. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              USER BROWSER                                    │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                   React + TypeScript Frontend                        │   │
│  │                                                                      │   │
│  │  Dashboard │ Charts │ KPIs │ Strategies │ Backtest │ Trade │ Audit   │   │
│  │            (TradingView Lightweight Charts)                          │   │
│  │                                                                      │   │
│  │  ┌─────────────────────────┐  ┌────────────────────────────────┐    │   │
│  │  │  Frontend State Layer   │  │   Frontend Storage             │    │   │
│  │  │  (Zustand / React Query)│  │                                │    │   │
│  │  │                         │  │  IndexedDB (Dexie.js)          │    │   │
│  │  │  - API response caching │  │  - holdings (TTL 60s)          │    │   │
│  │  │  - Optimistic updates   │  │  - positions (TTL 60s)         │    │   │
│  │  │  - Equity curve compute │  │  - orders (TTL 30s)            │    │   │
│  │  │    from trade log       │  │  - kpi_values (daily)          │    │   │
│  │  │  - Indicator compute    │  │  - ohlcv_session (session)     │    │   │
│  │  │    for chart overlays   │  │  - indicator_values (session)  │    │   │
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
│            charts · strategies · backtests · orders · gtt · audit           │
│                                                                              │
│  ┌────────────────────────────┐   ┌──────────────────────────────────────┐  │
│  │      Service Layer         │   │         Kite API Client              │  │
│  │                            │   │  (kiteconnect SDK wrapper)           │  │
│  │  - AuthService             │   │                                      │  │
│  │  - PortfolioService        │   │  - Token decrypt on each call        │  │
│  │  - HistoricalService       │   │  - Rate limiter (3 req/sec bucket)   │  │
│  │  - KPIService              │   │  - Retry with exponential backoff    │  │
│  │  - IndicatorEngine         │   │  - Session expiry detection → 401    │  │
│  │  - StrategyService         │   └──────────────────────────────────────┘  │
│  │  - BacktestEngine          │                                              │
│  │  - OrderService            │   ┌──────────────────────────────────────┐  │
│  │                             │   │          Database Layer               │  │
│  │  - AuditService            │   │  SQLAlchemy 2.0 async + Alembic      │  │
│  │                            │   │                                      │  │
│  └────────────────────────────┘   │  PostgreSQL (prod) / SQLite (dev)    │  │
│                                   │                                      │  │
│  ┌─────────────────────────────┐  │  10 tables — see DATA_MODEL.md       │  │
│  │  APScheduler (background)   │  └──────────────────────────────────────┘  │
│  │  - D-1 fetch: 09:20 IST     │                                             │
│  │  - KPI recompute: 09:25 IST │                                             │
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
│ User auth state       │             │  ✓ users         │              │
│ JWT refresh tokens    │             │  ✓               │  Cookie only │
│ Audit log             │             │  ✓ append-only   │              │
│ KPI definitions       │             │  ✓ kpis          │              │
│ Fundamental data      │  NSE India  │  ✓ fund_cache    │              │
│ KPI computed values   │             │                  │  ✓ IDB daily │
│ Strategy definitions  │             │  ✓ strategies    │              │
│ Backtest summaries    │             │  ✓ backtest_runs │              │
│ Backtest trade log    │             │  ✓ backtest_trades│             │
│ Backtest equity curve │             │                  │  ✓ computed  │
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
│   │   ├── models/                ← SQLAlchemy ORM (10 models)
│   │   │   ├── user.py
│   │   │   ├── refresh_token.py
│   │   │   ├── audit_log.py
│   │   │   ├── ohlcv_cache.py
│   │   │   ├── fundamental_cache.py
│   │   │   ├── kpi.py
│   │   │   ├── strategy.py
│   │   │   ├── backtest_run.py
│   │   │   ├── backtest_trade.py
│   │   │   └── chart_drawing.py
│   │   │
│   │   ├── schemas/               ← Pydantic request/response models
│   │   │   ├── auth.py
│   │   │   ├── portfolio.py
│   │   │   ├── historical.py
│   │   │   ├── kpi.py
│   │   │   ├── strategy.py
│   │   │   ├── backtest.py
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
│   │   │   ├── strategies.py
│   │   │   ├── backtests.py
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
│   │   │   ├── strategy_service.py
│   │   │   ├── backtest_engine.py       ← event-driven simulation
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
│   │       └── equityCurve.ts     ← Compute equity curve from trade log
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

### 4.2 Backtest Run & Equity Curve
```
User runs backtest: EMA Crossover on INFY, daily, 2024-2025
  │
  POST /backtests → { backtest_run_id, status: "PENDING" }
  │
  Backend (async):
    ├─ Load OHLCV from ohlcv_cache (fetch missing ranges from Kite)
    ├─ Compute EMA(20), EMA(50) with pandas-ta
    ├─ Simulate trade-by-trade
    ├─ Store summary in backtest_runs
    ├─ Store each trade in backtest_trades
    └─ status → "COMPLETED"
  │
  Frontend polls: GET /backtests/{id} → status = COMPLETED + summary metrics
  Frontend fetches: GET /backtests/{id}/trades → trade log array
  │
  Frontend computes equity curve:
    equityCurve = computeEquityCurve(trades, initialCapital)
    ← 5-line accumulator, runs in <5ms
  │
  Render equity curve chart + trade markers
  Cache equity curve in IndexedDB backtest_equity for this session
```

### 4.3 Order Placement
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

## 5. Architectural Decisions (Revised)

| Decision | Choice | Reason |
|----------|--------|--------|
| Conditions storage | JSONB in `strategies` | Max 10 conditions per strategy; avoids unnecessary join |
| KPI values | Not persisted | Derived from ohlcv_cache (TA) or fundamental_cache (P/E, EPS) in ~50ms; frontend caches for session |
| KPI return types | SCALAR / BOOLEAN / CATEGORICAL | Three types needed to express numeric signals, flag signals, and descriptive labels (Buy/Sell/Hold) |
| Supported intervals | 5m, 15m, 30m, 1hr, day | Simplified from original 8 intervals; covers all practical use cases |
| Equity curve | Frontend computed | Derived from trade log in <5ms; no storage benefit |
| Holdings/Positions | Never persisted | Always real-time Kite data; frontend caches with short TTL |
| OHLCV data | Backend only | Too large for IndexedDB at scale; needed server-side for backtests |
| Backtest execution | Synchronous in process | Single user; no concurrent backtest pressure; keeps it simple |
| Frontend data lib | Dexie.js (IndexedDB) | Typed, promise-based, excellent TTL support |
| Chart library | TradingView Lightweight Charts | Professional; performant for 5000+ candles; drawing support |

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
