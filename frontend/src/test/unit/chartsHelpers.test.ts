/**
 * Unit tests for exported helpers in Charts.tsx
 * PRD refs:
 *   - Point 8: intraday fetch window = 60 days (§5.8)
 *   - M-06: weekly interval removed (only 5m, 15m, 30m, 1hr, D)
 *   - CH-02: indicator spec parsing for 30+ indicators
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock lightweight-charts BEFORE importing Charts (which uses Canvas)
vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => ({
    addSeries: vi.fn(() => ({ setData: vi.fn(), createPriceLine: vi.fn(() => ({})), removePriceLine: vi.fn() })),
    remove: vi.fn(), applyOptions: vi.fn(),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })), resize: vi.fn(),
  })),
  ColorType: { Solid: 'solid' },
  LineStyle: { Dashed: 1, SparseDotted: 3 },
  CandlestickSeries: 'CandlestickSeries',
  BarSeries: 'BarSeries',
  LineSeries: 'LineSeries',
  AreaSeries: 'AreaSeries',
  HistogramSeries: 'HistogramSeries',
}))
vi.mock('../../app/data/store', () => ({
  useAppStore: vi.fn(() => ({ holdings: { data: [], fetchedAt: 0 } })),
}))
vi.mock('../../app/api/instruments', () => ({
  searchInstruments: vi.fn(() => Promise.resolve({ results: [] })),
}))
vi.mock('../../app/api/client', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ candles: [] })),
  ApiError: class ApiError extends Error { status = 0 },
}))

import { getDateRange, getIndicatorName, INDICATOR_CATALOG } from '../../app/pages/Charts'

afterEach(() => vi.useRealTimers())

// ── getDateRange ──────────────────────────────────────────────────────────────

describe('getDateRange', () => {
  it('returns today as "to" date', () => {
    vi.setSystemTime(new Date('2026-03-06'))
    const { to } = getDateRange('day')
    expect(to).toBe('2026-03-06')
  })

  it('daily interval: "from" is ~1 year ago', () => {
    vi.setSystemTime(new Date('2026-03-06'))
    const { from } = getDateRange('day')
    expect(from).toBe('2025-03-06')
  })

  it('intraday interval: "from" is exactly 60 days ago — PRD §5.8', () => {
    vi.setSystemTime(new Date('2026-03-06'))
    const { from } = getDateRange('5minute')
    expect(from).toBe('2026-01-05')
  })

  it('all intraday backends use 60-day window (not 30)', () => {
    vi.setSystemTime(new Date('2026-03-06'))
    for (const iv of ['5minute', '15minute', '30minute', '60minute']) {
      const { from } = getDateRange(iv)
      const diff =
        (new Date('2026-03-06').getTime() - new Date(from).getTime()) / 86_400_000
      expect(diff).toBeCloseTo(60, 0)
    }
  })

  it('"day" returns a 1-year window', () => {
    vi.setSystemTime(new Date('2026-03-06'))
    const { from, to } = getDateRange('day')
    const diffDays =
      (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000
    expect(diffDays).toBeGreaterThanOrEqual(364)
    expect(diffDays).toBeLessThanOrEqual(366)
  })
})

// ── getIndicatorName ──────────────────────────────────────────────────────────

describe('getIndicatorName', () => {
  it('returns simple name for single-part spec', () => {
    expect(getIndicatorName('RSI_14')).toBe('RSI')
    expect(getIndicatorName('EMA_20')).toBe('EMA')
    expect(getIndicatorName('MACD')).toBe('MACD')
    expect(getIndicatorName('VWAP')).toBe('VWAP')
    expect(getIndicatorName('OBV')).toBe('OBV')
  })

  it('handles multi-part: BB_PCT', () => {
    expect(getIndicatorName('BB_PCT_20')).toBe('BB_PCT')
    expect(getIndicatorName('BB_PCT')).toBe('BB_PCT')
  })

  it('handles multi-part: BB_BW', () => {
    expect(getIndicatorName('BB_BW_20')).toBe('BB_BW')
  })

  it('handles multi-part: STOCHRSI', () => {
    expect(getIndicatorName('STOCHRSI_14')).toBe('STOCHRSI')
    expect(getIndicatorName('STOCHRSI')).toBe('STOCHRSI')
  })

  it('handles multi-part: SUPERTREND', () => {
    expect(getIndicatorName('SUPERTREND_7_3')).toBe('SUPERTREND')
    expect(getIndicatorName('SUPERTREND')).toBe('SUPERTREND')
  })

  it('is case-insensitive', () => {
    expect(getIndicatorName('bb_pct_20')).toBe('BB_PCT')
    expect(getIndicatorName('stochrsi_14')).toBe('STOCHRSI')
    expect(getIndicatorName('rsi_14')).toBe('RSI')
  })
})

// ── INDICATOR_CATALOG ─────────────────────────────────────────────────────────

describe('INDICATOR_CATALOG', () => {
  it('has at least 30 indicators — CH-02', () => {
    expect(INDICATOR_CATALOG.length).toBeGreaterThanOrEqual(30)
  })

  it('covers all 4 categories — CH-02', () => {
    const cats = new Set(INDICATOR_CATALOG.map((d) => d.category))
    expect(cats).toContain('Trend')
    expect(cats).toContain('Momentum')
    expect(cats).toContain('Volatility')
    expect(cats).toContain('Volume')
  })

  it('each entry has key, label, category, group, color', () => {
    for (const d of INDICATOR_CATALOG) {
      expect(d.key).toBeTruthy()
      expect(d.label).toBeTruthy()
      expect(['Trend', 'Momentum', 'Volatility', 'Volume']).toContain(d.category)
      expect(['overlay', 'oscillator']).toContain(d.group)
      expect(d.color).toMatch(/^#[0-9a-f]{6}/i)
    }
  })

  it('keys are unique', () => {
    const keys = INDICATOR_CATALOG.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('includes RSI, MACD, Bollinger Bands — Kite standard indicators', () => {
    const keys = INDICATOR_CATALOG.map((d) => d.key)
    expect(keys).toContain('RSI_14')
    expect(keys).toContain('MACD')
    expect(keys).toContain('BB_20')
  })

  it('includes volume indicators: OBV, MFI, CMF', () => {
    const keys = INDICATOR_CATALOG.map((d) => d.key)
    expect(keys).toContain('OBV')
    expect(keys).toContain('MFI_14')
    expect(keys).toContain('CMF_20')
  })

  it('overlays: SUPERTREND, PSAR, VWAP', () => {
    const overlays = INDICATOR_CATALOG.filter((d) => d.group === 'overlay').map((d) => d.key)
    expect(overlays).toContain('SUPERTREND_7_3')
    expect(overlays).toContain('PSAR')
    expect(overlays).toContain('VWAP')
  })
})
