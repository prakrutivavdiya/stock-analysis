/**
 * AlertBell — topbar bell icon with unread-count badge.
 * Clicking opens a slide-in drawer showing recent alert notifications.
 */
import { useState, useEffect, useCallback } from "react";
import { Bell, X, ExternalLink } from "lucide-react";
import { Link } from "react-router";
import { useAppStore } from "../data/store";
import { getNotifications, markAllNotificationsRead } from "../api/alerts";
import type { AlertNotificationOut } from "../api/types";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export default function AlertBell() {
  const [open, setOpen] = useState(false);
  const unreadCount       = useAppStore((s) => s.unreadAlertsCount);
  const alertNotifications = useAppStore((s) => s.alertNotifications);
  const setAlertNotifications = useAppStore((s) => s.setAlertNotifications);
  const resetUnread       = useAppStore((s) => s.resetUnread);

  // Load recent notifications when drawer opens
  const loadNotifications = useCallback(async () => {
    try {
      const res = await getNotifications({ limit: 20 });
      setAlertNotifications(res.notifications);
    } catch {
      // ignore — store may already have recent ones from WS
    }
  }, [setAlertNotifications]);

  useEffect(() => {
    if (open) {
      void loadNotifications();
      void markAllNotificationsRead().catch(() => undefined);
      resetUnread();
    }
  }, [open, loadNotifications, resetUnread]);

  const notifications: AlertNotificationOut[] = alertNotifications.slice(0, 20);

  return (
    <>
      {/* Bell button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative p-2 hover:bg-[#2a2a2a] rounded transition-colors ${
          open ? "text-[#FF6600]" : "text-muted-foreground hover:text-foreground"
        }`}
        title="Alerts"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 bg-[#FF6600] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Drawer overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer panel */}
      <div
        className={`fixed top-14 right-0 bottom-0 w-80 bg-[#121212] border-l border-[#2a2a2a] z-50 flex flex-col shadow-xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a]">
          <span className="font-medium text-sm">Recent Alerts</span>
          <div className="flex items-center gap-2">
            <Link
              to="/alerts"
              className="text-xs text-[#FF6600] hover:underline flex items-center gap-1"
              onClick={() => setOpen(false)}
            >
              Manage <ExternalLink className="w-3 h-3" />
            </Link>
            <button
              onClick={() => setOpen(false)}
              className="p-1 hover:bg-[#2a2a2a] rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Notifications list */}
        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
              <Bell className="w-8 h-8 opacity-30" />
              <p>No notifications yet</p>
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className="px-4 py-3 border-b border-[#1e1e1e] hover:bg-[#1a1a1a]"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-sm text-[#FF6600]">
                    {n.tradingsymbol}
                  </span>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {formatTime(n.triggered_at)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  {n.message}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
