import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Check, Trash2, Settings, AlertTriangle, Wrench, Shield, Clock, GraduationCap, Radio } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function NotificationCenter({ user, onClose }) {
  const [filter, setFilter] = useState("all");
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: async () => {
      if (!user) return [];
      return await base44.entities.Notification.filter(
        { recipient_id: user.id },
        "-created_date",
        50
      );
    },
    enabled: !!user,
    refetchInterval: 10000
  });

  const markReadMutation = useMutation({
    mutationFn: async (notificationId) => {
      await base44.entities.Notification.update(notificationId, {
        read: true,
        read_at: new Date().toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["notifications"]);
    }
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
      await Promise.all(
        unreadIds.map(id => 
          base44.entities.Notification.update(id, {
            read: true,
            read_at: new Date().toISOString()
          })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["notifications"]);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (notificationId) => {
      await base44.entities.Notification.delete(notificationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["notifications"]);
    }
  });

  const handleNotificationClick = (notification) => {
    if (!notification.read) {
      markReadMutation.mutate(notification.id);
    }

    if (notification.action_url) {
      navigate(notification.action_url);
      onClose();
    }
  };

  const filteredNotifications = notifications.filter(n => {
    if (filter === "unread") return !n.read;
    if (filter === "read") return n.read;
    return true;
  });

  const getNotificationIcon = (type) => {
    const icons = {
      incident_assigned: AlertTriangle,
      incident_critical: AlertTriangle,
      incident_completed: AlertTriangle,
      maintenance_assigned: Wrench,
      maintenance_completed: Wrench,
      alarm_dispatch: Radio,
      shift_reminder: Clock,
      training_assigned: GraduationCap,
      system: Shield
    };
    return icons[type] || Shield;
  };

  const getPriorityColor = (priority) => {
    const colors = {
      critical: "text-rose-400 bg-rose-500/20",
      high: "text-orange-400 bg-orange-500/20",
      medium: "text-amber-400 bg-amber-500/20",
      low: "text-sky-400 bg-sky-500/20"
    };
    return colors[priority] || colors.medium;
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-2 sm:p-4">
      <Card className="w-full max-w-2xl max-h-[95vh] sm:max-h-[90vh] flex flex-col bg-slate-800 border-slate-700">
        <CardHeader className="border-b border-slate-700 flex-shrink-0 p-3 sm:p-4 lg:p-6">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
              <CardTitle className="text-white text-base sm:text-lg lg:text-xl">Notifications</CardTitle>
              {unreadCount > 0 && (
                <Badge className="bg-rose-500 text-xs sm:text-sm flex-shrink-0">{unreadCount} new</Badge>
              )}
            </div>
            <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(createPageUrl("NotificationPreferences"))}
                className="text-slate-400 h-8 w-8 sm:h-9 sm:w-9 p-0"
              >
                <Settings className="w-3 h-3 sm:w-4 sm:h-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 sm:h-9 sm:w-9">
                <X className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
              </Button>
            </div>
          </div>

          <div className="flex gap-1 sm:gap-2 mt-3 sm:mt-4 flex-wrap">
            <Button
              variant={filter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter("all")}
              className={`text-xs sm:text-sm ${filter === "all" ? "bg-sky-600" : "border-slate-600"}`}
            >
              All
            </Button>
            <Button
              variant={filter === "unread" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter("unread")}
              className={`text-xs sm:text-sm ${filter === "unread" ? "bg-sky-600" : "border-slate-600"}`}
            >
              Unread ({unreadCount})
            </Button>
            <Button
              variant={filter === "read" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter("read")}
              className={`text-xs sm:text-sm ${filter === "read" ? "bg-sky-600" : "border-slate-600"}`}
            >
              Read
            </Button>
            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
                className="ml-auto border-slate-600 text-xs sm:text-sm"
              >
                <Check className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                <span className="hidden sm:inline">Mark All Read</span>
                <span className="sm:hidden">All Read</span>
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto p-2 sm:p-3 lg:p-4 space-y-2">
          {filteredNotifications.length === 0 ? (
            <div className="text-center py-12">
              <Shield className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No notifications</p>
            </div>
          ) : (
            filteredNotifications.map((notification) => {
              const Icon = getNotificationIcon(notification.type);
              return (
                <div
                  key={notification.id}
                  className={`p-3 sm:p-4 rounded-lg border transition-all cursor-pointer group ${
                    notification.read
                      ? "bg-slate-900/30 border-slate-700/50"
                      : "bg-sky-500/5 border-sky-500/30 hover:bg-sky-500/10"
                  }`}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <div className="flex items-start gap-2 sm:gap-3">
                    <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center flex-shrink-0 ${getPriorityColor(notification.priority)}`}>
                      <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className="font-semibold text-white text-xs sm:text-sm line-clamp-2">
                          {notification.title}
                        </h4>
                        {!notification.read && (
                          <div className="w-2 h-2 rounded-full bg-sky-500 flex-shrink-0 mt-1" />
                        )}
                      </div>
                      <p className="text-xs sm:text-sm text-slate-400 mb-2 line-clamp-2">
                        {notification.message}
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-500 truncate">
                          {new Date(notification.created_date).toLocaleString()}
                        </span>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 sm:group-hover:opacity-100 active:opacity-100 transition-opacity flex-shrink-0">
                          {!notification.read && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                markReadMutation.mutate(notification.id);
                              }}
                              className="h-6 w-6 sm:h-7 sm:w-7 p-0"
                            >
                              <Check className="w-3 h-3" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteMutation.mutate(notification.id);
                            }}
                            className="h-6 w-6 sm:h-7 sm:w-7 p-0 text-rose-400"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}