import { apiFetch } from "./client";
import type { UIPreferences, UIPreferencesResponse } from "./types";

export function getPreferences(): Promise<UIPreferencesResponse> {
  return apiFetch<UIPreferencesResponse>("/user/preferences");
}

export function savePreferences(prefs: UIPreferences): Promise<UIPreferencesResponse> {
  return apiFetch<UIPreferencesResponse>("/user/preferences", {
    method: "PUT",
    body: JSON.stringify(prefs),
  });
}
