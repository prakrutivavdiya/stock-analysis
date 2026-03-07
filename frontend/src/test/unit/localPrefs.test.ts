/**
 * Unit tests for localPrefs.ts
 * PRD refs: DATA_MODEL §storage — 6 individual localStorage keys
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  theme,
  defaultInterval,
  visibleKpiColumns,
  visibleHoldingsColumns,
  holdingsSort,
  chartUIState,
  defaultChartStyle,
  holdingsRefreshInterval,
  notifyOnOrderSuccess,
  notifyOnGTTTrigger,
  notifyOnKiteSessionExpiry,
  migrateLegacyPrefs,
  type Theme,
  type DefaultInterval,
} from '../../app/data/localPrefs'

beforeEach(() => localStorage.clear())

// ── theme ───────────────────────────────────────────────────────────────────

describe('theme', () => {
  it('defaults to dark when not set', () => {
    expect(theme.get()).toBe('dark')
  })

  it('returns dark for stored "dark"', () => {
    theme.set('dark')
    expect(theme.get()).toBe('dark')
  })

  it('returns light for stored "light"', () => {
    theme.set('light')
    expect(theme.get()).toBe('light')
  })

  it('falls back to dark for invalid stored value', () => {
    localStorage.setItem('pref_theme', 'solarized')
    expect(theme.get()).toBe('dark')
  })

  it('writes to correct key', () => {
    theme.set('light')
    expect(localStorage.getItem('pref_theme')).toBe('light')
  })
})

// ── defaultInterval ──────────────────────────────────────────────────────────

describe('defaultInterval', () => {
  it('defaults to "D" when not set', () => {
    expect(defaultInterval.get()).toBe('D')
  })

  const validIntervals: DefaultInterval[] = ['5', '15', '30', '60', 'D']
  validIntervals.forEach((iv) => {
    it(`accepts valid interval "${iv}"`, () => {
      defaultInterval.set(iv)
      expect(defaultInterval.get()).toBe(iv)
    })
  })

  it('falls back to "D" for invalid value', () => {
    localStorage.setItem('pref_default_interval', 'W') // W was removed in M-06
    expect(defaultInterval.get()).toBe('D')
  })

  it('does not accept "W" — M-06: weekly interval removed', () => {
    localStorage.setItem('pref_default_interval', 'W')
    expect(defaultInterval.get()).not.toBe('W')
  })
})

// ── visibleKpiColumns ────────────────────────────────────────────────────────

describe('visibleKpiColumns', () => {
  it('defaults to empty array', () => {
    expect(visibleKpiColumns.get()).toEqual([])
  })

  it('round-trips an array of IDs', () => {
    visibleKpiColumns.set(['kpi-1', 'kpi-2'])
    expect(visibleKpiColumns.get()).toEqual(['kpi-1', 'kpi-2'])
  })

  it('returns empty array for corrupt JSON', () => {
    localStorage.setItem('pref_visible_kpi_columns', 'not-json')
    expect(visibleKpiColumns.get()).toEqual([])
  })
})

// ── visibleHoldingsColumns ───────────────────────────────────────────────────

describe('visibleHoldingsColumns', () => {
  it('defaults to empty array', () => {
    expect(visibleHoldingsColumns.get()).toEqual([])
  })

  it('stores and retrieves column IDs', () => {
    visibleHoldingsColumns.set(['quantity', 't1Quantity', 'pnl'])
    expect(visibleHoldingsColumns.get()).toEqual(['quantity', 't1Quantity', 'pnl'])
  })
})

// ── holdingsSort ─────────────────────────────────────────────────────────────

describe('holdingsSort', () => {
  it('defaults to { column: "symbol", direction: "asc" }', () => {
    expect(holdingsSort.get()).toEqual({ column: 'symbol', direction: 'asc' })
  })

  it('stores and retrieves sort state', () => {
    holdingsSort.set({ column: 'pnl', direction: 'desc' })
    expect(holdingsSort.get()).toEqual({ column: 'pnl', direction: 'desc' })
  })

  it('returns default for corrupt JSON', () => {
    localStorage.setItem('pref_holdings_sort', '{bad')
    expect(holdingsSort.get()).toEqual({ column: 'symbol', direction: 'asc' })
  })
})

// ── chartUIState ─────────────────────────────────────────────────────────────

describe('chartUIState', () => {
  it('generates correct key pattern', () => {
    expect(chartUIState.keyFor(408065, 'day')).toBe('chart_408065_day')
  })

  it('defaults to empty object when not set', () => {
    expect(chartUIState.get(408065, 'day')).toEqual({})
  })

  it('stores and retrieves chart state', () => {
    chartUIState.set(408065, 'day', { activeIndicators: ['RSI_14', 'MACD'] })
    expect(chartUIState.get(408065, 'day')).toEqual({ activeIndicators: ['RSI_14', 'MACD'] })
  })

  it('remove clears the key', () => {
    chartUIState.set(408065, 'day', { zoomFrom: 1000 })
    chartUIState.remove(408065, 'day')
    expect(chartUIState.get(408065, 'day')).toEqual({})
  })
})

// ── defaultChartStyle ────────────────────────────────────────────────────────

describe('defaultChartStyle', () => {
  it('defaults to "Candles"', () => {
    expect(defaultChartStyle.get()).toBe('Candles')
  })

  it('accepts all valid chart styles', () => {
    const styles = ['Candles', 'Bars', 'Line', 'Area'] as const
    styles.forEach((s) => {
      defaultChartStyle.set(s)
      expect(defaultChartStyle.get()).toBe(s)
    })
  })
})

// ── holdingsRefreshInterval ───────────────────────────────────────────────────

describe('holdingsRefreshInterval', () => {
  it('defaults to "60"', () => {
    expect(holdingsRefreshInterval.get()).toBe('60')
  })

  it('accepts "off"', () => {
    holdingsRefreshInterval.set('off')
    expect(holdingsRefreshInterval.get()).toBe('off')
  })
})

// ── notification prefs ────────────────────────────────────────────────────────

describe('notifyOnOrderSuccess', () => {
  it('defaults to true', () => {
    expect(notifyOnOrderSuccess.get()).toBe(true)
  })

  it('can be set to false', () => {
    notifyOnOrderSuccess.set(false)
    expect(notifyOnOrderSuccess.get()).toBe(false)
  })
})

describe('notifyOnGTTTrigger', () => {
  it('defaults to true', () => {
    expect(notifyOnGTTTrigger.get()).toBe(true)
  })
})

describe('notifyOnKiteSessionExpiry', () => {
  it('always returns true — AU-05: cannot be suppressed', () => {
    expect(notifyOnKiteSessionExpiry.get()).toBe(true)
  })

  it('setter is a no-op — AU-05 prohibition', () => {
    notifyOnKiteSessionExpiry.set(false as never)
    expect(notifyOnKiteSessionExpiry.get()).toBe(true)
    // should not write to localStorage either
    expect(localStorage.getItem('pref_notify_kite_session_expiry')).toBeNull()
  })
})

// ── migrateLegacyPrefs ────────────────────────────────────────────────────────

describe('migrateLegacyPrefs', () => {
  it('is a no-op when no legacy key exists', () => {
    migrateLegacyPrefs()
    expect(theme.get()).toBe('dark') // still default
  })

  it('migrates theme from legacy blob', () => {
    localStorage.setItem('stockpilot_prefs', JSON.stringify({ theme: 'light' }))
    migrateLegacyPrefs()
    expect(theme.get()).toBe('light')
    expect(localStorage.getItem('stockpilot_prefs')).toBeNull() // removed after migration
  })

  it('does not overwrite existing new-key values', () => {
    localStorage.setItem('pref_theme', 'dark')
    localStorage.setItem('stockpilot_prefs', JSON.stringify({ theme: 'light' }))
    migrateLegacyPrefs()
    expect(theme.get()).toBe('dark') // existing value preserved
  })

  it('handles corrupt legacy blob gracefully', () => {
    localStorage.setItem('stockpilot_prefs', '{corrupt')
    migrateLegacyPrefs()
    expect(localStorage.getItem('stockpilot_prefs')).toBeNull()
  })
})
