# Business Requirements Document (BRD)
## StockPilot — Trading & Analysis Platform

**Version:** 7.0
**Date:** 2026-03-01
**Owner:** Prakruti Vavdiya
**Status:** Draft for Review

---

## A. Market & Strategic Justification

### A.1 Market Gap

India's retail equity market is Zerodha-dominated (~8M+ active monthly traders). Zerodha's Kite platform is the industry standard for trade execution, but provides no analytical depth beyond basic charts and a static holdings view.

| Investor Need | Kite Status | Current Workaround |
|---------------|------------|-------------------|
| Personalised analytics and performance tracking on live portfolio data | Not available | Manual spreadsheets |
| Persistent visual analysis that survives between sessions | Not available | None — work is lost each session |
| Consolidated portfolio view with investor-defined performance metrics | Not available | Third-party read-only tools with no execution capability |
| Integrated analysis-to-execution workflow in a single place | Not available | Fragmented across 3–4 tools |

Active Zerodha investors today split their workflow across: execution (Kite), fundamentals research (Tickertape / Screener), manual metric tracking (spreadsheets), and charting (TradingView). StockPilot consolidates this into one connected platform.

### A.2 Competitive Positioning

| Platform | Price | Live Portfolio Data | Custom Analytics | Persistent Visual Analysis | Integrated Execution | Native Broker Link |
|----------|-------|:-------------------:|:----------------:|:--------------------------:|:--------------------:|:------------------:|
| **StockPilot** | ₹[X]/mo | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tijori Finance | ₹1,999/mo | Read-only | Pre-built only | ✗ | ✗ | Read-only |
| Tickertape | Free / ₹[X]/mo | Read-only | ✗ | ✗ | ✗ | Read-only |
| Screener.in | Free / ₹999/yr | ✗ | ✗ | ✗ | ✗ | ✗ |
| Zerodha Streak | ₹999–4,999/mo | ✗ | Algo rules only | ✗ | Algo only | ✓ |
| TradingView | Free / ₹[X]/mo | ✗ | ✗ | ✓ (not broker-linked) | ✗ | ✗ |

**Positioning statement:** StockPilot is the only platform that natively connects a live Zerodha portfolio, investor-defined analytics, persistent visual analysis, and trade execution — in one secure, per-user cockpit.

### A.3 Revenue Model

**Primary — SaaS subscription per registered Zerodha user:**

| Tier | Price | Access |
|------|-------|--------|
| Free | ₹0/month | Limited access to analytics features |
| Pro | ₹[X]/month | Full access to all analytics and trading features |
| Pro Annual | ₹[Y]/year | Full access + [X]% discount vs. monthly |

**Secondary:**
- Self-hosted open-source distribution — no direct revenue; drives developer adoption and brand credibility
- Zerodha Kite Connect partner referral program — to be explored after initial user base is established

*Pricing tiers and amounts are placeholders pending user research and competitive benchmarking.*

### A.4 Financial Projections

| Metric | Year 1 | Year 2 | Year 3 |
|--------|:------:|:------:|:------:|
| Monthly Active Users | [X] | [Y] | [Z] |
| Paid conversion rate | [X]% | [Y]% | [Z]% |
| Paid subscribers | [X] | [Y] | [Z] |
| ARPU (monthly) | ₹[X] | ₹[Y] | ₹[Z] |
| MRR | ₹[X] | ₹[Y] | ₹[Z] |
| Monthly operating cost | ₹5,000–7,000 | ₹[Y] | ₹[Z] |

*Projections to be completed after pricing validation and go-to-market channel is confirmed.*

### A.5 Unit Economics

| Metric | Estimate |
|--------|----------|
| Customer Acquisition Cost (CAC) | ₹[TBD] |
| ARPU (monthly) | ₹[TBD] |
| Gross margin | ~[X]% (low infrastructure COGS; no per-user marginal data cost) |
| Payback period | [TBD] months |
| Lifetime Value (LTV) at [X]% annual churn | ₹[TBD] |

*Unit economics to be refined post-launch with real retention and churn data.*

---

## B. Business Risk & Compliance

### B.1 Regulatory Implications

| Area | Implication | Owner |
|------|-------------|-------|
| SEBI algorithmic trading | Retail users acting on their own Zerodha accounts do not require SEBI algo registration — provided all orders are manually confirmed by the account holder. The platform must never auto-execute orders. | Platform operator |
| Kite Connect ToS | Commercial use of the Kite Connect API requires registration as a Kite Connect partner and payment of the API subscription fee. | Platform operator |
| DPDP Act 2023 | User personal data and trading activity are subject to India's Digital Personal Data Protection Act. A privacy policy and user consent flow are required before commercial launch. | Platform operator |
| Data localisation | If hosted commercially, user financial data should reside within India per RBI/SEBI guidance on financial data localisation. | Platform operator |

### B.2 Legal Exposure

| Exposure | Description | Mitigation |
|---------|-------------|------------|
| Order mis-execution | A platform defect causes an incorrect trade on a user's brokerage account | Mandatory pre-trade confirmation; simulation mode for testing; Terms & Conditions explicitly disclaim investment liability |
| Kite API ToS violation | Platform breaches API usage terms, risking suspension of broker data access | Compliance controls enforced before commercial launch; periodic ToS review |
| NSE data usage at scale | Fundamental data is sourced from NSE India public endpoints — commercial-use legality is ambiguous | Treat as a soft dependency; pursue a licensed data source if platform scales commercially |
| Security breach | Unauthorised access exposes users' brokerage credentials | Industry-standard encryption at rest and in transit; independent security audit before commercial launch |

### B.3 Risk Ownership

