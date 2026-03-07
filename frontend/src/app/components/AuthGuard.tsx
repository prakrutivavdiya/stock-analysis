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
    getMe()
      .then((data) => {
        setUser(data);
        setChecking(false);
      })
      .catch(() => {
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
