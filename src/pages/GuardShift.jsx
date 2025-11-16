
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
  ChevronRight,
  MessageCircle
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

export default function GuardShift() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [location, setLocation] = useState(null);
  const [showStayAwake, setShowStayAwake] = useState(false);
  const [alarmToComplete, setAlarmToComplete] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [forceDailyReport, setForceDailyReport] = useState(false);
  const [showChat, setShowChat] = useState(false);

  useEffect(() => {
    loadUser();
    startLocationTracking();
  }, []);

  const loadUser = async () => {
    setLoadingUser(true);
    try {
      const currentUser = await base44.auth.me();
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
      return shifts[0] || null;
    },
    enabled: !!user,
    refetchInterval: 30000,
    retry: 3,
    retryDelay: 1000
  });

  const { data: upcomingShifts } = useQuery({
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
      
      return shifts;
    },
    enabled: !!user,
    initialData: [],
    retry: 3,
    refetchInterval: 60000
  });

  const { data: pendingAssignments } = useQuery({
    queryKey: ["pendingAssignments", user?.id],
    queryFn: async () => {
      if (!user) return [];
      
      const assignments = await base44.entities.Assignment.filter({
        assigned_to: user.id,
        status: "pending"
      });
      
      return assignments;
    },
    enabled: !!user,
    initialData: [],
    retry: 3,
    refetchInterval: 15000
  });

  const { data: arrivedAlarms } = useQuery({
    queryKey: ["arrivedAlarms", user?.id],
    queryFn: async () => {
      if (!user) return [];
      
      const alarms = await base44.entities.AlarmResponse.filter({
        assigned_to: user.id,
        status: "arrived"
      });
      
      return alarms;
    },
    enabled: !!user,
    initialData: [],
    retry: 3
  });

  const { data: unreadMessages = 0 } = useQuery({
    queryKey: ["unreadMessages", user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const allMessages = await base44.entities.ChatMessage.list("-created_date", 50);
      const myMessages = allMessages.filter(m => 
        (m.recipient_id === user.id || m.is_broadcast) && 
        !m.read_by?.includes(user.id)
      );
      return myMessages.length;
    },
    enabled: !!user,
    refetchInterval: 5000
  });

  useEffect(() => {
    if (user && user.is_clocked_in && user.needs_daily_report) {
      setForceDailyReport(true);
    }
  }, [user]);

  useEffect(() => {
    if (activeShift) {
      const interval = setInterval(() => {
        const shouldAlert = Math.random() > 0.9;
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

  // Force daily report after clock in
  if (forceDailyReport) {
    return (
      <div className="fixed inset-0 bg-slate-900/98 z-[9999] overflow-y-auto">
        <div className="min-h-screen p-4 flex items-center justify-center">
          <Card className="max-w-md bg-slate-800 border-sky-500 shadow-2xl">
            <CardHeader className="border-b border-sky-500/30 text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-purple-500 rounded-full flex items-center justify-center">
                <Shield className="w-8 h-8 text-white" />
              </div>
              <CardTitle className="text-white text-xl">⚠️ Daily Report Required</CardTitle>
              <p className="text-slate-300 text-sm mt-2">
                You must complete your daily activity report before continuing
              </p>
            </CardHeader>
            <CardContent className="pt-6">
              <Button
                onClick={() => navigate(createPageUrl("DailyReport"))}
                className="w-full h-14 text-lg bg-purple-600 hover:bg-purple-700 font-semibold"
              >
                Complete Daily Report Now
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Guard must clock in through proper workflow
  if (!user.is_clocked_in && user.role_type === "guard") {
    return <ClockInOut user={user} location={location} />;
  }

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6">
      <LocationTracker 
        user={user} 
        shift={activeShift} 
        enabled={!!activeShift && user.is_clocked_in} 
      />

      {/* Floating Chat Button */}
      <Button
        onClick={() => setShowChat(true)}
        className="fixed bottom-6 right-6 w-16 h-16 rounded-full bg-sky-600 hover:bg-sky-700 shadow-2xl z-40"
      >
        <MessageCircle className="w-6 h-6" />
        {unreadMessages > 0 && (
          <Badge className="absolute -top-2 -right-2 bg-rose-500 h-6 w-6 p-0 flex items-center justify-center">
            {unreadMessages}
          </Badge>
        )}
      </Button>

      {showChat && <GuardChat user={user} onClose={() => setShowChat(false)} />}

      {showStayAwake && (
        <StayAwakeAlert
          shift={activeShift}
          onConfirm={() => setShowStayAwake(false)}
          location={location}
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

      {activeShift && (
        <ActiveShiftCard shift={activeShift} user={user} location={location} />
      )}

      {activeShift && (
        <AIPatrolGuidance user={user} shift={activeShift} location={location} />
      )}

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
