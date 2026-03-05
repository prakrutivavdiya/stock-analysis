import { apiFetch } from "./client";
import type { DrawingsResponse, DrawingOut } from "./types";

export function getDrawings(
  instrumentToken: number,
  interval: string
): Promise<DrawingsResponse> {
  return apiFetch<DrawingsResponse>(
    `/charts/${instrumentToken}/drawings?interval=${encodeURIComponent(interval)}`
  );
}

export function createDrawing(
  instrumentToken: number,
  body: {
    interval: string;
    drawing_type: string;
    drawing_data: Record<string, unknown>;
    label?: string;
  }
): Promise<DrawingOut> {
  return apiFetch<DrawingOut>(`/charts/${instrumentToken}/drawings`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateDrawing(
  instrumentToken: number,
  drawingId: string,
  body: { label?: string; drawing_data?: Record<string, unknown> }
): Promise<DrawingOut> {
  return apiFetch<DrawingOut>(
    `/charts/${instrumentToken}/drawings/${drawingId}`,
    { method: "PUT", body: JSON.stringify(body) }
  );
}

export function deleteDrawing(
  instrumentToken: number,
  drawingId: string
): Promise<void> {
  return apiFetch<void>(
    `/charts/${instrumentToken}/drawings/${drawingId}`,
    { method: "DELETE" }
  );
}

export function computeIndicators(params: {
  instrument_token: number;
  interval: string;
  from_date: string;
  to_date: string;
  indicators: string;
}): Promise<Record<string, unknown[]>> {
  const qs = new URLSearchParams({
    instrument_token: String(params.instrument_token),
    interval: params.interval,
    from_date: params.from_date,
    to_date: params.to_date,
    indicators: params.indicators,
  });
  return apiFetch<Record<string, unknown[]>>(
    `/charts/indicators/compute?${qs.toString()}`
  );
}
