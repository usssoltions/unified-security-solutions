import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, Clock, MapPin, QrCode, AlertCircle, CheckCircle2,
  Wrench, ChevronRight, MessageCircle, GraduationCap, FileText,
  Zap, Activity, Bell, Navigation, Star, TrendingUp, Cpu
} from "lucide-react";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";
import ClockInOut from "../components/guard/ClockInOut";
import ActiveShiftCard from "../components/guard/ActiveShiftCard";
import StayAwakeAlert from "../components/guard/StayAwakeAlert";
import QuickActions from "../components/guard/QuickActions";
import AlarmNotification from "../components/guard/AlarmNotification";
import CompleteAlarmResponse from "../components/guard/CompleteAlarmResponse";
import LocationTracker from "../components/guard/LocationTracker";
import ShiftEndNotification from "../components/guard/ShiftEndNotification";
import PullToRefresh from "../components/PullToRefresh";
import GuardChat from "../components/chat/GuardChat";
import GuardTrainingView from "../components/training/GuardTrainingView";
import AutoReportGenerator from "../components/reports/AutoReportGenerator";
import GeneratedReportsView from "../components/reports/GeneratedReportsView";
import PatrolRouteGuidance from "../components/guard/PatrolRouteGuidance";
import ForceSignOutModal from "../components/guard/ForceSignOutModal";
import PanicButton from "../components/guard/PanicButton";
import PatrolAssignmentAlert from "../components/guard/PatrolAssignmentAlert";
import SystemSetup from "../components/SystemSetup";

