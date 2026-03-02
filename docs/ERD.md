# Entity Relationship Diagram (ERD)
## StockPilot — Trading & Analysis Platform

**Version:** 4.0
**Date:** 2026-02-28
**Changes from v3.0:** Updated for multi-user support — removed single-user constraints from `users` table and updated design decisions. 7 tables unchanged.

---

## 1. ERD

```
┌──────────────────┐         ┌──────────────────┐
│      users       │         │  refresh_tokens  │
│──────────────────│1       *│──────────────────│
│ id (PK)          │─────────│ id (PK)          │
│ kite_user_id     │         │ user_id (FK)     │
│ username         │         │ token_hash       │
│ email            │         │ expires_at       │
│ kite_enc_tok     │         │ revoked          │
│ kite_tok_exp     │         │ created_at       │
│ exchange_members │         │ user_agent       │
│ product_types    │         │ ip_address       │
│ paper_trade_mode │         └──────────────────┘
│ created_at       │
│ last_login_at    │
│ is_active        │
└──────┬───────────┘
       │ 1
       ├──────────────────────────────────────┬──────────────────┐
       │ 1:many                               │ 1:many           │ 1:many
       ▼                                     ▼                 ▼
┌──────────────────────┐   ┌──────────────────────┐  ┌──────────────────────┐
│     audit_logs       │   │        kpis          │  │   chart_drawings     │
│──────────────────────│   │──────────────────────│  │──────────────────────│
│ id (PK)              │   │ id (PK)              │  │ id (PK)              │
│ user_id (FK)         │   │ user_id (FK)         │  │ user_id (FK)         │
│ action_type          │   │ name                 │  │ instrument_token     │
│ tradingsymbol        │   │ formula              │  │ tradingsymbol        │
│ exchange             │   │ return_type          │  │ exchange             │
│ order_params (JSONB) │   │ description          │  │ interval             │
│ kite_order_id        │   │ is_active            │  │ drawing_type         │
│ kite_gtt_id          │   │ display_order        │  │ drawing_data (JSONB) │
│ outcome              │   │ created_at           │  │ label                │
│ error_message        │   │ updated_at           │  │ created_at           │
│ created_at           │   └──────────────────────┘  │ updated_at           │
│ request_id           │                             └──────────────────────┘
└──────────────────────┘


──────── Standalone tables (not user-scoped; global market data) ────────

┌──────────────────────────┐     ┌──────────────────────────────────┐
│       ohlcv_cache        │     │        fundamental_cache         │
│──────────────────────────│     │──────────────────────────────────│
│ id (PK, BIGINT)          │     │ instrument_token (PK)            │
│ instrument_token         │     │ tradingsymbol                    │
│ tradingsymbol            │     │ exchange                         │
│ exchange                 │     │ isin                             │
│ interval                 │     │ pe_ratio                         │
│ candle_timestamp         │     │ eps                              │
│ open                     │     │ book_value                       │
│ high                     │     │ face_value                       │
│ low                      │     │ week_52_high                     │
│ close                    │     │ week_52_low                      │
│ volume                   │     │ fetched_at                       │
│ fetched_at               │     │ data_date                        │
└──────────────────────────┘     └──────────────────────────────────┘
UNIQUE: (instrument_token,        Refreshed weekly from NSE India.
         interval,                Used by KPIService for P/E, EPS.
         candle_timestamp)
```

---

## 2. What is NOT in the Database (and Why)

| Data | Lives In | Reason |
|------|----------|--------|
| Holdings, Positions, Orders, Margins | Kite API (live) | Always real-time; caching frontend-side with 30–60s TTL |
| KPI computed values | Frontend IndexedDB | Derived from ohlcv_cache; cheap to recompute per session |
| Computed indicator series for active chart | Frontend IndexedDB | Discarded on instrument/interval change; not worth persisting |
| Chart UI state (zoom, indicators) | Frontend localStorage | Per-browser preference; no cross-device need |
| User preferences (theme, defaults, column order) | Frontend localStorage | Standard browser preference pattern |

---

## 3. Relationship Summary

| From | To | Cardinality | Description |
|------|----|-------------|-------------|
| users | refresh_tokens | 1:many | Multiple active sessions allowed |
| users | audit_logs | 1:many | All trade actions logged |
| users | kpis | 1:many | User's KPI formula library |
| users | chart_drawings | 1:many | User's chart annotations |
| ohlcv_cache | — | standalone | Global OHLCV cache (not user-scoped) |
| fundamental_cache | — | standalone | Global fundamental data cache (not user-scoped) |

---

## 4. Key Design Decisions

1. **No `kpi_values` table** — KPI values are derived from `ohlcv_cache`. The compute time is ~50ms per instrument with pandas-ta. Frontend requests them on demand and caches in IndexedDB for the session. No persistent storage needed.

2. **`ohlcv_cache` is not user-scoped** — Market data is global and shared across all users. Fetching the same candle for INFY once serves all users who hold it.

3. **Audit logs are append-only** — Enforced at application layer; no UPDATE or DELETE operations on this table.

4. **`fundamental_cache` uses `instrument_token` as primary key** — One row per instrument; the entire row is replaced on each weekly refresh from NSE India. No surrogate key needed.

5. **No strategies or backtest tables** — Strategy building and backtesting are out of scope for this version.
