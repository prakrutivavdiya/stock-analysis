/**
 * Minimal mock for lightweight-charts — Canvas API is not available in jsdom.
 * Tests that import Charts.tsx need this mock via vi.mock().
 */
import { vi } from 'vitest'

const seriesStub = {
  setData: vi.fn(),
  createPriceLine: vi.fn(() => ({})),
  removePriceLine: vi.fn(),
}

const chartStub = {
  addSeries: vi.fn(() => seriesStub),
  remove: vi.fn(),
  applyOptions: vi.fn(),
  timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
  resize: vi.fn(),
}

export const createChart = vi.fn(() => chartStub)
export const ColorType = { Solid: 'solid' }
export const LineStyle = { Dashed: 1, SparseDotted: 3 }
export const CandlestickSeries = 'CandlestickSeries'
export const BarSeries = 'BarSeries'
export const LineSeries = 'LineSeries'
export const AreaSeries = 'AreaSeries'
export const HistogramSeries = 'HistogramSeries'
