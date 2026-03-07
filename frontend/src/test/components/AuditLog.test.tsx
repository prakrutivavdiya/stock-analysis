/**
 * AuditLog page component tests
 * PRD refs:
 *   M-05  — Action types: PLACE_ORDER | MODIFY_ORDER | CANCEL_ORDER | PLACE_GTT | MODIFY_GTT | DELETE_GTT | PAPER_TRADE
 *   M-03  — Sortable column headers
 *   US-080 — Filters: date range, symbol, action type, outcome
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { AuditEntry } from '../../app/data/mockData'

const mockLogs: AuditEntry[] = [
  {
    id: '1',
    action: 'PLACE_ORDER',
    symbol: 'INFY',
    exchange: 'NSE',
    outcome: 'SUCCESS',
    timestamp: '2026-03-06T09:15:00Z',
    requestId: 'req-001',
    orderParams: { order_id: 'ORD001', product: 'CNC', order_type: 'LIMIT', transaction_type: 'BUY', quantity: 1, price: 1500 },
  },
  {
    id: '2',
    action: 'CANCEL_ORDER',
    symbol: 'HDFCBANK',
    exchange: 'NSE',
    outcome: 'SUCCESS',
    timestamp: '2026-03-06T10:00:00Z',
    requestId: 'req-002',
    orderParams: {},
  },
  {
    id: '3',
    action: 'PAPER_TRADE',
    symbol: 'TCS',
    exchange: 'NSE',
    outcome: 'SUCCESS',
    timestamp: '2026-03-06T11:00:00Z',
    requestId: 'req-003',
    orderParams: { quantity: 2, price: 3500 },
  },
]

vi.mock('../../app/api/audit', () => ({
  getAuditLogs: vi.fn(() =>
    Promise.resolve({ logs: mockLogs, total: mockLogs.length, page: 1, page_size: 200 })
  ),
  mapAuditLog: vi.fn((l: AuditEntry) => l),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('../../app/api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(msg: string, status: number) { super(msg); this.status = status }
  },
}))

import AuditLog from '../../app/pages/AuditLog'

function renderAuditLog() {
  return render(
    <MemoryRouter>
      <AuditLog />
    </MemoryRouter>
  )
}

// ── Page renders ─────────────────────────────────────────────────────────────

describe('AuditLog — basic render', () => {
  it('renders Audit Log heading', () => {
    renderAuditLog()
    expect(screen.getByText(/audit log/i)).toBeInTheDocument()
  })

  it('shows log entries after loading', async () => {
    renderAuditLog()
    await waitFor(() => {
      expect(screen.getByText('INFY')).toBeInTheDocument()
    })
  })
})

// ── M-05: Action type labels ──────────────────────────────────────────────────

describe('AuditLog — M-05: action type labels', () => {
  it('shows "Place Order" label for PLACE_ORDER action', async () => {
    renderAuditLog()
    await waitFor(() => {
      expect(screen.getByText('Place Order')).toBeInTheDocument()
    })
  })

  it('shows "Cancel Order" label for CANCEL_ORDER action', async () => {
    renderAuditLog()
    await waitFor(() => {
      expect(screen.getByText('Cancel Order')).toBeInTheDocument()
    })
  })

  it('shows "Paper Trade" label for PAPER_TRADE action', async () => {
    renderAuditLog()
    await waitFor(() => {
      expect(screen.getByText('Paper Trade')).toBeInTheDocument()
    })
  })

  it('does NOT render raw "PLACE_ORDER" string in the visible table', async () => {
    renderAuditLog()
    await waitFor(() => {
      expect(screen.getByText('Place Order')).toBeInTheDocument()
    })
    // Table rows should show friendly labels, not raw enum values
    const rows = screen.queryAllByRole('row')
    rows.slice(1).forEach((row) => {
      expect(row.textContent).not.toMatch(/^PLACE_ORDER$/)
    })
  })

  it('renders "All Actions" as the default filter label', () => {
    renderAuditLog()
    expect(screen.getByText(/all actions/i)).toBeInTheDocument()
  })
})

// ── M-03: Sortable columns ────────────────────────────────────────────────────

describe('AuditLog — M-03: sortable columns', () => {
  it('renders column headers', async () => {
    renderAuditLog()
    await waitFor(() => {
      const headers = screen.queryAllByRole('columnheader')
      expect(headers.length).toBeGreaterThan(0)
    })
  })

  it('clicking a sortable column header keeps table rendered', async () => {
    renderAuditLog()
    await waitFor(() => {
      expect(screen.getByText('INFY')).toBeInTheDocument()
    })
    const headers = screen.queryAllByRole('columnheader')
    if (headers.length > 0) {
      await userEvent.click(headers[0])
      expect(screen.getByText('INFY')).toBeInTheDocument()
    }
  })
})

// ── Log entries & symbols ─────────────────────────────────────────────────────

describe('AuditLog — log entries', () => {
  it('shows all 3 symbols in log', async () => {
    renderAuditLog()
    await waitFor(() => {
      expect(screen.getByText('INFY')).toBeInTheDocument()
      expect(screen.getByText('HDFCBANK')).toBeInTheDocument()
      expect(screen.getByText('TCS')).toBeInTheDocument()
    })
  })
})
