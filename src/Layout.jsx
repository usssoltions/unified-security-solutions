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
  Mic
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ErrorBoundary from "@/components/ErrorBoundary";
import NotificationCenter from "@/components/notifications/NotificationCenter";
import IncidentEscalationMonitor from "@/components/incidents/IncidentEscalationMonitor";
import PWAInstaller from "@/components/PWAInstaller";

export default function Layout({ children, currentPageName }) {
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
    
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
    } catch (err) {
      console.error("Failed to load user:", err);
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const loadNotificationCount = async () => {
    try {
      const notifications = await base44.entities.Notification.filter({ 
        recipient_id: user.id,
        read: false 
      });
      setNotificationCount(notifications.length);
    } catch (error) {
      const errMsg = error?.message || '';
      if (!errMsg.includes('WebSocket') && !errMsg.includes('socket')) {
        console.error("Failed to load notifications:", error);
      }
    }
  };

  const handleLogout = async () => {
    try {
      await base44.auth.logout();
    } catch (err) {
      window.location.reload();
    }
  };

  const handleRetry = () => {
    setRetryCount(prev => prev + 1);
  };

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
        { title: "My Shift", url: createPageUrl("GuardShift"), icon: Shield },
        { title: "PTT Radio", url: createPageUrl("PTT"), icon: Mic },
        { title: "Contacts", url: createPageUrl("Contacts"), icon: Users },
        { title: "Incidents", url: createPageUrl("GuardIncidents"), icon: AlertTriangle },
        { title: "Maintenance", url: createPageUrl("GuardMaintenance"), icon: MapPin }
      ];
    }

    if (role === "dispatcher" || role === "admin") {
      return [
        { title: "Control Room", url: createPageUrl("ControlRoom"), icon: Radio },
        { title: "PTT Radio", url: createPageUrl("PTT"), icon: Mic },
        { title: "Contacts", url: createPageUrl("Contacts"), icon: Users },
        { title: "Scheduling", url: createPageUrl("Scheduling"), icon: Calendar },
        { title: "Sites", url: createPageUrl("SiteManagement"), icon: MapPin },
        { title: "Reports", url: createPageUrl("Reports"), icon: FileText },
        { title: "Analytics", url: createPageUrl("Analytics"), icon: BarChart3 },
        { title: "Guard Activity", url: createPageUrl("GuardActivity"), icon: Users },
        { title: "AI Reports", url: createPageUrl("AIReports"), icon: Sparkles },
        { title: "User Management", url: createPageUrl("UserManagement"), icon: Users },
        { title: "Assets", url: createPageUrl("AssetManagement"), icon: Package },
        { title: "Stay Awake", url: createPageUrl("StayAwakeConfiguration"), icon: Zap },
        { title: "Configuration", url: createPageUrl("Configuration"), icon: Sliders }
      ];
    }

    if (role === "client") {
      return [
        { title: "Dashboard", url: createPageUrl("ClientDashboard"), icon: BarChart3 },
        { title: "Reports", url: createPageUrl("ClientReports"), icon: Shield },
        { title: "Incidents", url: createPageUrl("ClientIncidents"), icon: AlertTriangle }
      ];
    }

    return [];
  };

  const navigationItems = getNavigationItems();

  return (
    <ErrorBoundary>
      <PWAInstaller />
      <IncidentEscalationMonitor user={user} />
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <header className="bg-slate-900/80 backdrop-blur-lg border-b border-slate-700/50 sticky top-0 z-50">
          <div className="px-4 lg:px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden text-slate-300"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X /> : <Menu />}
              </Button>
              <Shield className="w-8 h-8 text-sky-400" />
              <div>
                <h1 className="font-bold text-white text-lg">SecureGuard</h1>
                <p className="text-xs text-slate-400 capitalize">{user.role_type} Portal</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="icon" 
                className="relative text-slate-300"
                onClick={() => setShowNotifications(true)}
              >
                <Bell className="w-5 h-5" />
                {notificationCount > 0 && (
                  <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center bg-rose-500 text-white text-xs">
                    {notificationCount > 9 ? '9+' : notificationCount}
                  </Badge>
                )}
              </Button>
              
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

          {mobileMenuOpen && (
            <div className="lg:hidden bg-slate-800 border-t border-slate-700/50">
              <nav className="p-4 space-y-2">
                {navigationItems.map((item) => (
                  <Link
                    key={item.title}
                    to={item.url}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                      location.pathname === item.url
                        ? "bg-sky-500 text-white"
                        : "text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    <item.icon className="w-5 h-5" />
                    <span className="font-medium">{item.title}</span>
                  </Link>
                ))}
              </nav>
            </div>
          )}
        </header>

        <div className="flex">
          <aside className="hidden lg:flex flex-col w-64 bg-slate-900/60 backdrop-blur-lg border-r border-slate-700/50 min-h-screen">
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

          <main className="flex-1 min-h-screen">
            {children}
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
  );
}