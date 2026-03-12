import { useEffect, useRef } from "react";
import { useAppStore } from "../data/store";

export interface LiveTick {
  instrument_token: number;
  ltp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  volume: number;
  last_trade_time: string | null;
}

/**
 * Opens a WebSocket connection to /ws/quotes and pipes tick data into
 * the Zustand livePrices slice.  Auto-reconnects after 3 s on close.
 *
 * Call once at the AppShell level so there is a single shared connection
 * for the entire app.
 */
export function useQuotesSocket() {
  const setLivePrices = useAppStore((s) => s.setLivePrices);
  const wsRef    = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let destroyed = false;

    function connect() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      // Vite dev proxy forwards /ws → localhost:8000, so direct ws to the same host works
      const ws = new WebSocket(`${proto}//${location.host}/ws/quotes`);
      wsRef.current = ws;

      ws.onmessage = (e: MessageEvent) => {
        try {
          const msg = JSON.parse(e.data as string) as { type: string; data: LiveTick[] };
          if (msg.type === "tick") setLivePrices(msg.data);
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (!destroyed) retryRef.current = setTimeout(connect, 3_000);
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [setLivePrices]);
}
