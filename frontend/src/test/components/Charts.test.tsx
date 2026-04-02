/**
 * Charts page component tests
 * PRD refs:
 *   M-06  — Weekly interval removed (only 5m, 15m, 30m, 1hr, D)
 *   CH-01 — Chart type selector (Candles, Bars, Line, Area)
 *   CH-02 — Indicators dropdown with 4 categories
 *   CH-06 — Symbol sidebar with holdings search filter
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'

// Mock Canvas-dependent libraries before any component imports
vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => ({
    addSeries: vi.fn(() => ({
      setData: vi.fn(),
      createPriceLine: vi.fn(() => ({})),
      removePriceLine: vi.fn(),
      setMarkers: vi.fn(),
      coordinateToPrice: vi.fn(() => 1500),
    })),
    remove: vi.fn(),
    applyOptions: vi.fn(),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    resize: vi.fn(),
    subscribeClick: vi.fn(),
    removeSeries: vi.fn(),
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

vi.mock('../../app/api/charts', () => ({
  getDrawings: vi.fn(() => Promise.resolve({ instrument_token: 408065, interval: 'day', drawings: [] })),
  createDrawing: vi.fn(() => Promise.resolve({ id: 'draw-1', instrument_token: 408065, tradingsymbol: 'INFY', exchange: 'NSE', interval: 'day', drawing_type: 'hline', drawing_data: { price: 1500 }, label: null, created_at: '', updated_at: '' })),
  deleteDrawing: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../app/api/preferences', () => ({
  getChartPreferences: vi.fn(() =>
    Promise.resolve({ chart_prefs: { interval: 'D', chart_type: 'candle', active_indicators: [] } })
  ),
  saveChartPreferences: vi.fn(() =>
    Promise.resolve({ chart_prefs: { interval: 'D', chart_type: 'candle', active_indicators: [] } })
  ),
  getPreferences: vi.fn(() =>
    Promise.resolve({ preferences: { visible_holdings_columns: [], holdings_sort: { column: 'symbol', direction: 'asc' } } })
  ),
  savePreferences: vi.fn(() => Promise.resolve({})),
}))

// Mutable store state for test control
let mockHoldingsData = [
  { symbol: 'INFY', exchange: 'NSE' },
  { symbol: 'HDFCBANK', exchange: 'NSE' },
]

vi.mock('../../app/data/store', () => {
  const useAppStore: any = vi.fn((selector?: (s: object) => unknown) => {
    const state = {
      holdings: { data: mockHoldingsData, fetchedAt: Date.now() },
      livePrices: {},
      setLivePrices: vi.fn(),
      setOhlcv: vi.fn(),
      getOhlcv: vi.fn(() => undefined),
      setIndicatorSeries: vi.fn(),
      getIndicatorSeries: vi.fn(() => undefined),
      clearIndicatorValues: vi.fn(),
    }
    return selector ? selector(state) : state
  })
  // Zustand static method used in Charts for live tick subscriptions
  useAppStore.subscribe = vi.fn(() => () => {})
  return { useAppStore }
})

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
  localStorage.clear()
})

// ── Interval buttons ──────────────────────────────────────────────────────────

describe('Charts — interval buttons', () => {
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

  it('shows 2hr interval button', () => {
    renderCharts()
    expect(screen.getByRole('button', { name: '2hr' })).toBeInTheDocument()
  })

  it('shows 4hr interval button', () => {
    renderCharts()
    expect(screen.getByRole('button', { name: '4hr' })).toBeInTheDocument()
  })

  it('shows D (daily) interval button', () => {
    renderCharts()
    expect(screen.getByRole('button', { name: 'D' })).toBeInTheDocument()
  })

  it('shows W (weekly) interval button', () => {
    renderCharts()
    expect(screen.getByRole('button', { name: 'W' })).toBeInTheDocument()
  })

  it('shows M (monthly) interval button', () => {
    renderCharts()
    expect(screen.getByRole('button', { name: 'M' })).toBeInTheDocument()
  })

  it('exactly 9 interval buttons are rendered', () => {
    renderCharts()
    const intervals = ['5m', '15m', '30m', '1hr', '2hr', '4hr', 'D', 'W', 'M']
    const present = intervals.filter((iv) => screen.queryByRole('button', { name: iv }))
    expect(present.length).toBe(9)
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
    expect(screen.getAllByText('Volume').length).toBeGreaterThan(0)
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
  it('renders instrument search input in sidebar', () => {
    renderCharts()
    expect(screen.getByPlaceholderText(/search instruments/i)).toBeInTheDocument()
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

  it('typing in the search box calls searchInstruments API', async () => {
    const { searchInstruments } = await import('../../app/api/instruments')
    renderCharts()
    const searchBox = screen.getByPlaceholderText(/search instruments/i)
    await userEvent.type(searchBox, 'INFY')
    // debounce is 300ms — wait for it
    await new Promise((r) => setTimeout(r, 400))
    expect(searchInstruments).toHaveBeenCalledWith('INFY')
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

// ── IND-PARAMS: Indicator period selector ─────────────────────────────────────

describe('Charts — IND-PARAMS: indicator period selector', () => {
  async function openIndicatorsAndAdd(label: string) {
    const btns = screen.getAllByRole('button')
    const indBtn = btns.find((b) => b.textContent?.includes('Indicators'))!
    await userEvent.click(indBtn)
    await userEvent.click(screen.getByText(label))
    // close panel by clicking elsewhere
    await userEvent.keyboard('{Escape}')
  }

  it('active RSI badge shows period in parentheses', async () => {
    renderCharts()
    await openIndicatorsAndAdd('RSI (14)')
    expect(screen.getByTestId('period-btn-RSI_14')).toBeInTheDocument()
    expect(screen.getByTestId('period-btn-RSI_14').textContent).toContain('14')
  })

  it('clicking period opens an inline input with current value', async () => {
    renderCharts()
    await openIndicatorsAndAdd('RSI (14)')
    const periodBtn = screen.getByTestId('period-btn-RSI_14')
    await userEvent.click(periodBtn)
    expect(screen.getByTestId('period-input-RSI_14')).toBeInTheDocument()
    expect((screen.getByTestId('period-input-RSI_14') as HTMLInputElement).value).toBe('14')
  })

  it('typing a new period and pressing Enter updates the badge', async () => {
    renderCharts()
    await openIndicatorsAndAdd('RSI (14)')
    await userEvent.click(screen.getByTestId('period-btn-RSI_14'))
    const input = screen.getByTestId('period-input-RSI_14')
    await userEvent.clear(input)
    await userEvent.type(input, '9')
    await userEvent.keyboard('{Enter}')
    // Input gone, badge now shows (9)
    expect(screen.queryByTestId('period-input-RSI_14')).not.toBeInTheDocument()
    // After update key changes to RSI_9
    expect(screen.getByTestId('period-btn-RSI_9')).toBeInTheDocument()
    expect(screen.getByTestId('period-btn-RSI_9').textContent).toContain('9')
  })

  it('pressing Escape on the period input cancels without changing period', async () => {
    renderCharts()
    await openIndicatorsAndAdd('RSI (14)')
    await userEvent.click(screen.getByTestId('period-btn-RSI_14'))
    const input = screen.getByTestId('period-input-RSI_14')
    await userEvent.clear(input)
    await userEvent.type(input, '99')
    await userEvent.keyboard('{Escape}')
    // Input dismissed, period unchanged (RSI_14 badge still present)
    expect(screen.getByTestId('period-btn-RSI_14')).toBeInTheDocument()
  })

  it('MACD badge (no period) does not show period button', async () => {
    renderCharts()
    await openIndicatorsAndAdd('MACD')
    // MACD key has no _N — period-btn should not be present
    expect(screen.queryByTestId('period-btn-MACD')).not.toBeInTheDocument()
  })

  it('BB period editing: BB_20 → BB_10 works', async () => {
    renderCharts()
    await openIndicatorsAndAdd('Bollinger Bands (20)')
    await userEvent.click(screen.getByTestId('period-btn-BB_20'))
    const input = screen.getByTestId('period-input-BB_20')
    await userEvent.clear(input)
    await userEvent.type(input, '10')
    await userEvent.keyboard('{Enter}')
    expect(screen.getByTestId('period-btn-BB_10')).toBeInTheDocument()
  })

  it('removing an indicator via × removes the badge', async () => {
    renderCharts()
    await openIndicatorsAndAdd('RSI (14)')
    // find × button in the badge
    const badge = screen.getByTestId('period-btn-RSI_14').closest('span')!
    const removeBtn = badge.querySelector('button:last-child')!
    await userEvent.click(removeBtn)
    expect(screen.queryByTestId('period-btn-RSI_14')).not.toBeInTheDocument()
  })
})

// ── Volume indicator ──────────────────────────────────────────────────────────

describe('Charts — Volume indicator', () => {
  async function openIndicators() {
    const btns = screen.getAllByRole('button')
    const indBtn = btns.find((b) => b.textContent?.includes('Indicators'))!
    await userEvent.click(indBtn)
  }

  /** Find the Volume indicator item span (not the category header <p>) */
  function findVolumeSpan() {
    return screen.getAllByText('Volume').find(
      (el) => el.tagName.toLowerCase() === 'span'
    )!
  }

  it('"Volume" appears in the indicator catalog under the Volume category', async () => {
    renderCharts()
    await openIndicators()
    // Both the category header and the indicator item have text "Volume"
    expect(screen.getAllByText('Volume').length).toBeGreaterThanOrEqual(2)
  })

  it('clicking Volume adds it to the active indicators (count badge increments)', async () => {
    renderCharts()
    await openIndicators()
    await userEvent.click(findVolumeSpan())
    const updatedIndBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('Indicators'))
    expect(updatedIndBtn?.textContent).toContain('1')
  })

  it('Volume indicator has no period button (no _N suffix)', async () => {
    renderCharts()
    await openIndicators()
    await userEvent.click(findVolumeSpan())
    await userEvent.keyboard('{Escape}')
    // VOLUME key has no period — period-btn should not be present
    expect(screen.queryByTestId('period-btn-VOLUME')).not.toBeInTheDocument()
  })

  it('Volume is listed under the Volume category in the indicator panel', async () => {
    renderCharts()
    await openIndicators()
    // The Volume indicator item label is a <span> inside a button
    const volSpan = findVolumeSpan()
    expect(volSpan).toBeInTheDocument()
  })
})

