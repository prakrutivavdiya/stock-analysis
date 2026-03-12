/**
 * localStorage helpers — StockPilot
 *
 * DATA_MODEL spec: 6 separate keys (not a single blob).
 * All reads are safe (never throw); bad JSON falls back to defaults.
 *
 * Specified keys:
 *   pref_theme                  — "dark" | "light"
 *   pref_default_interval       — e.g. "D" (Charts interval code)
 *   pref_visible_kpi_columns    — string[] of KPI IDs
 *   pref_visible_holdings_columns — string[] of standard column IDs
 *   pref_holdings_sort          — { column: string; direction: "asc"|"desc" }
 *   chart_{token}_{interval}    — per-chart zoom/indicator/layout state
 *
 * Additional preference keys (not in spec but required by Settings page):
 *   pref_default_chart_style
 *   pref_holdings_refresh_interval
 *   pref_positions_refresh_interval
 *   pref_notify_order_success
 *   pref_notify_order_rejected
 *   pref_notify_gtt_trigger
 *   pref_notify_kite_session_expiry
 */

// ---------------------------------------------------------------------------
// Internal primitives
// ---------------------------------------------------------------------------

function _get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function _set(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage quota exceeded or private-browsing restriction — silently ignore
  }
}

function _remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // no-op
  }
}