| Risk Area | Owner |
|-----------|-------|
| Investment decisions and their financial outcomes | End user (Zerodha account holder) |
| Platform uptime, data accuracy, and security | Platform operator (Prakruti Vavdiya) |
| Broker API availability, pricing changes, and terms | Zerodha |
| Regulatory compliance (SEBI, DPDP) | Platform operator |
| User data protection | Platform operator |

### B.4 Capital Requirements

| Item | Estimated Cost |
|------|---------------|
| Broker API subscription (Kite Connect) | ₹2,000/month |
| Cloud infrastructure (compute + managed database) | ₹3,000–5,000/month |
| Domain + SSL | ~₹2,000/year |
| Development (solo opportunity cost) | [TBD] |
| Independent security audit (pre-commercial launch) | ₹[TBD] |
| **Total pre-revenue monthly burn** | ~₹5,000–7,000/month |

Break-even: approximately [X] paid Pro subscribers at ₹[X]/month covers operating costs.

### B.5 Operational Risk

| Risk | Probability | Impact | Mitigation |
|------|:-----------:|:------:|-----------|
| Zerodha changes API pricing or deprecates capabilities | Low | High | Monitor Zerodha developer announcements; maintain modular broker integration to limit switching cost |
| NSE India public data changes or becomes unavailable | Medium | Low | Fundamental data is a soft dependency; all core features remain functional without it |
| Single-developer maintenance bottleneck | High | Medium | Thorough documentation; modular design to allow future contributors |
| Hosting provider outage | Low | High | Managed hosting with uptime SLA; daily automated backups |

---

## C. ROI Logic

### C.1 Revenue Upside

Zerodha's active trader base provides a large addressable market. Comparable SaaS tools demonstrate clear willingness to pay: Tijori Finance (₹1,999/month), Zerodha Streak (₹999–4,999/month). StockPilot targets the underserved segment of active investors currently subscribing to multiple fragmented tools that lack execution integration or portfolio-native analytics.

### C.2 Cost Impact for Users

| Tool Replaced | User Cost | StockPilot Equivalent |
|--------------|-----------|----------------------|
| Tijori Finance | ₹1,999/month | Portfolio tracking + fundamental data |
| Chart analysis subscription (e.g., TradingView) | ₹[X]/month | Persistent visual analysis, linked to live portfolio |
| Manual spreadsheet tracking | ~20–30 min/day in time cost | Automated daily analytics across all holdings |

One StockPilot subscription replaces two or more paid tools and eliminates manual tracking overhead.

### C.3 Efficiency Gain

| Investor Activity | Without StockPilot | With StockPilot |
|-------------------|--------------------|----------------|
| Morning portfolio review | 20–30 min across multiple tools | < 5 min on a single dashboard |
| Tracking custom performance metrics | Manual per-stock calculation | Computed automatically every morning |
| Recovering visual analysis between sessions | Redrawn from scratch each time | Available instantly on every login |
| Analysis-to-execution workflow | Fragmented across separate tools | End-to-end in one platform |

### C.4 Strategic Leverage

| Asset | Leverage |
|-------|---------|
| Shared market data infrastructure | Historical data is fetched once and reused across all users — per-user marginal cost decreases as the user base grows |
| Accumulated personalised analytics | Users build a library of custom metrics and visual analysis over time, creating switching cost and driving retention |
| Deep broker integration | Native connectivity to Zerodha is a structural moat — competitors without direct broker partnerships cannot replicate the live portfolio and execution experience |

---

## D. Organizational Impact

### D.1 People & Teams

| Role | Person | Responsibility |
|------|--------|----------------|
| Owner / Lead Developer | Prakruti Vavdiya | Product strategy, development, operations, compliance |
| End users | Zerodha account holders | Platform adoption; bear their own investment decisions |
| Broker / data provider | Zerodha | Market data and trade execution access |

### D.2 Operational Changes for Users

Users transitioning from a fragmented toolset to StockPilot will:
- Complete a one-time broker account linking
- Re-authenticate daily (broker-imposed daily session expiry)
- Migrate existing analysis work from spreadsheets manually on initial onboarding

### D.3 Vendor Dependencies

| Vendor | Role | Dependency Level | Risk |
|--------|------|:---------------:|------|
| Zerodha (Kite Connect) | Live portfolio data + trade execution | Critical | High — no alternative broker integration planned for v1 |
| NSE India | Fundamental market data | Soft | Medium — unofficial data source; no availability guarantee |
| Cloud hosting provider | Infrastructure | Operational | Low — commodity provider; platform is portable |
| Charting library provider | Interactive chart rendering | Optional | Low — open-source alternative available |

### D.4 Go-to-Market

| Channel | Rationale |
|---------|-----------|
| Zerodha developer and power-user community | High intent — users already committed to the Zerodha ecosystem |
| Retail investor communities (social media, forums) | Active, high-intent audience of Indian equity investors |
| Product Hunt | Visibility with early-adopter and developer audience |
| Word-of-mouth from power users | Accumulated analytics history creates switching cost — drives retention-led organic growth |

---

## E. Success Definition (Business-Level)

| Metric | Year 1 Target | Year 2 Target | Measurement |
|--------|:-------------:|:-------------:|-------------|
| Monthly Active Users (MAU) | [X] | [Y] | Active logins per calendar month |
| Paid subscriber count | [X] | [Y] | Subscription records |
| Monthly Recurring Revenue (MRR) | ₹[X] | ₹[Y] | Billing system |
| Free → Pro conversion rate | [X]% | [Y]% | Funnel analytics |
| Monthly churn rate | < [X]% | < [Y]% | Cancellations / total subscribers |
| Security incidents (unauthorised account access) | 0 | 0 | Security monitoring |
| Regulatory compliance violations | 0 | 0 | Compliance audit |
| Trade errors attributable to platform | 0 | 0 | Support escalations |
