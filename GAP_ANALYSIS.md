# StockPilot — Gap Analysis
> PRD v5.1 · USER_STORIES v5.0 · API_SPEC v6.0 · Updated 2026-03-16

---

## Status Summary

| Phase | Status |
|-------|--------|
| Phase 1 — Test coverage (backend + frontend) | ✅ Closed |
| Phase 2 — User-facing feature gaps | ✅ Closed |
| Phase 3 — Kite parity + infra | 3 open (P2) |
| New gaps identified this review | 6 open (2 P2 · 4 P3) |

---

## P2 — High Impact

### Feature Gaps

| ID | PRD Ref | Gap | Detail | File(s) |
|----|---------|-----|--------|---------|
| PD-09-SYNC | PD-09 | Column prefs not synced to backend | PRD PD-09 explicitly requires `visible_holdings_columns` and `holdings_sort` to be persisted via `GET/PUT /user/preferences` so they survive across devices/browsers. Backend endpoints exist (`routers/` preferences router confirmed) but frontend reads/writes these two fields to `localStorage` only via `localPrefs.*`. On a second device or fresh browser the user's column layout is lost. | `frontend/src/app/pages/Dashboard.tsx`, `frontend/src/app/data/localPrefs.ts` |
| CH-06-SIDEBAR | CH-06 | Charts page has no instrument sidebar | PRD CH-06 requires a left sidebar listing the user's held instruments with a live search/filter box so the user can click to switch charts without leaving the page. Currently the Charts page has no such sidebar — the user must navigate away or use the topbar search. | `frontend/src/app/pages/Charts.tsx` |
| CH-DRAWINGS | CH-03, CH-04 | Drawing tools not rendered on chart | Backend has full drawings CRUD (5 endpoints: GET/POST/PUT/DELETE per token+interval). PRD requires horizontal lines, trendlines, rectangles, and text annotations rendered via Lightweight Charts v5. The frontend Charts.tsx renders OHLCV + indicator series only — no drawing tool UI, no load/save of existing drawings from the API. | `frontend/src/app/pages/Charts.tsx` |
| KITE-LOT-SIZE | TR-02 | No lot-size validation for F&O | Frontend allows any integer quantity. F&O instruments have a fixed `lot_size` (e.g. NIFTY = 25); Kite rejects orders where `qty % lot_size ≠ 0`. `InstrumentResult.lot_size` is now available via `selectedInstrument` state (added in instrument-search PR) — validation logic just needs to be added. | `frontend/src/app/pages/Orders.tsx` |
| KITE-TICK-SIZE | TR-01 | Tick-size validation hardcoded to ₹0.05 | `tickSizeError` (Orders.tsx:376-391) checks price is a multiple of ₹0.05 for NSE/BSE equity — correct for most equities but wrong for F&O instruments (e.g. NIFTY tick is ₹0.05, Bank NIFTY tick is ₹0.05, but individual futures may differ). Should use `selectedInstrument.tick_size` (now available) instead of hardcoded constant. | `frontend/src/app/pages/Orders.tsx` |
| KITE-MARGIN-REQ | TR-14, TR-15 | SPAN/exposure margin not fetched pre-order | Estimated brokerage charges are shown ✅. But the SPAN + exposure margin *required* for the specific trade (especially for F&O/MIS) is not fetched or displayed before the confirmation dialog. Kite provides `GET /margins/orders` for this. | `frontend/src/app/pages/Orders.tsx`, `backend/routers/orders.py` |
| SCHED-KPI | PRD §6.1, §9 | No scheduled KPI recompute job | PRD §6.1 shows a 09:25 IST job: "Scheduled job recomputes all active KPIs for all users' holdings." PRD §9 lists "KPI recompute at market open" in APScheduler. The backend `scheduler.py` has 3 jobs (instruments reload Mon–Fri 08:30, D-1 OHLCV fetch Mon–Fri 09:20, fundamentals refresh Sun 08:00) — the KPI recompute job is missing. Dashboard KPI values are therefore only refreshed on-demand (user page load), not automatically at market open. | `backend/scheduler.py` |

---

## P3 — Nice-to-Have

| ID | PRD Ref | Gap | Detail |
|----|---------|-----|--------|
| CH-08-RIGHTCLICK | CH-08 | Right-click chart menu | PRD CH-08 requires a context menu on right-click with "Buy at price" / "Sell at price" actions that pre-fill the order form. Deferred previously (L-03). Lightweight Charts v5 supports custom context menus; backend and order pre-fill plumbing already exists. |
| WL-REORDER | API-SPEC | Watchlist item drag reorder not wired | Backend has `PATCH /watchlist/{wl_id}/items/reorder` endpoint that persists display_order. The frontend `WatchlistPanel.tsx` shows items in order but has no drag-to-reorder UI. The endpoint is never called from the frontend. |
| BASKET-ORDERS | — | Bracket/basket order UI | Kite supports bracket orders (BUY + SL + target in one submit). Not in PRD v5.1 but frequently requested by active traders. |
| HOLIDAY-CAL | PRD §5.1 | Exchange holiday awareness | PRD §5.1 notes D-1 must resolve correctly across holidays (e.g. Monday's D-1 is Friday). No NSE/BSE holiday calendar is integrated. Charts show blank candles on holidays with no explanation. The `isNseMarketOpen()` helper in Orders.tsx only checks weekdays + time window — it does not account for declared exchange holidays. |
| SWAGGER | NFR | OpenAPI docs not exposed | FastAPI auto-generates `/docs` (Swagger UI) for free. Currently disabled in production config. Useful for debugging and integration testing. |
| DOCKER | PRD §9 | No Docker Compose for self-hosting | PRD §9 lists "Docker + Docker Compose" as the containerization target for local self-hosting on macOS. No `docker-compose.yml` exists in the repo. |
| ALEMBIC | PRD §9 | No Alembic migration setup | PRD §9 lists "SQLAlchemy 2.0 async + Alembic (migrations)" as the ORM stack. Alembic is not configured; schema changes require manual DB recreation. |

---

## Recently Closed (since 2026-03-11)

| ID | What was closed |
|----|-----------------|
| ORDER-ANY-INSTRUMENT | Orders page (equity + GTT) previously restricted symbol selection to held stocks only. Replaced both `<select>` dropdowns with `InstrumentSearch` component + holdings quick-pick chips. Any NSE/BSE/F&O instrument can now be ordered. `gttExchange` and `gttLastPrice` state added to support non-held GTT instruments. `InstrumentSearch` gained a `className` prop for full-width layout. |

---

## Resolution Order (Phase 3+)

```
Immediate P2 (user-visible correctness)
  1. CH-06-SIDEBAR   — instruments sidebar in Charts
  2. CH-DRAWINGS     — draw tools + load/save via backend CRUD
  3. SCHED-KPI       — add 09:25 IST KPI recompute APScheduler job
  4. PD-09-SYNC      — wire frontend column prefs to GET/PUT /user/preferences

Kite Parity P2
  5. KITE-LOT-SIZE   — validate qty % selectedInstrument.lot_size === 0 (data now available)
  6. KITE-TICK-SIZE  — use selectedInstrument.tick_size instead of hardcoded 0.05
  7. KITE-MARGIN-REQ — call Kite /margins/orders in pre-order confirmation

Nice-to-have P3
  8. CH-08-RIGHTCLICK
  9. WL-REORDER
  10. HOLIDAY-CAL
  11. DOCKER / ALEMBIC / SWAGGER
```

---

*Last updated: 2026-03-16*