function _getJson<T>(key: string, fallback: T): T {
  try {
    const raw = _get(key);
    return raw !== null ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// pref_theme — DATA_MODEL key
// ---------------------------------------------------------------------------

export type Theme = "dark" | "light";

export const theme = {
  key: "pref_theme",
  get(): Theme {
    const v = _get("pref_theme");
    return v === "light" ? "light" : "dark";
  },
  set(v: Theme): void {
    _set("pref_theme", v);
  },
};

// ---------------------------------------------------------------------------
// pref_default_interval — DATA_MODEL key
// Values match TradingView interval codes used in Charts.tsx
// ---------------------------------------------------------------------------

export type DefaultInterval = "5" | "15" | "30" | "60" | "D";

export const defaultInterval = {
  key: "pref_default_interval",
  get(): DefaultInterval {
    const v = _get("pref_default_interval");
    const valid: DefaultInterval[] = ["5", "15", "30", "60", "D"];
    return (valid.includes(v as DefaultInterval) ? v : "D") as DefaultInterval;
  },
  set(v: DefaultInterval): void {
    _set("pref_default_interval", v);
  },
};

// ---------------------------------------------------------------------------
// pref_visible_kpi_columns — DATA_MODEL key
// Array of KPI definition UUIDs to display as columns in the portfolio table
// ---------------------------------------------------------------------------

export const visibleKpiColumns = {
  key: "pref_visible_kpi_columns",
  get(): string[] {
    return _getJson<string[]>("pref_visible_kpi_columns", []);
  },
  set(v: string[]): void {
    _set("pref_visible_kpi_columns", JSON.stringify(v));
  },
};

// ---------------------------------------------------------------------------
// pref_visible_holdings_columns — DATA_MODEL key
// Array of standard column IDs shown in the portfolio table
// (allows hiding columns like Exchange)
// ---------------------------------------------------------------------------

export const visibleHoldingsColumns = {
  key: "pref_visible_holdings_columns",
  get(): string[] {
    return _getJson<string[]>("pref_visible_holdings_columns", []);
  },
  set(v: string[]): void {
    _set("pref_visible_holdings_columns", JSON.stringify(v));
  },
};

// ---------------------------------------------------------------------------
// pref_holdings_sort — DATA_MODEL key
// Last sort state for the holdings table
// ---------------------------------------------------------------------------

export interface HoldingsSort {
  column: string;
  direction: "asc" | "desc";
}

export const holdingsSort = {
  key: "pref_holdings_sort",
  get(): HoldingsSort {
    return _getJson<HoldingsSort>("pref_holdings_sort", {
      column: "symbol",
      direction: "asc",
    });
  },
  set(v: HoldingsSort): void {
    _set("pref_holdings_sort", JSON.stringify(v));
  },
};

// ---------------------------------------------------------------------------
// chart_{token}_{interval} — DATA_MODEL key pattern
// Per-chart zoom range, active indicators, and panel layout
// ---------------------------------------------------------------------------

export interface ChartUIState {
  zoomFrom?: number;   // epoch seconds
  zoomTo?: number;     // epoch seconds
  activeIndicators?: string[];
  panelLayout?: unknown;
}

export const chartUIState = {
  keyFor(instrumentToken: number, interval: string): string {
    return `chart_${instrumentToken}_${interval}`;
  },
  get(instrumentToken: number, interval: string): ChartUIState {
    return _getJson<ChartUIState>(
      `chart_${instrumentToken}_${interval}`,
      {},
    );
  },
  set(instrumentToken: number, interval: string, v: ChartUIState): void {
    _set(`chart_${instrumentToken}_${interval}`, JSON.stringify(v));
  },
  remove(instrumentToken: number, interval: string): void {
    _remove(`chart_${instrumentToken}_${interval}`);
  },
};

// ---------------------------------------------------------------------------
// Additional preference keys (required by Settings page; not individually
// named in DATA_MODEL spec but within the "User preferences" storage bucket)
// ---------------------------------------------------------------------------

export type ChartStyle = "Candles" | "Bars" | "Line" | "Area";

export const defaultChartStyle = {
  key: "pref_default_chart_style",
  get(): ChartStyle {
    const v = _get("pref_default_chart_style");
    const valid: ChartStyle[] = ["Candles", "Bars", "Line", "Area"];
    return (valid.includes(v as ChartStyle) ? v : "Candles") as ChartStyle;
  },
  set(v: ChartStyle): void {
    _set("pref_default_chart_style", v);
  },
};

export type RefreshInterval = "30" | "60" | "90" | "off";

export const holdingsRefreshInterval = {
  key: "pref_holdings_refresh_interval",
  get(): RefreshInterval {
    const v = _get("pref_holdings_refresh_interval");
    const valid: RefreshInterval[] = ["30", "60", "90", "off"];
    return (valid.includes(v as RefreshInterval) ? v : "60") as RefreshInterval;
  },
  set(v: RefreshInterval): void {
    _set("pref_holdings_refresh_interval", v);
  },
};

export const positionsRefreshInterval = {
  key: "pref_positions_refresh_interval",
  get(): RefreshInterval {
    const v = _get("pref_positions_refresh_interval");
    const valid: RefreshInterval[] = ["30", "60", "90", "off"];
    return (valid.includes(v as RefreshInterval) ? v : "60") as RefreshInterval;
  },
  set(v: RefreshInterval): void {
    _set("pref_positions_refresh_interval", v);
  },
};

export const notifyOnOrderSuccess = {
  key: "pref_notify_order_success",
  get(): boolean {
    return _get("pref_notify_order_success") !== "false";
  },
  set(v: boolean): void {
    _set("pref_notify_order_success", String(v));
  },
};

export const notifyOnOrderRejected = {
  key: "pref_notify_order_rejected",
  get(): boolean {
    return _get("pref_notify_order_rejected") !== "false";
  },
  set(v: boolean): void {
    _set("pref_notify_order_rejected", String(v));
  },
};

export const notifyOnGTTTrigger = {
  key: "pref_notify_gtt_trigger",
  get(): boolean {
    return _get("pref_notify_gtt_trigger") !== "false";
  },
  set(v: boolean): void {
    _set("pref_notify_gtt_trigger", String(v));
  },
};

// TR-17: Global paper trade mode — when on, all orders are simulated
export const paperTradeMode = {
  key: "pref_paper_trade_mode",
  get(): boolean {
    return _get("pref_paper_trade_mode") === "true";
  },
  set(v: boolean): void {
    _set("pref_paper_trade_mode", String(v));
  },
};

// AU-05 / US-095: Kite session expiry warning cannot be permanently suppressed
// This pref is read-only true from a product perspective but stored for completeness
export const notifyOnKiteSessionExpiry = {
  key: "pref_notify_kite_session_expiry",
  get(): true {
    return true; // PRD: cannot be permanently suppressed
  },
  // setter is a no-op: the value is always true per product requirement
  set(_v: boolean): void {
    // intentionally ignored — AU-05 prohibits suppressing this notification
  },
};

// ---------------------------------------------------------------------------
// Migrate from legacy single-blob key (stockpilot_prefs → separate keys)
// Call once on app startup; idempotent.
// ---------------------------------------------------------------------------

interface LegacyPrefsBlob {
  theme?: string;
  defaultInterval?: string;
  defaultChartStyle?: string;
  holdingsRefreshInterval?: string;
  positionsRefreshInterval?: string;
  notifyOnOrderSuccess?: boolean;
  notifyOnOrderRejected?: boolean;
  notifyOnGTTTrigger?: boolean;
}

const LEGACY_KEY = "stockpilot_prefs";

export function migrateLegacyPrefs(): void {
  const raw = _get(LEGACY_KEY);
  if (!raw) return; // nothing to migrate

  try {
    const blob = JSON.parse(raw) as LegacyPrefsBlob;

    // Only write if the new key is not already set (avoid overwriting user changes)
    if (blob.theme && !_get("pref_theme"))
      theme.set(blob.theme as Theme);
    if (blob.defaultInterval && !_get("pref_default_interval"))
      defaultInterval.set(blob.defaultInterval as DefaultInterval);
    if (blob.defaultChartStyle && !_get("pref_default_chart_style"))
      defaultChartStyle.set(blob.defaultChartStyle as ChartStyle);
    if (blob.holdingsRefreshInterval && !_get("pref_holdings_refresh_interval"))
      holdingsRefreshInterval.set(blob.holdingsRefreshInterval as RefreshInterval);
    if (blob.positionsRefreshInterval && !_get("pref_positions_refresh_interval"))
      positionsRefreshInterval.set(blob.positionsRefreshInterval as RefreshInterval);
    if (blob.notifyOnOrderSuccess !== undefined && !_get("pref_notify_order_success"))
      notifyOnOrderSuccess.set(blob.notifyOnOrderSuccess);
    if (blob.notifyOnOrderRejected !== undefined && !_get("pref_notify_order_rejected"))
      notifyOnOrderRejected.set(blob.notifyOnOrderRejected);
    if (blob.notifyOnGTTTrigger !== undefined && !_get("pref_notify_gtt_trigger"))
      notifyOnGTTTrigger.set(blob.notifyOnGTTTrigger);

    _remove(LEGACY_KEY); // clean up after successful migration
  } catch {
    // Corrupt blob — remove it silently
    _remove(LEGACY_KEY);
  }
}
