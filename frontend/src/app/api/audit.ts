import { apiFetch } from "./client";
import type { AuditResponse, AuditLogOut } from "./types";
import type { AuditEntry } from "../data/mockData";

export function getAuditLogs(params: {
  from_date?: string;
  to_date?: string;
  tradingsymbol?: string;
  action_type?: string;
  limit?: number;
  offset?: number;
}): Promise<AuditResponse> {
  const qs = new URLSearchParams();
  if (params.from_date) qs.set("from_date", params.from_date);
  if (params.to_date) qs.set("to_date", params.to_date);
  if (params.tradingsymbol) qs.set("tradingsymbol", params.tradingsymbol);
  if (params.action_type && params.action_type !== "ALL")
    qs.set("action_type", params.action_type);
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));

  const query = qs.toString();
  return apiFetch<AuditResponse>(`/audit${query ? "?" + query : ""}`);
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

export function mapAuditLog(l: AuditLogOut): AuditEntry {
  return {
    id: l.id,
    timestamp: l.created_at.replace("T", " ").slice(0, 19),
    action: l.action_type,
    symbol: l.tradingsymbol,
    exchange: l.exchange,
    outcome: l.outcome,
    kiteOrderId: l.kite_order_id ?? undefined,
    requestId: l.id, // use DB id as request ID
    orderParams: l.order_params,
    errorMessage: l.error_message ?? undefined,
  };
}
