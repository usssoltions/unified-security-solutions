import React, { useState, useEffect, useCallback, useContext } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { queryClientInstance } from "@/lib/query-client";
import { base44 } from "@/api/base44Client";
import {
  Shield, Radio, Calendar, AlertTriangle, MapPin, BarChart3, Users,
  Menu, X, LogOut, Bell, Package, Sliders, RefreshCw, Sparkles, Zap,
  FileText, Mic, Clock, ArrowLeft, UserCircle, Wrench, QrCode, MessageCircle, ShirtIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ErrorBoundary from "@/components/ErrorBoundary";
import NotificationCenter from "@/components/notifications/NotificationCenter";
import IncidentEscalationMonitor from "@/components/incidents/IncidentEscalationMonitor";
import RealTimeAlertMonitor from "@/components/alerts/RealTimeAlertMonitor";
import GlobalPanicButton from "@/components/GlobalPanicButton";
import PWAInstaller from "@/components/PWAInstaller";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import PermissionEnforcement from "@/components/PermissionEnforcement";
import OneSignalSetup from "@/components/OneSignalSetup";
import BackgroundNotificationManager from "@/components/BackgroundNotificationManager";
import ThemeProvider from "@/components/ThemeProvider";


const TabStateContext = React.createContext({ tabStates: {}, updateTabState: () => {}, navigateToTab: () => {} });
export const useTabState = () => React.useContext(TabStateContext);

export default function Layout({ children, currentPageName }) {
  const [tabStates, setTabStates] = React.useState({
    guard: { url: createPageUrl("GuardShift"), root: createPageUrl("GuardShift") },
    incidents: { url: createPageUrl("GuardIncidents"), root: createPageUrl("GuardIncidents") },
    maintenance: { url: createPageUrl("GuardMaintenance"), root: createPageUrl("GuardMaintenance") },
    qr: { url: createPageUrl("QRScanner"), root: createPageUrl("QRScanner") },
    control: { url: createPageUrl("ControlRoom"), root: createPageUrl("ControlRoom") },
    scheduling: { url: createPageUrl("Scheduling"), root: createPageUrl("Scheduling") },
    sites: { url: createPageUrl("SiteManagement"), root: createPageUrl("SiteManagement") }
  });

  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    sessionStorage.setItem('guard_session_active', 'true');
    loadUser();
    let wakeLock = null;
    const requestWakeLock = async () => {
      if ('wakeLock' in navigator) {
        try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
      }
    };
    requestWakeLock();
    document.addEventListener('visibilitychange', requestWakeLock);
    return () => {
      if (wakeLock) wakeLock.release();
      document.removeEventListener('visibilitychange', requestWakeLock);
    };
  }, [retryCount]);

  // Notification count: initial fetch + realtime subscription (no 90s polling).
  // The previous interval polled Notification.filter every 90s = 40 redundant
  // requests/hour per device, duplicating what BackgroundNotificationManager's
  // subscription already knows. Now we update the count from create/update/delete
  // events and re-fetch on foreground return to correct any drift.
  useEffect(() => {
    if (!user) return;
    loadNotificationCount();

    const unsub = base44.entities.Notification.subscribe((event) => {
      if (!event.data || event.data.recipient_id !== user.id) return;
      if (event.type === 'create' && !event.data.read) {
        setNotificationCount(c => c + 1);
      } else if (event.type === 'update') {
        if (event.data.read) setNotificationCount(c => Math.max(0, c - 1));
        else setNotificationCount(c => c + 1);
      } else if (event.type === 'delete') {
        loadNotificationCount();
      }
    });

    const onVisible = () => {
      if (document.visibilityState === 'visible') loadNotificationCount();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => { unsub(); document.removeEventListener('visibilitychange', onVisible); };
  }, [user]);

  // Keep session alive for ALL roles — ping every 10 min
  useEffect(() => {
    if (!user) return;
    const keepAlive = setInterval(async () => {
      try { await base44.auth.me(); } catch (_) {}
    }, 10 * 60 * 1000);
    return () => clearInterval(keepAlive);
  }, [user]);

  // Seal the device hardware-back button so an authenticated user can never back
  // out of the app into the login screen. Two layers:
  //  1. Native Android shell calls window.__ussHardwareBack() on hardware back
  //     (see MainActivity) — navigates to the role home, never to login.
  //  2. Browser fallback: a sentinel history entry + popstate handler re-seals
  //     and bounces home, so the browser/preview back button can't escape either.
  useEffect(() => {
    if (!user) return;
    const rootPath = getNavigationItems().find(i => i.isRoot)?.url;
    if (!rootPath) return;
    const goHome = () => navigate(rootPath, { replace: true });
    window.__ussHardwareBack = goHome;
    window.history.pushState({ ussGuard: true }, "");
    const handlePopState = () => {
      window.history.pushState({ ussGuard: true }, "");
      goHome();
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      delete window.__ussHardwareBack;
    };
  }, [user, navigate]);

  const loadUser = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setError(null);
    } catch (err) {
      if (retryCount >= 2) setError(err);
    } finally {
      setLoading(false);
    }
  };

  const loadNotificationCount = async () => {
    if (!user) return;
    try {
      const notifications = await base44.entities.Notification.filter({ recipient_id: user.id, read: false });
      setNotificationCount(notifications.length);
    } catch (e) {}
  };

  // Track the previously-seen user id on this shared device so we can purge
  // any cached data left over from a previous session the instant a NEW user
  // logs in. Without this, React Query can briefly serve the prior user's
  // records (notifications, logs, shifts) to the next user.
  const prevUserId = React.useRef(null);

  useEffect(() => {
    if (!user) { prevUserId.current = null; return; }
    if (prevUserId.current !== null && prevUserId.current !== user.id) {
      try { queryClientInstance.clear(); } catch (_) {}
    }
    prevUserId.current = user.id;
  }, [user?.id]);

  const handleLogout = async () => {
    // PHASE E/F — full session reset on shared devices. Order matters:
    // 1) drop every cached query so the next user can never read the previous
    //    user's data from memory, 2) wipe client storage, 3) terminate the
    //    auth session, 4) hard-navigate to "/" so the whole app remounts fresh
    //    (no stale menu, no cached role, no reachable Back to admin pages).
    try { queryClientInstance.clear(); } catch (_) {}
    try { queryClientInstance.invalidateQueries(); } catch (_) {}
    try { localStorage.clear(); } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
    try { await base44.auth.logout(); } catch (_) {}
    // Hard reload guarantees the previous user's component tree is destroyed.
    window.location.assign("/");
  };

  const updateTabState = React.useCallback((tabName, url) => {
    setTabStates(prev => ({ ...prev, [tabName]: { ...prev[tabName], url, lastVisited: Date.now() } }));
  }, []);

  React.useEffect(() => {
    const tabMapping = {
      [createPageUrl("GuardShift")]: "guard",
      [createPageUrl("GuardIncidents")]: "incidents",
      [createPageUrl("GuardMaintenance")]: "maintenance",
      [createPageUrl("QRScanner")]: "qr",
      [createPageUrl("ControlRoom")]: "control",
      [createPageUrl("Scheduling")]: "scheduling",
      [createPageUrl("SiteManagement")]: "sites"
    };
    const tabName = tabMapping[location.pathname];
    if (tabName) updateTabState(tabName, location.pathname);
  }, [location.pathname, updateTabState]);

  const navigateToTab = React.useCallback((tabName) => {
    const tabState = tabStates[tabName];
    if (!tabState) return;
    if (location.pathname === tabState.url && tabState.url !== tabState.root) {
      navigate(tabState.root);
    } else {
      navigate(tabState.url);
    }
  }, [tabStates, location.pathname, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 text-sm">Loading SecureGuard...</p>
        </div>
      </div>
    );
  }

  if (error && !user && retryCount >= 2) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <div className="text-center max-w-sm">
          <Shield className="w-16 h-16 text-amber-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Connection Error</h1>
          <p className="text-slate-400 mb-6 text-sm">Having trouble connecting. Please check your internet and try again.</p>
          <div className="flex flex-col gap-3">
            <Button onClick={() => window.location.reload()} className="bg-sky-500 hover:bg-sky-600">
              <RefreshCw className="w-4 h-4 mr-2" /> Reload App
            </Button>
            <Button onClick={() => base44.auth.redirectToLogin()} variant="outline" className="border-slate-600 text-slate-300">
              Log In Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <div className="text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-sky-400 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-sky-500/30">
            <Shield className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">SecureGuard</h1>
          <p className="text-slate-400 mb-8">Professional Security Management</p>
          <Button onClick={() => base44.auth.redirectToLogin()} className="bg-sky-500 hover:bg-sky-600 h-12 px-8 text-base shadow-lg shadow-sky-500/30">
            Sign In
          </Button>
        </div>
      </div>
    );
  }

  const getNavigationItems = () => {
    const role = user.role_type;
    if (role === "guard") {
      return [
        { title: "My Shift", url: createPageUrl("GuardShift"), icon: Shield, isRoot: true },
        { title: "My Schedule", url: createPageUrl("GuardMyShifts"), icon: Calendar },
        { title: "Contacts", url: createPageUrl("Contacts"), icon: Users },
        { title: "Call History", url: createPageUrl("CallHistory"), icon: Clock },
        { title: "Call Recordings", url: createPageUrl("CallRecordings"), icon: Mic },
        { title: "Incidents", url: createPageUrl("GuardIncidents"), icon: AlertTriangle },
        { title: "Maintenance", url: createPageUrl("GuardMaintenance"), icon: MapPin },
        { title: "AI Patrol", url: createPageUrl("GuardPatrol"), icon: Shield },
        { title: "Access Control", url: createPageUrl("AccessControl"), icon: QrCode },
        { title: "Shift Reports", url: createPageUrl("StartOfShiftHistory"), icon: FileText },
        { title: "Profile", url: createPageUrl("Profile"), icon: UserCircle }
      ];
    }
    if (role === "dispatcher" || role === "admin") {
      return [
        { title: "Control Room", url: createPageUrl("ControlRoom"), icon: Radio, isRoot: true },
        { title: "Incident Queue", url: createPageUrl("AdminIncidents"), icon: AlertTriangle },
        { title: "Panic Management", url: createPageUrl("PanicManagement"), icon: Zap },
        { title: "Access Control", url: createPageUrl("AccessControl"), icon: QrCode },
        { title: "Access History", url: createPageUrl("AccessHistory"), icon: FileText },
        { title: "Access Settings", url: createPageUrl("AccessSettings"), icon: Sliders },
        { title: "Contacts", url: createPageUrl("Contacts"), icon: Users },
        { title: "Call History", url: createPageUrl("CallHistory"), icon: Clock },
        { title: "Call Recordings", url: createPageUrl("CallRecordings"), icon: Mic },
        { title: "Scheduling", url: createPageUrl("Scheduling"), icon: Calendar },
        { title: "Clock In/Out", url: createPageUrl("ClockInOutReports"), icon: Clock },
        { title: "Sites", url: createPageUrl("SiteManagement"), icon: MapPin },
        { title: "Patrol Dashboard", url: createPageUrl("PatrolDashboard"), icon: Shield },
        { title: "Patrol Analytics", url: createPageUrl("PatrolAnalytics"), icon: BarChart3 },
        { title: "Site Map", url: createPageUrl("SiteMapDashboard"), icon: MapPin },
        { title: "Payroll", url: createPageUrl("PayrollSummary"), icon: BarChart3 },
        { title: "Data Hub", url: createPageUrl("DataHub"), icon: FileText },
        { title: "Reports", url: createPageUrl("Reports"), icon: FileText },
        { title: "Analytics", url: createPageUrl("Analytics"), icon: BarChart3 },
        { title: "Guard Activity", url: createPageUrl("GuardActivity"), icon: Users },
        { title: "AI Reports", url: createPageUrl("AIReports"), icon: Sparkles },
        { title: "Shift Reports", url: createPageUrl("StartOfShiftHistory"), icon: FileText },
        { title: "User Management", url: createPageUrl("UserManagement"), icon: Users },
        { title: "Assets", url: createPageUrl("AssetManagement"), icon: Package },
        { title: "Stay Awake", url: createPageUrl("StayAwakeConfiguration"), icon: Zap },
        { title: "Configuration", url: createPageUrl("Configuration"), icon: Sliders },
        { title: "Profile", url: createPageUrl("Profile"), icon: UserCircle }
      ];
    }
    if (role === "resident") {
      return [
        { title: "Home", url: createPageUrl("ResidentDashboard"), icon: Users, isRoot: true },
        { title: "Visitors", url: createPageUrl("ResidentVisitors"), icon: QrCode },
        { title: "Bookings", url: createPageUrl("ResidentBookings"), icon: Calendar },
        { title: "Order Food/Shop", url: createPageUrl("ResidentOrders"), icon: Package },
        { title: "Laundry", url: createPageUrl("ResidentLaundry"), icon: ShirtIcon },
        { title: "Maintenance", url: createPageUrl("ResidentMaintenance"), icon: Wrench },
        { title: "Security", url: createPageUrl("ResidentIncidents"), icon: Shield },
        { title: "Tickets", url: createPageUrl("ResidentTickets"), icon: FileText },
        { title: "Payments", url: createPageUrl("ResidentPayments"), icon: Wrench },
        { title: "Announcements", url: createPageUrl("ResidentAnnouncements"), icon: Bell },
        { title: "Profile", url: createPageUrl("Profile"), icon: UserCircle }
      ];
    }
    if (role === "estate_manager") {
      return [
        { title: "Dashboard", url: createPageUrl("EstateManagerDashboard"), icon: BarChart3, isRoot: true },
        { title: "Residents", url: createPageUrl("EstateResidents"), icon: Users },
        { title: "Venues", url: createPageUrl("EstateVenues"), icon: MapPin },
        { title: "Vendors", url: createPageUrl("EstateVendors"), icon: Package },
        { title: "Levy Management", url: createPageUrl("EstateLevy"), icon: Sliders },
        { title: "Access Control", url: createPageUrl("AccessControl"), icon: QrCode },
        { title: "Panic Management", url: createPageUrl("PanicManagement"), icon: Zap },
        { title: "Security", url: createPageUrl("ControlRoom"), icon: Shield },
        { title: "Profile", url: createPageUrl("Profile"), icon: UserCircle }
      ];
    }
    if (role === "vendor") {
      return [
        { title: "My Portal", url: createPageUrl("VendorPortal"), icon: Package, isRoot: true },
        { title: "Profile", url: createPageUrl("Profile"), icon: UserCircle }
      ];
    }
    if (role === "client") {
      return [
        { title: "Dashboard", url: createPageUrl("ClientDashboard"), icon: BarChart3, isRoot: true },
        { title: "Reports", url: createPageUrl("ClientReports"), icon: Shield },
        { title: "Incidents", url: createPageUrl("ClientIncidents"), icon: AlertTriangle },
        { title: "Profile", url: createPageUrl("Profile"), icon: UserCircle }
      ];
    }
    return [];
  };

  const navigationItems = getNavigationItems();
  const rootUrl = navigationItems.find(item => item.isRoot)?.url;
  const isRootPage = navigationItems.some(item => item.isRoot && location.pathname === item.url);
  const canGoBack = !isRootPage && window.history.length > 1;

  const getMobileNavItems = () => {
    const role = user.role_type;
    if (role === "guard") {
      return [
        { title: "Shift", tab: "guard", icon: Shield, color: "text-emerald-400" },
        { title: "Incidents", tab: "incidents", icon: AlertTriangle, color: "text-rose-400" },
        { title: "Maintenance", tab: "maintenance", icon: Wrench, color: "text-amber-400" },
        { title: "QR Scan", tab: "qr", icon: QrCode, color: "text-sky-400" }
      ];
    }
    if (role === "dispatcher" || role === "admin") {
      return [
        { title: "Control", tab: "control", icon: Radio, color: "text-sky-400" },
        { title: "Shifts", tab: "scheduling", icon: Calendar, color: "text-emerald-400" },
        { title: "Sites", tab: "sites", icon: MapPin, color: "text-amber-400" }
      ];
    }
    return [];
  };

  const mobileNavItems = getMobileNavItems();

  const roleLabel = {
    guard: "Security Guard", dispatcher: "Dispatcher", admin: "Administrator",
    resident: "Resident", estate_manager: "Estate Manager", vendor: "Vendor", client: "Client"
  }[user.role_type] || user.role_type;

  return (
    <TabStateContext.Provider value={{ tabStates, updateTabState, navigateToTab }}>
      <ThemeProvider>
        <ErrorBoundary>
          <ServiceWorkerRegistration />
          <PWAInstaller />
          <OneSignalSetup />
          {user && <BackgroundNotificationManager user={user} />}
          {user && <PermissionEnforcement />}
          <IncidentEscalationMonitor user={user} />
          <RealTimeAlertMonitor user={user} />


          <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 w-full max-w-full overflow-x-hidden">
            {/* Header */}
            <header className="bg-slate-900/90 backdrop-blur-xl border-b border-slate-700/50 sticky top-0 z-50 w-full" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
              <div className="px-4 lg:px-6 h-16 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {canGoBack ? (
                    <button onClick={() => navigate(rootUrl)} className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-800 text-slate-300 lg:hidden">
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                  ) : (
                    <div className="w-9 h-9 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/30 lg:hidden">
                      <Shield className="w-5 h-5 text-white" />
                    </div>
                  )}

                  <div className="w-9 h-9 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl hidden lg:flex items-center justify-center shadow-lg shadow-sky-500/30">
                    <Shield className="w-5 h-5 text-white" />
                  </div>
                  
                  {!canGoBack && (
                    <div className="lg:hidden">
                      <h1 className="font-bold text-white text-base leading-tight">
                        {["resident", "estate_manager", "vendor"].includes(user.role_type) ? "EstateHub" : "SecureGuard"}
                      </h1>
                      <p className="text-xs text-slate-400">{roleLabel}</p>
                    </div>
                  )}
                  <div className="hidden lg:block">
                    <h1 className="font-bold text-white text-base leading-tight">
                      {["resident", "estate_manager", "vendor"].includes(user.role_type) ? "EstateHub" : "SecureGuard"}
                    </h1>
                    <p className="text-xs text-slate-400">{roleLabel}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={() => setMobileMenuOpen(true)} className="lg:hidden w-11 h-11 bg-slate-800 rounded-xl flex items-center justify-center text-slate-200 active:scale-95 transition-transform touch-manipulation">
                    <Menu className="w-6 h-6" />
                  </button>

                  <GlobalPanicButton user={user} />

                  <button
                    onClick={() => setShowNotifications(true)}
                    className="relative w-11 h-11 bg-slate-800 rounded-xl flex items-center justify-center text-slate-200 active:scale-95 transition-transform touch-manipulation"
                  >
                    <Bell className="w-5 h-5" />
                    {notificationCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                        {notificationCount > 9 ? '9+' : notificationCount}
                      </span>
                    )}
                  </button>

                  <div className="hidden md:flex items-center gap-2 bg-slate-800/80 rounded-xl px-3 py-2">
                    <div className="w-7 h-7 bg-gradient-to-br from-sky-400 to-blue-600 rounded-lg flex items-center justify-center">
                      <span className="text-white font-bold text-xs">{(user.display_name || user.full_name)?.[0]?.toUpperCase() || "U"}</span>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">{(user.display_name || user.full_name)}</p>
                      <p className="text-xs text-slate-400">{user.badge_number || user.email}</p>
                    </div>
                  </div>

                  <button onClick={handleLogout} title="Log out" className="w-12 h-12 bg-rose-500/15 border border-rose-500/30 rounded-xl flex items-center justify-center text-rose-400 hover:bg-rose-500/25 active:scale-95 transition touch-manipulation shrink-0">
                    <LogOut className="w-6 h-6" />
                  </button>
                </div>
              </div>
            </header>

            <div className="flex flex-col lg:flex-row w-full max-w-full">
              {/* Desktop Sidebar */}
              <aside className="hidden lg:flex flex-col w-64 bg-slate-900/60 backdrop-blur-lg border-r border-slate-700/50 min-h-screen shrink-0">
                <div className="p-4 border-b border-slate-700/50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center">
                      <span className="text-white font-bold">{(user.display_name || user.full_name)?.[0]?.toUpperCase() || "U"}</span>
                    </div>
                    <div>
                      <p className="text-white font-semibold text-sm">{(user.display_name || user.full_name)}</p>
                      <p className="text-slate-400 text-xs">{roleLabel}</p>
                    </div>
                  </div>
                </div>
                <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                  {navigationItems.map((item) => (
                    <Link
                      key={item.title}
                      to={item.url}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm font-medium ${
                        location.pathname === item.url
                          ? "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                          : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      }`}
                    >
                      <item.icon className="w-4 h-4 shrink-0" />
                      {item.title}
                    </Link>
                  ))}
                </nav>
                {user.role_type === "guard" && user.is_clocked_in && (
                  <div className="p-4 border-t border-slate-700/50">
                    <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                      <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                      <span className="text-emerald-400 text-sm font-medium">On Duty</span>
                    </div>
                  </div>
                )}
              </aside>

              <main className="flex-1 min-h-screen w-full max-w-full overflow-x-hidden">
                <div className="pb-24 md:pb-6 w-full max-w-full">
                  {children}
                </div>
              </main>
            </div>

            {showNotifications && (
              <NotificationCenter user={user} onClose={() => { setShowNotifications(false); loadNotificationCount(); }} />
            )}

            {/* Mobile Drawer */}
            {mobileMenuOpen && (
              <div className="fixed inset-0 z-50 lg:hidden">
                <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
                <div className="absolute top-0 left-0 bottom-0 w-72 bg-slate-900 border-r border-slate-700 flex flex-col">
                  <div className="p-4 border-b border-slate-700 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center">
                        <span className="text-white font-bold">{(user.display_name || user.full_name)?.[0]?.toUpperCase() || "U"}</span>
                      </div>
                      <div>
                        <p className="text-white font-semibold text-sm">{(user.display_name || user.full_name)}</p>
                        <p className="text-slate-400 text-xs">{roleLabel}</p>
                      </div>
                    </div>
                    <button onClick={() => setMobileMenuOpen(false)} className="w-8 h-8 bg-slate-800 rounded-lg flex items-center justify-center text-slate-400">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                    {navigationItems.map((item) => (
                      <Link
                        key={item.title}
                        to={item.url}
                        onClick={() => setMobileMenuOpen(false)}
                        className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm font-medium ${
                          location.pathname === item.url
                            ? "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                            : "text-slate-400 hover:bg-slate-800 hover:text-white"
                        }`}
                      >
                        <item.icon className="w-4 h-4 shrink-0" />
                        {item.title}
                      </Link>
                    ))}
                  </nav>
                  <div className="p-4 border-t border-slate-700">
                    <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-3 text-rose-400 hover:bg-rose-500/10 rounded-xl transition-colors text-sm font-medium">
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Mobile Bottom Navigation */}
            {mobileNavItems.length > 0 && (
              <nav
                className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900/98 backdrop-blur-xl border-t border-slate-700/50 z-50"
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
              >
                <div className="flex justify-around items-center h-16">
                  {mobileNavItems.map((item) => {
                    const Icon = item.icon;
                    const tabState = tabStates[item.tab];
                    const isActive = tabState && location.pathname === tabState.url;
                    return (
                      <button
                        key={item.tab}
                        onClick={() => navigateToTab(item.tab)}
                        className={`flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-all ${isActive ? item.color : 'text-slate-500'}`}
                      >
                        <Icon className={`w-5 h-5 ${isActive ? 'scale-110' : ''} transition-transform`} />
                        <span className="text-xs font-medium">{item.title}</span>
                        {isActive && <div className={`w-1 h-1 rounded-full ${item.color.replace('text-', 'bg-')}`} />}
                      </button>
                    );
                  })}
                </div>
              </nav>
            )}
          </div>
        </ErrorBoundary>
      </ThemeProvider>
    </TabStateContext.Provider>
  );
}