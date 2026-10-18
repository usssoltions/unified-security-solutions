import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Calendar, Loader2, Info } from "lucide-react";
import { base44 } from "@/api/base44Client";

/**
 * Customer-level Shift Scheduler setting (Configuration → Shift Scheduling).
 *
 * Read and changed ONLY through the shiftAccess gateway (server-side tenant
 * resolution; the gateway permits the change only for a Customer
 * Administrator). Scheduler ON: guards clock in only against their assigned
 * scheduled shifts. Scheduler OFF: the in-app Scheduling / My Schedule
 * navigation entries are hidden and guards start unscheduled shifts from
 * My Shift at an authorised active site with server-side geofence
 * verification. Changing the setting never deletes or alters existing shifts.
 */
export default function ShiftSchedulerSetting({ user }) {
  const [enabled, setEnabled] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await base44.functions.invoke("shiftAccess", { action: "config" });
        const d = res?.data ?? res;
        if (!cancelled) setEnabled(d?.scheduler_enabled !== false);
      } catch (e) {
        if (!cancelled) setError("Could not load the setting — please reload.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleToggle = async (next) => {
    setSaving(true);
    setError("");
    try {
      const res = await base44.functions.invoke("shiftAccess", { action: "set_config", enabled: next });
      const d = res?.data ?? res;
      if (!d || d.error) throw new Error(d?.error || "Save failed");
      setEnabled(d.scheduler_enabled !== false);
    } catch (e) {
      setError(e.message || "Could not save the setting.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader className="pb-2">
        <CardTitle className="text-white flex items-center gap-2 text-lg">
          <Calendar className="w-5 h-5 text-sky-400" />
          Shift Scheduling
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4 p-3 bg-slate-900/50 rounded-lg border border-slate-700">
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold">Shift Scheduler</p>
            <p className="text-slate-400 text-xs mt-1">
              {enabled === false
                ? "OFF — guards start unscheduled shifts from My Shift at an authorised active site (geofence verified on the server). Scheduling and My Schedule are hidden from navigation."
                : "ON — guards clock in only against their assigned scheduled shifts."}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {saving && <Loader2 className="w-4 h-4 animate-spin text-sky-400" />}
            <Switch
              checked={enabled === true}
              onCheckedChange={handleToggle}
              disabled={saving || enabled === null}
            />
          </div>
        </div>
        <div className="flex items-start gap-2 text-slate-400 text-xs">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <p>Changing this setting never deletes or alters existing shifts. My Shift stays available in both modes.</p>
        </div>
        {error && <p className="text-rose-400 text-xs">{error}</p>}
      </CardContent>
    </Card>
  );
}