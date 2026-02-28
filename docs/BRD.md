# Business Requirements Document (BRD)
## StockPilot — Personal Trading & Analysis Platform

**Version:** 2.0
**Date:** 2026-02-27
**Owner:** Prakruti Vavdiya
**Status:** Draft for Review

---

## 1. Business Context

### 1.1 Problem Statement
Managing a personal equity portfolio across 18+ stocks on Zerodha's Kite platform lacks depth for serious analysis. Kite provides execution and basic charts, but offers no:
- Ability to define and track custom KPIs across the portfolio
- Persistent chart annotations that survive sessions
- Strategy creation and backtesting environment
- Consolidated view of portfolio performance with custom metrics

The result is that investment decisions are made using fragmented tools (Kite charts, external screeners, spreadsheets), which is inefficient, error-prone, and disconnected from actual portfolio data.

### 1.2 Business Opportunity
A personal, self-hosted trading cockpit directly connected to the live Zerodha account — combining portfolio monitoring, historical analysis, strategy research, and trade execution in one place — removes friction from the investment workflow and enables more disciplined, data-driven decision making.

### 1.3 Scope of Business
- **Who:** Prakruti Vavdiya, individual retail investor
- **Broker:** Zerodha (Kite API)
- **Market:** NSE + BSE equity (CNC, MIS, NRML)
- **Not in scope:** F&O, commodities, mutual fund transactions

---

## 2. Business Objectives

| ID | Objective | Measurable Outcome |
|----|-----------|-------------------|
| BO-01 | Reduce time to assess portfolio health each morning | Dashboard load in < 3 seconds with all D-1 data ready |
| BO-02 | Enable systematic strategy evaluation before deploying capital | At least one backtest run before every new position |
| BO-03 | Maintain a persistent visual analysis layer on top of price charts | Chart drawings survive browser refreshes and device switches |
| BO-04 | Eliminate manual spreadsheet tracking of KPIs | All KPIs computed automatically on D-1 data and visible in portfolio table |
| BO-05 | Ensure all trades executed via StockPilot have a complete audit trail | 100% of placed/modified/cancelled orders logged in audit table |
| BO-06 | Protect account from unauthorised access | Zero unauthorised logins (enforced by Kite OAuth + single-user allowlist) |

---

## 3. Stakeholders

| Stakeholder | Role | Interests |
|-------------|------|-----------|
| Prakruti Vavdiya | Owner, sole user, developer | Full feature access; security; reliability during market hours |
| Zerodha (Kite API) | Data & execution provider | API usage within rate limits; no TOS violation |
| SEBI (indirect) | Regulator | User is a retail investor; no algorithmic trading licence required for personal use |

---

## 4. Business Rules

These are non-negotiable constraints derived from market, regulatory, and broker requirements.

### 4.1 Market Hours & Trading Days

| Rule ID | Rule |
|---------|------|
| BR-MH-01 | Equity market hours: 09:15 IST to 15:30 IST, Monday–Friday |
| BR-MH-02 | Pre-open session: 09:00–09:15 IST (AMO orders only) |
| BR-MH-03 | No trading on NSE/BSE holidays (national holidays + exchange-declared holidays) |
| BR-MH-04 | The system must recognise trading days vs. non-trading days for D-1 logic (e.g., Monday D-1 = Friday) |
| BR-MH-05 | Intraday positions (MIS/BO/CO) must be squared off by 15:20 IST — the system shall display a warning when open intraday positions exist after 15:00 IST |

### 4.2 Product Types

| Product | Full Name | Rule |
|---------|-----------|------|
| CNC | Cash and Carry | Delivery equity. No intraday auto-square-off. Requires full margin. Settlement T+1. |
| MIS | Margin Intraday Square-off | Intraday only. Auto-squared off by Kite at 15:20 IST if not closed. Uses MIS margin. |
| NRML | Normal | Used for F&O carry-forward positions. Requires SPAN + exposure margin. |

**BR-PR-01:** StockPilot shall only display MIS square-off warning for MIS positions. CNC positions carry forward automatically.
**BR-PR-02:** Default product type for the order form shall be CNC (as the account is primarily delivery-based).

### 4.3 Order Types

| Order Type | When Allowed | Business Rule |
|-----------|-------------|---------------|
| MARKET | During market hours | Executes at best available price. Not allowed during pre-open. |
| LIMIT | Anytime (AMO outside hours) | Executes only at specified price or better. |
| SL (Stop-Loss Limit) | During market hours | Trigger price activates a LIMIT order. Both trigger and limit price required. |
| SL-M (Stop-Loss Market) | During market hours | Trigger price activates a MARKET order. Only trigger price required. |

