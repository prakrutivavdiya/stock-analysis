/**
 * Alerts management page — /alerts
 *
 * Lists all user alerts with status, condition details, and last notification.
 * Supports create, edit, toggle, and delete operations.
 * Also shows notification history tab.
 */
import { useState, useEffect, useCallback } from "react";
import { Bell, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  getAlerts,
  deleteAlert,
  toggleAlert,
  getNotifications,
} from "../api/alerts";
import AlertFormModal from "../components/AlertFormModal";
import { useAppStore } from "../data/store";
import type { AlertOut, AlertNotificationOut } from "../api/types";
import { ApiError } from "../api/client";

type Tab = "alerts" | "history";

const STATUS_COLORS: Record<string, string> = {
  ACTIVE:    "text-green-400  bg-green-400/10  border-green-400/20",
  TRIGGERED: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  DISABLED:  "text-muted-foreground bg-[#1e1e1e] border-[#2a2a2a]",
};

function ConditionBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    PRICE_ABOVE:       "↑ Above",
    PRICE_BELOW:       "↓ Below",
    PRICE_CROSS_ABOVE: "⤴ Cross ↑",
    PRICE_CROSS_BELOW: "⤵ Cross ↓",
    PCT_CHANGE_ABOVE:  "% ↑",
    PCT_CHANGE_BELOW:  "% ↓",
  };
  return (
    <span className="text-[11px] font-mono text-muted-foreground">
      {map[type] ?? type}
    </span>
  );
}

function isPct(type: string) {
  return type === "PCT_CHANGE_ABOVE" || type === "PCT_CHANGE_BELOW";
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}

