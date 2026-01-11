import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, MapPin, Navigation, Clock, CheckCircle2 } from "lucide-react";

export default function PatrolRouteGuidance({ user, shift, location, onDismiss }) {
  const [checkpoints, setCheckpoints] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCheckpoints();
  }, [shift]);

  const loadCheckpoints = async () => {
    if (!shift?.site_id) {
      setLoading(false);
      return;
    }

    try {
      const sites = await base44.entities.Site.filter({ id: shift.site_id });
      if (sites && Array.isArray(sites) && sites.length > 0 && sites[0].checkpoints && Array.isArray(sites[0].checkpoints)) {
        setCheckpoints(sites[0].checkpoints);
      } else {
        setCheckpoints([]);
      }
    } catch (error) {
      console.error("Failed to load checkpoints:", error);
      setCheckpoints([]);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-slate-800 border-sky-500/50">
        <CardHeader className="border-b border-slate-700 pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white flex items-center gap-2">
              <Navigation className="w-5 h-5 text-sky-400" />
              Patrol Reminder
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={onDismiss}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="p-4 bg-sky-500/10 border border-sky-500/20 rounded-lg">
            <p className="text-sky-400 text-sm">
              Time for your scheduled patrol. Please check the following areas:
            </p>
          </div>

          {Array.isArray(checkpoints) && checkpoints.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-400 font-medium">Checkpoints to Visit:</p>
              {checkpoints.map((checkpoint, idx) => (
                <div key={checkpoint.id || idx} className="flex items-center gap-3 p-3 bg-slate-900/50 rounded-lg">
                  <div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center text-white font-bold text-sm">
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-white font-medium">{checkpoint.name}</p>
                    {checkpoint.qr_code && (
                      <p className="text-xs text-slate-500">QR: {checkpoint.qr_code}</p>
                    )}
                  </div>
                  <MapPin className="w-4 h-4 text-slate-400" />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <MapPin className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No checkpoints configured for this site</p>
              <p className="text-sm text-slate-500 mt-1">Complete your standard patrol route</p>
            </div>
          )}

          <Button
            onClick={onDismiss}
            className="w-full bg-sky-600 hover:bg-sky-700"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Start Patrol
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}