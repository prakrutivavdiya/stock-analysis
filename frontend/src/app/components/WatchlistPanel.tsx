import { useEffect, useRef, useState } from "react";
import { X, Plus, Search, Star, Pencil, Trash2, ShoppingCart, GripVertical, Bell } from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "../data/store";
import {
  getWatchlists,
  createWatchlist,
  renameWatchlist,
  deleteWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  reorderWatchlistItems,
} from "../api/watchlist";
import { searchInstruments } from "../api/instruments";
import type { WatchlistOut, WatchlistItemOut, InstrumentResult } from "../api/types";
import AlertFormModal from "./AlertFormModal";

interface Props {
  onClose: () => void;
  onOrderIntent?: (symbol: string, exchange: string, side: "BUY" | "SELL") => void;
}

function fmtVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

export default function WatchlistPanel({ onClose, onOrderIntent }: Props) {
  const {
    watchlists: wlCache,
    setWatchlists,
    isWatchlistsFresh,
    activeWatchlistId,
    setActiveWatchlistId,
    livePrices,
    holdings: holdingsCache,
  } = useAppStore();

  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<InstrumentResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [creatingList, setCreatingList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragItemId = useRef<string | null>(null);

  // Alert modal
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const [alertItem, setAlertItem] = useState<WatchlistItemOut | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const watchlists: WatchlistOut[] = wlCache.data ?? [];
  const activeList = watchlists.find((w) => w.id === activeWatchlistId) ?? watchlists[0] ?? null;
  const holdingsMap = new Map<number, number>(
    (holdingsCache.data ?? [])
      .filter((h) => h.instrumentToken != null)
      .map((h) => [h.instrumentToken as number, h.quantity])
  );

  // Load watchlists on mount (or if stale)
  useEffect(() => {
    if (isWatchlistsFresh()) return;
    setLoading(true);
    getWatchlists()
      .then((r) => {
        setWatchlists(r.watchlists);
        if (!activeWatchlistId && r.watchlists.length > 0) {
          setActiveWatchlistId(r.watchlists[0].id);
        }
      })
      .catch(() => toast.error("Failed to load watchlists"))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced instrument search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(async () => {
      try {
        const r = await searchInstruments(searchQuery);
        setSearchResults(r.results.slice(0, 8));
        setSearchOpen(true);
      } catch {
        // ignore
      }
    }, 300);
  }, [searchQuery]);

  // Close search dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function handleCreateList() {
    if (!newListName.trim()) return;
    try {
      const wl = await createWatchlist(newListName.trim());
      const updated = [...watchlists, wl];
      setWatchlists(updated);
      setActiveWatchlistId(wl.id);
      setNewListName("");
      setCreatingList(false);
      toast.success(`Created "${wl.name}"`);
    } catch {
      toast.error("Failed to create watchlist");
    }
  }

  async function handleRename(id: string) {
    if (!renameValue.trim()) return;
    try {
      const updated = await renameWatchlist(id, renameValue.trim());
      setWatchlists(watchlists.map((w) => (w.id === id ? updated : w)));
      setRenamingId(null);
      toast.success("Renamed");
    } catch {
      toast.error("Failed to rename watchlist");
    }
  }

  async function handleDeleteList(id: string) {
    if (!confirm("Delete this watchlist?")) return;
    try {
      await deleteWatchlist(id);
      const updated = watchlists.filter((w) => w.id !== id);
      setWatchlists(updated);
      if (activeWatchlistId === id) {
        setActiveWatchlistId(updated[0]?.id ?? null);
      }
      toast.success("Watchlist deleted");
    } catch {
      toast.error("Failed to delete watchlist");
    }
  }

  async function handleAddInstrument(result: InstrumentResult) {
    if (!activeList) {
      toast.error("Create a watchlist first");
      return;
    }
    setSearchQuery("");
    setSearchOpen(false);
    try {
      const item = await addToWatchlist(activeList.id, {
        instrument_token: result.instrument_token,
        tradingsymbol: result.tradingsymbol,
        exchange: result.exchange,
      });
      const updatedItems = [...activeList.items, item];
      const updatedWl = { ...activeList, items: updatedItems };
      setWatchlists(watchlists.map((w) => (w.id === activeList.id ? updatedWl : w)));
      toast.success(`Added ${result.tradingsymbol}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to add";
      toast.error(msg.includes("409") ? "Already in watchlist" : msg);
    }
  }

  async function handleRemoveItem(item: WatchlistItemOut) {
    if (!activeList) return;
    try {
      await removeFromWatchlist(activeList.id, item.id);
      const updatedItems = activeList.items.filter((i) => i.id !== item.id);
      const updatedWl = { ...activeList, items: updatedItems };
      setWatchlists(watchlists.map((w) => (w.id === activeList.id ? updatedWl : w)));
    } catch {
      toast.error("Failed to remove");
    }
  }

  async function handleReorder(newItems: WatchlistItemOut[]) {
    if (!activeList) return;
    // Optimistic update
    const updatedWl = { ...activeList, items: newItems };
    setWatchlists(watchlists.map((w) => (w.id === activeList.id ? updatedWl : w)));
    try {
      const result = await reorderWatchlistItems(activeList.id, newItems.map((i) => i.id));
      setWatchlists(watchlists.map((w) => (w.id === activeList.id ? result : w)));
    } catch {
      // Rollback
      setWatchlists(watchlists.map((w) => (w.id === activeList.id ? activeList : w)));
      toast.error("Failed to save order");
    }
  }

  return (
    <div className="fixed top-14 right-0 bottom-0 w-80 bg-[#121212] border-l border-[#2a2a2a] z-40 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2a2a2a]">
        <div className="flex items-center gap-2">
          <Star className="w-4 h-4 text-[#FF6600]" />
          <span className="font-semibold text-sm">Watchlist</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCreatingList(true)}
            className="p-1.5 hover:bg-[#2a2a2a] rounded text-muted-foreground hover:text-foreground"
            title="New watchlist"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[#2a2a2a] rounded text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* New list input */}
      {creatingList && (
        <div className="px-3 py-2 border-b border-[#2a2a2a] flex gap-2">
          <input
            autoFocus
            className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-sm focus:outline-none focus:border-[#FF6600]"
            placeholder="List name…"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateList();
              if (e.key === "Escape") setCreatingList(false);
            }}
          />
          <button
            onClick={handleCreateList}
            className="px-2 py-1 bg-[#FF6600] hover:bg-[#ff7700] rounded text-xs font-medium text-white"
          >
            Create
          </button>
        </div>
      )}

      {/* Watchlist tabs */}
      {watchlists.length > 0 && (
        <div className="flex gap-1 px-3 py-2 border-b border-[#2a2a2a] overflow-x-auto">
          {watchlists.map((wl) => (
            <button
              key={wl.id}
              onClick={() => setActiveWatchlistId(wl.id)}
              className={`whitespace-nowrap px-3 py-1 rounded text-xs font-medium transition-colors ${
                activeList?.id === wl.id
                  ? "bg-[#FF6600] text-white"
                  : "bg-[#1a1a1a] text-muted-foreground hover:text-foreground"
              }`}
            >
              {wl.name}
            </button>
          ))}
        </div>
      )}

      {/* Active list header with rename / delete */}
      {activeList && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#2a2a2a]">
          {renamingId === activeList.id ? (
            <input
              autoFocus
              className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-xs focus:outline-none focus:border-[#FF6600]"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename(activeList.id);
                if (e.key === "Escape") setRenamingId(null);
              }}
            />
          ) : (
            <span className="text-xs text-muted-foreground">
              {activeList.items.length} instrument{activeList.items.length !== 1 ? "s" : ""}
            </span>
          )}
          <div className="flex gap-1">
            <button
              onClick={() => {
                setRenamingId(activeList.id);
                setRenameValue(activeList.name);
              }}
              className="p-1 hover:bg-[#2a2a2a] rounded text-muted-foreground hover:text-foreground"
              title="Rename"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={() => handleDeleteList(activeList.id)}
              className="p-1 hover:bg-[#2a2a2a] rounded text-muted-foreground hover:text-red-400"
              title="Delete list"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-2 border-b border-[#2a2a2a]" ref={searchRef}>
        <div className="relative flex items-center">
          <Search className="absolute left-2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded pl-7 pr-2 py-1.5 text-sm focus:outline-none focus:border-[#FF6600]"
            placeholder="Search to add…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
          />
        </div>
        {searchOpen && searchResults.length > 0 && (
          <div className="absolute left-0 right-0 mx-3 bg-[#1a1a1a] border border-[#2a2a2a] rounded mt-1 z-50 shadow-lg max-h-56 overflow-y-auto">
            {searchResults.map((r) => (
              <button
                key={r.instrument_token}
                className="w-full text-left px-3 py-2 hover:bg-[#2a2a2a] flex items-center justify-between"
                onClick={() => handleAddInstrument(r)}
              >
                <div>
                  <span className="text-sm font-medium">{r.tradingsymbol}</span>
                  <span className="text-xs text-muted-foreground ml-2">{r.exchange}</span>
                </div>
                <span className="text-xs text-muted-foreground truncate max-w-[120px]">{r.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Instrument rows */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-20 text-muted-foreground text-sm">
            Loading…
          </div>
        )}

        {!loading && watchlists.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-center px-4">
            <Star className="w-8 h-8 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">No watchlists yet</p>
            <button
              onClick={() => setCreatingList(true)}
              className="text-xs text-[#FF6600] hover:text-[#ff7700]"
            >
              Create one
            </button>
          </div>
        )}

        {!loading && activeList && activeList.items.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-1 text-center px-4">
            <p className="text-sm text-muted-foreground">Empty list</p>
            <p className="text-xs text-muted-foreground">Search above to add instruments</p>
          </div>
        )}

        {activeList?.items.map((item) => {
          const tick = livePrices[item.instrument_token];
          const up = tick ? tick.change >= 0 : null;
          const heldQty = holdingsMap.get(item.instrument_token);

          return (
            <div
              key={item.id}
              draggable
              onDragStart={() => { dragItemId.current = item.id; }}
              onDragOver={(e) => { e.preventDefault(); setDragOverId(item.id); }}
              onDragLeave={() => setDragOverId(null)}
              onDrop={() => {
                setDragOverId(null);
                if (!dragItemId.current || dragItemId.current === item.id || !activeList) return;
                const items = [...activeList.items];
                const fromIdx = items.findIndex((i) => i.id === dragItemId.current);
                const toIdx = items.findIndex((i) => i.id === item.id);
                if (fromIdx === -1 || toIdx === -1) return;
                const [moved] = items.splice(fromIdx, 1);
                items.splice(toIdx, 0, moved);
                handleReorder(items);
                dragItemId.current = null;
              }}
              onDragEnd={() => { dragItemId.current = null; setDragOverId(null); }}
              className={`group px-3 py-2.5 border-b border-[#1a1a1a] hover:bg-[#1a1a1a] transition-colors cursor-grab active:cursor-grabbing ${
                dragOverId === item.id ? "border-t-2 border-t-[#FF6600]" : ""
              }`}
            >
              {/* Row 1: grip + symbol + remove */}
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <GripVertical className="w-3 h-3 text-muted-foreground/30 shrink-0" />
                  <span className="font-medium text-sm truncate">{item.tradingsymbol}</span>
                  <span className="text-[10px] bg-[#2a2a2a] text-muted-foreground px-1.5 py-0.5 rounded">
                    {item.exchange}
                  </span>
                  {heldQty != null && heldQty > 0 && (
                    <span className="text-[10px] bg-green-900/40 text-green-400 px-1.5 py-0.5 rounded">
                      {heldQty} held
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleRemoveItem(item)}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#2a2a2a] rounded text-muted-foreground hover:text-red-400 transition-opacity"
                  title="Remove from watchlist"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>

              {/* Row 2: LTP + change */}
              <div className="flex items-center justify-between mb-1">
                {tick ? (
                  <>
                    <span className={`text-sm font-semibold ${up ? "text-green-400" : "text-red-400"}`}>
                      ₹{tick.ltp.toFixed(2)}
                    </span>
                    <span className={`text-xs ${up ? "text-green-400" : "text-red-400"}`}>
                      {up ? "▲" : "▼"} {up ? "+" : ""}{tick.change.toFixed(2)}%
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>

              {/* Row 3: OHLC + Vol */}
              {tick && (
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-2">
                  <span>O {tick.open.toFixed(0)}</span>
                  <span>H {tick.high.toFixed(0)}</span>
                  <span>L {tick.low.toFixed(0)}</span>
                  <span>C {tick.close.toFixed(0)}</span>
                  <span className="ml-auto">Vol {fmtVol(tick.volume)}</span>
                </div>
              )}

              {/* Row 4: Buy / Sell / Alert buttons */}
              <div className="flex gap-1.5">
                <button
                  onClick={() => onOrderIntent?.(item.tradingsymbol, item.exchange, "BUY")}
                  className="flex-1 flex items-center justify-center gap-1 py-1 rounded text-[11px] font-medium bg-green-900/30 text-green-400 hover:bg-green-900/60 transition-colors"
                >
                  <ShoppingCart className="w-3 h-3" />
                  Buy
                </button>
                <button
                  onClick={() => onOrderIntent?.(item.tradingsymbol, item.exchange, "SELL")}
                  className="flex-1 flex items-center justify-center gap-1 py-1 rounded text-[11px] font-medium bg-red-900/30 text-red-400 hover:bg-red-900/60 transition-colors"
                >
                  <ShoppingCart className="w-3 h-3" />
                  Sell
                </button>
                <button
                  onClick={() => { setAlertItem(item); setAlertModalOpen(true); }}
                  className="px-2 py-1 rounded text-[11px] font-medium border border-[#2a2a2a] text-muted-foreground hover:text-[#FF6600] hover:border-[#FF6600] transition-colors"
                  title="Set alert"
                >
                  <Bell className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Alert form modal for watchlist items */}
      {alertItem && (
        <AlertFormModal
          open={alertModalOpen}
          onClose={() => { setAlertModalOpen(false); setAlertItem(null); }}
          onSaved={() => { /* toast shown inside modal */ }}
          tradingsymbol={alertItem.tradingsymbol}
          exchange={alertItem.exchange}
          instrumentToken={alertItem.instrument_token}
          ltp={livePrices[alertItem.instrument_token]?.ltp}
        />
      )}
    </div>
  );
}
