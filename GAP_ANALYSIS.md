# StockPilot — Gap Analysis & Implementation Plan
> PRD v5.1 · USER_STORIES v5.0 · API_SPEC v6.0 · Updated 2026-04-03

---

## Status Summary

| Phase | Status |
|-------|--------|
| Phase 1 — Test coverage (backend + frontend) | ✅ Closed |
| Phase 2 — User-facing feature gaps | ✅ Closed |
| Phase 3 — Kite parity + infra | ✅ Closed — DOCKER and ALEMBIC both implemented |

All feature, Kite-parity, and infrastructure gaps are fully implemented.

---

## Recently Closed (2026-04-03)

### DOCKER
**PRD ref:** PRD §9
**Status:** ✅ Fully implemented

**What was created:**
- `backend/Dockerfile` — `python:3.12-slim`; installs `requirements.txt`; entrypoint runs Alembic then uvicorn
- `backend/entrypoint.sh` — runs `alembic upgrade head` then `uvicorn backend.main:app`
- `frontend/Dockerfile` — two-stage: `node:20-alpine` Vite build → `nginx:alpine` static serve
- `frontend/nginx.conf` — SPA fallback + `/api/` proxy → backend + `/ws/` WebSocket upgrade proxy
- `.dockerignore` (root) — excludes `.venv`, `__pycache__`, `*.pyc`, `node_modules`, `dist`, `.git`, secrets
- `frontend/.dockerignore` — excludes `node_modules`, `dist`, `.env*`
- `docker-compose.yml` updated — added `backend` (depends_on postgres healthcheck) and `frontend` (depends_on backend) services on shared `app` network

**Usage:** `docker compose up --build` — starts PostgreSQL, runs Alembic migrations, starts FastAPI on :8000, serves React on :80

---

### ALEMBIC
**PRD ref:** PRD §9
**Status:** ✅ Fully implemented — no action needed

**What exists (production-ready):**
- `backend/alembic.ini` — configured with `script_location = %(here)s/alembic`; DB URL sourced from `settings.DATABASE_URL` at runtime
- `backend/alembic/env.py` — async-aware (`async_engine_from_config` + `asyncio.run()`); imports `Base` from `backend.models` and URL from `backend.config`
- `backend/alembic/versions/0001_initial_schema.py` — comprehensive initial migration covering all 9 tables (users, refresh_tokens, audit_logs, ohlcv_cache, kpis, chart_drawings, fundamental_cache, watchlists, watchlist_items) with correct indexes, unique constraints, and `downgrade()`
- `alembic>=1.13.0` in `requirements.txt`

**Design decisions (correct):**
- Migrations are **CLI-driven** (`alembic upgrade head`), not auto-run on app startup
- `database.py` `create_all_tables()` is explicitly documented as "dev/testing only"
- Tests use `Base.metadata.create_all/drop_all` directly (bypasses Alembic — correct for test isolation)

**Usage:** `cd backend && alembic upgrade head` before first deploy or after new migration. Generate new: `alembic revision --autogenerate -m "description"`

---

## Recently Closed (2026-04-03)

| ID | What was closed |
|----|-----------------|
| ALEMBIC | Fully implemented: `backend/alembic.ini`, async `env.py` (imports Base + settings), `versions/0001_initial_schema.py` covering all 9 tables. CLI-driven (`alembic upgrade head`). `create_all_tables()` retained for dev/tests only. |
| KITE-MARGIN-REQ | `POST /orders/margins` endpoint added (`backend/routers/orders.py`) with `OrderMarginItem/Result/Response` schemas. Frontend: `fetchOrderMargins()` in `orders.ts`; async margin fetch in `handlePlaceOrder` before showing review dialog; SPAN + exposure + total displayed in confirmation modal. |
| BASKET-ORDERS | Backend: `"bo"` added to `variety` Literal; `squareoff/stoploss/trailing_stoploss` fields in `PlaceOrderRequest`; bracket validation in `place_order` handler. Frontend: `isBracket` toggle (equity+market-hours only), bracket fields UI, forces `product=MIS`+`orderType=LIMIT`, passes bracket kwargs to `placeOrder()`, shows in review dialog. |
| SCHED-KPI | `_job_recompute_kpis()` added to `backend/scheduler.py`; registered at Mon–Fri 09:25 IST via `CronTrigger`. Pre-warms OHLCV cache by running all KPI evaluations per active user post-open. |
| HOLIDAY-CAL | New `backend/holidays.py` module: static 2026 NSE holidays + `load_holidays_from_kite()` + `is_exchange_holiday()` + `prev_trading_day()`. Wired into `scheduler.py` (D-1 resolution), `kpis.py` (`_market_is_open()`), `main.py` (startup holiday load). Frontend `isNseMarketOpen()` in `Orders.tsx` checks `NSE_HOLIDAYS_2026` Set. |
| WL-REORDER | Native HTML5 drag-and-drop added to `WatchlistPanel.tsx`; `GripVertical` icon per row; optimistic reorder + rollback; calls already-implemented `reorderWatchlistItems()` API. |
| CH-08-RIGHTCLICK | DOM `contextmenu` listener in `Charts.tsx` reads `coordinateToPrice()`; context menu JSX with "Buy at ₹X" / "Sell at ₹X" buttons; navigates to `/orders?symbol=…&txType=…&price=…`. `Orders.tsx` extended to read these URL params and pre-fill the order form. |

## Recently Closed (since 2026-03-16)

| ID | What was closed |
|----|-----------------|
| SWAGGER | OpenAPI docs exposed at `/api/docs` (Swagger UI), `/api/redoc` (ReDoc), `/api/openapi.json`. Set explicitly in `main.py` via `docs_url`, `redoc_url`, `openapi_url`. |
| CHART-PREFS-PERSIST | Chart preferences (interval, chart_type, active_indicators) persisted per user in `users.ui_preferences` via `GET/PUT /user/preferences/chart` endpoints in `preferences.py`. |
| MA-EMA-SLOPE | `MA_SLOPE` and `EMA_SLOPE` KPI indicators added to `kpi_engine.py`. |
| TEST-COVERAGE-86 | Backend test coverage at 86%; 318 tests collected. Five new test files: `test_watchlist.py`, `test_ws.py`, `test_ticker.py`, `test_scheduler.py`, `test_preferences.py`. |

## Recently Closed (since 2026-03-11)

| ID | What was closed |
|----|-----------------|
| CH-DRAWINGS | Drawing tools (horizontal line, trendline, text annotation) in Charts.tsx. Persist per user per instrument+interval via backend CRUD. |
| KITE-LOT-SIZE | F&O lot-size validation in Orders.tsx using `selectedInstrument.lot_size`. |
| KITE-TICK-SIZE | Tick-size validation using `selectedInstrument.tick_size`; fallback to 0.05. |
| PD-09-SYNC | Dashboard calls `getPreferences()` on mount and `savePreferences()` on column/sort change. |
| CH-06-SIDEBAR | Charts page has holdings sidebar with live search/filter. |
| ORDER-ANY-INSTRUMENT | Orders page uses `InstrumentSearch` component; any NSE/BSE/F&O instrument can be ordered. |

---

*Last updated: 2026-04-03*
