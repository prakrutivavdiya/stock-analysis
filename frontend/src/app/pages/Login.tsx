import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { getLoginUrl } from "../api/auth";

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);

  // H-03: Parse error/reason query params set by OAuth callback
  const error = searchParams.get("error");   // "cancelled" | "unauthorized"
  const reason = searchParams.get("reason"); // "expired"

  useEffect(() => {}, [navigate]);

  // H-03: Map URL params to user-facing messages
  const errorMessage = (() => {
    if (reason === "expired") return "Your session has expired. Please log in again.";
    if (error === "unauthorized") return "Access denied. This app is private.";
    if (error === "cancelled") return "Login failed or was cancelled. Please try again.";
    return null;
  })();

  // C-01: Fetch login_url from backend then redirect
  const handleLogin = async () => {
    setIsLoading(true);
    try {
      const { login_url } = await getLoginUrl();
      window.location.assign(login_url);
    } catch (err) {
      console.error("[Login] getLoginUrl failed:", err);
      setIsLoading(false);
      // Try fetching the login URL directly as a fallback
      try {
        const res = await fetch("/api/v1/auth/login");
        const data = await res.json();
        if (data?.login_url) {
          window.location.assign(data.login_url);
          return;
        }
      } catch {
        // ignore
      }
      alert("Unable to reach the backend. Is the server running on port 8000?");
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="w-full max-w-sm space-y-8 px-4">
        {/* Brand */}
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">StockPilot</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Personal trade management, connected to Kite
          </p>
        </div>

        {/* H-03: Error banner */}
        {errorMessage && (
          <div className="bg-red-900/20 border border-red-500/30 rounded px-4 py-3 text-sm text-red-400">
            {errorMessage}
          </div>
        )}

        {/* Login card */}
        <div className="bg-[#121212] border border-[#2a2a2a] rounded-lg p-8 space-y-6">
          <p className="text-sm text-muted-foreground text-center">
            Sign in with your Zerodha Kite account to continue.
          </p>

          {/* C-01: Kite OAuth button */}
          <button
            onClick={handleLogin}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 bg-[#FF6600] hover:bg-[#ff7700] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded transition-colors"
          >
            {isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Redirecting…
              </>
            ) : (
              "Login with Kite"
            )}
          </button>

        </div>

        <p className="text-xs text-center text-muted-foreground">
          🔒 Secure · OAuth 2.0 via Zerodha Kite
        </p>
      </div>
    </div>
  );
}
