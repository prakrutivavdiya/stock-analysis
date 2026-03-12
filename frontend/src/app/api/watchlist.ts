import { apiFetch } from "./client";
import type { WatchlistOut, WatchlistItemOut, WatchlistsResponse } from "./types";

export interface WatchlistItemAdd {
  instrument_token: number;
  tradingsymbol: string;
  exchange: string;
}

export const getWatchlists = () =>
  apiFetch<WatchlistsResponse>("/watchlist");

export const createWatchlist = (name: string) =>
  apiFetch<WatchlistOut>("/watchlist", {
    method: "POST",
    body: JSON.stringify({ name }),
  });

export const renameWatchlist = (id: string, name: string) =>
  apiFetch<WatchlistOut>(`/watchlist/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });

export const deleteWatchlist = (id: string) =>
  apiFetch<void>(`/watchlist/${id}`, { method: "DELETE" });

export const addToWatchlist = (wlId: string, item: WatchlistItemAdd) =>
  apiFetch<WatchlistItemOut>(`/watchlist/${wlId}/items`, {
    method: "POST",
    body: JSON.stringify(item),
  });

export const removeFromWatchlist = (wlId: string, itemId: string) =>
  apiFetch<void>(`/watchlist/${wlId}/items/${itemId}`, { method: "DELETE" });

export const reorderWatchlistItems = (wlId: string, itemIds: string[]) =>
  apiFetch<WatchlistOut>(`/watchlist/${wlId}/items/reorder`, {
    method: "PATCH",
    body: JSON.stringify({ item_ids: itemIds }),
  });
