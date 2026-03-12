import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router";
import { getMe } from "../api/auth";
import { ApiError } from "../api/client";
import { useAppStore } from "../data/store";

export default function AuthGuard({ children }: { children?: React.ReactNode }) {
  const navigate = useNavigate();
  const setUser = useAppStore((s) => s.setUser);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Dev bypass: "Skip login" button sets this flag
    if (import.meta.env.DEV && sessionStorage.getItem("devBypass") === "true") {
      setChecking(false);
      return;
    }
    getMe()
      .then((data) => {
        setUser(data);
        setChecking(false);
      })
      .catch((err) => {
        // Also bypass when backend is unreachable (network error, status=0)
        if (import.meta.env.DEV && err instanceof ApiError && err.status === 0) {
          setChecking(false);
          return;
        }
        navigate("/login");
      });
  }, [navigate, setUser]);

  if (checking) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#2a2a2a] border-t-[#FF6600] rounded-full animate-spin" />
      </div>
    );
  }

  // If children prop is passed (legacy pattern), render it; otherwise Outlet
  return children ? <>{children}</> : <Outlet />;
}
