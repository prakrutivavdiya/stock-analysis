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
    window.location.href = "/login";
    // Throw so callers see this as an error, even though we're redirecting
    throw new ApiError("Unauthorized", 401);
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body?.detail) {
        message = typeof body.detail === "string"
          ? body.detail
          : JSON.stringify(body.detail);
      }
    } catch {
      // ignore JSON parse failures; use default message
    }
    throw new ApiError(message, response.status);
  }

  // 204 No Content — return empty object cast to T
  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}
