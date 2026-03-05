import { apiFetch } from "./client";
import type {
  LoginUrlResponse,
  MeResponse,
  LogoutResponse,
  RevokeAllResponse,
  RefreshResponse,
} from "./types";

export function getLoginUrl(): Promise<LoginUrlResponse> {
  return apiFetch<LoginUrlResponse>("/auth/login");
}

export function getMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>("/auth/me");
}

export function logout(): Promise<LogoutResponse> {
  return apiFetch<LogoutResponse>("/auth/logout", { method: "POST" });
}

export function revokeAllSessions(): Promise<RevokeAllResponse> {
  return apiFetch<RevokeAllResponse>("/auth/sessions/revoke-all", {
    method: "POST",
  });
}

export function refreshToken(): Promise<RefreshResponse> {
  return apiFetch<RefreshResponse>("/auth/refresh", { method: "POST" });
}
