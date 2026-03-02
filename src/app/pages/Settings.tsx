import { useState } from "react";
import { useNavigate } from "react-router";
import { User, Palette, Shield, LogOut, RefreshCw, AlertTriangle } from "lucide-react";
import { Switch } from "../components/ui/switch";
import { Separator } from "../components/ui/separator";

// ST-02: Profile includes exchange memberships and product types (from Kite profile stored at first login)
const MOCK_USER = {
  name: "Prakruti Vavdiya",
  kiteUserId: "BBQ846",
  email: "prakruti@example.com",
  initials: "PV",
  exchangeMemberships: ["NSE", "BSE"],
  productTypes: ["CNC", "MIS", "NRML"],
  kiteSessionActive: true,
  kiteSessionExpiry: "Today at 23:59 IST",
  jwtTimeRemaining: "6h 42m",
  refreshTokenExpiry: "2026-04-01",
  lastActivity: "2026-03-02 09:34:11 IST",
};

type Theme = "dark" | "light";
type ChartInterval = "5" | "15" | "30" | "60" | "D";
type ChartStyle = "Candles" | "Line" | "Bars" | "Area";
// ST-07 / US-093: separate holdings and positions refresh intervals with "off" option
type RefreshInterval = "30" | "60" | "90" | "off";

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

const PREF_KEY = "stockpilot_prefs";

function loadPrefs(): Preferences {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return DEFAULT_PREFS;
}

type Section = "profile" | "preferences" | "session";

export default function Settings() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<Section>("profile");
  const [prefs, setPrefs] = useState<Preferences>(loadPrefs);
  const [saved, setSaved] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);

  const updatePref = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const savePrefs = () => {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const resetPrefs = () => {
    setPrefs(DEFAULT_PREFS);
    setSaved(false);
  };

  const handleLogout = () => {
    sessionStorage.removeItem("isLoggedIn");
    navigate("/login");
  };

  // ST-04: Re-authenticate available in profile section
  const handleReauthenticate = () => {
    window.location.assign("/api/v1/auth/login");
  };

  const handleRevokeAll = () => {
    sessionStorage.removeItem("isLoggedIn");
    localStorage.removeItem(PREF_KEY);
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
                  {MOCK_USER.initials}
                </div>
                <div>
                  <p className="font-medium">{MOCK_USER.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {MOCK_USER.kiteUserId} · {MOCK_USER.email}
                  </p>
                </div>
              </div>

              {/* ST-02: Full profile including exchange memberships and product types */}
              <div className="bg-[#121212] border border-[#2a2a2a] rounded-lg divide-y divide-[#2a2a2a]">
                <Row label="Full name" value={MOCK_USER.name} />
                <Row label="Kite User ID" value={MOCK_USER.kiteUserId} />
                <Row label="Email" value={MOCK_USER.email} />
                {/* ST-02: Exchange memberships */}
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-muted-foreground">Exchange memberships</span>
                  <div className="flex gap-1.5">
                    {MOCK_USER.exchangeMemberships.map((e) => (
                      <span key={e} className="text-xs bg-[#2a2a2a] text-foreground px-2 py-0.5 rounded font-medium">
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
                {/* ST-02: Product types */}
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-muted-foreground">Product types</span>
                  <div className="flex gap-1.5">
                    {MOCK_USER.productTypes.map((p) => (
                      <span key={p} className="text-xs bg-[#2a2a2a] text-foreground px-2 py-0.5 rounded font-medium">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
                {/* ST-03: Kite session status */}
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-muted-foreground">Kite session</span>
                  <span
                    className={`text-sm flex items-center gap-1.5 ${
                      MOCK_USER.kiteSessionActive ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        MOCK_USER.kiteSessionActive ? "bg-green-400" : "bg-red-400"
                      }`}
                    />
                    {MOCK_USER.kiteSessionActive ? "Active" : "Expired"} — expires{" "}
                    {MOCK_USER.kiteSessionExpiry}
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

              {/* US-095: JWT status, refresh token validity, last activity */}
              <div className="bg-[#121212] border border-[#2a2a2a] rounded-lg divide-y divide-[#2a2a2a]">
                <div className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">StockPilot JWT</p>
                    <p className="text-xs text-muted-foreground">
                      {MOCK_USER.jwtTimeRemaining} remaining · expires {MOCK_USER.kiteSessionExpiry}
                    </p>
                  </div>
                  <span className="text-xs text-green-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    Active
                  </span>
                </div>
                {/* US-095: Refresh token validity */}
                <div className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Refresh token</p>
                    <p className="text-xs text-muted-foreground">
                      Valid until {MOCK_USER.refreshTokenExpiry} (30-day rolling)
                    </p>
                  </div>
                  <span className="text-xs text-green-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    Valid
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Kite access token</p>
                    <p className="text-xs text-muted-foreground">
                      Expires {MOCK_USER.kiteSessionExpiry}
                    </p>
                  </div>
                  <span
                    className={`text-xs flex items-center gap-1 ${
                      MOCK_USER.kiteSessionActive ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        MOCK_USER.kiteSessionActive ? "bg-green-400" : "bg-red-400"
                      }`}
                    />
                    {MOCK_USER.kiteSessionActive ? "Active" : "Expired"}
                  </span>
                </div>
                {/* US-095: Last activity */}
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-muted-foreground">Last activity</span>
                  <span className="text-xs text-muted-foreground font-mono">{MOCK_USER.lastActivity}</span>
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
