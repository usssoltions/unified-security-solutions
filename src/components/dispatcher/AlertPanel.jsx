import React from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, CheckCircle2, AlertTriangle, Zap } from "lucide-react";

export default function AlertPanel({ alerts }) {
  const queryClient = useQueryClient();

  const acknowledgeMutation = useMutation({
    mutationFn: async (alertId) => {
      const user = await base44.auth.me();
      await base44.entities.Alert.update(alertId, {
        status: "acknowledged",
        acknowledged_by: user.id,
        acknowledged_at: new Date().toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["activeAlerts"]);
    }
  });

  const priorityConfig = {
    critical: { color: "bg-rose-500", icon: Zap },
    high: { color: "bg-orange-500", icon: AlertTriangle },
    medium: { color: "bg-amber-500", icon: Bell },
    low: { color: "bg-sky-500", icon: Bell }
  };

  const alertsArray = Array.isArray(alerts) ? alerts : [];

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Bell className="w-5 h-5 text-amber-400" />
          Active Alerts
          {alertsArray.length > 0 && (
            <Badge className="bg-amber-500 ml-auto">{alertsArray.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 max-h-96 overflow-y-auto">
        {alertsArray.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-2" />
            <p className="text-slate-400 text-sm">All clear - no active alerts</p>
          </div>
        ) : (
          alertsArray.map((alert) => {
            const config = priorityConfig[alert.priority];
            const Icon = config.icon;
            
            return (
              <div
                key={alert.id}
                className={`p-3 rounded-lg border ${
                  alert.priority === "critical"
                    ? "bg-rose-500/10 border-rose-500/20 animate-pulse"
                    : "bg-slate-900/50 border-slate-700"
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-start gap-2 flex-1">
                    <Icon className={`w-4 h-4 mt-0.5 ${
                      alert.priority === "critical" ? "text-rose-400" :
                      alert.priority === "high" ? "text-orange-400" :
                      alert.priority === "medium" ? "text-amber-400" :
                      "text-sky-400"
                    }`} />
                    <div className="flex-1">
                      <h4 className="font-semibold text-white text-sm">{alert.title}</h4>
                      <p className="text-xs text-slate-400 mt-1">{alert.message}</p>
                      {alert.guard_name && (
                        <p className="text-xs text-slate-500 mt-1">Guard: {alert.guard_name}</p>
                      )}
                    </div>
                  </div>
                  <Badge className={config.color}>{alert.priority}</Badge>
                </div>
                <Button
                  size="sm"
                  onClick={() => acknowledgeMutation.mutate(alert.id)}
                  className="w-full mt-2 bg-slate-700 hover:bg-slate-600 text-white"
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Acknowledge
                </Button>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}