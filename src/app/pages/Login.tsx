import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);

  // H-03: Parse error/reason query params set by OAuth callback
  const error = searchParams.get("error");   // "cancelled" | "unauthorized"
  const reason = searchParams.get("reason"); // "expired"

  useEffect(() => {
    const isLoggedIn = sessionStorage.getItem("isLoggedIn");
    if (isLoggedIn === "true") {
      navigate("/dashboard");
    }
  }, [navigate]);

  // H-03: Map URL params to user-facing messages
  const errorMessage = (() => {
    if (reason === "expired") return "Your session has expired. Please log in again.";
    if (error === "unauthorized") return "Access denied. This app is private.";
    if (error === "cancelled") return "Login failed or was cancelled. Please try again.";
    return null;
  })();

  // C-01: Redirect to Kite OAuth endpoint
  const handleLogin = () => {
    setIsLoading(true);
    window.location.assign("/api/v1/auth/login");
  };

  // Dev-mode bypass — localhost only
  const handleDevLogin = () => {
    sessionStorage.setItem("isLoggedIn", "true");
    navigate("/dashboard");
  };

  const isDev =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

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

          {/* Dev-mode bypass (localhost only) */}
          {isDev && (
            <div className="pt-2 border-t border-[#2a2a2a]">
              <p className="text-xs text-muted-foreground mb-2 text-center">Dev mode</p>
              <button
                onClick={handleDevLogin}
                className="w-full text-xs text-muted-foreground hover:text-foreground border border-[#2a2a2a] hover:border-[#3a3a3a] py-2 rounded transition-colors"
              >
                Skip auth (localhost only)
              </button>
            </div>
          )}
        </div>

        <p className="text-xs text-center text-muted-foreground">
          🔒 Secure · OAuth 2.0 via Zerodha Kite
        </p>
      </div>
    </div>
  );
}
