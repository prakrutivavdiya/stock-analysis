/**
 * Login page component tests
 * PRD refs:
 *   C-01  — Login button fetches login_url from backend then redirects
 *   H-03  — Error states from ?error=cancelled|unauthorized and ?reason=expired
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'

vi.mock('../../app/api/auth', () => ({
  getLoginUrl: vi.fn(() =>
    Promise.resolve({ login_url: 'https://kite.zerodha.com/connect/login?api_key=test' })
  ),
}))

import Login from '../../app/pages/Login'

function renderLogin(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/login${search}`]}>
      <Login />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.stubGlobal('location', {
    ...window.location,
    assign: vi.fn(),
    hostname: 'localhost',
  })
})


// ── Basic render ──────────────────────────────────────────────────────────────

describe('Login — basic render', () => {
  it('renders StockPilot brand name', () => {
    renderLogin()
    expect(screen.getByText('StockPilot')).toBeInTheDocument()
  })

  it('renders "Login with Kite" button', () => {
    renderLogin()
    expect(screen.getByRole('button', { name: /login with kite/i })).toBeInTheDocument()
  })

  it('shows no error banner when no query params', () => {
    renderLogin()
    expect(screen.queryByText(/session has expired/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/access denied/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/cancelled/i)).not.toBeInTheDocument()
  })
})

// ── H-03: Error states ────────────────────────────────────────────────────────

describe('Login — H-03: error states', () => {
  it('shows "session expired" message for ?reason=expired', () => {
    renderLogin('?reason=expired')
    expect(screen.getByText(/your session has expired/i)).toBeInTheDocument()
  })

  it('shows "access denied" message for ?error=unauthorized', () => {
    renderLogin('?error=unauthorized')
    expect(screen.getByText(/access denied/i)).toBeInTheDocument()
  })

  it('shows "login failed or was cancelled" for ?error=cancelled', () => {
    renderLogin('?error=cancelled')
    expect(screen.getByText(/login failed or was cancelled/i)).toBeInTheDocument()
  })

  it('error banner uses red styling', () => {
    const { container } = renderLogin('?reason=expired')
    const banner = container.querySelector('.text-red-400')
    expect(banner).toBeInTheDocument()
  })

  it('each error shows a different message', () => {
    const { unmount } = renderLogin('?reason=expired')
    expect(screen.getByText(/session has expired/i)).toBeInTheDocument()
    unmount()

    renderLogin('?error=unauthorized')
    expect(screen.getByText(/access denied/i)).toBeInTheDocument()
  })
})

// ── C-01: Redirect flow ───────────────────────────────────────────────────────

describe('Login — C-01: redirect flow', () => {
  it('calls window.location.assign with Kite login URL on button click', async () => {
    renderLogin()
    const button = screen.getByRole('button', { name: /login with kite/i })
    await userEvent.click(button)

    await waitFor(() => {
      expect(window.location.assign).toHaveBeenCalledWith(
        expect.stringContaining('kite.zerodha.com')
      )
    })
  })

  it('shows loading text while redirecting', async () => {
    renderLogin()
    const button = screen.getByRole('button', { name: /login with kite/i })
    await userEvent.click(button)
    // During loading, shows "Redirecting…"
    expect(screen.queryByText(/redirecting/i)).toBeInTheDocument()
  })

  it('button is disabled while loading', async () => {
    renderLogin()
    const button = screen.getByRole('button', { name: /login with kite/i })
    await userEvent.click(button)
    expect(button).toBeDisabled()
  })
})

// ── Backend error fallback ────────────────────────────────────────────────────

describe('Login — backend unreachable', () => {
  it('falls back to alert when backend returns error', async () => {
    server.use(
      http.get('/api/v1/auth/login', () => HttpResponse.json({}, { status: 500 }))
    )
    vi.mocked(await import('../../app/api/auth')).getLoginUrl = vi.fn(() =>
      Promise.reject(new Error('Backend unreachable'))
    )
    vi.stubGlobal('alert', vi.fn())
    renderLogin()
    const button = screen.getByRole('button', { name: /login with kite/i })
    await userEvent.click(button)
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalled()
    }, { timeout: 3000 })
  })
})
