import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAppStore } from "../data/store";
import type { AlertWsMessage } from "./types";

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
 * the Zustand livePrices slice.  Alert messages trigger Sonner toasts and
 * are stored in the alertNotifications slice.
 *
 * Auto-reconnects after 3 s on close.  Call once at the AppShell level.
 */
export function useQuotesSocket() {
  const setLivePrices      = useAppStore((s) => s.setLivePrices);
  const addAlertNotif      = useAppStore((s) => s.addAlertNotification);
  const incrementUnread    = useAppStore((s) => s.incrementUnread);
  const upsertAlert        = useAppStore((s) => s.upsertAlert);
  const wsRef    = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let destroyed = false;

    function connect() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/ws/quotes`);
      wsRef.current = ws;

      ws.onmessage = (e: MessageEvent) => {
        try {
          const msg = JSON.parse(e.data as string) as { type: string; data: unknown };
          if (msg.type === "tick") {
            setLivePrices(msg.data as LiveTick[]);
          } else if (msg.type === "alert") {
            const d = msg.data as AlertWsMessage;
            // Add to notification history
            addAlertNotif({
              id: d.alert_id,          // reuse alert_id as notification id for WS delivery
              alert_id: d.alert_id,
              tradingsymbol: d.tradingsymbol,
              exchange: d.exchange,
              triggered_at: d.triggered_at,
              trigger_price: String(d.trigger_price),
              message: d.message,
            });
            incrementUnread();
            // Update the alert status in the store if it's already cached
            upsertAlert({
              id: d.alert_id,
              tradingsymbol: d.tradingsymbol,
              exchange: d.exchange,
              instrument_token: 0,   // unknown from WS payload — page will refetch
              condition_type: d.condition_type,
              threshold: d.threshold,
              note: null,
              status: "TRIGGERED",
              triggered_at: d.triggered_at,
              created_at: d.triggered_at,
              updated_at: d.triggered_at,
              last_notification: null,
            });
            // Show toast
            toast(`🔔 ${d.tradingsymbol} alert triggered`, {
              description: d.message,
              duration: 8_000,
            });
          }
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
  }, [setLivePrices, addAlertNotif, incrementUnread, upsertAlert]);
}