// ── CH-DRAWINGS: Drawing tools toolbar ───────────────────────────────────────

describe('Charts — CH-DRAWINGS: drawing tools', () => {
  it('renders the "Draw" toolbar with three tool buttons', () => {
    renderCharts()
    expect(screen.getByTestId('draw-hline')).toBeInTheDocument()
    expect(screen.getByTestId('draw-trendline')).toBeInTheDocument()
    expect(screen.getByTestId('draw-text')).toBeInTheDocument()
  })

  it('draw-hline button has title "Horizontal line"', () => {
    renderCharts()
    expect(screen.getByTestId('draw-hline').title).toBe('Horizontal line')
  })

  it('draw-trendline button has title "Trendline"', () => {
    renderCharts()
    expect(screen.getByTestId('draw-trendline').title).toBe('Trendline')
  })

  it('draw-text button has title "Text annotation"', () => {
    renderCharts()
    expect(screen.getByTestId('draw-text').title).toBe('Text annotation')
  })

  it('clicking hline activates it (orange accent class)', async () => {
    renderCharts()
    const btn = screen.getByTestId('draw-hline')
    await userEvent.click(btn)
    expect(btn.className).toContain('FF6600')
  })

  it('clicking the active hline button again deactivates it', async () => {
    renderCharts()
    const btn = screen.getByTestId('draw-hline')
    await userEvent.click(btn) // activate
    await userEvent.click(btn) // deactivate
    expect(btn.className).not.toContain('FF6600')
  })

  it('switching from hline to trendline deactivates hline', async () => {
    renderCharts()
    await userEvent.click(screen.getByTestId('draw-hline'))
    await userEvent.click(screen.getByTestId('draw-trendline'))
    expect(screen.getByTestId('draw-hline').className).not.toContain('FF6600')
    expect(screen.getByTestId('draw-trendline').className).toContain('FF6600')
  })

  it('drawings chips row is hidden when no drawings exist', () => {
    renderCharts()
    // getDrawings mock returns [] so no chips
    expect(screen.queryByText('Drawings:')).not.toBeInTheDocument()
  })

  it('drawings chips row appears after a drawing is loaded', async () => {
    const { getDrawings: mockGetDrawings } = await import('../../app/api/charts')
    ;(mockGetDrawings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      instrument_token: 408065,
      interval: 'day',
      drawings: [
        { id: 'draw-1', instrument_token: 408065, tradingsymbol: 'INFY', exchange: 'NSE',
          interval: 'day', drawing_type: 'hline', drawing_data: { price: 1500 },
          label: null, created_at: '', updated_at: '' },
      ],
    })
    renderCharts()
    await waitFor(() => {
      expect(screen.queryByText('Drawings:')).toBeInTheDocument()
    })
  })

  it('drawing chip shows delete button', async () => {
    const { getDrawings: mockGetDrawings } = await import('../../app/api/charts')
    ;(mockGetDrawings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      instrument_token: 408065,
      interval: 'day',
      drawings: [
        { id: 'draw-x', instrument_token: 408065, tradingsymbol: 'INFY', exchange: 'NSE',
          interval: 'day', drawing_type: 'hline', drawing_data: { price: 1500 },
          label: null, created_at: '', updated_at: '' },
      ],
    })
    renderCharts()
    await waitFor(() => {
      expect(screen.queryByTestId('delete-drawing-draw-x')).toBeInTheDocument()
    })
  })
})

