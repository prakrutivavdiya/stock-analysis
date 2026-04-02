/**
 * TypeScript interfaces for all backend API response shapes.
 * Fields are in snake_case as returned by the FastAPI backend.
 */

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface MeResponse {
  user_id: string;
  name: string;
  email: string;
  exchange_memberships: string[];
  product_types: string[];
  paper_trade_mode: boolean;
  kite_session_valid: boolean;
  kite_token_expires_at: string | null;
  last_login_at: string | null;
}

export interface LoginUrlResponse {
  login_url: string;
}

export interface LogoutResponse {
  message: string;
}

export interface RevokeAllResponse {
  revoked_count: number;
}

export interface RefreshResponse {
  expires_in: number;
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

export interface ApiHolding {
  tradingsymbol: string;
  exchange: string;
  isin: string;
  instrument_token: number;
  quantity: number;
  t1_quantity: number;
  average_price: number;
  last_price: number;
  close_price: number;
  pnl: number;
  pnl_pct: number;
  day_change: number;
  day_change_pct: number;
  current_value: number;
  invested_value: number;
}

export interface HoldingsSummary {
  total_invested: number;
  total_current_value: number;
  total_pnl: number;
  total_pnl_pct: number;
  total_day_change: number;
  total_day_change_pct: number;
}

export interface HoldingsResponse {
  holdings: ApiHolding[];
  summary: HoldingsSummary;
}

export interface ApiPosition {
  tradingsymbol: string;
  exchange: string;
  product: string;
  instrument_token: number;
  quantity: number;
  average_price: number;
  last_price: number;
  pnl: number;
  unrealised: number;
  realised: number;
}

export interface PositionsResponse {
  positions: ApiPosition[];
}

export interface MarginsResponse {
  equity: {
    available_cash: number;
    opening_balance: number;
    used_debits: number;
  };
}

export interface PortfolioSummary {
  total_invested: number;
  current_value: number;
  total_pnl: number;
  total_pnl_pct: number;
  available_margin: number;
  holdings_count: number;
  profitable_count: number;
  loss_count: number;
  xirr: number | null;
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export interface KPIOut {
  id: string;
  name: string;
  formula: string;
  return_type: "SCALAR" | "BOOLEAN" | "CATEGORICAL";
  description: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface KPIPortfolioRow {
  tradingsymbol: string;
  instrument_token: number;
  kpi_values: Record<string, Record<string, unknown>>;
}

export interface KPIPortfolioResponse {
  as_of_date: string;
  kpis: Array<{ id: string; name: string; return_type: string }>;
  results: KPIPortfolioRow[];
}

export interface KPIComputeResponse {
  kpi_id: string;
  as_of_date: string;
  using_live_price: boolean;
  results: Record<string, { value: unknown; return_type: string }>;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface ApiOrder {
  order_id: string;
  tradingsymbol: string;
  exchange: string;
  transaction_type: "BUY" | "SELL";
  product: string;
  order_type: "MARKET" | "LIMIT" | "SL" | "SL-M";
  variety: "regular" | "co" | "amo" | "iceberg" | "auction";
  quantity: number;
  price: number;
  trigger_price: number | null;
  validity: "DAY" | "IOC" | "TTL";
  status: "OPEN" | "COMPLETE" | "REJECTED" | "CANCELLED";
  filled_quantity: number;
  average_price: number;
  placed_at: string;
  status_message?: string;
}

export interface OrdersResponse {
  orders: ApiOrder[];
}

export interface PlaceOrderRequest {
  tradingsymbol: string;
  exchange: string;
  transaction_type: "BUY" | "SELL";
  quantity: number;
  product: string;
  order_type: "MARKET" | "LIMIT" | "SL" | "SL-M";
  variety: string;
  price?: number;
  trigger_price?: number;
  validity: "DAY" | "IOC" | "TTL";
  validity_ttl?: number;
  paper_trade?: boolean;
}

export interface PlaceOrderResponse {
  order_id: string;
  audit_log_id: string;
  paper_trade: boolean;
}

export interface ModifyOrderResponse {
  order_id: string;
  status: string;
}

export interface CancelOrderResponse {
  order_id: string;
  status: string;
}

// ---------------------------------------------------------------------------
// GTT
// ---------------------------------------------------------------------------

export interface ApiGTT {
  trigger_id: number;
  tradingsymbol: string;
  exchange: string;
  trigger_type: "single" | "two-leg";
  transaction_type: "BUY" | "SELL";
  product: string;
  quantity: number;
  status: "ACTIVE" | "TRIGGERED" | "CANCELLED";
  // single-leg
  trigger_value: number | null;
  limit_price: number | null;
  // two-leg
  upper_trigger_value: number | null;
  upper_limit_price: number | null;
  lower_trigger_value: number | null;
  lower_limit_price: number | null;
}

export interface GTTListResponse {
  gtts: ApiGTT[];
}

export interface GTTCreateRequest {
  tradingsymbol: string;
  exchange: string;
  transaction_type: "BUY" | "SELL";
  product: "CNC" | "MIS" | "NRML";
  trigger_type: "single" | "two-leg";
  last_price: number;
  // single-leg
  trigger_value?: number;
  limit_price?: number;
  quantity?: number;
  // two-leg
  upper_trigger_value?: number;
  upper_limit_price?: number;
  upper_quantity?: number;
  lower_trigger_value?: number;
  lower_limit_price?: number;
  lower_quantity?: number;
}

export interface GTTModifyRequest {
  tradingsymbol: string;
  exchange: string;
  transaction_type: "BUY" | "SELL";
  product: "CNC" | "MIS" | "NRML";
  last_price: number;
  trigger_type: "single" | "two-leg";
  trigger_value?: number;
  limit_price?: number;
  quantity?: number;
  upper_trigger_value?: number;
  upper_limit_price?: number;
  upper_quantity?: number;
  lower_trigger_value?: number;
  lower_limit_price?: number;
  lower_quantity?: number;
}

export interface GTTPlaceResponse {
  trigger_id: number;
  audit_log_id: string;
}

export interface GTTModifyResponse {
  trigger_id: number;
  status: string;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditLogOut {
  id: string;
  user_id: string;
  action_type:
    | "PLACE_ORDER"
    | "MODIFY_ORDER"
    | "CANCEL_ORDER"
    | "PLACE_GTT"
    | "MODIFY_GTT"
    | "DELETE_GTT"
    | "PAPER_TRADE";
  tradingsymbol: string;
  exchange: string;
  order_params: Record<string, unknown>;
  kite_order_id: string | null;
  outcome: "SUCCESS" | "FAILURE";
  error_message: string | null;
  created_at: string;
}

export interface AuditResponse {
  total: number;
  logs: AuditLogOut[];
}

// ---------------------------------------------------------------------------
// Charts / Drawings
// ---------------------------------------------------------------------------

export interface DrawingOut {
  id: string;
  instrument_token: number;
  tradingsymbol: string;
  exchange: string;
  interval: string;
  drawing_type: string;
  drawing_data: Record<string, unknown>;
  label: string | null;
  created_at: string;
  updated_at: string;
}

export interface DrawingsResponse {
  instrument_token: number;
  interval: string;
  drawings: DrawingOut[];
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

export interface InstrumentResult {
  instrument_token: number;
  tradingsymbol: string;
  exchange: string;
  name: string;
  instrument_type: string;
  segment: string;
  lot_size: number;
  tick_size: number;
}

export interface InstrumentSearchResponse {
  results: InstrumentResult[];
}

export interface InstrumentDetail {
  instrument_token: number;
  tradingsymbol: string;
  exchange: string;
  name: string;
  instrument_type: string;
  segment: string;
  lot_size: number;
  tick_size: number;
  expiry: string | null;
  strike: number | null;
}

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export interface WatchlistItemOut {
  id: string;
  watchlist_id: string;
  instrument_token: number;
  tradingsymbol: string;
  exchange: string;
  display_order: number;
  created_at: string;
}

export interface WatchlistOut {
  id: string;
  name: string;
  display_order: number;
  created_at: string;
  items: WatchlistItemOut[];
}

export interface WatchlistsResponse {
  watchlists: WatchlistOut[];
}

// ---------------------------------------------------------------------------
// User Preferences (PD-09)
// ---------------------------------------------------------------------------

export interface HoldingsSortPreference {
  column: string;
  direction: "asc" | "desc";
}

export interface ChartPreferences {
  interval: string;
  chart_type: string;
  active_indicators: string[];
}

export interface ChartPreferencesResponse {
  chart_prefs: ChartPreferences;
}

export interface UIPreferences {
  visible_holdings_columns: string[];
  visible_user_kpi_columns?: string[];
  holdings_sort: HoldingsSortPreference;
  chart_prefs?: ChartPreferences;
}

export interface UIPreferencesResponse {
  preferences: UIPreferences;
}

// Column Definitions (GET /user/columns)
// ---------------------------------------------------------------------------

export type ColFilterType = "text" | "range" | "boolean" | "categorical";

export interface ColumnDefinition {
  id: string;
  label: string;
  align: "left" | "right";
  default_visible: boolean;
  filter_type: ColFilterType;
}

export interface ColumnsResponse {
  columns: ColumnDefinition[];
}