export default function Alerts() {
  const [tab, setTab] = useState<Tab>("alerts");
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<AlertNotificationOut[]>([]);

  const alerts         = useAppStore((s) => s.alerts);
  const setAlerts      = useAppStore((s) => s.setAlerts);
  const upsertAlert    = useAppStore((s) => s.upsertAlert);
  const removeAlert    = useAppStore((s) => s.removeAlert);

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AlertOut | undefined>();

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAlerts({ limit: 200 });
      setAlerts(res.alerts);
    } catch {
      toast.error("Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, [setAlerts]);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await getNotifications({ limit: 100 });
      setNotifications(res.notifications);
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  useEffect(() => {
    if (tab === "history") void loadNotifications();
  }, [tab, loadNotifications]);

  const handleToggle = async (alert: AlertOut) => {
    try {
      const updated = await toggleAlert(alert.id);
      upsertAlert(updated);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to toggle alert";
      toast.error(msg);
    }
  };

  const handleDelete = async (alert: AlertOut) => {
    if (!confirm(`Delete alert for ${alert.tradingsymbol}?`)) return;
    try {
      await deleteAlert(alert.id);
      removeAlert(alert.id);
      toast.success("Alert deleted");
    } catch {
      toast.error("Failed to delete alert");
    }
  };

  const handleEdit = (alert: AlertOut) => {
    setEditTarget(alert);
    setModalOpen(true);
  };

  const handleCreate = () => {
    setEditTarget(undefined);
    setModalOpen(true);
  };

  const handleSaved = (saved: AlertOut) => {
    upsertAlert(saved);
  };

  const filtered = statusFilter === "ALL"
    ? alerts
    : alerts.filter((a) => a.status === statusFilter);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bell className="w-5 h-5 text-[#FF6600]" />
          <div>
            <h1 className="font-semibold text-lg">Alerts</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              One-shot price &amp; % change alerts — auto-disabled after trigger
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadAlerts}
            disabled={loading}
            className="p-2 hover:bg-[#2a2a2a] rounded text-muted-foreground"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={handleCreate}
            className="flex items-center gap-2 px-3 py-2 bg-[#FF6600] hover:bg-[#e55500] text-white text-sm rounded font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> New Alert
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-[#2a2a2a]">
        {(["alerts", "history"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize transition-colors -mb-px border-b-2 ${
              tab === t
                ? "border-[#FF6600] text-[#FF6600]"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "alerts" ? `Alerts (${alerts.length})` : "History"}
          </button>
        ))}
      </div>

      {/* ── Alerts tab ──────────────────────────────────────────────── */}
      {tab === "alerts" && (
        <>
          {/* Filter */}
          <div className="flex gap-2 mb-4">
            {["ALL", "ACTIVE", "TRIGGERED", "DISABLED"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  statusFilter === s
                    ? "bg-[#FF6600] border-[#FF6600] text-white"
                    : "border-[#2a2a2a] text-muted-foreground hover:border-[#444]"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
              <Bell className="w-10 h-10 opacity-20" />
              <p className="text-sm">No alerts yet</p>
              <button
                onClick={handleCreate}
                className="text-sm text-[#FF6600] hover:underline"
              >
                Set your first alert
              </button>
            </div>
          ) : (
            <div className="border border-[#2a2a2a] rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#1a1a1a] text-xs text-muted-foreground">
                    <th className="text-left px-4 py-3">Symbol</th>
                    <th className="text-left px-4 py-3">Condition</th>
                    <th className="text-right px-4 py-3">Threshold</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Note</th>
                    <th className="text-left px-4 py-3 hidden lg:table-cell">Triggered</th>
                    <th className="text-right px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr
                      key={a.id}
                      className="border-t border-[#1e1e1e] hover:bg-[#1a1a1a] transition-colors"
                    >
                      {/* Symbol */}
                      <td className="px-4 py-3">
                        <div className="font-medium">{a.tradingsymbol}</div>
                        <div className="text-[11px] text-muted-foreground">{a.exchange}</div>
                      </td>

                      {/* Condition */}
                      <td className="px-4 py-3">
                        <ConditionBadge type={a.condition_type} />
                      </td>

                      {/* Threshold */}
                      <td className="px-4 py-3 text-right font-mono">
                        {isPct(a.condition_type)
                          ? `${Number(a.threshold).toFixed(2)}%`
                          : `₹${Number(a.threshold).toFixed(2)}`}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 text-[11px] font-medium border rounded-full ${
                            STATUS_COLORS[a.status] ?? ""
                          }`}
                        >
                          {a.status}
                        </span>
                      </td>

                      {/* Note */}
                      <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell max-w-[120px] truncate">
                        {a.note ?? "—"}
                      </td>

                      {/* Triggered at */}
                      <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">
                        {a.triggered_at ? formatDateTime(a.triggered_at) : "—"}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {/* Toggle */}
                          <button
                            onClick={() => handleToggle(a)}
                            title={a.status === "ACTIVE" ? "Disable" : "Re-activate"}
                            className="p-1.5 hover:bg-[#2a2a2a] rounded text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {a.status === "ACTIVE"
                              ? <ToggleRight className="w-4 h-4 text-green-400" />
                              : <ToggleLeft className="w-4 h-4" />}
                          </button>

                          {/* Edit */}
                          <button
                            onClick={() => handleEdit(a)}
                            title="Edit"
                            className="p-1.5 hover:bg-[#2a2a2a] rounded text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => handleDelete(a)}
                            title="Delete"
                            className="p-1.5 hover:bg-[#2a2a2a] rounded text-muted-foreground hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── History tab ─────────────────────────────────────────────── */}
      {tab === "history" && (
        <>
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
              <Bell className="w-10 h-10 opacity-20" />
              <p className="text-sm">No alert history yet</p>
            </div>
          ) : (
            <div className="border border-[#2a2a2a] rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#1a1a1a] text-xs text-muted-foreground">
                    <th className="text-left px-4 py-3">Symbol</th>
                    <th className="text-right px-4 py-3">Trigger Price</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Message</th>
                    <th className="text-left px-4 py-3">Triggered At</th>
                  </tr>
                </thead>
                <tbody>
                  {notifications.map((n) => (
                    <tr
                      key={n.id}
                      className="border-t border-[#1e1e1e] hover:bg-[#1a1a1a] transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{n.tradingsymbol}</div>
                        <div className="text-[11px] text-muted-foreground">{n.exchange}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        {n.trigger_price ? `₹${Number(n.trigger_price).toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">
                        {n.message}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatDateTime(n.triggered_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Modal */}
      <AlertFormModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditTarget(undefined);
        }}
        onSaved={handleSaved}
        tradingsymbol={editTarget?.tradingsymbol ?? ""}
        exchange={editTarget?.exchange ?? "NSE"}
        instrumentToken={editTarget?.instrument_token ?? 0}
        editAlert={editTarget}
      />
    </div>
  );
}