export default function GuardShift() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [location, setLocation] = useState(null);
  const [showStayAwake, setShowStayAwake] = useState(false);
  const [showPatrolRoute, setShowPatrolRoute] = useState(false);
  const [showForceSignOut, setShowForceSignOut] = useState(false);
  const [alarmToComplete, setAlarmToComplete] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [showTraining, setShowTraining] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [showDailyReportModal, setShowDailyReportModal] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const lastStayAwakeCheck = useRef(null);
  const lastPatrolCheck = useRef(null);

  useEffect(() => {
    loadUser();
    startLocationTracking();
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const loadUser = async () => {
    setLoadingUser(true);
    const currentUser = await base44.auth.me();
    setUser(currentUser);
    setLoadingUser(false);
    // Defer the shift-sync check by 5s to avoid startup rate limits
    if (currentUser.role_type === 'guard' && currentUser.is_clocked_in) {
      setTimeout(async () => {
        try {
          const activeShifts = await base44.entities.Shift.filter({ guard_id: currentUser.id, status: "active" });
          if (activeShifts.length === 0) {
            await base44.auth.updateMe({ is_clocked_in: false, current_shift_id: null });
            setUser(prev => ({ ...prev, is_clocked_in: false, current_shift_id: null }));
          }
        } catch (e) {}
      }, 5000);
    }
  };

  const lastLocationUpdate = useRef(0);

  const startLocationTracking = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.watchPosition(
      async (position) => {
        const newLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
        setLocation(newLocation);
        // Throttle API updates to once every 60 seconds max
        const now = Date.now();
        if (now - lastLocationUpdate.current < 60000) return;
        lastLocationUpdate.current = now;
        // Use the already-loaded user state instead of calling me() again
        setUser(prev => {
          if (prev?.is_clocked_in) {
            base44.auth.updateMe({ last_location: { ...newLocation, timestamp: new Date().toISOString() } })
              .catch(() => {});
          }
          return prev;
        });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 }
    );
  };

  const { data: activeShift, isLoading: shiftsLoading } = useQuery({
    queryKey: ["activeShift", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const shifts = await base44.entities.Shift.filter({ guard_id: user.id, status: "active" });
      return shifts?.[0] || null;
    },
    enabled: !!user,
    refetchInterval: 30000,
    retry: 0,
    staleTime: 25000,
    refetchOnWindowFocus: false
  });

  const { data: upcomingShifts = [] } = useQuery({
    queryKey: ["upcomingShifts", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const shifts = await base44.entities.Shift.filter({ guard_id: user.id, status: "scheduled" }, "start_time", 3);
      return shifts || [];
    },
    enabled: !!user && !shiftsLoading,
    refetchInterval: 120000,
    staleTime: 100000,
    refetchOnWindowFocus: false
  });

  const { data: pendingAssignments = [] } = useQuery({
    queryKey: ["pendingAssignments", user?.id],
    queryFn: async () => {
      if (!user) return [];
      return await base44.entities.Assignment.filter({ assigned_to: user.id, status: "pending" }) || [];
    },
    enabled: !!user && !shiftsLoading,
    refetchInterval: 60000,
    staleTime: 50000,
    refetchOnWindowFocus: false
  });

  const { data: arrivedAlarms = [] } = useQuery({
    queryKey: ["arrivedAlarms", user?.id],
    queryFn: async () => {
      if (!user) return [];
      return await base44.entities.AlarmResponse.filter({ assigned_to: user.id, status: "arrived" }) || [];
    },
    enabled: !!user,
    refetchInterval: 15000,
    staleTime: 10000
  });

  const { data: unreadMessages = 0 } = useQuery({
    queryKey: ["unreadMessages", user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const allMessages = await base44.entities.ChatMessage.list("-created_date", 20);
      const msgs = Array.isArray(allMessages) ? allMessages : [];
      return msgs.filter(m => (m.recipient_id === user.id || m.is_broadcast) && !(Array.isArray(m.read_by) && m.read_by.includes(user.id))).length;
    },
    enabled: !!user && !shiftsLoading,
    refetchInterval: 60000,
    staleTime: 50000,
    refetchOnWindowFocus: false
  });

  // Stay Awake system
  useEffect(() => {
    if (!user || !activeShift || !user.stay_awake_enabled) return;
    if (!lastStayAwakeCheck.current) lastStayAwakeCheck.current = Date.now();
    const id = setInterval(() => {
      const interval = (user.stay_awake_interval_minutes || 30) * 60 * 1000;
      if (Date.now() - lastStayAwakeCheck.current >= interval) {
        lastStayAwakeCheck.current = Date.now();
        setShowStayAwake(true);
      }
    }, 30000);
    return () => clearInterval(id);
  }, [user, activeShift]);

  // Patrol reminder system
  useEffect(() => {
    if (!user || !activeShift || !user.patrol_reminder_enabled) return;
    if (!lastPatrolCheck.current) lastPatrolCheck.current = Date.now();
    const id = setInterval(() => {
      const interval = (user.patrol_reminder_interval_minutes || 60) * 60 * 1000;
      if (Date.now() - lastPatrolCheck.current >= interval) {
        lastPatrolCheck.current = Date.now();
        setShowPatrolRoute(true);
      }
    }, 60000);
    return () => clearInterval(id);
  }, [user, activeShift]);

  useEffect(() => {
    if (user?.needs_daily_report && activeShift && user.is_clocked_in) setShowDailyReportModal(true);
  }, [user, activeShift]);

  useEffect(() => {
    if (user && !user.is_clocked_in && user.role_type === 'guard') {
      base44.entities.Shift.filter({ guard_id: user.id, status: 'completed' }, '-clock_out.timestamp', 1).then(recent => {
        if (recent?.[0]?.clock_out) {
          const mins = (Date.now() - new Date(recent[0].clock_out.timestamp).getTime()) / 60000;
          if (mins >= 0 && mins < 2) setShowForceSignOut(true);
        }
      });
    }
  }, [user]);

  if (loadingUser || shiftsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 text-sm">Loading your shift...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950 p-4">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-rose-400 mx-auto mb-4" />
          <p className="text-white text-lg mb-4">Unable to load user data</p>
          <Button onClick={() => window.location.reload()} className="bg-sky-600 hover:bg-sky-700">Reload</Button>
        </div>
      </div>
    );
  }

  if (showForceSignOut) return <ForceSignOutModal user={user} />;
  if (!user.is_clocked_in && user.role_type === "guard") return <ClockInOut user={user} location={location} />;

  if (showDailyReportModal && user?.needs_daily_report) {
    return (
      <div className="fixed inset-0 bg-slate-900/98 z-50 overflow-hidden flex flex-col">
        <div className="bg-rose-500/20 border-b border-rose-500/50 p-4 shrink-0">
          <h2 className="text-xl font-bold text-white text-center">⚠ Daily Report Required</h2>
          <p className="text-slate-300 text-center mt-1 text-sm">Complete your daily activity report to continue</p>
        </div>
        <iframe src={createPageUrl("DailyReport")} className="flex-1 w-full border-0" title="Daily Report" />
      </div>
    );
  }

  if (showTraining) {
    return (
      <div className="min-h-screen bg-slate-950 p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-white">Training Center</h1>
            <Button variant="ghost" onClick={() => setShowTraining(false)} className="text-slate-300">← Back</Button>
          </div>
          <GuardTrainingView user={user} />
        </div>
      </div>
    );
  }

  if (showReports) {
    return (
      <div className="min-h-screen bg-slate-950 p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-white">My Reports</h1>
            <Button variant="ghost" onClick={() => setShowReports(false)} className="text-slate-300">← Back</Button>
          </div>
          <GeneratedReportsView user={user} />
        </div>
      </div>
    );
  }

  const shiftDuration = activeShift ? Math.round((Date.now() - new Date(activeShift.start_time).getTime()) / 3600000 * 10) / 10 : 0;

  return (
    <PullToRefresh onRefresh={async () => { await queryClient.invalidateQueries(); }}>
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pb-28">

        {/* Background utilities */}
        <PatrolAssignmentAlert user={user} />
        <AutoReportGenerator user={user} shift={activeShift} />
        <LocationTracker user={user} shift={activeShift} enabled={!!activeShift && user.is_clocked_in} />

        {/* Header */}
        <div className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-xl border-b border-slate-700/50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-lg ${
                user.is_clocked_in ? "bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-emerald-500/30" : "bg-slate-700"
              }`}>
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-white font-bold text-base leading-tight">
                  {user.full_name?.split(' ')[0] || "Guard"}
                </h1>
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${user.is_clocked_in ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
                  <span className={`text-xs font-medium ${user.is_clocked_in ? "text-emerald-400" : "text-slate-400"}`}>
                    {user.is_clocked_in ? `On Duty • ${shiftDuration}h` : "Off Duty"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {pendingAssignments.length > 0 && (
                <div className="relative">
                  <Bell className="w-5 h-5 text-amber-400" />
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-amber-500 text-white text-xs rounded-full flex items-center justify-center">
                    {pendingAssignments.length}
                  </span>
                </div>
              )}
              <button
                onClick={() => setShowChat(true)}
                className="relative w-9 h-9 bg-slate-800 rounded-xl flex items-center justify-center"
              >
                <MessageCircle className="w-4 h-4 text-slate-300" />
                {unreadMessages > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white text-xs rounded-full flex items-center justify-center">
                    {unreadMessages}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 pt-4 space-y-4 max-w-2xl mx-auto">

          {/* Alerts & Modals */}
          <AnimatePresence>
            {showStayAwake && (
              <StayAwakeAlert shift={activeShift} user={user} onConfirm={() => { setShowStayAwake(false); lastStayAwakeCheck.current = Date.now(); }} location={location} />
            )}
            {showPatrolRoute && (
              <PatrolRouteGuidance user={user} shift={activeShift} location={location} onDismiss={() => { setShowPatrolRoute(false); lastPatrolCheck.current = Date.now(); }} />
            )}
          </AnimatePresence>

          {activeShift && <ShiftEndNotification shift={activeShift} user={user} location={location} />}
          {user && <AlarmNotification user={user} />}

          {alarmToComplete && (
            <CompleteAlarmResponse alarm={alarmToComplete} onClose={() => setAlarmToComplete(null)} onSuccess={() => { setAlarmToComplete(null); queryClient.invalidateQueries(["arrivedAlarms"]); }} />
          )}

          {/* On-Scene Alarms */}
          {arrivedAlarms.length > 0 && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
              <Card className="bg-gradient-to-r from-emerald-500/15 to-emerald-600/10 border-emerald-500/30">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-white flex items-center gap-2 text-base">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    On Scene — Complete Response
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  {arrivedAlarms.map(alarm => (
                    <div key={alarm.id} className="bg-slate-800/60 rounded-xl p-3">
                      <p className="text-white font-semibold text-sm">{alarm.alarm_type?.replace(/_/g, ' ').toUpperCase()}</p>
                      <p className="text-slate-400 text-xs mt-0.5 mb-3">{alarm.address}</p>
                      <Button onClick={() => setAlarmToComplete(alarm)} className="w-full bg-emerald-600 hover:bg-emerald-700 h-10">
                        Complete & Report
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Active Shift Card */}
          {activeShift && <ActiveShiftCard shift={activeShift} user={user} location={location} />}

          {/* Panic Button */}
          {activeShift && <PanicButton shiftId={activeShift.id} siteId={activeShift.site_id} />}

          {/* Pending Assignments */}
          {pendingAssignments.length > 0 && (
            <Card className="bg-gradient-to-r from-amber-500/15 to-orange-500/10 border-amber-500/30">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-amber-400" />
                  <CardTitle className="text-white text-base">New Assignments</CardTitle>
                  <Badge className="bg-amber-500 ml-auto">{pendingAssignments.length}</Badge>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                {pendingAssignments.map(assignment => (
                  <div key={assignment.id} className="bg-slate-800/60 rounded-xl p-3">
                    <div className="flex items-start gap-2 mb-3">
                      <div className="flex-1">
                        <p className="text-white font-semibold text-sm">{assignment.title}</p>
                        <p className="text-slate-400 text-xs mt-0.5">{assignment.description}</p>
                      </div>
                      <Badge className={`shrink-0 text-xs ${assignment.priority === "critical" ? "bg-rose-500" : assignment.priority === "high" ? "bg-orange-500" : "bg-sky-500"}`}>
                        {assignment.priority}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={async () => {
                        await base44.entities.Assignment.update(assignment.id, { status: "accepted", accepted_at: new Date().toISOString() });
                        queryClient.invalidateQueries(["pendingAssignments"]);
                      }} className="flex-1 bg-emerald-600 hover:bg-emerald-700 h-9">Accept</Button>
                      <Button size="sm" variant="outline" onClick={async () => {
                        await base44.entities.Assignment.update(assignment.id, { status: "declined" });
                        queryClient.invalidateQueries(["pendingAssignments"]);
                      }} className="flex-1 border-slate-600 text-slate-300 h-9">Decline</Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Quick Actions */}
          <QuickActions location={location} shiftId={activeShift?.id} siteId={activeShift?.site_id} />

          {/* Feature Grid */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: GraduationCap, label: "Training", color: "from-purple-600 to-purple-700", action: () => setShowTraining(true), badge: null },
              { icon: FileText, label: "Reports", color: "from-sky-600 to-sky-700", action: () => setShowReports(true), badge: null },
              { icon: MapPin, label: "Access Log", color: "from-emerald-600 to-emerald-700", action: () => navigate(createPageUrl("AccessControl")), badge: null },
            ].map(({ icon: Icon, label, color, action, badge }) => (
              <button key={label} onClick={action} className={`bg-gradient-to-br ${color} rounded-2xl p-4 text-center active:scale-95 transition-all shadow-lg relative`}>
                <Icon className="w-6 h-6 text-white mx-auto mb-1.5" />
                <p className="text-white text-xs font-semibold">{label}</p>
                {badge && (
                  <span className="absolute top-2 right-2 w-5 h-5 bg-rose-500 text-white text-xs rounded-full flex items-center justify-center">{badge}</span>
                )}
              </button>
            ))}
          </div>

          {/* No active shift setup */}
          {!activeShift && <SystemSetup />}

          {/* Upcoming Shifts */}
          {upcomingShifts.length > 0 && (
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-white flex items-center gap-2 text-base">
                  <Clock className="w-4 h-4 text-sky-400" />
                  Upcoming Shifts
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {upcomingShifts.map(shift => (
                  <div key={shift.id} className="flex items-center justify-between p-3 bg-slate-900/50 rounded-xl border border-slate-700/50">
                    <div>
                      <p className="text-white text-sm font-semibold">{shift.site_name}</p>
                      <p className="text-slate-400 text-xs mt-0.5">
                        {new Date(shift.start_time).toLocaleDateString()} • {new Date(shift.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <Badge variant="outline" className="border-sky-500 text-sky-400 text-xs">{shift.status}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Chat Modal */}
        {showChat && <GuardChat user={user} onClose={() => setShowChat(false)} />}
      </div>
    </PullToRefresh>
  );
}