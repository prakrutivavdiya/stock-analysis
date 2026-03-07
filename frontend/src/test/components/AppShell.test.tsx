/**
 * AppShell component tests
 * PRD refs:
 *   H-01  — Kite session expired banner with dismiss and re-authenticate
 *   H-02  — User dropdown: name, Kite ID, email, session status, Settings link, Logout
 *   C-02  — Settings page accessible from sidebar gear icon and topbar dropdown
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { MeResponse } from '../../app/api/types'

// Mutable variable to control user state per test
let currentUser: MeResponse | null = null

vi.mock('../../app/data/store', () => ({
  useAppStore: vi.fn((selector: (s: object) => unknown) =>
    selector({
      user: currentUser,
      setUser: vi.fn(),
      clearUser: vi.fn(),
    })
  ),
}))

vi.mock('../../app/api/auth', () => ({
  getMe: vi.fn(() =>
    currentUser
      ? Promise.resolve(currentUser)
      : Promise.reject(Object.assign(new Error('Unauthorized'), { status: 401 }))
  ),
  logout: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../app/api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(msg: string, status: number) { super(msg); this.status = status }
  },
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import AppShell from '../../app/components/AppShell'

const activeUser: MeResponse = {
  user_id: 'ZR0001',
  name: 'Test User',
  email: 'test@example.com',
  exchange_memberships: ['NSE', 'BSE'],
  product_types: ['CNC', 'MIS'],
  paper_trade_mode: false,
  kite_session_valid: true,
  kite_token_expires_at: '2026-03-06T17:00:00Z',
  last_login_at: '2026-03-06T09:00:00Z',
}

const expiredUser: MeResponse = {
  ...activeUser,
  kite_session_valid: false,
}

function renderAppShell() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AppShell />
    </MemoryRouter>
  )
}

beforeEach(() => {
  currentUser = activeUser
  vi.clearAllMocks()
})

// ── Basic topbar ──────────────────────────────────────────────────────────────

describe('AppShell — topbar', () => {
  it('renders StockPilot brand', async () => {
    renderAppShell()
    await waitFor(() => {
      expect(screen.getByText('StockPilot')).toBeInTheDocument()
    })
  })

  it('shows market hours label', async () => {
    renderAppShell()
    await waitFor(() => {
      expect(screen.getByText(/09:15/)).toBeInTheDocument()
    })
  })

  it('shows Kite user ID in topbar', async () => {
    renderAppShell()
    await waitFor(() => {
      expect(screen.queryByText('ZR0001')).toBeInTheDocument()
    })
  })
})

// ── H-01: Kite session expired banner ────────────────────────────────────────

describe('AppShell — H-01: Kite session expired banner', () => {
  it('shows expired banner when kite_session_valid = false', async () => {
    currentUser = expiredUser
    renderAppShell()
    await waitFor(() => {
      expect(
        screen.queryByText(/kite session has expired/i)
      ).toBeInTheDocument()
    })
  })

  it('does NOT show banner when kite_session_valid = true', async () => {
    currentUser = activeUser
    renderAppShell()
    await waitFor(() => {
      expect(screen.getByText('StockPilot')).toBeInTheDocument()
    })
    expect(screen.queryByText(/kite session has expired/i)).not.toBeInTheDocument()
  })

  it('banner includes "Re-authenticate with Kite" button', async () => {
    currentUser = expiredUser
    renderAppShell()
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /re-authenticate/i })
      ).toBeInTheDocument()
    })
  })

  it('banner includes a dismiss button', async () => {
    currentUser = expiredUser
    renderAppShell()
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /dismiss/i })
      ).toBeInTheDocument()
    })
  })

  it('clicking dismiss hides the banner', async () => {
    currentUser = expiredUser
    renderAppShell()
    await waitFor(() => {
      expect(screen.queryByText(/kite session has expired/i)).toBeInTheDocument()
    })
    const dismissBtn = screen.getByRole('button', { name: /dismiss/i })
    await userEvent.click(dismissBtn)
    expect(screen.queryByText(/kite session has expired/i)).not.toBeInTheDocument()
  })
})

// ── H-02: User dropdown ───────────────────────────────────────────────────────

describe('AppShell — H-02: user dropdown', () => {
  it('user avatar initials shown in topbar', async () => {
    renderAppShell()
    await waitFor(() => {
      // "Test User" → initials "TU"
      expect(screen.getAllByText('TU').length).toBeGreaterThan(0)
    })
  })

  it('dropdown opens on trigger click and shows full name', async () => {
    renderAppShell()
    await waitFor(() => {
      expect(screen.queryByText('ZR0001')).toBeInTheDocument()
    })
    // Click the user dropdown trigger
    const trigger = screen.getAllByText('ZR0001')[0].closest('button') ??
                    screen.getAllByText('ZR0001')[0]
    await userEvent.click(trigger)
    await waitFor(() => {
      expect(screen.queryByText('Test User')).toBeInTheDocument()
    })
  })

  it('dropdown shows email', async () => {
    renderAppShell()
    await waitFor(() => {
      expect(screen.queryByText('ZR0001')).toBeInTheDocument()
    })
    const trigger = screen.getAllByText('ZR0001')[0].closest('button') ??
                    screen.getAllByText('ZR0001')[0]
    await userEvent.click(trigger)
    await waitFor(() => {
      expect(screen.queryByText(/test@example\.com/)).toBeInTheDocument()
    })
  })

  it('dropdown contains Settings & Preferences link — C-02', async () => {
    renderAppShell()
    await waitFor(() => {
      expect(screen.queryByText('ZR0001')).toBeInTheDocument()
    })
    const trigger = screen.getAllByText('ZR0001')[0].closest('button') ??
                    screen.getAllByText('ZR0001')[0]
    await userEvent.click(trigger)
    await waitFor(() => {
      expect(screen.queryByText(/settings/i)).toBeInTheDocument()
    })
  })

  it('dropdown contains Logout', async () => {
    renderAppShell()
    await waitFor(() => {
      expect(screen.queryByText('ZR0001')).toBeInTheDocument()
    })
    const trigger = screen.getAllByText('ZR0001')[0].closest('button') ??
                    screen.getAllByText('ZR0001')[0]
    await userEvent.click(trigger)
    await waitFor(() => {
      expect(screen.queryByText(/logout/i)).toBeInTheDocument()
    })
  })

  it('shows "Kite session active" for valid session', async () => {
    renderAppShell()
    await waitFor(() => {
      expect(screen.queryByText('ZR0001')).toBeInTheDocument()
    })
    const trigger = screen.getAllByText('ZR0001')[0].closest('button') ??
                    screen.getAllByText('ZR0001')[0]
    await userEvent.click(trigger)
    await waitFor(() => {
      expect(screen.queryByText(/kite session active/i)).toBeInTheDocument()
    })
  })

  it('shows "Kite session expired" in dropdown for expired session', async () => {
    currentUser = expiredUser
    renderAppShell()
    await waitFor(() => {
      expect(screen.queryByText('ZR0001')).toBeInTheDocument()
    })
    const trigger = screen.getAllByText('ZR0001')[0].closest('button') ??
                    screen.getAllByText('ZR0001')[0]
    await userEvent.click(trigger)
    await waitFor(() => {
      expect(screen.queryByText(/kite session expired/i)).toBeInTheDocument()
    })
  })
})

// ── Navigation sidebar ────────────────────────────────────────────────────────

describe('AppShell — sidebar navigation', () => {
  it('contains Dashboard nav link', async () => {
    const { container } = renderAppShell()
    await waitFor(() => {
      expect(screen.getByText('StockPilot')).toBeInTheDocument()
    })
    // Sidebar labels are hidden when collapsed — query by href instead
    expect(container.querySelector('a[href="/dashboard"]')).toBeInTheDocument()
  })

  it('contains Charts nav link', async () => {
    const { container } = renderAppShell()
    await waitFor(() => {
      expect(screen.getByText('StockPilot')).toBeInTheDocument()
    })
    expect(container.querySelector('a[href="/charts"]')).toBeInTheDocument()
  })

  it('contains Orders nav link', async () => {
    const { container } = renderAppShell()
    await waitFor(() => {
      expect(screen.getByText('StockPilot')).toBeInTheDocument()
    })
    expect(container.querySelector('a[href="/orders"]')).toBeInTheDocument()
  })

  it('contains Audit Log nav link', async () => {
    const { container } = renderAppShell()
    await waitFor(() => {
      expect(screen.getByText('StockPilot')).toBeInTheDocument()
    })
    expect(container.querySelector('a[href="/audit"]')).toBeInTheDocument()
  })
})
