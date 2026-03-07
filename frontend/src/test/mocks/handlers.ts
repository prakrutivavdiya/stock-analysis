import { http, HttpResponse } from 'msw'

// ── Shared fixtures ──────────────────────────────────────────────────────────

export const mockUser = {
  user_id: 'ZR0001',
  full_name: 'Test User',
  email: 'test@example.com',
  exchange_memberships: ['NSE', 'BSE'],
  product_types: ['CNC', 'MIS', 'NRML'],
  kite_session_valid: true,
  kite_token_expiry: '2026-03-06T09:00:00Z',
}

export const mockHolding = {
  tradingsymbol: 'INFY',
  exchange: 'NSE',
  instrument_token: 408065,
  isin: 'INE009A01021',
  quantity: 10,
  t1_quantity: 2,
  average_price: 1400.0,
  last_price: 1500.0,
  day_change: 20.0,
  day_change_percentage: 1.35,
  pnl: 1000.0,
  pnl_percent: 7.14,
  current_value: 15000.0,
  invested_value: 14000.0,
}

export const mockPosition = {
  tradingsymbol: 'RELIANCE',
  exchange: 'NSE',
  instrument_token: 738561,
  product: 'MIS',
  quantity: 5,
  average_price: 2800.0,
  last_price: 2820.0,
  pnl: 100.0,
  day_change: 20.0,
  day_change_percentage: 0.71,
}

export const mockOrder = {
  order_id: 'ORD001',
  tradingsymbol: 'INFY',
  exchange: 'NSE',
  transaction_type: 'BUY',
  product: 'CNC',
  order_type: 'LIMIT',
  quantity: 1,
  price: 1500.0,
  trigger_price: null,
  status: 'COMPLETE',
  variety: 'regular',
  validity: 'DAY',
  placed_at: '2026-03-06T09:15:00Z',
  filled_quantity: 1,
  pending_quantity: 0,
  average_price: 1500.0,
}

export const mockGtt = {
  trigger_id: 1001,
  tradingsymbol: 'INFY',
  exchange: 'NSE',
  transaction_type: 'SELL',
  product: 'CNC',
  trigger_type: 'two-leg',
  status: 'active',
  condition: { trigger_values: [1400, 1600], last_price: 1500 },
  orders: [],
  created_at: '2026-03-01T09:00:00Z',
}

export const mockAuditLog = {
  id: 1,
  action: 'PLACE_ORDER',
  tradingsymbol: 'INFY',
  exchange: 'NSE',
  quantity: 1,
  price: 1500.0,
  ip_address: '127.0.0.1',
  created_at: '2026-03-06T09:15:00Z',
  order_id: 'ORD001',
  transaction_type: 'BUY',
  product: 'CNC',
  order_type: 'LIMIT',
}

export const mockKpi = {
  id: 'kpi-001',
  name: 'Daily RSI',
  formula: 'RSI(close, 14)',
  return_type: 'FLOAT',
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
}

export const mockInstrument = {
  instrument_token: 408065,
  tradingsymbol: 'INFY',
  name: 'Infosys Ltd',
  exchange: 'NSE',
  segment: 'NSE',
  instrument_type: 'EQ',
  lot_size: 1,
  tick_size: 0.05,
}

export const mockCandles = [
  { timestamp: '2026-03-05T09:15:00Z', open: 1490, high: 1510, low: 1485, close: 1500, volume: 100000 },
  { timestamp: '2026-03-06T09:15:00Z', open: 1500, high: 1520, low: 1495, close: 1515, volume: 90000 },
]

// ── Request handlers ─────────────────────────────────────────────────────────

