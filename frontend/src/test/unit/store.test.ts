/**
 * Unit tests for store.ts helper functions
 * PRD refs: KP-05 (Zustand in-memory store, not IndexedDB)
 */
import { describe, it, expect, vi } from 'vitest'
import { isFresh, TTL_MS } from '../../app/data/store'

describe('isFresh', () => {
  it('returns true when data is within TTL', () => {
    const fetchedAt = Date.now() - 5_000 // 5 seconds ago
    expect(isFresh(fetchedAt, TTL_MS.holdings)).toBe(true) // TTL is 60s
  })

  it('returns false when data is past TTL', () => {
    const fetchedAt = Date.now() - 90_000 // 90 seconds ago
    expect(isFresh(fetchedAt, TTL_MS.holdings)).toBe(false) // TTL is 60s
  })

  it('returns false for fetchedAt = 0 (never fetched)', () => {
    expect(isFresh(0, TTL_MS.holdings)).toBe(false)
  })

  it('matches TTL_MS.holdings = 60s', () => {
    const ttl = TTL_MS.holdings
    const justFresh = Date.now() - ttl + 100
    const justStale = Date.now() - ttl - 100
    expect(isFresh(justFresh, ttl)).toBe(true)
    expect(isFresh(justStale, ttl)).toBe(false)
  })

  it('matches TTL_MS.ordersToday = 30s (shorter)', () => {
    const fetchedAt = Date.now() - 45_000 // 45s ago
    expect(isFresh(fetchedAt, TTL_MS.ordersToday)).toBe(false)
    expect(isFresh(fetchedAt, TTL_MS.holdings)).toBe(true)
  })

  it('is sensitive to the current time', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    const fetchedAt = now - 59_000
    expect(isFresh(fetchedAt, TTL_MS.holdings)).toBe(true)

    vi.setSystemTime(now + 2_000) // advance 2 more seconds
    expect(isFresh(fetchedAt, TTL_MS.holdings)).toBe(false)
    vi.useRealTimers()
  })
})

describe('TTL_MS constants', () => {
  it('holdings TTL is 60 seconds', () => {
    expect(TTL_MS.holdings).toBe(60_000)
  })

  it('positions TTL is 60 seconds', () => {
    expect(TTL_MS.positions).toBe(60_000)
  })

  it('ordersToday TTL is 30 seconds', () => {
    expect(TTL_MS.ordersToday).toBe(30_000)
  })

  it('margins TTL is 30 seconds', () => {
    expect(TTL_MS.margins).toBe(30_000)
  })
})
