import { apiFetch } from "./client";
import type {
  GTTListResponse,
  GTTCreateRequest,
  GTTModifyRequest,
  GTTPlaceResponse,
  GTTModifyResponse,
  ApiGTT,
} from "./types";
import type { GTTOrder } from "../data/mockData";

export function getGtts(): Promise<GTTListResponse> {
  return apiFetch<GTTListResponse>("/gtt");
}

export function placeGtt(body: GTTCreateRequest): Promise<GTTPlaceResponse> {
  return apiFetch<GTTPlaceResponse>("/gtt", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function modifyGtt(
  triggerId: number,
  body: GTTModifyRequest
): Promise<GTTModifyResponse> {
  return apiFetch<GTTModifyResponse>(`/gtt/${triggerId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteGtt(triggerId: number): Promise<void> {
  return apiFetch<void>(`/gtt/${triggerId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

export function mapGtt(g: ApiGTT): GTTOrder {
  return {
    id: String(g.trigger_id),
    symbol: g.tradingsymbol,
    type: g.trigger_type,
    transaction: g.transaction_type,
    quantity: g.quantity,
    status: g.status,
    // single-leg fields
    singleTrigger: g.trigger_value ?? undefined,
    singleLimit: g.limit_price ?? undefined,
    // two-leg fields
    upperTrigger: g.upper_trigger_value ?? undefined,
    upperLimit: g.upper_limit_price ?? undefined,
    lowerTrigger: g.lower_trigger_value ?? undefined,
    lowerLimit: g.lower_limit_price ?? undefined,
  };
}
