/**
 * useQuotesSocket hook tests — WebSocket/live price store integration
 * Tests that WS messages of type "tick" are forwarded to Zustand livePrices.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { LiveTick } from '../../app/api/quotes'

// Mock Zustand store
let capturedTicks: LiveTick[] = []
const mockSetLivePrices = vi.fn((ticks: LiveTick[]) => { capturedTicks = ticks })

vi.mock('../../app/data/store', () => ({
  useAppStore: vi.fn((selector: (s: object) => unknown) =>
    selector({ setLivePrices: mockSetLivePrices })
  ),
}))

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = []
  url: string
  onmessage: ((e: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((e: Event) => void) | null = null
  readyState = 1 // OPEN

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  close() { this.readyState = 3 }

  // Helper: simulate receiving a message
  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }

  // Helper: simulate close
  simulateClose() {
    this.readyState = 3
    this.onclose?.()
  }
}

beforeEach(() => {
  MockWebSocket.instances = []
  capturedTicks = []
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', MockWebSocket)
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:5174' })
})

afterEach(() => {
  vi.useRealTimers()
})

import { useQuotesSocket } from '../../app/api/quotes'

describe('useQuotesSocket — WebSocket/live price store integration', () => {
  it('opens a WebSocket connection on mount', () => {
    renderHook(() => useQuotesSocket())
    expect(MockWebSocket.instances.length).toBe(1)
    expect(MockWebSocket.instances[0].url).toContain('/ws/quotes')
  })

  it('calls setLivePrices when a tick message is received', () => {
    renderHook(() => useQuotesSocket())
    const ws = MockWebSocket.instances[0]
    const ticks: LiveTick[] = [
      { instrument_token: 408065, ltp: 1500, open: 1490, high: 1510, low: 1485, close: 1498, change: 0.13, volume: 50000, last_trade_time: null }
    ]
    act(() => {
      ws.simulateMessage({ type: 'tick', data: ticks })
    })
    expect(mockSetLivePrices).toHaveBeenCalledWith(ticks)
    expect(capturedTicks[0].instrument_token).toBe(408065)
    expect(capturedTicks[0].ltp).toBe(1500)
  })

  it('ignores messages with non-tick type', () => {
    renderHook(() => useQuotesSocket())
    const ws = MockWebSocket.instances[0]
    act(() => {
      ws.simulateMessage({ type: 'heartbeat', data: [] })
    })
    expect(mockSetLivePrices).not.toHaveBeenCalled()
  })

  it('ignores malformed (non-JSON) messages', () => {
    renderHook(() => useQuotesSocket())
    const ws = MockWebSocket.instances[0]
    act(() => {
      ws.onmessage?.({ data: 'not valid json {{{{' } as MessageEvent)
    })
    expect(mockSetLivePrices).not.toHaveBeenCalled()
  })

  it('reconnects after WebSocket close after 3s', () => {
    renderHook(() => useQuotesSocket())
    expect(MockWebSocket.instances.length).toBe(1)
    act(() => {
      MockWebSocket.instances[0].simulateClose()
      vi.advanceTimersByTime(3100)
    })
    expect(MockWebSocket.instances.length).toBe(2)
  })

  it('closes WebSocket on unmount', () => {
    const { unmount } = renderHook(() => useQuotesSocket())
    const ws = MockWebSocket.instances[0]
    unmount()
    expect(ws.readyState).toBe(3) // CLOSED
  })

  it('forwards multiple ticks in a single message', () => {
    renderHook(() => useQuotesSocket())
    const ws = MockWebSocket.instances[0]
    const ticks: LiveTick[] = [
      { instrument_token: 1, ltp: 100, open: 99, high: 101, low: 98, close: 100, change: 0.5, volume: 1000, last_trade_time: null },
      { instrument_token: 2, ltp: 200, open: 198, high: 202, low: 197, close: 200, change: -0.2, volume: 2000, last_trade_time: null },
    ]
    act(() => {
      ws.simulateMessage({ type: 'tick', data: ticks })
    })
    expect(capturedTicks.length).toBe(2)
    expect(capturedTicks[1].instrument_token).toBe(2)
  })
})
