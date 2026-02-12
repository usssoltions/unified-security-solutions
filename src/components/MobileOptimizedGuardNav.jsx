import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { 
  Shield, 
  AlertTriangle, 
  Wrench, 
  QrCode,
  Menu,
  X,
  MessageCircle,
  GraduationCap,
  FileText,
  MapPin,
  Radio,
  Calendar,
  BarChart3,
  Users,
  Package,
  Sliders,
  Sparkles,
  Zap,
  Clock
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function UnifiedMobileNav({ 
  user, 
  unreadMessages = 0, 
  pendingTrainings = 0,
  onChatOpen,
  onTrainingOpen,
  onReportsOpen
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  const getNavItems = () => {
    const role = user?.role_type;

    if (role === "guard") {
      return [
        { title: "My Shift", url: createPageUrl("GuardShift"), icon: Shield, color: "text-emerald-400" },
        { title: "Incidents", url: createPageUrl("GuardIncidents"), icon: AlertTriangle, color: "text-rose-400" },
        { title: "Maintenance", url: createPageUrl("GuardMaintenance"), icon: Wrench, color: "text-amber-400" },
        { title: "Scan QR", url: createPageUrl("QRScanner"), icon: QrCode, color: "text-sky-400" }
      ];
    }

    if (role === "dispatcher" || role === "admin") {
      return [
        { title: "Control", url: createPageUrl("ControlRoom"), icon: Radio, color: "text-sky-400" },
        { title: "PTT", url: createPageUrl("PTT"), icon: MessageCircle, color: "text-purple-400" },
        { title: "Shifts", url: createPageUrl("Scheduling"), icon: Calendar, color: "text-emerald-400" },
        { title: "Sites", url: createPageUrl("SiteManagement"), icon: MapPin, color: "text-amber-400" }
      ];
    }

    return [];
  };

  const navItems = getNavItems();

  const getQuickActions = () => {
    const role = user?.role_type;

    if (role === "guard") {
      return [
        {
          title: "Chat",
          icon: MessageCircle,
          color: "bg-sky-600",
          badge: unreadMessages,
          onClick: () => {
            onChatOpen?.();
            setMenuOpen(false);
          }
        },
        {
          title: "Training",
          icon: GraduationCap,
          color: "bg-purple-600",
          badge: pendingTrainings,
          onClick: () => {
            onTrainingOpen?.();
            setMenuOpen(false);
          }
        },
        {
          title: "Reports",
          icon: FileText,
          color: "bg-emerald-600",
          onClick: () => {
            onReportsOpen?.();
            setMenuOpen(false);
          }
        }
      ];
    }

    if (role === "dispatcher" || role === "admin") {
      return [
        { title: "Analytics", icon: BarChart3, color: "bg-sky-600", url: createPageUrl("Analytics") },
        { title: "AI Reports", icon: Sparkles, color: "bg-purple-600", url: createPageUrl("AIReports") },
        { title: "Guard Activity", icon: Users, color: "bg-emerald-600", url: createPageUrl("GuardActivity") }
      ];
    }

    return [];
  };

  const quickActions = getQuickActions();

  return (
    <>
      {/* Bottom Navigation Bar - Mobile Only */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-700 z-40" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}>
        <div className="flex justify-around items-center h-16">
          {navItems.map((item) => {
            const isActive = location.pathname === item.url;
            const Icon = item.icon;
            return (
              <Link
                key={item.title}
                to={item.url}
                className={`flex flex-col items-center justify-center flex-1 h-full ${
                  isActive ? item.color : 'text-slate-400'
                }`}
              >
                <Icon className="w-6 h-6 mb-1" />
                <span className="text-xs">{item.title.split(' ')[0]}</span>
              </Link>
            );
          })}
          <button
            onClick={() => setMenuOpen(true)}
            className="flex flex-col items-center justify-center flex-1 h-full text-slate-400"
          >
            <Menu className="w-6 h-6 mb-1" />
            <span className="text-xs">More</span>
            {(unreadMessages > 0 || pendingTrainings > 0) && (
              <div className="absolute top-2 right-4 w-2 h-2 bg-rose-500 rounded-full" />
            )}
          </button>
        </div>
      </div>

      {/* Full-Screen Menu */}
      {menuOpen && (
        <div className="md:hidden fixed inset-0 bg-slate-900 z-50 overflow-y-auto">
          <div className="flex items-center justify-between p-4 border-b border-slate-700">
            <div>
              <h2 className="text-white font-bold text-lg">Menu</h2>
              <p className="text-slate-400 text-sm">{user?.full_name}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMenuOpen(false)}
              className="text-slate-400"
            >
              <X className="w-6 h-6" />
            </Button>
          </div>

          <div className="p-4 space-y-3">
            <div className="mb-4">
              <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Quick Actions</p>
              <div className="grid grid-cols-3 gap-3">
                {quickActions.map((action) => {
                  const Icon = action.icon;
                  const Element = action.url ? Link : 'button';
                  const props = action.url 
                    ? { to: action.url, onClick: () => setMenuOpen(false) }
                    : { onClick: action.onClick };
                  
                  return (
                    <Element
                      key={action.title}
                      {...props}
                      className={`${action.color} hover:opacity-90 rounded-lg p-4 flex flex-col items-center justify-center relative`}
                    >
                      <Icon className="w-6 h-6 text-white mb-2" />
                      <span className="text-white text-xs">{action.title}</span>
                      {action.badge > 0 && (
                        <Badge className="absolute -top-1 -right-1 bg-rose-500 h-5 w-5 p-0 flex items-center justify-center text-xs">
                          {action.badge}
                        </Badge>
                      )}
                    </Element>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Navigation</p>
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.url;
                return (
                  <Link
                    key={item.title}
                    to={item.url}
                    onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-3 p-4 rounded-lg mb-2 ${
                      isActive 
                        ? 'bg-slate-800 border border-slate-700' 
                        : 'hover:bg-slate-800/50'
                    }`}
                  >
                    <Icon className={`w-5 h-5 ${isActive ? item.color : 'text-slate-400'}`} />
                    <span className={`font-medium ${isActive ? 'text-white' : 'text-slate-300'}`}>
                      {item.title}
                    </span>
                  </Link>
                );
              })}
            </div>

            {(user?.role_type === "dispatcher" || user?.role_type === "admin") && (
              <div className="mt-6">
                <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">More</p>
                <Link
                  to={createPageUrl("Reports")}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 p-4 rounded-lg mb-2 hover:bg-slate-800/50"
                >
                  <FileText className="w-5 h-5 text-slate-400" />
                  <span className="font-medium text-slate-300">Reports</span>
                </Link>
                <Link
                  to={createPageUrl("UserManagement")}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 p-4 rounded-lg mb-2 hover:bg-slate-800/50"
                >
                  <Users className="w-5 h-5 text-slate-400" />
                  <span className="font-medium text-slate-300">Users</span>
                </Link>
                <Link
                  to={createPageUrl("AssetManagement")}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 p-4 rounded-lg mb-2 hover:bg-slate-800/50"
                >
                  <Package className="w-5 h-5 text-slate-400" />
                  <span className="font-medium text-slate-300">Assets</span>
                </Link>
                <Link
                  to={createPageUrl("Configuration")}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 p-4 rounded-lg mb-2 hover:bg-slate-800/50"
                >
                  <Sliders className="w-5 h-5 text-slate-400" />
                  <span className="font-medium text-slate-300">Settings</span>
                </Link>
              </div>
            )}

            {user?.is_clocked_in && (
              <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <div className="flex items-center gap-2 text-emerald-400">
                  <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                  <span className="text-sm font-medium">On Duty</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}