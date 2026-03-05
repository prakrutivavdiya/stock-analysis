# StockPilot — ASCII Wireframes

ASCII wireframes for all pages of the StockPilot trading platform.
These serve as the visual specification for the React + TypeScript frontend.

---

## Index

| File | Route | Description |
|------|-------|-------------|
| [00_app_shell.txt](00_app_shell.txt) | (all pages) | Global layout: topbar, sidebar (collapsed/expanded), notification toasts, responsive rules |
| [01_login.txt](01_login.txt) | `/login` | Full-screen login card, Kite OAuth flow, error states (cancelled / wrong account / session expired) |
| [02_dashboard.txt](02_dashboard.txt) | `/dashboard` | Portfolio summary cards, holdings table with KPI columns, column picker, intraday positions |
| [03_chart.txt](03_chart.txt) | `/charts` | TradingView Charting Library embed with built-in drawing toolbar, indicator dialog, sub-panes; JS DataFeed adapter design; Lightweight Charts fallback layout |
| [04_kpi_builder.txt](04_kpi_builder.txt) | `/kpis` | KPI library list, formula editor with full reference, return types (SCALAR / BOOLEAN / CATEGORICAL), live preview |
| [05_orders.txt](05_orders.txt) | `/orders` | Place order form (all order types), review modal, today's orders table, GTT management |
| [06_audit_log.txt](06_audit_log.txt) | `/audit` | Filterable audit log, detail panel (order params JSON), success/failure states, CSV export |
| [07_settings.txt](07_settings.txt) | `/settings` | User profile card (name, Kite ID, email, exchanges, session status), Preferences panel (theme, intervals, notifications), Session management (JWT status, revoke all sessions), topbar user dropdown, Kite session expired banner |

---

## Design Notes

**Theme:** Dark (default). Color refs:
- Zerodha orange: `#FF6600` (primary CTA — Login button)
- Green: gains, success, BUY SIGNAL badges
- Red: losses, errors, SELL SIGNAL badges
- Grey: neutral, HOLD badges, disabled state

**Layout:**
- Sidebar: 56px collapsed (icons only) / 200px expanded (hover or pinned)
- Topbar: fixed height, market status indicator + scrolling ticker on Dashboard and Charts
- Content area: fills remaining width, max 1600px on very wide screens

**Tables:**
- All table column headers are clickable for sort
- Clicking a holdings row → navigates to Chart for that symbol
- P&L values: green for positive, red for negative

**KPI Column Types in Dashboard:**
- `SCALAR` → plain number
- `BOOLEAN` → green badge (true) or grey badge (false)
- `CATEGORICAL` → colour-coded badge (green BUY SIGNAL, red SELL SIGNAL, grey HOLD)
- `N/A` shown when data is unavailable for an instrument

**Order Flow:**
1. Fill form → click Review Order
2. Confirm modal shows full order summary
3. Click Confirm & Place → POST /orders
4. Toast notification on success or failure
5. Today's orders table refreshed

**Responsive:**
- Sidebar always collapsed on screen < 1024px
- Tables scroll horizontally on narrow viewport
- Charts minimum width: 640px
