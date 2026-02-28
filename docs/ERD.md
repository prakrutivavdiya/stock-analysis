# Entity Relationship Diagram (ERD)
## StockPilot — Personal Trading & Analysis Platform

**Version:** 2.1
**Date:** 2026-02-28
**Changes from v2:** Added `fundamental_cache`. Removed live execution tables (`strategy_runs`, `strategy_run_signals`). 10 tables total.

---

## 1. ERD

```
┌──────────────┐         ┌──────────────────┐
│    users     │         │  refresh_tokens  │
│──────────────│1       *│──────────────────│
│ id (PK)      │─────────│ id (PK)          │
│ kite_user_id │         │ user_id (FK)     │
│ username     │         │ token_hash       │
│ email        │         │ expires_at       │
│ kite_enc_tok │         │ revoked          │
│ kite_tok_exp │         │ created_at       │
│ created_at   │         │ user_agent       │
│ last_login   │         │ ip_address       │
└──────┬───────┘         └──────────────────┘
       │ 1
       ├─────────────────────────────────────┬─────────────────┐
       │ 1:many                              │ 1:many          │ 1:many
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
       ┌─────────────────────────────────────────────────────────────┐
       │                      strategies                              │
       │─────────────────────────────────────────────────────────────│
       │ id (PK)                          user_id (FK) ──→ users     │
       │ name                                                         │
       │ description                                                  │
       │ version                                                      │
       │ is_active                                                    │
       │ position_sizing_type                                         │
       │ position_sizing_value                                        │
       │ stop_loss_pct                                                │
       │ target_pct                                                   │
       │ entry_conditions  ← JSONB (conditions embedded, no join)    │
       │ exit_conditions   ← JSONB (conditions embedded, no join)    │
       │ created_at                                                   │
       │ updated_at                                                   │
       └──────────────────────┬───────────────────────────────────────┘
                              │ 1
                              │ 1:many
                              ▼
       ┌────────────────────────────┐
       │        backtest_runs       │
       │────────────────────────────│
       │ id (PK)                    │
       │ strategy_id (FK)           │
       │ instrument_token           │
       │ tradingsymbol              │
       │ exchange                   │
       │ interval                   │
       │ from_date                  │
       │ to_date                    │
       │ initial_capital            │
       │ final_capital              │
       │ total_return_pct           │
       │ cagr                       │
       │ max_drawdown               │
       │ sharpe_ratio               │
       │ win_rate                   │
       │ total_trades               │
       │ status                     │
       │ run_at                     │
       │ completed_at               │
       └───────────┬────────────────┘
                   │ 1
                   │ 1:many
                   ▼
       ┌────────────────────────────┐
       │      backtest_trades       │  ← trade log only; equity curve
       │────────────────────────────│    computed client-side from this
       │ id (PK)                    │
       │ backtest_run_id (FK)       │
       │ entry_timestamp            │
       │ entry_price                │
       │ exit_timestamp             │
       │ exit_price                 │
       │ quantity                   │
       │ direction                  │
       │ pnl                        │
       │ pnl_pct                    │
       │ exit_reason                │
       └────────────────────────────┘

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
| Backtest equity curve | Frontend (computed) | Pure chart data; derived from `backtest_trades` returned by API |
| Chart UI state (zoom, indicators) | Frontend localStorage | Per-browser preference; no cross-device need |
| User preferences (theme, defaults) | Frontend localStorage | Standard browser preference pattern |

---

## 3. Relationship Summary

| From | To | Cardinality | Description |
|------|----|-------------|-------------|
| users | refresh_tokens | 1:many | Multiple active sessions allowed |
| users | audit_logs | 1:many | All trade actions logged |
| users | kpis | 1:many | User's KPI formula library |
| users | strategies | 1:many | User's strategy library |
| users | chart_drawings | 1:many | User's chart annotations |
| strategies | backtest_runs | 1:many | Strategy backtested multiple times |
| backtest_runs | backtest_trades | 1:many | Each run produces a trade log |
| ohlcv_cache | — | standalone | Global OHLCV cache (not user-scoped) |
| fundamental_cache | — | standalone | Global fundamental data cache (not user-scoped) |

---

## 4. Key Design Decisions

1. **Conditions inside strategies (JSONB)** — There are at most 5–10 conditions per strategy. A separate `strategy_conditions` table adds a join with zero benefit at this scale. JSONB is indexed in PostgreSQL and perfectly queryable.

2. **No `kpi_values` table** — KPI values are derived from `ohlcv_cache`. The compute time is ~50ms per instrument with pandas-ta. Frontend requests them on demand and caches in IndexedDB for the session. No persistent storage needed.

3. **No `backtest_equity_curve` table** — Equity curve is a visualisation artifact derived from `backtest_trades` by accumulating portfolio value over time. This is a 5-line computation the frontend does after receiving the trade log. The `backtest_trades` table (the source data) is persisted; the curve is not.

4. **`ohlcv_cache` is not user-scoped** — Single-user app. Market data is global.

5. **Audit logs are append-only** — Enforced at application layer; no UPDATE or DELETE operations on this table.

6. **`fundamental_cache` is keyed by `instrument_token`** — One row per instrument; the entire row is replaced on each weekly refresh from NSE India.
