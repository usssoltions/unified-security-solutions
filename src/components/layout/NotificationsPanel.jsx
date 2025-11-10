import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X, Bell, CheckCircle2, AlertTriangle, Info, Clock } from "lucide-react";

export default function NotificationsPanel({ user, onClose }) {
  const queryClient = useQueryClient();

  const { data: alerts } = useQuery({
    queryKey: ["userAlerts", user?.id],
    queryFn: async () => {
      if (!user) return [];
      
      const allAlerts = await base44.entities.Alert.filter(
        { status: "active" },
        "-created_date",
        20
      );
      
      // Filter alerts for this user
      return allAlerts.filter(alert => 
        !alert.guard_id || alert.guard_id === user.id
      );
    },
    enabled: !!user,
    initialData: [],
    refetchInterval: 10000
  });

  const acknowledgeAlertMutation = useMutation({
    mutationFn: async (alertId) => {
      await base44.entities.Alert.update(alertId, {
        status: "acknowledged",
        acknowledged_by: user.id,
        acknowledged_at: new Date().toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["userAlerts"]);
      queryClient.invalidateQueries(["activeAlerts"]);
    }
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      const promises = alerts.map(alert =>
        base44.entities.Alert.update(alert.id, {
          status: "acknowledged",
          acknowledged_by: user.id,
          acknowledged_at: new Date().toISOString()
        })
      );
      await Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["userAlerts"]);
      queryClient.invalidateQueries(["activeAlerts"]);
    }
  });

  const getAlertIcon = (type) => {
    const icons = {
      panic: AlertTriangle,
      shift_reminder: Clock,
      assignment: Info,
      system: Bell,
      default: Bell
    };
    return icons[type] || icons.default;
  };

  const getAlertColor = (priority) => {
    const colors = {
      critical: "text-rose-400 bg-rose-500/10 border-rose-500/20",
      high: "text-orange-400 bg-orange-500/10 border-orange-500/20",
      medium: "text-amber-400 bg-amber-500/10 border-amber-500/20",
      low: "text-sky-400 bg-sky-500/10 border-sky-500/20"
    };
    return colors[priority] || colors.low;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end md:items-start md:justify-end z-50">
      <Card className="w-full md:w-96 md:m-4 bg-slate-800 border-slate-700 md:max-h-[80vh] flex flex-col rounded-t-2xl md:rounded-2xl">
        <CardHeader className="border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-sky-400" />
              <CardTitle className="text-white">Notifications</CardTitle>
              {alerts.length > 0 && (
                <Badge className="bg-rose-500">{alerts.length}</Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-4 space-y-3 overflow-y-auto flex-1">
          {alerts.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => clearAllMutation.mutate()}
              disabled={clearAllMutation.isPending}
              className="w-full border-slate-600 text-slate-300 hover:bg-slate-700"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              {clearAllMutation.isPending ? "Clearing..." : "Clear All"}
            </Button>
          )}

          {alerts.length === 0 ? (
            <div className="text-center py-12">
              <Bell className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No new notifications</p>
            </div>
          ) : (
            alerts.map((alert) => {
              const Icon = getAlertIcon(alert.type);
              return (
                <div
                  key={alert.id}
                  className={`p-4 rounded-lg border ${getAlertColor(alert.priority)}`}
                >
                  <div className="flex items-start gap-3">
                    <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-white mb-1">{alert.title}</h4>
                      <p className="text-sm text-slate-300 mb-2">{alert.message}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">
                          {new Date(alert.created_date).toLocaleString()}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => acknowledgeAlertMutation.mutate(alert.id)}
                          disabled={acknowledgeAlertMutation.isPending}
                          className="text-xs h-7 px-2"
                        >
                          Dismiss
                        </Button>
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