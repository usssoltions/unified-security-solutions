
import React, { useState, useEffect } from "react";
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
  ChevronRight
} from "lucide-react";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";
import ClockInOut from "../components/guard/ClockInOut";
import ActiveShiftCard from "../components/guard/ActiveShiftCard";
import StayAwakeAlert from "../components/guard/StayAwakeAlert";
import QuickActions from "../components/guard/QuickActions";
import AlarmNotification from "../components/guard/AlarmNotification";
import CompleteAlarmResponse from "../components/guard/CompleteAlarmResponse";
import { useOfflineMode } from "@/hooks/useOfflineMode";
import { useNotifications } from "@/hooks/useNotifications";
import OfflineSyncIndicator from "../components/guard/OfflineSyncIndicator";

export default function GuardShift() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [location, setLocation] = useState(null);
  const [showStayAwake, setShowStayAwake] = useState(false);
  const [alarmToComplete, setAlarmToComplete] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const { isOnline, saveOfflineData, getOfflineItem } = useOfflineMode();
  const { sendShiftNotification, sendAssignmentNotification, permission } = useNotifications();

  useEffect(() => {
    loadUser();
    startLocationTracking();
  }, []);

  const loadUser = async () => {
    setLoadingUser(true);
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      
      // Cache user data for offline access
      saveOfflineData("current_user", currentUser);
    } catch (error) {
      console.error("Failed to load user:", error);
      
      // Try to load from offline cache
      const cachedUser = getOfflineItem("current_user");
      if (cachedUser) {
        setUser(cachedUser);
      }
    } finally {
      setLoadingUser(false);
    }
  };

  const startLocationTracking = () => {
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(
        (position) => {
          setLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
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
      
      if (!isOnline) {
        // Load from offline cache
        return getOfflineItem("active_shift");
      }
      
      const shifts = await base44.entities.Shift.filter({
        guard_id: user.id,
        status: "active"
      });
      const shift = shifts[0] || null;
      
      // Cache for offline access
      if (shift) {
        saveOfflineData("active_shift", shift);
      }
      
      return shift;
    },
    enabled: !!user,
    refetchInterval: isOnline ? 30000 : false,
    retry: isOnline ? 3 : 0,
    retryDelay: 1000
  });

  const { data: upcomingShifts } = useQuery({
    queryKey: ["upcomingShifts", user?.id],
    queryFn: async () => {
      if (!user) return [];
      
      if (!isOnline) {
        return getOfflineItem("upcoming_shifts") || [];
      }
      
      const shifts = await base44.entities.Shift.filter(
        {
          guard_id: user.id,
          status: "scheduled"
        },
        "start_time",
        5
      );
      
      saveOfflineData("upcoming_shifts", shifts);
      
      // Check for upcoming shifts and send reminders
      if (permission === "granted") {
        shifts.forEach(shift => {
          const startTime = new Date(shift.start_time);
          const now = new Date();
          const minutesUntil = (startTime.getTime() - now.getTime()) / 60000;
          
          // Send notification 30 minutes before shift
          if (minutesUntil > 25 && minutesUntil <= 35) {
            // Use local storage to prevent sending the same notification multiple times
            const notifiedKey = `notified_shift_reminder_${shift.id}`;
            if (!localStorage.getItem(notifiedKey)) {
              sendShiftNotification(shift, "reminder");
              localStorage.setItem(notifiedKey, "true");
            }
          }
        });
      }
      
      return shifts;
    },
    enabled: !!user,
    initialData: [],
    retry: isOnline ? 3 : 0,
    refetchInterval: isOnline ? 60000 : false // Check every minute
  });

  const { data: pendingAssignments } = useQuery({
    queryKey: ["pendingAssignments", user?.id],
    queryFn: async () => {
      if (!user) return [];
      
      if (!isOnline) {
        return getOfflineItem("pending_assignments") || [];
      }
      
      const assignments = await base44.entities.Assignment.filter({
        assigned_to: user.id,
        status: "pending"
      });
      
      saveOfflineData("pending_assignments", assignments);
      
      // Send notifications for new critical/high priority assignments
      if (permission === "granted") {
        assignments.forEach(assignment => {
          if (assignment.priority === "critical" || assignment.priority === "high") {
            const notifiedKey = `notified_assignment_${assignment.id}`;
            if (!localStorage.getItem(notifiedKey)) {
              sendAssignmentNotification(assignment);
              localStorage.setItem(notifiedKey, "true");
            }
          }
        });
      }
      
      return assignments;
    },
    enabled: !!user,
    initialData: [],
    retry: isOnline ? 3 : 0,
    refetchInterval: isOnline ? 15000 : false // Check every 15 seconds
  });

  const { data: arrivedAlarms } = useQuery({
    queryKey: ["arrivedAlarms", user?.id],
    queryFn: async () => {
      if (!user) return [];
      
      if (!isOnline) {
        return getOfflineItem("arrived_alarms") || [];
      }
      
      const alarms = await base44.entities.AlarmResponse.filter({
        assigned_to: user.id,
        status: "arrived"
      });
      
      saveOfflineData("arrived_alarms", alarms);
      return alarms;
    },
    enabled: !!user,
    initialData: [],
    retry: isOnline ? 3 : 0
  });

  // Simulate Stay Awake Alert (in production, this would come from backend)
  useEffect(() => {
    if (activeShift) {
      const interval = setInterval(() => {
        const shouldAlert = Math.random() > 0.9; // 10% chance every 30s for demo
        if (shouldAlert) {
          setShowStayAwake(true);
        }
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [activeShift]);

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

  if (!user.is_clocked_in && !activeShift) {
    return <ClockInOut user={user} location={location} />;
  }

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6">
      {/* Offline Mode Indicator for Guard */}
      {!isOnline && (
        <Card className="bg-amber-500/10 border-amber-500/20">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-amber-400 font-semibold mb-1">Offline Mode</h3>
                <p className="text-sm text-slate-300">
                  You can still view your shift details and fill out forms. 
                  Data will sync automatically when you're back online.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Offline Sync Indicator */}
      <OfflineSyncIndicator />

      {/* Stay Awake Alert Modal */}
      {showStayAwake && (
        <StayAwakeAlert
          shift={activeShift}
          onConfirm={() => setShowStayAwake(false)}
          location={location}
        />
      )}

      {/* Alarm Notifications */}
      {user && <AlarmNotification user={user} />}

      {/* Complete Alarm Response */}
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

      {/* Arrived Alarms - Ready to Complete */}
      {arrivedAlarms.length > 0 && (
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

      {/* Active Shift Card */}
      {activeShift && (
        <ActiveShiftCard shift={activeShift} user={user} location={location} />
      )}

      {/* Pending Assignments */}
      {pendingAssignments.length > 0 && (
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
                      // Also clear the notification flag from local storage
                      localStorage.removeItem(`notified_assignment_${assignment.id}`);
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
                      // Also clear the notification flag from local storage
                      localStorage.removeItem(`notified_assignment_${assignment.id}`);
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

      {/* Quick Actions */}
      <QuickActions location={location} shiftId={activeShift?.id} siteId={activeShift?.site_id} />

      {/* Upcoming Shifts */}
      {upcomingShifts.length > 0 && (
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