**BR-OT-01:** The order form shall validate that `trigger_price < limit_price` for BUY SL orders, and `trigger_price > limit_price` for SELL SL orders.
**BR-OT-02:** MARKET orders shall display a warning: "Market orders execute at the best available price and may result in slippage."
**BR-OT-03:** After-Market Orders (AMO) are placed with `variety = amo` and are valid for placement outside market hours. StockPilot shall default to AMO variety when the current time is outside market hours.

### 4.4 Order Validity

| Validity | Meaning | Business Rule |
|----------|---------|---------------|
| DAY | Valid for the current trading day only | Default for all regular orders |
| IOC | Immediate or Cancel | Executes immediately, remainder cancelled |
| TTL | Time To Live (minutes) | Valid for specified number of minutes |

**BR-OV-01:** Default validity is DAY for all orders.

### 4.5 GTT (Good Till Triggered) Orders

| Rule ID | Rule |
|---------|------|
| BR-GTT-01 | GTT orders are not regular orders — they are triggers that create orders when price is reached |
| BR-GTT-02 | Single-leg GTT: one trigger price (e.g., buy at ₹1200 if INFY falls to ₹1200) |
| BR-GTT-03 | Two-leg GTT: upper trigger (target) + lower trigger (stop-loss) — common for existing positions |
| BR-GTT-04 | GTT orders expire after 1 year or upon trigger, whichever is earlier |
| BR-GTT-05 | GTT triggers are checked by Zerodha's servers — no need for StockPilot to be running |
| BR-GTT-06 | `last_price` must be provided when creating/modifying a GTT — it is used by Kite to validate the trigger is sensible |

### 4.6 Settlement & Holdings

| Rule ID | Rule |
|---------|------|
| BR-SE-01 | Equity settlement in India is T+1 (buy today, shares credited next trading day) |
| BR-SE-02 | Shares bought today (T1 quantity) are not available for CNC sell until T+1 |
| BR-SE-03 | StockPilot shall display `t1_quantity` separately in holdings to avoid confusion about sellable quantity |
| BR-SE-04 | `authorised_quantity = realised_quantity + t1_quantity` — the quantity available for placing sell orders |

### 4.7 Charges & Brokerage (Informational — display only)

| Charge | Rule |
|--------|------|
| Brokerage (CNC) | ₹0 (Zerodha charges zero brokerage on CNC delivery equity) |
| Brokerage (MIS/NRML) | 0.03% or ₹20 per order, whichever is lower |
| STT (Buy CNC) | 0.1% of trade value |
| STT (Sell CNC) | 0.1% of trade value |
| STT (MIS sell) | 0.025% of sell-side value |
| Exchange charges | ~0.00345% NSE / ~0.00375% BSE |
| GST | 18% on brokerage + exchange charges |
| SEBI charges | ₹10 per crore |
| Stamp duty | 0.015% on buy-side |

**BR-CH-01:** StockPilot shall show an estimated charges breakdown in the order confirmation dialog before placement.
**BR-CH-02:** Charges are estimates only — actual charges are determined by Zerodha post-execution.

### 4.8 Risk Rules (Application-Level)

| Rule ID | Rule |
|---------|------|
| BR-RK-01 | StockPilot shall warn if a single order value exceeds 20% of available margin |
| BR-RK-02 | StockPilot shall warn if placing a sell order for more than the authorised (sellable) quantity |
| BR-RK-03 | No order shall be placed without an explicit confirmation step (confirmation modal) |
| BR-RK-04 | Paper trade mode: when enabled, orders are simulated locally and never sent to Kite |

### 4.9 Historical Data Constraints (Kite API Limits)

| Rule ID | Rule |
|---------|------|
| BR-HD-01 | Intraday candles (5m, 15m, 30m, 1hr): available for the last 60 days only via Kite API |
| BR-HD-02 | Daily candles: available for up to approximately 3 years |
| BR-HD-03 | Kite API rate limit for historical data: 3 requests per second |
| BR-HD-04 | Maximum date range per API call: 60 days for intraday; no hard limit for daily |
| BR-HD-05 | StockPilot shall never attempt to fetch intraday data older than 60 days from Kite |
| BR-HD-06 | Historical data requests outside market hours are fine; inside market hours, today's candles are partial and must be flagged as live/incomplete |

### 4.10 Backtesting Business Rules

