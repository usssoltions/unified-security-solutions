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
      loadNotificationCount();
      const interval = setInterval(loadNotificationCount, 10000);
      return () => clearInterval(interval);
    }
  }, [user]);

  // Keep-alive mechanism
  useEffect(() => {
    if (user && ['admin', 'dispatcher', 'supervisor', 'management'].includes(user.role_type)) {
      const keepAlive = setInterval(async () => {
        try {
          await base44.auth.me();
        } catch (error) {
          // Silent fail
        }
      }, 5 * 60 * 1000);

      return () => clearInterval(keepAlive);
    }
  }, [user]);

  const loadUser = async () => {
    setLoading(true);
    setError(null);
    
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        const currentUser = await base44.auth.me();
        setUser(currentUser);
        setError(null);
        break;
      } catch (err) {
        attempts++;
        if (attempts >= maxAttempts) {
          console.error("Failed to load user after retries:", err);
          setError(err);
        } else {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
        }
      }
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
      // Clear all local state and navigate to root
      localStorage.clear();
      sessionStorage.clear();
      queryClient.clear();
      
      // Force navigate to root before logout to prevent state persistence
      navigate('/');
      
      await base44.auth.logout();
    } catch (err) {
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
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <header className="bg-slate-900/80 backdrop-blur-lg border-b border-slate-700/50 sticky top-0 z-50 safe-area-top">
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

              {/* Desktop always shows logo and menu */}
              <Shield className="w-8 h-8 text-sky-400 hidden lg:block" />
              <div className={canGoBack ? "hidden lg:block" : ""}>
                <h1 className="font-bold text-white text-lg">SecureGuard</h1>
                <p className="text-xs text-slate-400 capitalize">{user.role_type} Portal</p>
              </div>
              {!canGoBack && (
                <div className="lg:hidden">
                  <h1 className="font-bold text-white text-lg">SecureGuard</h1>
                  <p className="text-xs text-slate-400 capitalize">{user.role_type} Portal</p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 md:gap-3">
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

        <div className="flex flex-col lg:flex-row">
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

          <main className="flex-1 min-h-screen w-full overflow-x-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
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
      </div>
      </ErrorBoundary>
      </ThemeProvider>
      </TabStateContext.Provider>
      );
      }