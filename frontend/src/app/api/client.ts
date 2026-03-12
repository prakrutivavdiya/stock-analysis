/**
 * Base HTTP client for StockPilot backend API.
 *
 * All requests go to /api/v1/* — proxied to http://localhost:8000 in dev.
 * Cookies (httpOnly JWT + refresh token) are sent automatically via credentials: "include".
 * 401 responses redirect to /login.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = "/api/v1";

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const isWriteMethod =
    options.method && options.method !== "GET" && options.method !== "HEAD";

  const headers: HeadersInit = {
    ...(isWriteMethod ? { "Content-Type": "application/json" } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...options,
      credentials: "include",
      headers,
    });
  } catch {
    throw new ApiError("Network error", 0);
  }

  if (response.status === 401) {
    // Dev bypass: skip redirect so "Skip login" mode keeps working
    if (!(import.meta.env.DEV && sessionStorage.getItem("devBypass") === "true")) {
      window.location.href = "/login";
    }
    throw new ApiError("Unauthorized", 401);
  }

  // SESSION-EXPIRE: 403 means the Kite access token expired mid-session.
  // Notify the app shell to show the re-auth banner without forcing a redirect.
  if (response.status === 403) {
    window.dispatchEvent(new CustomEvent("kite-session-expired"));
    throw new ApiError("Kite session expired — please re-authenticate", 403);
  }

  if (response.status === 429) {
    // Rate limit hit — show a persistent warning and stop the call chain
    import("sonner").then(({ toast }) =>
      toast.warning("Too many requests — please wait a moment before retrying.", {
        id: "rate-limit",
        duration: 6000,
      })
    );
    throw new ApiError("Rate limit exceeded", 429);
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    let detail: Record<string, unknown> | undefined;
    try {
      const body = await response.json();
      if (body?.detail) {
        if (typeof body.detail === "string") {
          message = body.detail;
        } else {
          detail = body.detail as Record<string, unknown>;
          const err = detail?.error as Record<string, unknown> | undefined;
          message = (err?.message as string) ?? JSON.stringify(body.detail);
          // REQUEST-ID: append request_id to the message so it surfaces in toasts
          const requestId = err?.request_id as string | undefined;
          if (requestId) message += ` (ref: ${requestId})`;
        }
      }
    } catch {
      // ignore JSON parse failures; use default message
    }
    throw new ApiError(message, response.status, detail);
  }

  // 204 No Content — return empty object cast to T
  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}
