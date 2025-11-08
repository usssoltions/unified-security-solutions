import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Clock, MapPin } from "lucide-react";

export default function ActiveGuardsPanel({ guards }) {
  const calculateDuration = (clockInTime) => {
    const start = new Date(clockInTime);
    const now = new Date();
    const diff = now - start;
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  };

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Shield className="w-5 h-5 text-emerald-400" />
          Active Guards
          <Badge className="bg-emerald-500 ml-auto">{guards.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 max-h-96 overflow-y-auto">
        {guards.map((guard) => (
          <div
            key={guard.id}
            className="p-3 bg-slate-900/50 rounded-lg border border-slate-700"
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <h4 className="font-semibold text-white text-sm">{guard.guard_name}</h4>
                <p className="text-xs text-slate-400 flex items-center gap-1 mt-1">
                  <MapPin className="w-3 h-3" />
                  {guard.site_name}
                </p>
              </div>
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Clock className="w-3 h-3" />
              <span>On duty: {calculateDuration(guard.clock_in.timestamp)}</span>
            </div>
          </div>
        ))}

        {guards.length === 0 && (
          <div className="text-center py-8">
            <Shield className="w-12 h-12 text-slate-600 mx-auto mb-2" />
            <p className="text-slate-400 text-sm">No guards currently active</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}