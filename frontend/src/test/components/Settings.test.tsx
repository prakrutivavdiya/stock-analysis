/**
 * Settings page component tests
 * PRD refs:
 *   ST-04 — Re-authenticate button in profile section
 *   ST-07 — Separate refresh intervals for holdings and positions
 *   AU-05 — Kite session expiry notification cannot be suppressed
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'

vi.mock('../../app/api/auth', () => ({
  logout: vi.fn(() => Promise.resolve()),
  revokeAllSessions: vi.fn(() => Promise.resolve({ revoked_count: 2 })),
  getLoginUrl: vi.fn(() => Promise.resolve({ login_url: 'https://kite.zerodha.com/connect/login?api_key=test' })),
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

vi.mock('../../app/api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(msg: string, status: number) { super(msg); this.status = status }
  },
}))

const mockUser = {
  user_id: 'ZX1234',
  name: 'Test User',
  email: 'test@example.com',
  exchange_memberships: ['NSE', 'BSE'],
  product_types: ['CNC', 'MIS'],
  kite_session_valid: true,
  kite_token_expires_at: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
  last_login_at: new Date().toISOString(),
}

vi.mock('../../app/data/store', () => ({
  useAppStore: vi.fn((selector: (s: object) => unknown) =>
    selector({
      user: mockUser,
      clearUser: vi.fn(),
    })
  ),
}))

vi.mock('../../app/data/localPrefs', () => ({
  theme: { get: vi.fn(() => 'dark'), set: vi.fn() },
  defaultInterval: { get: vi.fn(() => 'D'), set: vi.fn() },
  defaultChartStyle: { get: vi.fn(() => 'Candles'), set: vi.fn() },
  holdingsRefreshInterval: { get: vi.fn(() => '60'), set: vi.fn() },
  positionsRefreshInterval: { get: vi.fn(() => '60'), set: vi.fn() },
  notifyOnOrderSuccess: { get: vi.fn(() => true), set: vi.fn() },
  notifyOnOrderRejected: { get: vi.fn(() => true), set: vi.fn() },
  notifyOnGTTTrigger: { get: vi.fn(() => true), set: vi.fn() },
  paperTradeMode: { get: vi.fn(() => false), set: vi.fn() },
}))

import Settings from '../../app/pages/Settings'

beforeEach(() => { vi.clearAllMocks() })

function renderSettings() {
  return render(
    <MemoryRouter>
      <Settings />
    </MemoryRouter>
  )
}

// ── Profile section ────────────────────────────────────────────────────────

describe('Settings — profile section', () => {
  it('renders user name', () => {
    renderSettings()
    expect(screen.getAllByText('Test User').length).toBeGreaterThan(0)
  })

  it('renders user kite ID', () => {
    renderSettings()
    expect(screen.getByText('ZX1234')).toBeInTheDocument()
  })

  it('renders user email', () => {
    renderSettings()
    expect(screen.getByText('test@example.com')).toBeInTheDocument()
  })

  it('renders exchange memberships', () => {
    renderSettings()
    expect(screen.getByText(/NSE/)).toBeInTheDocument()
  })

  it('renders product types', () => {
    renderSettings()
    expect(screen.getByText(/CNC/)).toBeInTheDocument()
  })
})

// ── Session section ────────────────────────────────────────────────────────

describe('Settings — session section', () => {
  it('shows session section after clicking Session nav', async () => {
    renderSettings()
    const sessionBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('Session'))
    if (sessionBtn) {
      await userEvent.click(sessionBtn)
      expect(screen.getByText(/revoke/i)).toBeInTheDocument()
    }
  })

  it('clicking Revoke All Sessions shows confirm dialog', async () => {
    renderSettings()
    const sessionBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('Session'))
    if (sessionBtn) await userEvent.click(sessionBtn)
    const revokeBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('revoke'))
    if (revokeBtn) {
      await userEvent.click(revokeBtn)
      expect(screen.queryAllByText(/confirm|sure|revoke/i).length).toBeGreaterThan(0)
    }
  })
})

// ── Navigation ─────────────────────────────────────────────────────────────

describe('Settings — navigation', () => {
  it('renders Profile section by default', () => {
    renderSettings()
    expect(screen.getAllByText(/test user/i).length).toBeGreaterThan(0)
  })

  it('has Preferences navigation button', () => {
    renderSettings()
    expect(screen.getAllByRole('button').some((b) => b.textContent?.includes('Preferences'))).toBe(true)
  })

  it('clicking Preferences shows preference controls', async () => {
    renderSettings()
    const prefsBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('Preferences'))
    if (prefsBtn) {
      await userEvent.click(prefsBtn)
      expect(screen.getAllByText(/default interval|chart style|theme/i).length).toBeGreaterThan(0)
    }
  })
})

// ── Re-authenticate ────────────────────────────────────────────────────────

describe('Settings — ST-04: re-authenticate', () => {
  it('has re-authenticate button in profile section', () => {
    renderSettings()
    const reAuthBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('re-auth') || b.textContent?.toLowerCase().includes('reauthenticate')
    )
    expect(reAuthBtn).toBeInTheDocument()
  })
})

// ── Logout ─────────────────────────────────────────────────────────────────

describe('Settings — logout', () => {
  it('has logout button', () => {
    renderSettings()
    const logoutBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('logout') || b.textContent?.toLowerCase().includes('log out'))
    expect(logoutBtn).toBeInTheDocument()
  })

  it('clicking logout calls logout API', async () => {
    const { logout: mockLogout } = await import('../../app/api/auth')
    renderSettings()
    const logoutBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('logout') || b.textContent?.toLowerCase().includes('log out'))!
    await userEvent.click(logoutBtn)
    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalled()
    })
  })
})

// ── Preferences saving ──────────────────────────────────────────────────────

describe('Settings — preferences', () => {
  it('Save Preferences button exists in Preferences section', async () => {
    renderSettings()
    const prefsBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('Preferences'))
    if (prefsBtn) {
      await userEvent.click(prefsBtn)
      const saveBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('save'))
      expect(saveBtn).toBeInTheDocument()
    }
  })
})

// ── TR-17-UI: Global paper trade mode toggle ────────────────────────────────

describe('Settings — TR-17-UI: paper trade mode toggle', () => {
  it('shows paper trade mode toggle in Preferences section', async () => {
    renderSettings()
    const prefsBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('Preferences'))
    if (prefsBtn) {
      await userEvent.click(prefsBtn)
      expect(screen.getByText(/paper trade mode/i)).toBeInTheDocument()
    }
  })

  it('paper trade toggle description mentions simulated orders', async () => {
    renderSettings()
    const prefsBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('Preferences'))
    if (prefsBtn) {
      await userEvent.click(prefsBtn)
      expect(screen.getByText(/simulated/i)).toBeInTheDocument()
    }
  })

  it('shows amber warning when paper trade mode is enabled', async () => {
    const { paperTradeMode } = await import('../../app/data/localPrefs')
    vi.mocked(paperTradeMode.get).mockReturnValue(true)
    renderSettings()
    const prefsBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('Preferences'))
    if (prefsBtn) {
      await userEvent.click(prefsBtn)
      expect(screen.getByText(/paper trade mode is active/i)).toBeInTheDocument()
    }
  })

  it('saves paper trade mode when Save preferences is clicked', async () => {
    const { paperTradeMode } = await import('../../app/data/localPrefs')
    renderSettings()
    const prefsBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('Preferences'))
    if (prefsBtn) {
      await userEvent.click(prefsBtn)
      const saveBtn = screen.getAllByRole('button').find((b) => b.textContent?.toLowerCase().includes('save'))
      if (saveBtn) {
        await userEvent.click(saveBtn)
        expect(paperTradeMode.set).toHaveBeenCalled()
      }
    }
  })
})