| Rule ID | Rule |
|---------|------|
| BR-BT-01 | Backtest simulations assume trades execute at the **open price of the next candle** after a signal (to avoid look-ahead bias) |
| BR-BT-02 | Brokerage is assumed at ₹0 for CNC backtests (Zerodha CNC is zero brokerage) |
| BR-BT-03 | Slippage is not modelled in v1 |
| BR-BT-04 | Backtests shall not allow `from_date = to_date` (minimum 2 candles required) |
| BR-BT-05 | A backtest requires a minimum of 50 candles in the date range to produce meaningful results; a warning is shown if fewer |
| BR-BT-06 | Only one open position is held at a time per strategy per instrument (no pyramiding in v1) |

### 4.11 KPI Business Rules

| Rule ID | Rule |
|---------|------|
| BR-KP-01 | KPI formulas may only reference supported functions — arbitrary code expressions are rejected at parse time |
| BR-KP-02 | Supported technical functions: full pandas-ta indicator library (SMA, EMA, RSI, MACD, Bollinger Bands, ATR, VWAP, Stochastic, etc.) and price fields: `CLOSE`, `OPEN`, `HIGH`, `LOW`, `VOLUME` |
| BR-KP-03 | Pre-built default KPIs: daily RSI, P/E Ratio, EPS, % change from 52-week high, % change from 52-week low, Bollinger Band Position Signal |
| BR-KP-04 | KPI values are computed using the live price when the market is open; D-1 data is used when the market is closed or live data is unavailable |
| BR-KP-05 | KPI return types: `SCALAR` (numeric), `BOOLEAN` (true/false), `CATEGORICAL` (descriptive label) |
| BR-KP-06 | Boolean KPIs use a comparison operator: `>`, `<`, `>=`, `<=`, `==` |
| BR-KP-07 | Bollinger Band Position Signal logic: price above upper band or within 5% of upper band height from above → "Sell Signal"; price below lower band or within 5% of lower band height from below → "Buy Signal"; otherwise → "Hold" |
| BR-KP-08 | 52-week high and low are computed from the OHLCV cache (last 252 trading day daily candles). If fewer than 252 candles are available, the available range is used with a data-coverage warning displayed |
| BR-KP-09 | P/E Ratio and EPS are sourced from the fundamental data cache (refreshed weekly from NSE India). If data is unavailable, the column displays "N/A" |
| BR-KP-10 | A minimum of 2× the longest indicator period is required in historical data for a valid result (e.g., EMA(200) requires at least 400 daily candles) |

### 4.12 Fundamental Data Rules (P/E, EPS)

| Rule ID | Rule |
|---------|------|
| BR-FD-01 | Fundamental data (P/E ratio, EPS) is sourced from NSE India's public data endpoints |
| BR-FD-02 | Fundamental data is cached locally in the `fundamental_cache` table and refreshed weekly every Sunday at 08:00 IST |
| BR-FD-03 | P/E Ratio = Market Price / EPS; the system stores both raw EPS and pre-computed P/E |
| BR-FD-04 | If the NSE data fetch fails, the last cached value is used with a staleness indicator |
| BR-FD-05 | Fundamental data is a soft dependency — all other app features function normally if fundamental data is unavailable |

---

## 5. Business Process Flows

### 5.1 Morning Routine (Primary Use Case)
```
Market opens at 09:15 IST
    │
    ├─ 09:20 IST — Scheduled job fetches D-1 daily candle for all 18 holdings
    ├─ 09:25 IST — Scheduled job recomputes all active KPIs for all holdings
    │
User opens StockPilot
    │
    ├─ Dashboard loads: portfolio summary (live holdings from Kite) + D-1 KPI values
    ├─ User scans KPI columns for signals (e.g., RSI Overbought, MACD Bullish)
    ├─ User clicks a stock → opens chart view with D-1 data pre-loaded
    ├─ User reviews chart with saved drawings + overlays new indicators
    ├─ User decides to act → opens order form → reviews estimated charges → confirms
    └─ Order placed via Kite → audit log written → orders view refreshes
```

### 5.2 Strategy Research Flow
```
User wants to test a new strategy idea
    │
    ├─ Open Strategy Builder → create new strategy with entry/exit conditions
    ├─ Open Backtesting → select strategy, instrument, date range, capital
    ├─ System fetches OHLCV from cache (or Kite if not cached)
    ├─ Backtest runs → returns summary metrics + trade log
    ├─ Frontend renders equity curve from trade log
    ├─ User evaluates: Is CAGR > 15%? Is drawdown < 15%? Is win rate > 50%?
    ├─ If yes → mark strategy as active for monitoring
    └─ If no → edit strategy (creates new version) → backtest again
```

