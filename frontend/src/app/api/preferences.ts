import { apiFetch } from "./client";
import type {
  UIPreferences,
  UIPreferencesResponse,
  ChartPreferences,
  ChartPreferencesResponse,
  ColumnsResponse,
} from "./types";

export function getPreferences(): Promise<UIPreferencesResponse> {
  return apiFetch<UIPreferencesResponse>("/user/preferences");
}

export function savePreferences(prefs: UIPreferences): Promise<UIPreferencesResponse> {
  return apiFetch<UIPreferencesResponse>("/user/preferences", {
    method: "PUT",
    body: JSON.stringify(prefs),
  });
}

export function getColumns(): Promise<ColumnsResponse> {
  return apiFetch<ColumnsResponse>("/user/columns");
}

export function getChartPreferences(): Promise<ChartPreferencesResponse> {
  return apiFetch<ChartPreferencesResponse>("/user/preferences/chart");
}

export function saveChartPreferences(prefs: ChartPreferences): Promise<ChartPreferencesResponse> {
  return apiFetch<ChartPreferencesResponse>("/user/preferences/chart", {
    method: "PUT",
    body: JSON.stringify(prefs),
  });
}
