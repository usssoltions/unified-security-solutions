import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Bell, AlertTriangle, CheckCircle2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export default function NotificationPanel({ alerts, onClose }) {
  const queryClient = useQueryClient();

  const acknowledgeMutation = useMutation({
    mutationFn: async (alertId) => {
      await base44.entities.Alert.update(alertId, {
        status: "acknowledged",
        acknowledged_at: new Date().toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["alerts"]);
    }
  });

  const priorityColors = {
    critical: "bg-rose-500",
    high: "bg-orange-500",
    medium: "bg-amber-500",
    low: "bg-sky-500"
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md bg-slate-800 border-slate-700 max-h-[80vh] overflow-hidden flex flex-col">
        <CardHeader className="border-b border-slate-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-sky-400" />
              <CardTitle className="text-white">Notifications</CardTitle>
              <Badge className="bg-rose-500">{alerts.length}</Badge>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400">
              <X className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-4 overflow-y-auto flex-1">
          {alerts.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
              <p className="text-slate-400">No active notifications</p>
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="p-4 bg-slate-900/50 rounded-lg border border-slate-700"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      <h4 className="font-semibold text-white text-sm">{alert.title}</h4>
                    </div>
                    <Badge className={`${priorityColors[alert.priority]} text-xs`}>
                      {alert.priority}
                    </Badge>
                  </div>
                  
                  <p className="text-sm text-slate-300 mb-3">{alert.message}</p>
                  
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-500">
                      {new Date(alert.created_date).toLocaleString()}
                    </p>
                    <Button
                      size="sm"
                      onClick={() => acknowledgeMutation.mutate(alert.id)}
                      disabled={acknowledgeMutation.isPending}
                      className="bg-sky-600 hover:bg-sky-700"
                    >
                      Acknowledge
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}