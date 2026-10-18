import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import {
  Activity, Clock, Battery, Shield, Bell, Loader2, AlertCircle
} from "lucide-react";

const AUTOMATIONS = [
  {
    key: "monitor_overdue_patrols",
    label: "Overdue Patrol Monitor",
    description: "Alerts when active patrol routes exceed their estimated duration",
    icon: Activity,
    color: "text-amber-400",
  },
  {
    key: "monitor_missed_clockins",
    label: "Missed Clock-In Monitor",
    description: "Alerts when guards fail to clock in within 15 minutes of shift start",
    icon: Clock,
    color: "text-rose-400",
  },
  {
    key: "monitor_low_battery",
    label: "Low Battery Monitor",
    description: "Alerts when a guard's device battery drops below 15%",
    icon: Battery,
    color: "text-orange-400",
  },
  {
    key: "generate_scheduled_patrols",
    label: "Auto-Generate Patrols",
    description: "Generates scheduled patrol records for patrol-enabled sites",
    icon: Shield,
    color: "text-sky-400",
  },
  {
    key: "send_shift_reminders",
    label: "Shift Reminders",
    description: "Sends a one-time reminder 2 hours before a scheduled shift",
    icon: Bell,
    color: "text-purple-400",
  },
];

export default function AutomationToggles() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      // TENANT-SCOPED GATEWAY — the settings are read for the caller's own
      // organisation (server-resolved). A new organisation starts with all
      // monitors OFF — it never inherits another customer's switches.
      const res = await base44.functions.invoke("automationAccess", { action: "get" });
      setSettings(res?.settings || null);
    } catch (err) {
      console.error("Failed to load automation settings:", err);
      setError(err?.message || "Could not load automation settings. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (key, value) => {
    if (!settings) return;
    setSaving(key);
    setError(null);
    const prevSettings = settings;
    setSettings({ ...settings, [key]: value });
    try {
      const res = await base44.functions.invoke("automationAccess", {
        action: "toggle",
        key,
        value,
      });
      if (res?.settings) setSettings(res.settings);
    } catch (err) {
      console.error("Failed to update setting:", err);
      setSettings(prevSettings);
      setError(err?.message || "Could not save the change. Please try again.");
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <Card className="bg-slate-800/50 border-slate-700">
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-sky-400" />
          Automation Monitoring
        </CardTitle>
        <p className="text-sm text-slate-400">
          Enable or disable background monitoring for your organisation. All monitors run inside a single combined
          check every 10 minutes — only enabled monitors execute, minimising credit usage. All are disabled by
          default: a monitor only runs once you switch it on here. These switches apply to your organisation only
          and never affect other customers.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="flex items-start gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-rose-300">{error}</p>
          </div>
        )}
        {AUTOMATIONS.map((automation) => {
          const Icon = automation.icon;
          const isEnabled = settings?.[automation.key] === true;
          const isSaving = saving === automation.key;
          return (
            <div
              key={automation.key}
              className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-slate-700"
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <Icon className={`w-5 h-5 ${automation.color} flex-shrink-0 mt-0.5`} />
                <div className="min-w-0">
                  <p className="text-white font-medium text-sm">{automation.label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{automation.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {isSaving && <Loader2 className="w-3 h-3 text-slate-400 animate-spin" />}
                <Badge className={`text-xs ${isEnabled ? "bg-emerald-500" : "bg-slate-600"}`}>
                  {isEnabled ? "ON" : "OFF"}
                </Badge>
                <Switch
                  checked={isEnabled}
                  onCheckedChange={(checked) => handleToggle(automation.key, checked)}
                  disabled={isSaving || !settings}
                />
              </div>
            </div>
          );
        })}
        <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300">
            Changes take effect on the next 10-minute combined monitoring cycle. Shift reminders are sent at most once per shift.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}