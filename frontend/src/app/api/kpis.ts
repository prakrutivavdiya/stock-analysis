import { apiFetch } from "./client";
import type {
  KPIOut,
  KPIPortfolioResponse,
  KPIComputeResponse,
} from "./types";
import type { KPI } from "../data/mockData";

export function listKpis(): Promise<{ kpis: KPIOut[] }> {
  return apiFetch<{ kpis: KPIOut[] }>("/kpis");
}

export function createKpi(body: {
  name: string;
  formula: string;
  return_type: "SCALAR" | "BOOLEAN" | "CATEGORICAL";
  description?: string;
}): Promise<KPIOut> {
  return apiFetch<KPIOut>("/kpis", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateKpi(
  id: string,
  body: Partial<{
    name: string;
    formula: string;
    return_type: "SCALAR" | "BOOLEAN" | "CATEGORICAL";
    description: string;
    is_active: boolean;
    display_order: number;
  }>
): Promise<KPIOut> {
  return apiFetch<KPIOut>(`/kpis/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteKpi(id: string): Promise<void> {
  return apiFetch<void>(`/kpis/${id}`, { method: "DELETE" });
}

export function computeKpi(
  id: string,
  body: {
    instrument_tokens: number[];
    as_of_date: string;
    interval?: string;
  }
): Promise<KPIComputeResponse> {
  return apiFetch<KPIComputeResponse>(`/kpis/${id}/compute`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getKpiPortfolio(): Promise<KPIPortfolioResponse> {
  return apiFetch<KPIPortfolioResponse>("/kpis/portfolio");
}

// ---------------------------------------------------------------------------
// Mapper: backend KPIOut → frontend KPI type
// ---------------------------------------------------------------------------

export function mapKpi(k: KPIOut): KPI {
  return {
    id: k.id,
    name: k.name,
    formula: k.formula,
    returnType: k.return_type,
    description: k.description ?? undefined,
    active: k.is_active,
    createdAt: k.created_at.slice(0, 10),
  };
}
