/**
 * API client functions for the /api/v1/alerts endpoints.
 */
import { apiFetch } from "./client";
import type {
  AlertOut,
  AlertsListResponse,
  AlertNotificationsListResponse,
  AlertCreateRequest,
  AlertUpdateRequest,
} from "./types";

const BASE = "/api/v1/alerts";

export async function getAlerts(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<AlertsListResponse> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.limit != null) q.set("limit", String(params.limit));
  if (params?.offset != null) q.set("offset", String(params.offset));
  const qs = q.toString();
  return apiFetch<AlertsListResponse>(`${BASE}${qs ? `?${qs}` : ""}`);
}

export async function createAlert(body: AlertCreateRequest): Promise<AlertOut> {
  return apiFetch<AlertOut>(BASE, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getAlert(alertId: string): Promise<AlertOut> {
  return apiFetch<AlertOut>(`${BASE}/${alertId}`);
}

export async function updateAlert(
  alertId: string,
  body: AlertUpdateRequest,
): Promise<AlertOut> {
  return apiFetch<AlertOut>(`${BASE}/${alertId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteAlert(alertId: string): Promise<void> {
  await apiFetch<void>(`${BASE}/${alertId}`, { method: "DELETE" });
}

export async function toggleAlert(alertId: string): Promise<AlertOut> {
  return apiFetch<AlertOut>(`${BASE}/${alertId}/toggle`, { method: "PATCH" });
}

export async function getNotifications(params?: {
  limit?: number;
  offset?: number;
}): Promise<AlertNotificationsListResponse> {
  const q = new URLSearchParams();
  if (params?.limit != null) q.set("limit", String(params.limit));
  if (params?.offset != null) q.set("offset", String(params.offset));
  const qs = q.toString();
  return apiFetch<AlertNotificationsListResponse>(
    `${BASE}/notifications${qs ? `?${qs}` : ""}`,
  );
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiFetch<void>(`${BASE}/notifications/read-all`, { method: "POST" });
}
