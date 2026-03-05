import { useState } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router";
import {
  LayoutGrid,
  CandlestickChart,
  Gauge,
  Receipt,
  ClipboardList,
  LogOut,
  Menu,
  RefreshCw,
  Settings,
  ChevronDown,
} from "lucide-react";
import AuthGuard from "./AuthGuard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useAppStore } from "../data/store";
import { logout } from "../api/auth";
import { ApiError } from "../api/client";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function AppShell() {
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const user = useAppStore((s) => s.user);
  const clearUser = useAppStore((s) => s.clearUser);

  // H-01: Kite session expired banner — driven by real user data
  const isKiteSessionExpired = user != null && user.kite_session_valid === false;

  const userName = user?.name ?? "User";
  const userEmail = user?.email ?? "—";
  const userKiteId = user?.user_id ?? "—";
  const userInitials = user ? getInitials(user.name) : "U";
  const kiteSessionActive = user?.kite_session_valid ?? false;
  const kiteSessionExpiry = user?.kite_token_expires_at
    ? new Date(user.kite_token_expires_at).toLocaleString("en-IN", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      })
    : "—";

  const isMarketOpen = true;

  const navItems = [
    { path: "/dashboard", label: "Dashboard", icon: LayoutGrid },
    { path: "/charts", label: "Charts", icon: CandlestickChart },
    { path: "/kpis", label: "KPIs", icon: Gauge },
    { path: "/orders", label: "Orders", icon: Receipt },
    { path: "/audit", label: "Audit Log", icon: ClipboardList },
  ];

  const handleMouseEnter = () => {
    if (!sidebarPinned) setSidebarExpanded(true);
  };

  const handleMouseLeave = () => {
    if (!sidebarPinned) setSidebarExpanded(false);
  };

  const togglePin = () => {
    setSidebarPinned(!sidebarPinned);
    if (!sidebarPinned) setSidebarExpanded(true);
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      // If backend is unreachable, continue with client-side cleanup
      if (!(err instanceof ApiError && err.status === 0)) {
        // For non-network errors, still clean up client side
      }
    }
    clearUser();
    sessionStorage.removeItem("isLoggedIn");
    navigate("/login");
  };

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + "/");

  const showBanner = isKiteSessionExpired && !bannerDismissed;
  const bannerHeight = showBanner ? "h-10" : "h-0";

  return (
    <AuthGuard>
      <div className="min-h-screen bg-[#0a0a0a] text-foreground">
        {/* Topbar */}
        <header className="fixed top-0 left-0 right-0 h-14 bg-[#121212] border-b border-[#2a2a2a] z-50 flex items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <button onClick={togglePin} className="lg:hidden">
              <Menu className="w-5 h-5" />
            </button>
            <span className="font-semibold">StockPilot</span>
            <div className="flex items-center gap-2 ml-4">
              <div className={`w-2 h-2 rounded-full ${isMarketOpen ? "bg-green-500" : "bg-red-500"}`} />
              <span className="text-sm text-muted-foreground">
                {isMarketOpen ? "MARKET OPEN" : "MARKET CLOSED"}
              </span>
              <span className="text-sm text-muted-foreground">09:15 – 15:30 IST</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Watchlist ticker — Dashboard and Charts only */}
            {(location.pathname === "/dashboard" || location.pathname.startsWith("/charts")) && (
              <div className="hidden md:flex items-center gap-4 text-sm">
                <span className="text-green-500">INFY ▲1290 +1.08%</span>
                <span className="text-muted-foreground">HDFCBANK +0.4%</span>
                <span className="text-muted-foreground">ITC +0.2%</span>
              </div>
            )}
            <button className="p-2 hover:bg-[#2a2a2a] rounded" title="Refresh live data">
              <RefreshCw className="w-4 h-4" />
            </button>

            {/* H-02: User dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1.5 hover:bg-[#2a2a2a] px-2 py-1 rounded focus:outline-none">
                <div className="w-7 h-7 rounded-full bg-[#FF6600] flex items-center justify-center text-xs font-semibold text-white">
                  {userInitials}
                </div>
                <span className="text-sm">{userKiteId}</span>
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 bg-[#1a1a1a] border-[#2a2a2a]">
                {/* User info */}
                <div className="px-3 py-3 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#FF6600] flex items-center justify-center text-sm font-semibold text-white shrink-0">
                    {userInitials}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{userName}</p>
                    <p className="text-xs text-muted-foreground">
                      {userKiteId} · {userEmail}
                    </p>
                    <p className={`text-xs mt-1 flex items-center gap-1 ${kiteSessionActive ? "text-green-400" : "text-red-400"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${kiteSessionActive ? "bg-green-400" : "bg-red-400"}`} />
                      {kiteSessionActive ? "Kite session active" : "Kite session expired"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Expires {kiteSessionExpiry}
                    </p>
                  </div>
                </div>
                <DropdownMenuSeparator className="bg-[#2a2a2a]" />
                <DropdownMenuItem asChild className="cursor-pointer hover:bg-[#2a2a2a] focus:bg-[#2a2a2a]">
                  <Link to="/settings" className="flex items-center gap-2 px-3 py-2 text-sm">
                    <Settings className="w-4 h-4" />
                    Settings & Preferences
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-[#2a2a2a]" />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="cursor-pointer px-3 py-2 text-sm text-red-400 hover:bg-[#2a2a2a] focus:bg-[#2a2a2a] flex items-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* H-01: Kite session expired banner */}
        {showBanner && (
          <div className="fixed top-14 left-0 right-0 z-40 bg-yellow-900/20 border-b border-yellow-500/30 px-4 py-2 flex items-center justify-between">
            <span className="text-sm text-yellow-400">
              ⚠ Your Kite session has expired — live data is unavailable.
            </span>
            <div className="flex items-center gap-4">
              <button
                className="text-sm text-[#FF6600] hover:text-[#ff7700] font-medium"
                onClick={() => window.location.assign("/api/v1/auth/login")}
              >
                Re-authenticate with Kite
              </button>
              <button
                className="text-muted-foreground hover:text-foreground text-lg leading-none"
                onClick={() => setBannerDismissed(true)}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Sidebar */}
        <aside
          className={`fixed left-0 bg-[#121212] border-r border-[#2a2a2a] z-40 transition-all duration-200 ${
            sidebarExpanded || sidebarPinned ? "w-[200px]" : "w-[56px]"
          } ${showBanner ? "top-24 bottom-0" : "top-14 bottom-0"}`}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <nav className="flex flex-col h-full py-4">
            <div className="flex-1 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center gap-3 px-4 py-3 transition-colors relative ${
                      active
                        ? "text-foreground bg-[#2a2a2a]"
                        : "text-muted-foreground hover:text-foreground hover:bg-[#1a1a1a]"
                    }`}
                  >
                    {active && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#FF6600]" />
                    )}
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    {(sidebarExpanded || sidebarPinned) && (
                      <span className="whitespace-nowrap">{item.label}</span>
                    )}
                  </Link>
                );
              })}
            </div>

            <div className="border-t border-[#2a2a2a] pt-4 space-y-1">
              {/* C-02: Settings links to /settings page */}
              <Link
                to="/settings"
                className={`flex items-center gap-3 px-4 py-3 transition-colors relative ${
                  isActive("/settings")
                    ? "text-foreground bg-[#2a2a2a]"
                    : "text-muted-foreground hover:text-foreground hover:bg-[#1a1a1a]"
                }`}
              >
                {isActive("/settings") && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#FF6600]" />
                )}
                <Settings className="w-5 h-5 flex-shrink-0" />
                {(sidebarExpanded || sidebarPinned) && (
                  <span className="whitespace-nowrap">Settings</span>
                )}
              </Link>
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 px-4 py-3 w-full text-muted-foreground hover:text-foreground hover:bg-[#1a1a1a] transition-colors"
              >
                <LogOut className="w-5 h-5 flex-shrink-0" />
                {(sidebarExpanded || sidebarPinned) && <span>Logout</span>}
              </button>
            </div>
          </nav>
        </aside>

        {/* Main content */}
        <main
          className={`pt-14 min-h-screen transition-all duration-200 ${
            sidebarExpanded || sidebarPinned ? "ml-[200px]" : "ml-[56px]"
          } ${showBanner ? "pt-24" : "pt-14"}`}
        >
          <div className={`${showBanner ? "h-[calc(100vh-6rem)]" : "h-[calc(100vh-3.5rem)]"}`}>
            <Outlet />
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}
