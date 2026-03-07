/**
 * Charts page component tests
 * PRD refs:
 *   M-06  — Weekly interval removed (only 5m, 15m, 30m, 1hr, D)
 *   CH-01 — Chart type selector (Candles, Bars, Line, Area)
 *   CH-02 — Indicators dropdown with 4 categories
 *   CH-06 — Symbol sidebar with holdings search filter
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'

// Mock Canvas-dependent libraries before any component imports
vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => ({
    addSeries: vi.fn(() => ({ setData: vi.fn(), createPriceLine: vi.fn(() => ({})), removePriceLine: vi.fn() })),
    remove: vi.fn(),
    applyOptions: vi.fn(),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    resize: vi.fn(),
  })),
  ColorType: { Solid: 'solid' },
  LineStyle: { Dashed: 1, SparseDotted: 3 },
  CandlestickSeries: 'CandlestickSeries',
  BarSeries: 'BarSeries',
  LineSeries: 'LineSeries',
  AreaSeries: 'AreaSeries',
  HistogramSeries: 'HistogramSeries',
}))

vi.mock('../../app/api/instruments', () => ({
  searchInstruments: vi.fn(() =>
    Promise.resolve({
      results: [{ instrument_token: 408065, tradingsymbol: 'INFY', exchange: 'NSE' }],
    })
  ),
}))

vi.mock('../../app/api/client', () => ({
  apiFetch: vi.fn(() =>
    Promise.resolve({
      candles: [
        { timestamp: '2026-03-06T09:15:00Z', open: 1490, high: 1510, low: 1485, close: 1500, volume: 100000 },
      ],
    })
  ),
  ApiError: class ApiError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  },
}))

// Mutable store state for test control
let mockHoldingsData = [
  { symbol: 'INFY', exchange: 'NSE' },
  { symbol: 'HDFCBANK', exchange: 'NSE' },
]

vi.mock('../../app/data/store', () => ({
  useAppStore: vi.fn((selector: (s: object) => unknown) =>
    selector({
      holdings: { data: mockHoldingsData, fetchedAt: Date.now() },
    })
  ),
}))

// Mock ResizeObserver
global.ResizeObserver = class {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

import Charts from '../../app/pages/Charts'

function renderCharts(symbol = 'INFY') {
  return render(
    <MemoryRouter initialEntries={[`/charts/${symbol}`]}>
      <Charts />
    </MemoryRouter>
  )
}

beforeEach(() => {
  mockHoldingsData = [
    { symbol: 'INFY', exchange: 'NSE' },
    { symbol: 'HDFCBANK', exchange: 'NSE' },
  ]
})

// ── M-06: Interval buttons (no W) ────────────────────────────────────────────

describe('Charts — M-06: interval buttons', () => {
  it('shows 5m interval button', () => {
    renderCharts()
    expect(screen.getByRole('button', { name: '5m' })).toBeInTheDocument()
  })

  it('shows 15m interval button', () => {
    renderCharts()
    expect(screen.getByRole('button', { name: '15m' })).toBeInTheDocument()
  })

  it('shows 30m interval button', () => {
    renderCharts()
    expect(screen.getByRole('button', { name: '30m' })).toBeInTheDocument()
  })

  it('shows 1hr interval button', () => {
    renderCharts()
    expect(screen.getByRole('button', { name: '1hr' })).toBeInTheDocument()
  })

  it('shows D (daily) interval button', () => {
    renderCharts()
    expect(screen.getByRole('button', { name: 'D' })).toBeInTheDocument()
  })

  it('does NOT show W (weekly) interval button — M-06 fix', () => {
    renderCharts()
    expect(screen.queryByRole('button', { name: 'W' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^W$/ })).not.toBeInTheDocument()
  })

  it('exactly 5 interval buttons are rendered', () => {
    renderCharts()
    const intervals = ['5m', '15m', '30m', '1hr', 'D']
    const present = intervals.filter((iv) => screen.queryByRole('button', { name: iv }))
    expect(present.length).toBe(5)
  })

  it('D interval is selected by default', () => {
    renderCharts()
    const dBtn = screen.getByRole('button', { name: 'D' })
    expect(dBtn.className).toContain('bg-[#FF6600]')
  })

  it('clicking 5m changes active interval', async () => {
    renderCharts()
    const btn5m = screen.getByRole('button', { name: '5m' })
    await userEvent.click(btn5m)
    expect(btn5m.className).toContain('bg-[#FF6600]')
  })
})

// ── CH-01: Chart type selector ────────────────────────────────────────────────

describe('Charts — CH-01: chart type selector', () => {
  it('shows Candles button', () => {
    renderCharts()
    expect(screen.getByRole('button', { name: 'Candles' })).toBeInTheDocument()
  })

  it('shows Bars button', () => {
    renderCharts()
    expect(screen.getByRole('button', { name: 'Bars' })).toBeInTheDocument()
  })

  it('shows Line button', () => {
    renderCharts()
    expect(screen.getByRole('button', { name: 'Line' })).toBeInTheDocument()
  })

  it('shows Area button', () => {
    renderCharts()
    expect(screen.getByRole('button', { name: 'Area' })).toBeInTheDocument()
  })

  it('Candles is selected by default', () => {
    renderCharts()
    const btn = screen.getByRole('button', { name: 'Candles' })
    expect(btn.className).toContain('bg-[#FF6600]')
  })

  it('clicking Bars activates it', async () => {
    renderCharts()
    const btn = screen.getByRole('button', { name: 'Bars' })
    await userEvent.click(btn)
    expect(btn.className).toContain('bg-[#FF6600]')
  })
})

// ── CH-02: Indicators dropdown ────────────────────────────────────────────────

describe('Charts — CH-02: indicators dropdown', () => {
  it('renders "Indicators" button', () => {
    renderCharts()
    // Match button that starts with "Indicators" text
    const btns = screen.getAllByRole('button')
    const indBtn = btns.find((b) => b.textContent?.includes('Indicators'))
    expect(indBtn).toBeInTheDocument()
  })

  it('clicking Indicators opens the search panel', async () => {
    renderCharts()
    const btns = screen.getAllByRole('button')
    const indBtn = btns.find((b) => b.textContent?.includes('Indicators'))!
    await userEvent.click(indBtn)
    expect(screen.getByPlaceholderText(/search indicators/i)).toBeInTheDocument()
  })

  it('panel shows 4 categories after open', async () => {
    renderCharts()
    const btns = screen.getAllByRole('button')
    const indBtn = btns.find((b) => b.textContent?.includes('Indicators'))!
    await userEvent.click(indBtn)
    expect(screen.getByText('Trend')).toBeInTheDocument()
    expect(screen.getByText('Momentum')).toBeInTheDocument()
    expect(screen.getByText('Volatility')).toBeInTheDocument()
    expect(screen.getByText('Volume')).toBeInTheDocument()
  })

  it('panel shows Overlay and Indicator badges', async () => {
    renderCharts()
    const btns = screen.getAllByRole('button')
    const indBtn = btns.find((b) => b.textContent?.includes('Indicators'))!
    await userEvent.click(indBtn)
    expect(screen.getAllByText('Overlay').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Indicator').length).toBeGreaterThan(0)
  })

  it('indicator search filters the list to RSI only', async () => {
    renderCharts()
    const btns = screen.getAllByRole('button')
    const indBtn = btns.find((b) => b.textContent?.includes('Indicators'))!
    await userEvent.click(indBtn)
    const searchBox = screen.getByPlaceholderText(/search indicators/i)
    await userEvent.type(searchBox, 'RSI')
    expect(screen.getByText('RSI (14)')).toBeInTheDocument()
    expect(screen.queryByText('MACD')).not.toBeInTheDocument()
  })

  it('toggling an indicator adds its label elsewhere on page', async () => {
    renderCharts()
    const btns = screen.getAllByRole('button')
    const indBtn = btns.find((b) => b.textContent?.includes('Indicators'))!
    await userEvent.click(indBtn)
    const rsiItem = screen.getByText('RSI (14)')
    await userEvent.click(rsiItem)
    // Count badge "1" should appear on the Indicators button
    const updatedIndBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('Indicators'))
    expect(updatedIndBtn?.textContent).toContain('1')
  })

  it('active indicator count badge shows number', async () => {
    renderCharts()
    const btns = screen.getAllByRole('button')
    const indBtn = btns.find((b) => b.textContent?.includes('Indicators'))!
    await userEvent.click(indBtn)
    await userEvent.click(screen.getByText('RSI (14)'))
    // '1' badge
    expect(screen.queryByText('1')).toBeInTheDocument()
  })
})

// ── CH-06: Symbol sidebar ─────────────────────────────────────────────────────

describe('Charts — CH-06: symbol sidebar', () => {
  it('renders holdings search input in sidebar', () => {
    renderCharts()
    expect(screen.getByPlaceholderText(/search holdings/i)).toBeInTheDocument()
  })

  it('renders INFY in the sidebar', () => {
    renderCharts()
    // INFY appears in sidebar as a button
    expect(screen.getAllByText('INFY').length).toBeGreaterThan(0)
  })

  it('renders HDFCBANK in the sidebar', () => {
    renderCharts()
    expect(screen.getAllByText('HDFCBANK').length).toBeGreaterThan(0)
  })

  it('filtering the sidebar hides non-matching symbols', async () => {
    renderCharts()
    const searchBox = screen.getByPlaceholderText(/search holdings/i)
    await userEvent.type(searchBox, 'INFY')
    expect(screen.queryByText('HDFCBANK')).not.toBeInTheDocument()
  })

  it('clicking a symbol in the sidebar updates the active symbol label', async () => {
    renderCharts()
    const hdfcBtn = screen.getAllByText('HDFCBANK')[0]
    await userEvent.click(hdfcBtn)
    // The toolbar should show NSE:HDFCBANK
    expect(screen.getByText('NSE:HDFCBANK')).toBeInTheDocument()
  })
})

// ── Toolbar label ─────────────────────────────────────────────────────────────

describe('Charts — toolbar', () => {
  it('shows instrument label in toolbar', () => {
    renderCharts()
    expect(screen.getByText('NSE:INFY')).toBeInTheDocument()
  })
})
