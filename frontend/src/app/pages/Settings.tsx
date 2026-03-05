import { useState } from "react";
import { useNavigate } from "react-router";
import { User, Palette, Shield, LogOut, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "../components/ui/switch";
import { Separator } from "../components/ui/separator";
import * as localPrefs from "../data/localPrefs";
import { useAppStore } from "../data/store";
import { logout, revokeAllSessions, getLoginUrl } from "../api/auth";
import { ApiError } from "../api/client";

// Re-export types from localPrefs for local use
type Theme = localPrefs.Theme;
type ChartInterval = localPrefs.DefaultInterval;
type ChartStyle = localPrefs.ChartStyle;
// ST-07 / US-093: separate holdings and positions refresh intervals with "off" option
type RefreshInterval = localPrefs.RefreshInterval;

// US-094: separate toggles for successful order and rejected/error order toasts
interface Preferences {
  theme: Theme;
  defaultInterval: ChartInterval;
  defaultChartStyle: ChartStyle;
  holdingsRefreshInterval: RefreshInterval;
  positionsRefreshInterval: RefreshInterval;
  notifyOnOrderSuccess: boolean;
  notifyOnOrderRejected: boolean;
  notifyOnGTTTrigger: boolean;
  // US-094: Kite session expiry warning cannot be permanently suppressed
  notifyOnKiteSessionExpiry: boolean;
}

const DEFAULT_PREFS: Preferences = {
  theme: "dark",
  defaultInterval: "D",
  defaultChartStyle: "Candles",
  holdingsRefreshInterval: "60",
  positionsRefreshInterval: "60",
  notifyOnOrderSuccess: true,
  notifyOnOrderRejected: true,
  notifyOnGTTTrigger: true,
  notifyOnKiteSessionExpiry: true,
};

// DB-03 fix: read from individual localStorage keys per DATA_MODEL spec
// (migrateLegacyPrefs() in main.tsx already moved any old blob data)
function loadPrefs(): Preferences {
  return {
    theme:                    localPrefs.theme.get(),
    defaultInterval:          localPrefs.defaultInterval.get(),
    defaultChartStyle:        localPrefs.defaultChartStyle.get(),
    holdingsRefreshInterval:  localPrefs.holdingsRefreshInterval.get(),
    positionsRefreshInterval: localPrefs.positionsRefreshInterval.get(),
    notifyOnOrderSuccess:     localPrefs.notifyOnOrderSuccess.get(),
    notifyOnOrderRejected:    localPrefs.notifyOnOrderRejected.get(),
    notifyOnGTTTrigger:       localPrefs.notifyOnGTTTrigger.get(),
    notifyOnKiteSessionExpiry: true, // AU-05: cannot be suppressed
  };
}

type Section = "profile" | "preferences" | "session";

export default function Settings() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<Section>("profile");
  const [prefs, setPrefs] = useState<Preferences>(loadPrefs);
  const [saved, setSaved] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);

  // Real user from store
  const user = useAppStore((s) => s.user);
  const clearUser = useAppStore((s) => s.clearUser);

  // Derive display values — fall back gracefully when user is null (dev bypass)
  const userName = user?.name ?? "User";
  const userKiteId = user?.user_id ?? "—";
  const userEmail = user?.email ?? "—";
  const userInitials = userName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const exchangeMemberships = user?.exchange_memberships ?? [];
  const productTypes = user?.product_types ?? [];
  const kiteSessionActive = user?.kite_session_valid ?? false;
  const kiteSessionExpiry = user?.kite_token_expires_at
    ? new Date(user.kite_token_expires_at).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      })
    : "—";
  const lastActivity = user?.last_login_at
    ? new Date(user.last_login_at).toLocaleString("en-IN", {
        dateStyle: "short",
        timeStyle: "medium",
        timeZone: "Asia/Kolkata",
      })
    : "—";

  const updatePref = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  // DB-03 fix: write to individual localStorage keys per DATA_MODEL spec
  const savePrefs = () => {
    localPrefs.theme.set(prefs.theme);
    localPrefs.defaultInterval.set(prefs.defaultInterval);
    localPrefs.defaultChartStyle.set(prefs.defaultChartStyle);
    localPrefs.holdingsRefreshInterval.set(prefs.holdingsRefreshInterval);
    localPrefs.positionsRefreshInterval.set(prefs.positionsRefreshInterval);
    localPrefs.notifyOnOrderSuccess.set(prefs.notifyOnOrderSuccess);
    localPrefs.notifyOnOrderRejected.set(prefs.notifyOnOrderRejected);
    localPrefs.notifyOnGTTTrigger.set(prefs.notifyOnGTTTrigger);
    // notifyOnKiteSessionExpiry is always true (AU-05) — no write needed
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const resetPrefs = () => {
    setPrefs(DEFAULT_PREFS);
    setSaved(false);
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Proceed with client-side cleanup even if backend is unreachable
    }
    clearUser();
    sessionStorage.removeItem("isLoggedIn");
    navigate("/login");
  };

  // ST-04: Re-authenticate available in profile section
  const handleReauthenticate = async () => {
    try {
      const { login_url } = await getLoginUrl();
      window.location.assign(login_url);
    } catch {
      toast.error("Unable to reach backend. Is the server running?");
    }
  };

  const handleRevokeAll = async () => {
    try {
      const res = await revokeAllSessions();
      toast.success(`Revoked ${res.revoked_count} session${res.revoked_count !== 1 ? "s" : ""}`);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status !== 401) {
        toast.error(err.message || "Failed to revoke sessions");
      }
    }
    clearUser();
    sessionStorage.removeItem("isLoggedIn");
    navigate("/login");
  };

  const navItems: { id: Section; label: string; icon: React.ElementType }[] = [
    { id: "profile", label: "Profile", icon: User },
    { id: "preferences", label: "Preferences", icon: Palette },
    { id: "session", label: "Session", icon: Shield },
  ];

  return (
    <div className="flex h-full">
      {/* Settings nav */}
      <nav className="w-48 shrink-0 border-r border-[#2a2a2a] bg-[#0f0f0f] py-4">
        <p className="px-4 mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Settings
        </p>
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveSection(id)}
            className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
              activeSection === id
                ? "text-foreground bg-[#2a2a2a]"
                : "text-muted-foreground hover:text-foreground hover:bg-[#1a1a1a]"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-8 space-y-8">

          {/* Profile */}
          {activeSection === "profile" && (
            <>
              <div>
                <h2 className="text-lg font-semibold mb-1">Profile</h2>
                <p className="text-sm text-muted-foreground">
                  Your account details linked to Zerodha Kite. Read-only.
                </p>
              </div>
              <Separator className="bg-[#2a2a2a]" />

              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-[#FF6600] flex items-center justify-center text-lg font-semibold text-white">
                  {userInitials}
                </div>
                <div>
                  <p className="font-medium">{userName}</p>
                  <p className="text-sm text-muted-foreground">
                    {userKiteId} · {userEmail}
                  </p>
                </div>
              </div>

              {/* ST-02: Full profile including exchange memberships and product types */}
              <div className="bg-[#121212] border border-[#2a2a2a] rounded-lg divide-y divide-[#2a2a2a]">
                <Row label="Full name" value={userName} />
                <Row label="Kite User ID" value={userKiteId} />
                <Row label="Email" value={userEmail} />
                {/* ST-02: Exchange memberships */}
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-muted-foreground">Exchange memberships</span>
                  <div className="flex gap-1.5">
                    {exchangeMemberships.length > 0
                      ? exchangeMemberships.map((e) => (
                          <span key={e} className="text-xs bg-[#2a2a2a] text-foreground px-2 py-0.5 rounded font-medium">
                            {e}
                          </span>
                        ))
                      : <span className="text-xs text-muted-foreground">—</span>
                    }
                  </div>
                </div>
                {/* ST-02: Product types */}
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-muted-foreground">Product types</span>
                  <div className="flex gap-1.5">
                    {productTypes.length > 0
                      ? productTypes.map((p) => (
                          <span key={p} className="text-xs bg-[#2a2a2a] text-foreground px-2 py-0.5 rounded font-medium">
                            {p}
                          </span>
                        ))
                      : <span className="text-xs text-muted-foreground">—</span>
                    }
                  </div>
                </div>
                {/* ST-03: Kite session status */}
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-muted-foreground">Kite session</span>
                  <span
                    className={`text-sm flex items-center gap-1.5 ${
                      kiteSessionActive ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        kiteSessionActive ? "bg-green-400" : "bg-red-400"
                      }`}
                    />
                    {kiteSessionActive ? "Active" : "Expired"} — expires{" "}
                    {kiteSessionExpiry}
                  </span>
                </div>
              </div>

              {/* ST-04: Re-authenticate button in Profile section */}
              <div className="space-y-3">
                <button
                  onClick={handleReauthenticate}
                  className="flex items-center gap-2 px-4 py-2 border border-[#2a2a2a] hover:border-[#3a3a3a] text-sm rounded transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Re-authenticate with Kite
                </button>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              </div>
            </>
          )}

          {/* Preferences */}
          {activeSection === "preferences" && (
            <>
              <div>
                <h2 className="text-lg font-semibold mb-1">Preferences</h2>
                <p className="text-sm text-muted-foreground">
                  Saved locally in your browser. Applied immediately.
                </p>
              </div>
              <Separator className="bg-[#2a2a2a]" />

              {/* ST-07: Appearance — theme */}
              <section className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Appearance
                </h3>
                <div className="bg-[#121212] border border-[#2a2a2a] rounded-lg divide-y divide-[#2a2a2a]">
                  <SelectRow
                    label="Theme"
                    value={prefs.theme}
                    onChange={(v) => updatePref("theme", v as Theme)}
                    options={[
                      { value: "dark", label: "Dark" },
                      { value: "light", label: "Light" },
                    ]}
                  />
                </div>
              </section>

              {/* ST-07: Charts */}
              <section className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Charts
                </h3>
                <div className="bg-[#121212] border border-[#2a2a2a] rounded-lg divide-y divide-[#2a2a2a]">
                  <SelectRow
                    label="Default interval"
                    value={prefs.defaultInterval}
                    onChange={(v) => updatePref("defaultInterval", v as ChartInterval)}
                    options={[
                      { value: "5", label: "5 minutes" },
                      { value: "15", label: "15 minutes" },
                      { value: "30", label: "30 minutes" },
                      { value: "60", label: "1 hour" },
                      { value: "D", label: "Daily" },
                    ]}
                  />
                  <SelectRow
                    label="Default chart type"
                    value={prefs.defaultChartStyle}
                    onChange={(v) => updatePref("defaultChartStyle", v as ChartStyle)}
                    options={[
                      { value: "Candles", label: "Candlestick" },
                      { value: "Bars", label: "Bar" },
                      { value: "Line", label: "Line" },
                      { value: "Area", label: "Area" },
                    ]}
                  />
                </div>
              </section>

              {/* ST-07: Live Data — separate holdings and positions refresh intervals */}
              <section className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Live Data
                </h3>
                <div className="bg-[#121212] border border-[#2a2a2a] rounded-lg divide-y divide-[#2a2a2a]">
                  <SelectRow
                    label="Holdings refresh interval"
                    value={prefs.holdingsRefreshInterval}
                    onChange={(v) => updatePref("holdingsRefreshInterval", v as RefreshInterval)}
                    options={[
                      { value: "30", label: "Every 30 seconds" },
                      { value: "60", label: "Every 60 seconds" },
                      { value: "90", label: "Every 90 seconds" },
                      { value: "off", label: "Off" },
                    ]}
                  />
                  <SelectRow
                    label="Positions refresh interval"
                    value={prefs.positionsRefreshInterval}
                    onChange={(v) => updatePref("positionsRefreshInterval", v as RefreshInterval)}
                    options={[
                      { value: "30", label: "Every 30 seconds" },
                      { value: "60", label: "Every 60 seconds" },
                      { value: "90", label: "Every 90 seconds" },
                      { value: "off", label: "Off" },
                    ]}
                  />
                </div>
              </section>

              {/* US-094: Notification preferences — separate success vs rejected */}
              <section className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Notifications
                </h3>
                <div className="bg-[#121212] border border-[#2a2a2a] rounded-lg divide-y divide-[#2a2a2a]">
                  <SwitchRow
                    label="Successful order toast"
                    description="Notify when an order is filled"
                    checked={prefs.notifyOnOrderSuccess}
                    onCheckedChange={(v) => updatePref("notifyOnOrderSuccess", v)}
                  />
                  <SwitchRow
                    label="Rejected / error order toast"
                    description="Notify when an order is rejected or fails"
                    checked={prefs.notifyOnOrderRejected}
                    onCheckedChange={(v) => updatePref("notifyOnOrderRejected", v)}
                  />
                  <SwitchRow
                    label="GTT trigger alerts"
                    description="Notify when a GTT order is triggered"
                    checked={prefs.notifyOnGTTTrigger}
                    onCheckedChange={(v) => updatePref("notifyOnGTTTrigger", v)}
                  />
                  {/* US-094: Cannot be permanently suppressed */}
                  <SwitchRow
                    label="Kite session expiry warning"
                    description="Notify 30 minutes before your Kite session expires (resets on each login)"
                    checked={prefs.notifyOnKiteSessionExpiry}
                    onCheckedChange={(v) => updatePref("notifyOnKiteSessionExpiry", v)}
                  />
                </div>
              </section>

              <div className="flex items-center gap-3">
                <button
                  onClick={savePrefs}
                  className="px-5 py-2 bg-[#FF6600] hover:bg-[#ff7700] text-white text-sm font-medium rounded transition-colors"
                >
                  Save preferences
                </button>
                <button
                  onClick={resetPrefs}
                  className="px-5 py-2 border border-[#2a2a2a] hover:border-[#3a3a3a] text-sm text-muted-foreground hover:text-foreground rounded transition-colors"
                >
                  Reset to defaults
                </button>
                {saved && (
                  <span className="text-sm text-green-400">Saved!</span>
                )}
              </div>
            </>
          )}

          {/* Session */}
          {activeSection === "session" && (
            <>
              <div>
                <h2 className="text-lg font-semibold mb-1">Session</h2>
                <p className="text-sm text-muted-foreground">
                  Manage your authentication tokens and active sessions.
                </p>
              </div>
              <Separator className="bg-[#2a2a2a]" />

              {/* US-095: Kite session status + last activity */}
              <div className="bg-[#121212] border border-[#2a2a2a] rounded-lg divide-y divide-[#2a2a2a]">
                <div className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Kite access token</p>
                    <p className="text-xs text-muted-foreground">
                      Expires {kiteSessionExpiry}
                    </p>
                  </div>
                  <span
                    className={`text-xs flex items-center gap-1 ${
                      kiteSessionActive ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        kiteSessionActive ? "bg-green-400" : "bg-red-400"
                      }`}
                    />
                    {kiteSessionActive ? "Active" : "Expired"}
                  </span>
                </div>
                {/* US-095: Last activity */}
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-muted-foreground">Last login</span>
                  <span className="text-xs text-muted-foreground font-mono">{lastActivity}</span>
                </div>
              </div>

              <div className="space-y-3">
                <button
                  onClick={handleReauthenticate}
                  className="flex items-center gap-2 px-4 py-2 border border-[#2a2a2a] hover:border-[#3a3a3a] text-sm rounded transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  Re-authenticate with Kite
                </button>

                {/* US-095: Logout this device */}
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 px-4 py-2 border border-[#2a2a2a] hover:border-[#3a3a3a] text-sm rounded transition-colors text-muted-foreground hover:text-foreground"
                >
                  <LogOut className="w-4 h-4" />
                  Logout this device
                </button>

                {/* US-095: Revoke all sessions */}
                {!showRevokeConfirm ? (
                  <button
                    onClick={() => setShowRevokeConfirm(true)}
                    className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 transition-colors px-1"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    Revoke all sessions
                  </button>
                ) : (
                  <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 space-y-3">
                    <p className="text-sm text-red-400">
                      This will invalidate all refresh tokens and log out all devices. Are you sure?
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={handleRevokeAll}
                        className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors"
                      >
                        Revoke all
                      </button>
                      <button
                        onClick={() => setShowRevokeConfirm(false)}
                        className="px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Helpers
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function SelectRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-2 py-1 text-sm focus:outline-none focus:border-[#FF6600]"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 gap-4">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