describe('Charts — Reset chart', () => {
  it('renders the Reset button in the drawing toolbar', () => {
    renderCharts()
    expect(screen.getByTestId('reset-chart')).toBeInTheDocument()
    expect(screen.getByTestId('reset-chart')).toHaveTextContent('Reset')
  })

  it('first click changes button to Confirm reset?', async () => {
    renderCharts()
    const btn = screen.getByTestId('reset-chart')
    await userEvent.click(btn)
    expect(btn).toHaveTextContent('Confirm reset?')
  })

  it('second click calls saveChartPreferences with defaults and clears drawings', async () => {
    const { getDrawings: mockGetDrawings } = await import('../../app/api/charts')
    ;(mockGetDrawings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      instrument_token: 408065,
      interval: 'day',
      drawings: [],
    })
    const { saveChartPreferences: mockSavePrefs } = await import('../../app/api/preferences')
    renderCharts()
    const btn = screen.getByTestId('reset-chart')
    // first click — confirm mode
    await userEvent.click(btn)
    expect(btn).toHaveTextContent('Confirm reset?')
    // second click — executes reset
    await userEvent.click(btn)
    await waitFor(() => {
      expect(mockSavePrefs).toHaveBeenCalledWith(
        expect.objectContaining({ interval: 'D', chart_type: 'candle', active_indicators: [] })
      )
    })
    // button should revert to normal label
    expect(btn).toHaveTextContent('Reset')
  })
})
