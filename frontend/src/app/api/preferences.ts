import { apiFetch } from "./client";
import type {
  UIPreferences,
  UIPreferencesResponse,
  ChartPreferences,
  ChartPreferencesResponse,
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

export function getChartPreferences(): Promise<ChartPreferencesResponse> {
  return apiFetch<ChartPreferencesResponse>("/user/preferences/chart");
}

export function saveChartPreferences(prefs: ChartPreferences): Promise<ChartPreferencesResponse> {
  return apiFetch<ChartPreferencesResponse>("/user/preferences/chart", {
    method: "PUT",
    body: JSON.stringify(prefs),
  });
}
