import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  Clock,
  MapPin,
  QrCode,
  AlertCircle,
  CheckCircle2,
  Navigation,
  Wrench,
  ChevronRight,
  MessageCircle,
  GraduationCap,
  FileText
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
import AIPatrolGuidance from "../components/guard/AIPatrolGuidance";
import GuardChat from "../components/chat/GuardChat";
import GuardTrainingView from "../components/training/GuardTrainingView";
import AutoReportGenerator from "../components/reports/AutoReportGenerator";
import GeneratedReportsView from "../components/reports/GeneratedReportsView";
import MobileOptimizedGuardNav from "../components/MobileOptimizedGuardNav";
import MobileInstallPrompt from "../components/MobileInstallPrompt";
import PatrolRouteGuidance from "../components/guard/PatrolRouteGuidance";
import ForceSignOutModal from "../components/guard/ForceSignOutModal";
import PanicButton from "../components/guard/PanicButton";
import PatrolAssignmentAlert from "../components/guard/PatrolAssignmentAlert";

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
  const lastStayAwakeCheck = useRef(null);
  const lastPatrolCheck = useRef(null);

  useEffect(() => {
    loadUser();
    startLocationTracking();
    
    // Clear all cache on mount to ensure fresh data
    queryClient.clear();
  }, []);

  const loadUser = async () => {
    setLoadingUser(true);
    try {
      const currentUser = await base44.auth.me();
      
      // Force clock-in check for guards
      if (currentUser.role_type === 'guard') {
        // Check if user has an active shift
        const activeShifts = await base44.entities.Shift.filter({
          guard_id: currentUser.id,
          status: "active"
        });
        
        // If no active shift but is_clocked_in is true, reset it
        if (activeShifts.length === 0 && currentUser.is_clocked_in) {
          await base44.auth.updateMe({ is_clocked_in: false, current_shift_id: null });
          currentUser.is_clocked_in = false;
          currentUser.current_shift_id = null;
        }
      }
      
      setUser(currentUser);
    } catch (error) {
      console.error("Failed to load user:", error);
    } finally {
      setLoadingUser(false);
    }
  };

  const startLocationTracking = () => {
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(
        async (position) => {
          const newLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          setLocation(newLocation);
          
          try {
            const currentUser = await base44.auth.me();
            if (currentUser && currentUser.is_clocked_in) {
              await base44.auth.updateMe({
                last_location: {
                  ...newLocation,
                  timestamp: new Date().toISOString()
                }
              });
            }
          } catch (error) {
            console.error("Failed to update location:", error);
          }
        },
        (error) => console.error("Location error:", error),
        { enableHighAccuracy: true, maximumAge: 10000 }
      );
    }
  };

  const { data: activeShift, isLoading: shiftsLoading } = useQuery({
    queryKey: ["activeShift", user?.id],
    queryFn: async () => {
      if (!user) return null;
      
      const shifts = await base44.entities.Shift.filter({
        guard_id: user.id,
        status: "active"
      });
      return shifts?.[0] || null;
    },
    enabled: !!user,
    refetchInterval: 5000, // Real-time sync every 5 seconds
    retry: 3,
    retryDelay: 1000,
    initialData: null,
    staleTime: 0, // Always fetch fresh data
    cacheTime: 0 // Don't cache
  });

  const { data: upcomingShifts = [] } = useQuery({
    queryKey: ["upcomingShifts", user?.id],
    queryFn: async () => {
      if (!user) return [];
      
      const shifts = await base44.entities.Shift.filter(
        {
          guard_id: user.id,
          status: "scheduled"
        },
        "start_time",
        5
      );
      
      return shifts || [];
    },
    enabled: !!user,
    initialData: [],
    retry: 3,
    refetchInterval: 10000, // Real-time sync
    staleTime: 0,
    cacheTime: 0
  });

  const { data: pendingAssignments = [] } = useQuery({
    queryKey: ["pendingAssignments", user?.id],
    queryFn: async () => {
      if (!user) return [];
      
      const assignments = await base44.entities.Assignment.filter({
        assigned_to: user.id,
        status: "pending"
      });
      
      return assignments || [];
    },
    enabled: !!user,
    initialData: [],
    retry: 3,
    refetchInterval: 5000, // Real-time sync
    staleTime: 0,
    cacheTime: 0
  });

  const { data: arrivedAlarms = [] } = useQuery({
    queryKey: ["arrivedAlarms", user?.id],
    queryFn: async () => {
      if (!user) return [];
      
      const alarms = await base44.entities.AlarmResponse.filter({
        assigned_to: user.id,
        status: "arrived"
      });
      
      return alarms || [];
    },
    enabled: !!user,
    initialData: [],
    retry: 3,
    refetchInterval: 3000, // Real-time sync for alarms
    staleTime: 0,
    cacheTime: 0
  });

  const { data: unreadMessages = 0 } = useQuery({
    queryKey: ["unreadMessages", user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const allMessages = await base44.entities.ChatMessage.list("-created_date", 50);
      const messageArray = Array.isArray(allMessages) ? allMessages : [];
      const myMessages = messageArray.filter(m => 
        (m.recipient_id === user.id || m.is_broadcast) && 
        !(Array.isArray(m.read_by) && m.read_by.includes(user.id))
      );
      return myMessages.length;
    },
    enabled: !!user,
    refetchInterval: 5000,
    initialData: 0,
    staleTime: 0,
    cacheTime: 0
  });

  const { data: pendingTrainings = 0 } = useQuery({
    queryKey: ["pendingTrainings", user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const trainings = await base44.entities.TrainingAssignment.filter({
        assigned_to: user.id,
        status: { $in: ["pending", "in_progress"] }
      });
      return Array.isArray(trainings) ? trainings.length : 0;
    },
    enabled: !!user,
    refetchInterval: 30000,
    initialData: 0,
    staleTime: 0,
    cacheTime: 0
  });

  // Stay Awake Alert System
  useEffect(() => {
    if (!user || !activeShift || !user.stay_awake_enabled) return;

    // Initialize the last check time to now if not set (prevents immediate alert on clock-in)
    if (!lastStayAwakeCheck.current) {
      lastStayAwakeCheck.current = Date.now();
    }

    const checkStayAwake = () => {
      const now = Date.now();
      const interval = (user.stay_awake_interval_minutes || 30) * 60 * 1000;

      if ((now - lastStayAwakeCheck.current) >= interval) {
        lastStayAwakeCheck.current = now;
        setShowStayAwake(true);
      }
    };

    // Check every minute, but only show alert when interval has passed
    const intervalId = setInterval(checkStayAwake, 60000);

    return () => clearInterval(intervalId);
  }, [user, activeShift]);

  // Patrol Route Reminder System
  useEffect(() => {
    if (!user || !activeShift || !user.patrol_reminder_enabled) return;

    // Initialize the last check time to now if not set (prevents immediate alert on clock-in)
    if (!lastPatrolCheck.current) {
      lastPatrolCheck.current = Date.now();
    }

    const checkPatrolReminder = () => {
      const now = Date.now();
      const interval = (user.patrol_reminder_interval_minutes || 60) * 60 * 1000;

      if ((now - lastPatrolCheck.current) >= interval) {
        lastPatrolCheck.current = now;
        setShowPatrolRoute(true);
      }
    };

    // Check every minute, but only show alert when interval has passed
    const intervalId = setInterval(checkPatrolReminder, 60000);

    return () => clearInterval(intervalId);
  }, [user, activeShift]);

  // Check for force sign out after clock out
  // Check if daily report is needed after clock-in
  useEffect(() => {
    if (user?.needs_daily_report && activeShift && user.is_clocked_in) {
      setShowDailyReportModal(true);
    }
  }, [user, activeShift]);

  useEffect(() => {
    if (user && !user.is_clocked_in && user.role_type === 'guard') {
      const checkForceSignOut = async () => {
        try {
          const recentShift = await base44.entities.Shift.filter(
            { guard_id: user.id, status: 'completed' },
            '-clock_out.timestamp',
            1
          );

          if (recentShift && recentShift.length > 0 && recentShift[0].clock_out) {
            const clockOutTime = new Date(recentShift[0].clock_out.timestamp);
            const now = new Date();
            const minutesSinceClockOut = (now.getTime() - clockOutTime.getTime()) / 1000 / 60;

            if (minutesSinceClockOut >= 0 && minutesSinceClockOut < 2) {
              setShowForceSignOut(true);
            }
          }
        } catch (error) {
          console.error("Error checking sign out status:", error);
        }
      };

      checkForceSignOut();
    }
  }, [user]);

  if (loadingUser || shiftsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-400 mx-auto mb-4" />
          <p className="text-slate-400">Loading your shift...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-rose-400 mx-auto mb-4" />
          <p className="text-white text-lg mb-2">Unable to load user data</p>
          <Button onClick={() => window.location.reload()} className="bg-sky-600 hover:bg-sky-700">
            Reload Page
          </Button>
        </div>
      </div>
    );
  }

  if (showForceSignOut) {
    return <ForceSignOutModal user={user} />;
  }

  // ENFORCE CLOCK-IN WORKFLOW FOR GUARDS
  if (!user.is_clocked_in && user.role_type === "guard") {
    return <ClockInOut user={user} location={location} />;
  }

  // MANDATORY DAILY REPORT AFTER CLOCK-IN
  if (showDailyReportModal && user?.needs_daily_report) {
    return (
      <div className="fixed inset-0 bg-slate-900/98 z-50 overflow-hidden">
        <div className="h-full flex flex-col">
          <div className="bg-rose-500/20 border-b border-rose-500/50 p-4 flex-shrink-0">
            <h2 className="text-xl font-bold text-white text-center">⚠️ Daily Report Required</h2>
            <p className="text-slate-300 text-center mt-1">Complete your daily activity report to continue</p>
          </div>
          <iframe 
            src={createPageUrl("DailyReport")} 
            className="flex-1 w-full border-0"
            title="Daily Report"
          />
        </div>
      </div>
    );
  }

  if (showTraining) {
    return (
      <div className="min-h-screen p-4 lg:p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-white">Training Center</h1>
            <Button variant="ghost" onClick={() => setShowTraining(false)}>
              Back to Shift
            </Button>
          </div>
          <GuardTrainingView user={user} />
        </div>
      </div>
    );
  }

  if (showReports) {
    return (
      <div className="min-h-screen p-4 lg:p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-white">My Reports</h1>
            <Button variant="ghost" onClick={() => setShowReports(false)}>
              Back to Shift
            </Button>
          </div>
          <GeneratedReportsView user={user} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6 pb-24 md:pb-6">
      <PatrolAssignmentAlert user={user} />
      <MobileInstallPrompt />
      <AutoReportGenerator user={user} shift={activeShift} />
      <LocationTracker 
        user={user} 
        shift={activeShift} 
        enabled={!!activeShift && user.is_clocked_in} 
      />

      <div className="hidden md:flex fixed bottom-6 right-6 flex-col gap-3 z-40">
        <Button
          onClick={() => setShowReports(true)}
          className="w-16 h-16 rounded-full bg-emerald-600 hover:bg-emerald-700 shadow-2xl"
        >
          <FileText className="w-6 h-6" />
        </Button>
        
        <Button
          onClick={() => setShowTraining(true)}
          className="w-16 h-16 rounded-full bg-purple-600 hover:bg-purple-700 shadow-2xl"
        >
          <GraduationCap className="w-6 h-6" />
          {pendingTrainings > 0 && (
            <Badge className="absolute -top-2 -right-2 bg-rose-500 h-6 w-6 p-0 flex items-center justify-center">
              {pendingTrainings}
            </Badge>
          )}
        </Button>
        
        <Button
          onClick={() => setShowChat(true)}
          className="w-16 h-16 rounded-full bg-sky-600 hover:bg-sky-700 shadow-2xl"
        >
          <MessageCircle className="w-6 h-6" />
          {unreadMessages > 0 && (
            <Badge className="absolute -top-2 -right-2 bg-rose-500 h-6 w-6 p-0 flex items-center justify-center">
              {unreadMessages}
            </Badge>
          )}
        </Button>
      </div>

      <MobileOptimizedGuardNav 
        user={user}
        unreadMessages={unreadMessages}
        pendingTrainings={pendingTrainings}
        onChatOpen={() => setShowChat(true)}
        onTrainingOpen={() => setShowTraining(true)}
        onReportsOpen={() => setShowReports(true)}
      />

      {showChat && <GuardChat user={user} onClose={() => setShowChat(false)} />}

      {showStayAwake && (
        <StayAwakeAlert
          shift={activeShift}
          user={user}
          onConfirm={() => {
            setShowStayAwake(false);
            lastStayAwakeCheck.current = Date.now();
          }}
          location={location}
        />
      )}

      {showPatrolRoute && (
        <PatrolRouteGuidance
          user={user}
          shift={activeShift}
          location={location}
          onDismiss={() => {
            setShowPatrolRoute(false);
            lastPatrolCheck.current = Date.now();
          }}
        />
      )}

      {activeShift && (
        <ShiftEndNotification
          shift={activeShift}
          user={user}
          location={location}
        />
      )}

      {user && <AlarmNotification user={user} />}

      {alarmToComplete && (
        <CompleteAlarmResponse
          alarm={alarmToComplete}
          onClose={() => setAlarmToComplete(null)}
          onSuccess={() => {
            setAlarmToComplete(null);
            queryClient.invalidateQueries(["arrivedAlarms"]);
          }}
        />
      )}

      {Array.isArray(arrivedAlarms) && arrivedAlarms.length > 0 && (
        <Card className="bg-gradient-to-r from-emerald-500/10 to-emerald-600/10 border-emerald-500/20">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              On Scene - Complete Response
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {arrivedAlarms.map((alarm) => (
              <div
                key={alarm.id}
                className="p-4 bg-slate-800/50 rounded-lg border border-slate-700"
              >
                <h4 className="font-semibold text-white mb-1">
                  {alarm.alarm_type.replace(/_/g, ' ').toUpperCase()}
                </h4>
                <p className="text-sm text-slate-400 mb-3">{alarm.address}</p>
                <Button
                  onClick={() => setAlarmToComplete(alarm)}
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                >
                  Complete & Report
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {activeShift && (
        <ActiveShiftCard shift={activeShift} user={user} location={location} />
      )}

      {activeShift && (
        <PanicButton shiftId={activeShift.id} siteId={activeShift.site_id} />
      )}

      {Array.isArray(pendingAssignments) && pendingAssignments.length > 0 && (
        <Card className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 border-amber-500/20">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-400" />
              <CardTitle className="text-white">New Assignments</CardTitle>
              <Badge className="bg-amber-500">{pendingAssignments.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingAssignments.map((assignment) => (
              <div
                key={assignment.id}
                className="p-4 bg-slate-800/50 rounded-lg border border-slate-700"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-semibold text-white">{assignment.title}</h4>
                    <p className="text-sm text-slate-400">{assignment.description}</p>
                  </div>
                  <Badge
                    className={
                      assignment.priority === "critical"
                        ? "bg-rose-500"
                        : assignment.priority === "high"
                        ? "bg-orange-500"
                        : "bg-sky-500"
                    }
                  >
                    {assignment.priority}
                  </Badge>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    onClick={async () => {
                      await base44.entities.Assignment.update(assignment.id, {
                        status: "accepted",
                        accepted_at: new Date().toISOString()
                      });
                      queryClient.invalidateQueries(["pendingAssignments"]);
                    }}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await base44.entities.Assignment.update(assignment.id, {
                        status: "declined"
                      });
                      queryClient.invalidateQueries(["pendingAssignments"]);
                    }}
                    className="flex-1 border-slate-600 text-slate-300"
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <QuickActions location={location} shiftId={activeShift?.id} siteId={activeShift?.site_id} />

      {Array.isArray(upcomingShifts) && upcomingShifts.length > 0 && (
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-sky-400" />
              Upcoming Shifts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {upcomingShifts.map((shift) => (
              <div
                key={shift.id}
                className="p-4 bg-slate-900/50 rounded-lg border border-slate-700 hover:border-sky-500/50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-semibold text-white">{shift.site_name}</h4>
                    <p className="text-sm text-slate-400 mt-1">
                      {new Date(shift.start_time).toLocaleString()} - 
                      {new Date(shift.end_time).toLocaleTimeString()}
                    </p>
                  </div>
                  <Badge variant="outline" className="border-sky-500 text-sky-400">
                    {shift.status}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}