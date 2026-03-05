import { apiFetch } from "./client";
import type { InstrumentSearchResponse, InstrumentDetail } from "./types";

export function searchInstruments(
  q: string,
  exchange?: string
): Promise<InstrumentSearchResponse> {
  const qs = new URLSearchParams({ q });
  if (exchange) qs.set("exchange", exchange);
  return apiFetch<InstrumentSearchResponse>(
    `/instruments/search?${qs.toString()}`
  );
}

export function getInstrument(token: number): Promise<InstrumentDetail> {
  return apiFetch<InstrumentDetail>(`/instruments/${token}`);
}
