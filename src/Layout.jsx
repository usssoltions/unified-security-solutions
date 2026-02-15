import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import {
  Shield,
  Radio,
  Calendar,
  AlertTriangle,
  MapPin,
  BarChart3,
  Users,
  Menu,
  X,
  LogOut,
  Bell,
  Package,
  Sliders,
  RefreshCw,
  Sparkles,
  Zap,
  FileText,
  Mic,
  Clock,
  ArrowLeft,
  UserCircle,
  Wrench,
  QrCode,
  MessageCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ErrorBoundary from "@/components/ErrorBoundary";
import NotificationCenter from "@/components/notifications/NotificationCenter";
import IncidentEscalationMonitor from "@/components/incidents/IncidentEscalationMonitor";
import RealTimeAlertMonitor from "@/components/alerts/RealTimeAlertMonitor";
import PWAInstaller from "@/components/PWAInstaller";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import PermissionEnforcement from "@/components/PermissionEnforcement";
import OneSignalSetup from "@/components/OneSignalSetup";
import ThemeProvider from "@/components/ThemeProvider";
import { AnimatePresence, motion } from "framer-motion";
import IncomingCallHandler from "@/components/IncomingCallHandler";

// Tab state context for preserving navigation history
const TabStateContext = React.createContext({
  tabStates: {},
  updateTabState: () => {},
  navigateToTab: () => {}
});

export const useTabState = () => React.useContext(TabStateContext);

export default function Layout({ children, currentPageName }) {
  const [tabStates, setTabStates] = React.useState({
    // Initialize with root URLs for each tab
    guard: { url: createPageUrl("GuardShift"), root: createPageUrl("GuardShift") },
    incidents: { url: createPageUrl("GuardIncidents"), root: createPageUrl("GuardIncidents") },
    maintenance: { url: createPageUrl("GuardMaintenance"), root: createPageUrl("GuardMaintenance") },
    qr: { url: createPageUrl("QRScanner"), root: createPageUrl("QRScanner") },
    control: { url: createPageUrl("ControlRoom"), root: createPageUrl("ControlRoom") },
    ptt: { url: createPageUrl("PTT"), root: createPageUrl("PTT") },
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
    // Force re-authentication on app startup (for shared device usage)
    const sessionKey = 'guard_session_active';
    const isNewSession = !sessionStorage.getItem(sessionKey);

    if (isNewSession) {
      // Clear all auth data to force fresh login
      localStorage.removeItem('sb-qtrypzzcjebvfcihiynt-auth-token');
      sessionStorage.clear();
      sessionStorage.setItem(sessionKey, 'true');

      // Force re-authentication through Base44
      base44.auth.me().then(currentUser => {
        if (!currentUser) {
          base44.auth.redirectToLogin();
        }
      }).catch(() => {
        base44.auth.redirectToLogin();
      });
      return;
    }

    loadUser();
    
    // Keep screen awake
    let wakeLock = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
          console.log('Wake lock active');
        }
      } catch (err) {
        console.log('Wake lock error:', err);
      }
    };
    
    requestWakeLock();
    document.addEventListener('visibilitychange', requestWakeLock);
    
    // Suppress WebSocket errors globally
    const originalError = console.error;
    const originalWarn = console.warn;
    
    console.error = (...args) => {
      const msg = args[0]?.toString() || '';
      if (
        msg.includes('WebSocket') || 
        msg.includes('websocket') ||
        msg.includes('WS') ||
        msg.includes('socket')
      ) {
        return;
      }
      originalError.apply(console, args);
    };
    
    console.warn = (...args) => {
      const msg = args[0]?.toString() || '';
      if (
        msg.includes('WebSocket') || 
        msg.includes('websocket') ||
        msg.includes('WS') ||
        msg.includes('socket')
      ) {
        return;
      }
      originalWarn.apply(console, args);
    };

    return () => {
      console.error = originalError;
      console.warn = originalWarn;
      document.removeEventListener('visibilitychange', requestWakeLock);
      if (wakeLock) {
        wakeLock.release();
      }
    };
  }, [retryCount]);

  useEffect(() => {
    if (user) {
      // Defer notification loading by 2 seconds to not block initial render
      const timeout = setTimeout(loadNotificationCount, 2000);
      const interval = setInterval(loadNotificationCount, 30000);
      return () => {
        clearTimeout(timeout);
        clearInterval(interval);
      };
    }
  }, [user]);

  // Keep-alive mechanism - reduced frequency
  useEffect(() => {
    if (user && ['admin', 'dispatcher', 'supervisor', 'management'].includes(user.role_type)) {
      const keepAlive = setInterval(async () => {
        try {
          await base44.auth.me();
        } catch (error) {
          // Silent fail
        }
      }, 15 * 60 * 1000);

      return () => clearInterval(keepAlive);
    }
  }, [user]);

  const loadUser = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setError(null);
    } catch (err) {
      console.error("Failed to load user:", err);
      setError(err);
    }
    
    setLoading(false);
  };

  const loadNotificationCount = async () => {
    try {
      const notifications = await base44.entities.Notification.filter({ 
        recipient_id: user.id,
        read: false 
      });
      setNotificationCount(notifications.length);
    } catch (error) {
      // Silent fail - non-critical functionality
    }
  };

  const handleLogout = async () => {
    try {
      // Clear all state including session marker
      localStorage.clear();
      sessionStorage.clear();
      
      // Logout and let Base44 handle redirect
      await base44.auth.logout();
    } catch (err) {
      // Force clear and reload
      localStorage.clear();
      sessionStorage.clear();
      window.location.reload();
    }
  };

  const handleRetry = () => {
    setRetryCount(prev => prev + 1);
  };

  const updateTabState = React.useCallback((tabName, url) => {
    setTabStates(prev => ({
      ...prev,
      [tabName]: {
        ...prev[tabName],
        url: url,
        lastVisited: Date.now()
      }
    }));
  }, []);

  // Track current URL for each tab
  React.useEffect(() => {
    const currentPath = location.pathname;
    
    // Map paths to tabs
    const tabMapping = {
      [createPageUrl("GuardShift")]: "guard",
      [createPageUrl("GuardIncidents")]: "incidents",
      [createPageUrl("GuardMaintenance")]: "maintenance",
      [createPageUrl("QRScanner")]: "qr",
      [createPageUrl("ControlRoom")]: "control",
      [createPageUrl("PTT")]: "ptt",
      [createPageUrl("Scheduling")]: "scheduling",
      [createPageUrl("SiteManagement")]: "sites"
    };

    const tabName = tabMapping[currentPath];
    if (tabName) {
      updateTabState(tabName, currentPath);
    }
  }, [location.pathname, updateTabState]);

  const navigateToTab = React.useCallback((tabName) => {
    const tabState = tabStates[tabName];
    if (!tabState) return;

    // If already on this tab, reset to root
    if (location.pathname === tabState.url && tabState.url !== tabState.root) {
      navigate(tabState.root);
    } else {
      // Navigate to last saved URL for this tab
      navigate(tabState.url);
    }
  }, [tabStates, location.pathname, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-400 mx-auto mb-4" />
          <p className="text-slate-400">Loading Security Guard System...</p>
        </div>
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
        <div className="text-center max-w-md">
          <Shield className="w-16 h-16 text-rose-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Connection Error</h1>
          <p className="text-slate-400 mb-6">
            Unable to connect to the server. Please check your internet connection and try again.
          </p>
          <div className="flex gap-3 justify-center">
            <Button onClick={handleRetry} className="bg-sky-500 hover:bg-sky-600">
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
            <Button 
              onClick={() => window.location.reload()} 
              variant="outline" 
              className="border-slate-600 text-slate-300"
            >
              Reload Page
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="text-center">
          <Shield className="w-16 h-16 text-sky-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Security Guard Management</h1>
          <p className="text-slate-400 mb-6">Please log in to continue</p>
          <Button onClick={() => base44.auth.redirectToLogin()} className="bg-sky-500 hover:bg-sky-600">
            Log In
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
        { title: "Contacts", url: createPageUrl("Contacts"), icon: Users },
        { title: "Call History", url: createPageUrl("CallHistory"), icon: Clock },
        { title: "Call Recordings", url: createPageUrl("CallRecordings"), icon: Mic },
        { title: "PTT Recordings", url: createPageUrl("PTTRecordings"), icon: Radio },
        { title: "PTT Radio", url: createPageUrl("PTT"), icon: Mic },
        { title: "Incidents", url: createPageUrl("GuardIncidents"), icon: AlertTriangle },
        { title: "Maintenance", url: createPageUrl("GuardMaintenance"), icon: MapPin },
        { title: "Profile", url: createPageUrl("Profile"), icon: UserCircle }
      ];
    }

    if (role === "dispatcher" || role === "admin") {
      return [
        { title: "Control Room", url: createPageUrl("ControlRoom"), icon: Radio, isRoot: true },
        { title: "Incident Queue", url: createPageUrl("AdminIncidents"), icon: AlertTriangle },
        { title: "PTT Radio", url: createPageUrl("PTT"), icon: Mic },
        { title: "PTT Recordings", url: createPageUrl("PTTRecordings"), icon: Radio },
        { title: "Contacts", url: createPageUrl("Contacts"), icon: Users },
        { title: "Call History", url: createPageUrl("CallHistory"), icon: Clock },
        { title: "Call Recordings", url: createPageUrl("CallRecordings"), icon: Mic },
        { title: "Scheduling", url: createPageUrl("Scheduling"), icon: Calendar },
        { title: "Clock In/Out", url: createPageUrl("ClockInOutReports"), icon: Clock },
        { title: "Sites", url: createPageUrl("SiteManagement"), icon: MapPin },
        { title: "Reports", url: createPageUrl("Reports"), icon: FileText },
        { title: "Analytics", url: createPageUrl("Analytics"), icon: BarChart3 },
        { title: "Guard Activity", url: createPageUrl("GuardActivity"), icon: Users },
        { title: "AI Reports", url: createPageUrl("AIReports"), icon: Sparkles },
        { title: "User Management", url: createPageUrl("UserManagement"), icon: Users },
        { title: "Assets", url: createPageUrl("AssetManagement"), icon: Package },
        { title: "Stay Awake", url: createPageUrl("StayAwakeConfiguration"), icon: Zap },
        { title: "Test Data Manager", url: createPageUrl("TestDataManager"), icon: RefreshCw },
        { title: "OneSignal Test", url: createPageUrl("OneSignalTest"), icon: Bell },
        { title: "Configuration", url: createPageUrl("Configuration"), icon: Sliders },
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
  const isRootPage = navigationItems.some(
    item => item.isRoot && location.pathname === item.url
  );
  const canGoBack = !isRootPage && window.history.length > 1;

  // Mobile bottom nav configuration
  const getMobileNavItems = () => {
    const role = user.role_type;

    if (role === "guard") {
      return [
        { title: "My Shift", tab: "guard", icon: Shield, color: "text-emerald-400" },
        { title: "Incidents", tab: "incidents", icon: AlertTriangle, color: "text-rose-400" },
        { title: "Maintenance", tab: "maintenance", icon: Wrench, color: "text-amber-400" },
        { title: "Scan QR", tab: "qr", icon: QrCode, color: "text-sky-400" }
      ];
    }

    if (role === "dispatcher" || role === "admin") {
      return [
        { title: "Control", tab: "control", icon: Radio, color: "text-sky-400" },
        { title: "PTT", tab: "ptt", icon: MessageCircle, color: "text-purple-400" },
        { title: "Shifts", tab: "scheduling", icon: Calendar, color: "text-emerald-400" },
        { title: "Sites", tab: "sites", icon: MapPin, color: "text-amber-400" }
      ];
    }

    return [];
  };

  const mobileNavItems = getMobileNavItems();

  return (
    <TabStateContext.Provider value={{ tabStates, updateTabState, navigateToTab }}>
      <ThemeProvider>
        <ErrorBoundary>
          <ServiceWorkerRegistration />
          <PWAInstaller />
          <OneSignalSetup />
          {user && <PermissionEnforcement />}
          <IncidentEscalationMonitor user={user} />
          <RealTimeAlertMonitor user={user} />
          {user && <IncomingCallHandler user={user} />}
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 w-full max-w-full overflow-x-hidden">
        <header className="bg-slate-900/80 backdrop-blur-lg border-b border-slate-700/50 sticky top-0 z-50 w-full" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="px-4 lg:px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Back button on mobile child screens, logo on root screens */}
              {canGoBack ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigate(-1)}
                  className="text-slate-300 hover:text-white lg:hidden"
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              ) : (
                <Shield className="w-8 h-8 text-sky-400 lg:hidden" />
              )}

              {/* Desktop always shows logo and title */}
              <Shield className="w-8 h-8 text-sky-400 hidden lg:block" />
              <div className="hidden lg:block">
                <h1 className="font-bold text-white text-lg">SecureGuard</h1>
                <p className="text-xs text-slate-400 capitalize">{user.role_type} Portal</p>
              </div>
              
              {/* Mobile: show title only on root pages */}
              {!canGoBack && (
                <div className="lg:hidden">
                  <h1 className="font-bold text-white text-lg">SecureGuard</h1>
                  <p className="text-xs text-slate-400 capitalize">{user.role_type} Portal</p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 md:gap-3">
              {/* Mobile Menu Button */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden text-slate-300 hover:text-white"
              >
                <Menu className="w-5 h-5" />
              </Button>

              {/* Current User Display - Mobile */}
              <div className="md:hidden flex items-center gap-2 px-2 py-1 bg-slate-800/50 rounded-lg">
                <div className="w-7 h-7 bg-sky-500 rounded-full flex items-center justify-center">
                  <span className="text-white font-semibold text-xs">
                    {user.full_name?.[0]?.toUpperCase() || "U"}
                  </span>
                </div>
                <div className="text-left">
                  <p className="text-xs font-medium text-white truncate max-w-[100px]">{user.full_name}</p>
                  <p className="text-xs text-slate-400 capitalize">{user.role_type}</p>
                </div>
              </div>

              <button 
                className="relative text-slate-300 hover:text-white transition-colors p-2 rounded-lg hover:bg-slate-800"
                onClick={() => setShowNotifications(true)}
                aria-label="Notifications"
              >
                <Bell className="w-5 h-5" />
                {notificationCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center bg-rose-500 text-white text-xs font-bold rounded-full">
                    {notificationCount > 9 ? '9+' : notificationCount}
                  </span>
                )}
              </button>

              {/* Current User Display - Desktop */}
              <div className="hidden md:flex items-center gap-3 px-3 py-2 bg-slate-800/50 rounded-lg">
                <div className="w-8 h-8 bg-sky-500 rounded-full flex items-center justify-center">
                  <span className="text-white font-semibold text-sm">
                    {user.full_name?.[0]?.toUpperCase() || "U"}
                  </span>
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-white">{user.full_name}</p>
                  <p className="text-xs text-slate-400">{user.badge_number || user.email}</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={handleLogout} className="text-slate-300">
                <LogOut className="w-5 h-5" />
              </Button>
            </div>
            </div>
            </header>

        <div className="flex flex-col lg:flex-row w-full max-w-full">
          <aside className="hidden lg:flex flex-col w-full lg:w-64 bg-slate-900/60 backdrop-blur-lg lg:border-r border-slate-700/50 min-h-screen flex-shrink-0 safe-area-bottom">
            <nav className="flex-1 p-4 space-y-2">
              {navigationItems.map((item) => (
                <Link
                  key={item.title}
                  to={item.url}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                    location.pathname === item.url
                      ? "bg-sky-500 text-white shadow-lg shadow-sky-500/20"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="font-medium">{item.title}</span>
                </Link>
              ))}
            </nav>

            {user.role_type === "guard" && user.is_clocked_in && (
              <div className="p-4 border-t border-slate-700/50">
                <div className="px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                    <span className="text-sm font-medium">On Duty</span>
                  </div>
                </div>
              </div>
            )}
          </aside>

          <main className="flex-1 min-h-screen w-full max-w-full overflow-x-hidden pb-0 md:pb-0">
            <div className="pb-24 md:pb-0 w-full max-w-full">
              {children}
            </div>
          </main>
          </div>

        {showNotifications && (
          <NotificationCenter
            user={user}
            onClose={() => {
              setShowNotifications(false);
              loadNotificationCount();
            }}
          />
        )}

        {/* Mobile Menu Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div 
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="absolute top-0 left-0 bottom-0 w-80 max-w-[85vw] bg-slate-900 border-r border-slate-700 overflow-y-auto">
              <div className="p-4 border-b border-slate-700 flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Menu</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-slate-400"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
              <nav className="p-4 space-y-2">
                {navigationItems.map((item) => (
                  <Link
                    key={item.title}
                    to={item.url}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                      location.pathname === item.url
                        ? "bg-sky-500 text-white"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    <item.icon className="w-5 h-5" />
                    <span className="font-medium">{item.title}</span>
                  </Link>
                ))}
              </nav>
            </div>
          </div>
        )}

        {/* Mobile Bottom Navigation */}
        {mobileNavItems.length > 0 && (
          <nav 
            className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-lg border-t border-slate-700/50 z-50" 
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
                    className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${
                      isActive ? item.color : 'text-slate-400'
                    }`}
                  >
                    <Icon className={`w-6 h-6 mb-1 ${isActive ? 'scale-110' : ''} transition-transform`} />
                    <span className="text-xs font-medium">{item.title}</span>
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