export const handlers = [
  // Auth
  http.get('/api/v1/auth/me', () => HttpResponse.json(mockUser)),
  http.get('/api/v1/auth/login', () =>
    HttpResponse.json({ login_url: 'https://kite.zerodha.com/connect/login?api_key=test' })
  ),
  http.post('/api/v1/auth/logout', () => HttpResponse.json({ message: 'Logged out' })),

  // Portfolio
  http.get('/api/v1/portfolio/holdings', () =>
    HttpResponse.json({ holdings: [mockHolding], count: 1 })
  ),
  http.get('/api/v1/portfolio/positions', () =>
    HttpResponse.json({ net: [mockPosition], day: [], count: 1 })
  ),
  http.get('/api/v1/portfolio/margins', () =>
    HttpResponse.json({ equity: { available: { cash: 50000 }, used: { debits: 1000 } } })
  ),
  http.get('/api/v1/portfolio/summary', () =>
    HttpResponse.json({
      total_invested: 140000,
      current_value: 150000,
      total_pnl: 10000,
      total_pnl_percent: 7.14,
      day_pnl: 200,
      day_pnl_percent: 0.13,
      xirr: 12.5,
    })
  ),

  // Historical
  http.get('/api/v1/historical/:token', () =>
    HttpResponse.json({
      instrument_token: 408065,
      tradingsymbol: 'INFY',
      interval: 'day',
      from_date: '2026-03-05',
      to_date: '2026-03-06',
      candles: mockCandles,
      source: 'cache',
    })
  ),

  // Instruments
  http.get('/api/v1/instruments/search', () =>
    HttpResponse.json({ results: [mockInstrument], count: 1 })
  ),
  http.get('/api/v1/instruments/:token', () =>
    HttpResponse.json(mockInstrument)
  ),

  // KPIs
  http.get('/api/v1/kpis', () =>
    HttpResponse.json({ kpis: [mockKpi], count: 1 })
  ),
  http.post('/api/v1/kpis', () =>
    HttpResponse.json({ ...mockKpi, id: 'kpi-new' }, { status: 201 })
  ),
  http.put('/api/v1/kpis/:id', () => HttpResponse.json(mockKpi)),
  http.delete('/api/v1/kpis/:id', () => new HttpResponse(null, { status: 204 })),
  http.post('/api/v1/kpis/compute', () =>
    HttpResponse.json({ results: { 'INFY': { value: 62.5, return_type: 'FLOAT' } }, using_live_price: true })
  ),

  // Charts
  http.get('/api/v1/charts/:token/drawings', () =>
    HttpResponse.json({ drawings: [], count: 0 })
  ),
  http.post('/api/v1/charts/:token/drawings', () =>
    HttpResponse.json({ id: 1, type: 'hline', data: {} }, { status: 201 })
  ),
  http.post('/api/v1/charts/indicators/compute', () =>
    HttpResponse.json({ indicators: {} })
  ),

  // Orders
  http.get('/api/v1/orders', () =>
    HttpResponse.json({ orders: [mockOrder], count: 1 })
  ),
  http.post('/api/v1/orders', () =>
    HttpResponse.json({ audit_log_id: 42 }, { status: 201 })
  ),
  http.put('/api/v1/orders/:id', () => HttpResponse.json({ audit_log_id: 43 })),
  http.delete('/api/v1/orders/:id', () => new HttpResponse(null, { status: 204 })),

  // GTT
  http.get('/api/v1/gtt', () =>
    HttpResponse.json({ gtts: [mockGtt], count: 1 })
  ),
  http.post('/api/v1/gtt', () =>
    HttpResponse.json({ audit_log_id: 44 }, { status: 201 })
  ),
  http.put('/api/v1/gtt/:id', () => HttpResponse.json({ audit_log_id: 45 })),
  http.delete('/api/v1/gtt/:id', () => new HttpResponse(null, { status: 204 })),

  // Audit log
  http.get('/api/v1/audit', () =>
    HttpResponse.json({ logs: [mockAuditLog], count: 1, page: 1, page_size: 50 })
  ),

  // System
  http.get('/api/v1/health', () =>
    HttpResponse.json({ status: 'ok', version: '1.0.0' })
  ),
]