### 5.3 GTT Setup Flow (Passive Order Management)
```
User holds LT (bought at ₹3433, current ₹4298)
    │
    ├─ User wants: sell if price drops to ₹4000 (stop loss)
    ├─ User creates two-leg GTT:
    │     Lower trigger: ₹4000 → SELL limit ₹3990 (stop loss)
    │     Upper trigger: ₹4700 → SELL limit ₹4690 (target)
    ├─ GTT created via Kite → Kite monitors 24/7 regardless of StockPilot state
    └─ Audit log written
```

---

## 6. Business Constraints

| ID | Constraint |
|----|-----------|
| BC-01 | StockPilot must comply with Zerodha Kite Connect API Terms of Service |
| BC-02 | Kite API session tokens expire daily — user must re-authenticate once per day |
| BC-03 | Historical intraday data is limited to the last 60 days by Kite API |
| BC-04 | Maximum 3 Kite API requests per second for historical data |
| BC-05 | Only one Kite API key (personal use) — no production API key for third parties |
| BC-06 | The application must be self-hosted (Zerodha does not permit SaaS redistribution of Kite API data to multiple end-users) |
| BC-07 | SEBI regulations: individual retail investors may use strategy signals as research/alerts on their own accounts without SEBI algo registration; all orders must be placed manually |
| BC-08 | NSE India fundamental data is sourced from public endpoints — no commercial licence required for personal use, but availability is not guaranteed |

---

## 7. Business Assumptions

| ID | Assumption |
|----|-----------|
| BA-01 | The user will always authenticate once per trading day (Kite token expires daily) |
| BA-02 | The application runs on a local machine accessible only by the user — no internet-exposed deployment |
| BA-03 | Backtesting results are indicative only and do not guarantee future performance |
| BA-04 | Market data from Kite is accurate; StockPilot does not independently validate prices |
| BA-05 | NSE/BSE holiday calendar is maintained as a static list and updated manually at start of each year |
| BA-06 | The user understands that CNC brokerage is zero at Zerodha but all other charges (STT, GST, etc.) still apply |
| BA-07 | No concurrent users — all rate limits and resource constraints are designed for one user |

---

## 8. Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Morning dashboard load time | < 3 seconds (D-1 data pre-fetched) | Browser DevTools / APM |
| KPI computation time for full portfolio | < 5 seconds for 18 stocks | API response time log |
| Backtest run time (daily candles, 2 years) | < 10 seconds | `completed_at - run_at` in backtest_runs |
| Order placement success rate | > 99% (excluding Kite rejections) | audit_logs outcome = SUCCESS rate |
| Zero unauthorised access events | 0 | Auth logs |
| Data freshness on dashboard open | D-1 data available by 09:25 IST | Scheduler job logs |

---

## 9. Out of Scope (Business Level)

| Item | Reason |
|------|--------|
| Providing algo trading services to other users | Out of scope — this app is for personal use only on the owner's own account |
| Options / F&O strategy and execution | Different margin rules, Greeks, expiry logic — v2 |
| Multi-broker support | Business scope is Zerodha only |
| Tax computation (P&L statement) | Zerodha provides this via Console; out of scope |
| Social / shared strategies | Single-user app; no sharing capability |
| Mobile native app | Web app is sufficient for the use case |
| Real-time WebSocket price feed | Kite WebSocket requires a separate streaming connection; v2 consideration |
| Mutual fund SIP / lumpsum execution | MF execution has different API and business rules |

---

## 10. Business Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Zerodha changes Kite API pricing or terms | Low | High | Monitor Zerodha developer announcements; app is personal use so risk is low |
| Kite session expires mid-trading-day | Medium | Medium | Session health check every 30 min; graceful re-auth prompt |
| Wrong order placed due to UI error | Low | High | Order confirmation modal; paper trade mode; audit log |
| Historical data gap (Kite doesn't have data for a period) | Low | Medium | Handle gracefully; show "data unavailable" for missing ranges |
| Backtest overfitting leads to poor live performance | High | Medium | This is inherent to backtesting — documented as a known limitation |
| Database corruption on local machine | Low | High | Regular DB backup reminder; WAL mode on SQLite |
| NSE India fundamental data endpoint changes or becomes unavailable | Medium | Low | App continues to function; KPIs dependent on P/E and EPS display "N/A"; monitor and update fetch logic as needed |
