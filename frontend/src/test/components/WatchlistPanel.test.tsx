/**
 * WatchlistPanel component tests
 *
 * Covers:
 *   - Loading / empty state rendering
 *   - Watchlist CRUD (create, rename, delete)
 *   - Add / remove instrument
 *   - Live price display (LTP + change colour)
 *   - Holdings badge ("N held")
 *   - Order intent callback (Buy / Sell buttons)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WatchlistOut } from '../../app/api/types'
import type { Holding } from '../../app/data/mockData'

// ---------------------------------------------------------------------------
// Mutable store state (shared by all tests; reset in beforeEach)
// ---------------------------------------------------------------------------

type StoreState = {
  watchlists: { data: WatchlistOut[] | null; fetchedAt: number }
  activeWatchlistId: string | null
  livePrices: Record<number, { ltp: number; change: number; open: number; high: number; low: number; close: number; volume: number; instrument_token: number }>
  holdings: { data: Holding[] | null; fetchedAt: number }
  setWatchlists: ReturnType<typeof vi.fn>
  setActiveWatchlistId: ReturnType<typeof vi.fn>
  isWatchlistsFresh: ReturnType<typeof vi.fn>
}

let storeState: StoreState

// Reset store state and all mock call counts before each test
beforeEach(() => {
  vi.clearAllMocks()
  storeState = {
    watchlists: { data: null, fetchedAt: 0 },
    activeWatchlistId: null,
    livePrices: {},
    holdings: { data: null, fetchedAt: 0 },
    setWatchlists: vi.fn(),
    setActiveWatchlistId: vi.fn(),
    isWatchlistsFresh: vi.fn(() => false),
  }
})

vi.mock('../../app/data/store', () => ({
  useAppStore: vi.fn((selector?: (s: StoreState) => unknown) =>
    selector ? selector(storeState) : storeState
  ),
}))

vi.mock('../../app/api/watchlist', () => ({
  getWatchlists: vi.fn(),
  createWatchlist: vi.fn(),
  renameWatchlist: vi.fn(),
  deleteWatchlist: vi.fn(),
  addToWatchlist: vi.fn(),
  removeFromWatchlist: vi.fn(),
}))

vi.mock('../../app/api/instruments', () => ({
  searchInstruments: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Import mocks AFTER vi.mock declarations
import {
  getWatchlists,
  createWatchlist,
  renameWatchlist,
  deleteWatchlist,
  addToWatchlist,
  removeFromWatchlist,
} from '../../app/api/watchlist'
import { searchInstruments } from '../../app/api/instruments'
import { toast } from 'sonner'
import { useAppStore } from '../../app/data/store'
import WatchlistPanel from '../../app/components/WatchlistPanel'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const WL_ID = 'wl-001'
const ITEM_ID = 'item-001'

const mockItem = {
  id: ITEM_ID,
  watchlist_id: WL_ID,
  instrument_token: 408065,
  tradingsymbol: 'INFY',
  exchange: 'NSE',
  display_order: 0,
  created_at: '2026-01-01T00:00:00Z',
}

const mockWatchlist: WatchlistOut = {
  id: WL_ID,
  name: 'Tech',
  display_order: 0,
  created_at: '2026-01-01T00:00:00Z',
  items: [mockItem],
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPanel(onClose = vi.fn(), onOrderIntent?: (symbol: string, exchange: string, side: "BUY" | "SELL") => void) {
  return render(<WatchlistPanel onClose={onClose} onOrderIntent={onOrderIntent} />)
}

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe('loading state', () => {
  it('shows loading indicator while fetching', async () => {
    vi.mocked(getWatchlists).mockReturnValue(new Promise(() => {})) // never resolves
    storeState.isWatchlistsFresh.mockReturnValue(false)

    renderPanel()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('does not fetch when watchlists are fresh', async () => {
    storeState.isWatchlistsFresh.mockReturnValue(true)
    storeState.watchlists = { data: [mockWatchlist], fetchedAt: Date.now() }

    renderPanel()

    expect(getWatchlists).not.toHaveBeenCalled()
    expect(screen.getByText('Tech')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('empty state', () => {
  it('shows empty placeholder when no watchlists exist', async () => {
    vi.mocked(getWatchlists).mockResolvedValue({ watchlists: [] })
    storeState.isWatchlistsFresh.mockReturnValue(false)

    renderPanel()

    await waitFor(() => expect(screen.getByText('No watchlists yet')).toBeInTheDocument())
  })

  it('clicking "Create one" shows the new-list input', async () => {
    vi.mocked(getWatchlists).mockResolvedValue({ watchlists: [] })
    renderPanel()

    await waitFor(() => screen.getByText('Create one'))
    await userEvent.click(screen.getByText('Create one'))

    expect(screen.getByPlaceholderText('List name…')).toBeInTheDocument()
  })

  it('shows empty list message when active watchlist has no items', async () => {
    const empty = { ...mockWatchlist, items: [] }
    storeState.watchlists = { data: [empty], fetchedAt: Date.now() }
    storeState.activeWatchlistId = WL_ID
    storeState.isWatchlistsFresh.mockReturnValue(true)

    renderPanel()

    expect(screen.getByText('Empty list')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Create watchlist
// ---------------------------------------------------------------------------

describe('create watchlist', () => {
  it('creates a watchlist on Enter and shows success toast', async () => {
    storeState.watchlists = { data: [], fetchedAt: Date.now() }
    storeState.isWatchlistsFresh.mockReturnValue(true)
    vi.mocked(createWatchlist).mockResolvedValue({ ...mockWatchlist, items: [] })

    renderPanel()

    await userEvent.click(screen.getByTitle('New watchlist'))
    await userEvent.type(screen.getByPlaceholderText('List name…'), 'Tech')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      expect(createWatchlist).toHaveBeenCalledWith('Tech')
      expect(toast.success).toHaveBeenCalledWith('Created "Tech"')
    })
  })

  it('creates a watchlist on button click', async () => {
    storeState.watchlists = { data: [], fetchedAt: Date.now() }
    storeState.isWatchlistsFresh.mockReturnValue(true)
    vi.mocked(createWatchlist).mockResolvedValue({ ...mockWatchlist, items: [] })

    renderPanel()

    await userEvent.click(screen.getByTitle('New watchlist'))
    await userEvent.type(screen.getByPlaceholderText('List name…'), 'Tech')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createWatchlist).toHaveBeenCalledWith('Tech'))
  })

  it('shows error toast when createWatchlist fails', async () => {
    storeState.watchlists = { data: [], fetchedAt: Date.now() }
    storeState.isWatchlistsFresh.mockReturnValue(true)
    vi.mocked(createWatchlist).mockRejectedValue(new Error('network'))

    renderPanel()

    await userEvent.click(screen.getByTitle('New watchlist'))
    await userEvent.type(screen.getByPlaceholderText('List name…'), 'Tech')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to create watchlist'))
  })

  it('Escape key cancels new-list input', async () => {
    storeState.watchlists = { data: [], fetchedAt: Date.now() }
    storeState.isWatchlistsFresh.mockReturnValue(true)

    renderPanel()

    await userEvent.click(screen.getByTitle('New watchlist'))
    expect(screen.getByPlaceholderText('List name…')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByPlaceholderText('List name…')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Rename watchlist
// ---------------------------------------------------------------------------

describe('rename watchlist', () => {
  beforeEach(() => {
    storeState.watchlists = { data: [mockWatchlist], fetchedAt: Date.now() }
    storeState.activeWatchlistId = WL_ID
    storeState.isWatchlistsFresh.mockReturnValue(true)
  })

  it('shows rename input on pencil click', async () => {
    renderPanel()

    await userEvent.click(screen.getByTitle('Rename'))
    expect(screen.getByDisplayValue('Tech')).toBeInTheDocument()
  })

  it('renames on Enter and shows toast', async () => {
    vi.mocked(renameWatchlist).mockResolvedValue({ ...mockWatchlist, name: 'Tech2' })

    renderPanel()

    await userEvent.click(screen.getByTitle('Rename'))
    const input = screen.getByDisplayValue('Tech')
    await userEvent.clear(input)
    await userEvent.type(input, 'Tech2')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      expect(renameWatchlist).toHaveBeenCalledWith(WL_ID, 'Tech2')
      expect(toast.success).toHaveBeenCalledWith('Renamed')
    })
  })

  it('Escape cancels rename', async () => {
    renderPanel()

    await userEvent.click(screen.getByTitle('Rename'))
    expect(screen.getByDisplayValue('Tech')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByDisplayValue('Tech')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Delete watchlist
// ---------------------------------------------------------------------------

describe('delete watchlist', () => {
  beforeEach(() => {
    storeState.watchlists = { data: [mockWatchlist], fetchedAt: Date.now() }
    storeState.activeWatchlistId = WL_ID
    storeState.isWatchlistsFresh.mockReturnValue(true)
  })

  it('deletes watchlist when user confirms', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(deleteWatchlist).mockResolvedValue(undefined)

    renderPanel()

    await userEvent.click(screen.getByTitle('Delete list'))

    await waitFor(() => {
      expect(deleteWatchlist).toHaveBeenCalledWith(WL_ID)
      expect(toast.success).toHaveBeenCalledWith('Watchlist deleted')
    })
  })

  it('does NOT delete when user cancels the confirm dialog', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderPanel()

    await userEvent.click(screen.getByTitle('Delete list'))

    expect(deleteWatchlist).not.toHaveBeenCalled()
  })

  it('shows error toast when deleteWatchlist fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(deleteWatchlist).mockRejectedValue(new Error('network'))

    renderPanel()

    await userEvent.click(screen.getByTitle('Delete list'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to delete watchlist'))
  })
})

// ---------------------------------------------------------------------------
// Instrument search + add
// ---------------------------------------------------------------------------

describe('add instrument', () => {
  beforeEach(() => {
    storeState.watchlists = { data: [{ ...mockWatchlist, items: [] }], fetchedAt: Date.now() }
    storeState.activeWatchlistId = WL_ID
    storeState.isWatchlistsFresh.mockReturnValue(true)
  })

  it('shows search results while typing', async () => {
    vi.mocked(searchInstruments).mockResolvedValue({
      results: [
        { instrument_token: 408065, tradingsymbol: 'INFY', exchange: 'NSE', name: 'Infosys Ltd', instrument_type: 'EQ', segment: 'NSE', lot_size: 1, tick_size: 0.05 },
      ],
    })

    renderPanel()

    const search = screen.getByPlaceholderText('Search to add…')
    await userEvent.type(search, 'INFY')

    await waitFor(() => expect(screen.getByText('Infosys Ltd')).toBeInTheDocument(), { timeout: 1000 })
  })

  it('adds instrument to watchlist on result click', async () => {
    vi.mocked(searchInstruments).mockResolvedValue({
      results: [
        { instrument_token: 408065, tradingsymbol: 'INFY', exchange: 'NSE', name: 'Infosys Ltd', instrument_type: 'EQ', segment: 'NSE', lot_size: 1, tick_size: 0.05 },
      ],
    })
    vi.mocked(addToWatchlist).mockResolvedValue(mockItem)

    renderPanel()

    const search = screen.getByPlaceholderText('Search to add…')
    await userEvent.type(search, 'INFY')

    await waitFor(() => screen.getByText('Infosys Ltd'))
    await userEvent.click(screen.getByText('INFY'))

    await waitFor(() => {
      expect(addToWatchlist).toHaveBeenCalledWith(WL_ID, {
        instrument_token: 408065,
        tradingsymbol: 'INFY',
        exchange: 'NSE',
      })
      expect(toast.success).toHaveBeenCalledWith('Added INFY')
    })
  })

  it('shows "Already in watchlist" for 409 duplicate', async () => {
    vi.mocked(searchInstruments).mockResolvedValue({
      results: [
        { instrument_token: 408065, tradingsymbol: 'INFY', exchange: 'NSE', name: 'Infosys Ltd', instrument_type: 'EQ', segment: 'NSE', lot_size: 1, tick_size: 0.05 },
      ],
    })
    vi.mocked(addToWatchlist).mockRejectedValue(new Error('409'))

    renderPanel()

    await userEvent.type(screen.getByPlaceholderText('Search to add…'), 'INFY')
    await waitFor(() => screen.getByText('INFY'))
    await userEvent.click(screen.getByText('INFY'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Already in watchlist'))
  })
})

// ---------------------------------------------------------------------------
// Remove instrument
// ---------------------------------------------------------------------------

describe('remove instrument', () => {
  beforeEach(() => {
    storeState.watchlists = { data: [mockWatchlist], fetchedAt: Date.now() }
    storeState.activeWatchlistId = WL_ID
    storeState.isWatchlistsFresh.mockReturnValue(true)
  })

  it('removes an item on X click', async () => {
    vi.mocked(removeFromWatchlist).mockResolvedValue(undefined)

    renderPanel()

    // Hover to reveal the remove button (opacity-0 → group-hover:opacity-100 handled in JSDOM via direct click)
    const removeBtn = screen.getByTitle('Remove from watchlist')
    await userEvent.click(removeBtn)

    await waitFor(() => {
      expect(removeFromWatchlist).toHaveBeenCalledWith(WL_ID, ITEM_ID)
    })
  })

  it('shows error toast when removeFromWatchlist fails', async () => {
    vi.mocked(removeFromWatchlist).mockRejectedValue(new Error('network'))

    renderPanel()

    await userEvent.click(screen.getByTitle('Remove from watchlist'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to remove'))
  })
})

// ---------------------------------------------------------------------------
// Live price display
// ---------------------------------------------------------------------------

describe('live price display', () => {
  beforeEach(() => {
    storeState.watchlists = { data: [mockWatchlist], fetchedAt: Date.now() }
    storeState.activeWatchlistId = WL_ID
    storeState.isWatchlistsFresh.mockReturnValue(true)
  })

  it('renders LTP and positive change in green', () => {
    storeState.livePrices = {
      408065: { instrument_token: 408065, ltp: 1567.25, change: 1.25, open: 1540, high: 1575, low: 1538, close: 1545, volume: 2_500_000 },
    }

    renderPanel()

    expect(screen.getByText('₹1567.25')).toBeInTheDocument()
    expect(screen.getByText(/▲/)).toBeInTheDocument()
    expect(screen.getByText(/1\.25%/)).toBeInTheDocument()
  })

  it('renders LTP and negative change in red', () => {
    storeState.livePrices = {
      408065: { instrument_token: 408065, ltp: 1490.0, change: -0.8, open: 1502, high: 1505, low: 1488, close: 1500, volume: 1_200_000 },
    }

    renderPanel()

    expect(screen.getByText('₹1490.00')).toBeInTheDocument()
    expect(screen.getByText(/▼/)).toBeInTheDocument()
  })

  it('renders dash when no live price available', () => {
    storeState.livePrices = {}

    renderPanel()

    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Holdings badge
// ---------------------------------------------------------------------------

describe('holdings badge', () => {
  beforeEach(() => {
    storeState.watchlists = { data: [mockWatchlist], fetchedAt: Date.now() }
    storeState.activeWatchlistId = WL_ID
    storeState.isWatchlistsFresh.mockReturnValue(true)
  })

  it('shows held qty badge when user holds the instrument', () => {
    storeState.holdings = {
      data: [{
        symbol: 'INFY', exchange: 'NSE', quantity: 5, t1Quantity: 0,
        avgPrice: 1400, ltp: 1500, dayChange: 20, dayChangePercent: 1.35,
        pnl: 500, pnlPercent: 7.14, currentValue: 7500, investedValue: 7000,
        instrumentToken: 408065,
      }] as unknown as Holding[],
      fetchedAt: Date.now(),
    }

    renderPanel()

    expect(screen.getByText('5 held')).toBeInTheDocument()
  })

  it('does NOT show held badge when quantity is 0', () => {
    storeState.holdings = {
      data: [{
        symbol: 'INFY', exchange: 'NSE', quantity: 0, t1Quantity: 0,
        avgPrice: 1400, ltp: 1500, dayChange: 0, dayChangePercent: 0,
        pnl: 0, pnlPercent: 0, currentValue: 0, investedValue: 0,
        instrumentToken: 408065,
      }] as unknown as Holding[],
      fetchedAt: Date.now(),
    }

    renderPanel()

    expect(screen.queryByText(/held/)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Order intent callback
// ---------------------------------------------------------------------------

describe('order intent (Buy / Sell buttons)', () => {
  beforeEach(() => {
    storeState.watchlists = { data: [mockWatchlist], fetchedAt: Date.now() }
    storeState.activeWatchlistId = WL_ID
    storeState.isWatchlistsFresh.mockReturnValue(true)
  })

  it('calls onOrderIntent with BUY when Buy button is clicked', async () => {
    const onOrderIntent = vi.fn()

    renderPanel(vi.fn(), onOrderIntent)

    await userEvent.click(screen.getByRole('button', { name: /buy/i }))

    expect(onOrderIntent).toHaveBeenCalledWith('INFY', 'NSE', 'BUY')
  })

  it('calls onOrderIntent with SELL when Sell button is clicked', async () => {
    const onOrderIntent = vi.fn()

    renderPanel(vi.fn(), onOrderIntent)

    await userEvent.click(screen.getByRole('button', { name: /sell/i }))

    expect(onOrderIntent).toHaveBeenCalledWith('INFY', 'NSE', 'SELL')
  })

  it('does NOT throw when onOrderIntent is not provided', async () => {
    renderPanel(vi.fn(), undefined)

    await expect(userEvent.click(screen.getByRole('button', { name: /buy/i }))).resolves.not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// onClose
// ---------------------------------------------------------------------------

describe('close button', () => {
  it('calls onClose when X button in header is clicked', async () => {
    storeState.watchlists = { data: [], fetchedAt: Date.now() }
    storeState.isWatchlistsFresh.mockReturnValue(true)
    vi.mocked(getWatchlists).mockResolvedValue({ watchlists: [] })
    const onClose = vi.fn()

    renderPanel(onClose)

    // The header X button has no title — find via its close context
    const allXButtons = screen.getAllByRole('button')
    const closeBtn = allXButtons.find(
      (b) => !b.getAttribute('title') && b.querySelector('svg')
    )
    if (closeBtn) await userEvent.click(closeBtn)

    expect(onClose).toHaveBeenCalled()
  })
})
