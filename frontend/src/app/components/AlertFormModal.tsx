/**
 * AlertFormModal — Create or edit a price alert.
 *
 * Props:
 *   open            — controls visibility
 *   onClose         — called when dismissed
 *   onSaved         — called with the saved/updated AlertOut
 *   tradingsymbol   — pre-fill symbol (read-only when editing)
 *   exchange        — pre-fill exchange
 *   instrumentToken — pre-fill instrument_token
 *   ltp             — suggested threshold (current price)
 *   editAlert       — if provided, we're editing an existing alert
 */
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { createAlert, updateAlert } from "../api/alerts";
import type { AlertOut, AlertConditionType, AlertUpdateRequest } from "../api/types";
import { ApiError } from "../api/client";

const CONDITION_LABELS: Record<AlertConditionType, string> = {
  PRICE_ABOVE:       "Price goes above",
  PRICE_BELOW:       "Price goes below",
  PRICE_CROSS_ABOVE: "Price crosses above (from below)",
  PRICE_CROSS_BELOW: "Price crosses below (from above)",
  PCT_CHANGE_ABOVE:  "% change above (intraday)",
  PCT_CHANGE_BELOW:  "% change below (intraday)",
};

const PCT_CONDITIONS: AlertConditionType[] = [
  "PCT_CHANGE_ABOVE",
  "PCT_CHANGE_BELOW",
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: (a: AlertOut) => void;
  tradingsymbol?: string;
  exchange?: string;
  instrumentToken?: number;
  ltp?: number;
  editAlert?: AlertOut;
}

export default function AlertFormModal({
  open,
  onClose,
  onSaved,
  tradingsymbol = "",
  exchange = "NSE",
  instrumentToken = 0,
  ltp,
  editAlert,
}: Props) {
  const isEdit = Boolean(editAlert);

  const [conditionType, setConditionType] = useState<AlertConditionType>(
    editAlert?.condition_type ?? "PRICE_ABOVE",
  );
  const [threshold, setThreshold] = useState(
    editAlert ? editAlert.threshold : ltp != null ? String(ltp) : "",
  );
  const [note, setNote] = useState(editAlert?.note ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when re-opened
  useEffect(() => {
    if (open) {
      setConditionType(editAlert?.condition_type ?? "PRICE_ABOVE");
      setThreshold(editAlert ? editAlert.threshold : ltp != null ? String(ltp) : "");
      setNote(editAlert?.note ?? "");
      setError(null);
    }
  }, [open, editAlert, ltp]);

  if (!open) return null;

  const isPct = PCT_CONDITIONS.includes(conditionType);
  const thresholdLabel = isPct ? "% Change" : "Price (₹)";
  const thresholdPlaceholder = isPct ? "e.g. 2.5" : "e.g. 1500.00";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const thr = parseFloat(threshold);
    if (isNaN(thr)) {
      setError("Please enter a valid threshold value.");
      return;
    }

    setLoading(true);
    try {
      let saved: AlertOut;
      if (isEdit && editAlert) {
        const body: AlertUpdateRequest = {
          condition_type: conditionType !== editAlert.condition_type ? conditionType : undefined,
          threshold: thr !== parseFloat(editAlert.threshold) ? thr : undefined,
          note: note !== (editAlert.note ?? "") ? note || undefined : undefined,
        };
        saved = await updateAlert(editAlert.id, body);
        toast.success(`Alert updated for ${editAlert.tradingsymbol}`);
      } else {
        saved = await createAlert({
          tradingsymbol: tradingsymbol.toUpperCase(),
          exchange: exchange.toUpperCase(),
          instrument_token: instrumentToken,
          condition_type: conditionType,
          threshold: thr,
          note: note || undefined,
        });
        toast.success(`Alert set for ${tradingsymbol.toUpperCase()}`);
      }
      onSaved(saved);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to save alert. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg w-full max-w-md shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a]">
          <div>
            <h2 className="font-semibold text-sm">
              {isEdit ? "Edit Alert" : "Set Alert"}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {tradingsymbol.toUpperCase() || editAlert?.tradingsymbol} · {exchange.toUpperCase() || editAlert?.exchange}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[#2a2a2a] rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Condition type */}
          <div>
            <label className="block text-xs font-medium mb-1.5">Condition</label>
            <select
              value={conditionType}
              onChange={(e) => setConditionType(e.target.value as AlertConditionType)}
              className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#FF6600]"
            >
              {(Object.entries(CONDITION_LABELS) as [AlertConditionType, string][]).map(
                ([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ),
              )}
            </select>
          </div>

          {/* Threshold */}
          <div>
            <label className="block text-xs font-medium mb-1.5">
              {thresholdLabel}
            </label>
            <input
              type="number"
              step="any"
              placeholder={thresholdPlaceholder}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#FF6600]"
              required
            />
            {ltp != null && !isEdit && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Current price: ₹{ltp.toFixed(2)}
              </p>
            )}
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-medium mb-1.5">
              Note <span className="text-muted-foreground">(optional)</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="e.g. breakout watch"
              className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#FF6600]"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm border border-[#2a2a2a] rounded hover:bg-[#2a2a2a] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm bg-[#FF6600] hover:bg-[#e55500] text-white rounded font-medium disabled:opacity-50 transition-colors"
            >
              {loading ? "Saving…" : isEdit ? "Update Alert" : "Set Alert"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
