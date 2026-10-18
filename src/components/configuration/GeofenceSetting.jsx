import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { MapPin, Loader2, Info, AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";

/**
 * Customer-level site geofence enforcement setting (Configuration).
 *
 * Read and changed ONLY through the shiftAccess gateway (server-side tenant
 * resolution; the gateway permits the change only for a Customer
 * Administrator and writes an audit entry). Stored PER CUSTOMER — one
 * customer's setting never affects another's. ON (default) keeps the current
 * geofence checks for guard clock-ins and patrol checkpoint scans; OFF
 * permits guards of this customer to clock in and scan patrol checkpoints
 * outside their site geofences, with the available GPS/timestamp still
 * recorded and affected records marked "Geofence enforcement disabled".
 * QR recognition, checkpoint matching, authentication and permissions are
 * never affected by this setting.
 */
export default function GeofenceSetting({ user }) {
  const [enabled, setEnabled] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await base44.functions.invoke("shiftAccess", { action: "config" });
        const d = res?.data ?? res;
        if (!cancelled) setEnabled(d?.geofence_enforcement_enabled !== false);
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
      const res = await base44.functions.invoke("shiftAccess", { action: "set_geofence_config", enabled: next });
      const d = res?.data ?? res;
      if (!d || d.error) throw new Error(d?.error || "Save failed");
      setEnabled(d.geofence_enforcement_enabled !== false);
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
          <MapPin className="w-5 h-5 text-emerald-400" />
          Guard Geofence Enforcement
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4 p-3 bg-slate-900/50 rounded-lg border border-slate-700">
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold">Enforce site geofence for guard clock-in and patrol scans</p>
            <p className="text-slate-400 text-xs mt-1">
              {enabled === false
                ? "OFF — guards of YOUR organisation may clock in and scan patrol checkpoints outside their site geofences. GPS, timestamp, guard, site and checkpoint details are still recorded and affected records are marked \u201cGeofence enforcement disabled\u201d. QR recognition, checkpoint matching, authentication and permissions are unaffected. Other customers keep their own settings."
                : "ON — guard clock-ins and patrol checkpoint scans are geofence-verified at your sites (current behaviour)."}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {saving && <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />}
            <Switch
              checked={enabled === true}
              onCheckedChange={handleToggle}
              disabled={saving || enabled === null}
            />
          </div>
        </div>

        {enabled === false && (
          <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-amber-300 text-xs font-medium">
              WARNING: Geofence enforcement is currently OFF for your organisation. Guards can clock in and scan patrol
              checkpoints from outside their site geofences (records are labelled \u201cGeofence enforcement disabled\u201d).
              Turn the switch back ON to restore location verification.
            </p>
          </div>
        )}

        <div className="flex items-start gap-2 text-slate-400 text-xs">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <p>Every change is audit-logged (customer, user, previous and new values, timestamp). This setting applies only to your organisation.</p>
        </div>
        {error && <p className="text-rose-400 text-xs">{error}</p>}
      </CardContent>
    </Card>
  );
}