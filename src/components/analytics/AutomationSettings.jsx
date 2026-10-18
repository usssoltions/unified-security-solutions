import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Activity, Clock, Battery, Shield, Bell, BarChart3, FileText, LineChart,
  CalendarDays, AlertTriangle, Users, Loader2, AlertCircle, Info, Wrench
} from "lucide-react";

// The FULL inventory of tenant-configurable automation, made discoverable
// here: every monitoring automation and every automated report this app can
// actually run, with its true current state for the caller's OWN
// organisation (loaded through the automationAccess gateway, server-resolved
// tenant). A switch that is OFF means that automation is not running for
// this organisation — nothing is presented as active unless it is
// configured and running.
const AUTOMATIONS = [
  {
    key: "monitor_overdue_patrols",
    label: "Overdue Patrol Monitor",
    description: "Alerts when active patrol routes exceed their estimated duration",
    icon: Activity, color: "text-amber-400",
  },
  {
    key: "monitor_missed_clockins",
    label: "Missed Clock-In Monitor",
    description: "Alerts when guards fail to clock in within 15 minutes of shift start",
    icon: Clock, color: "text-rose-400",
  },
  {
    key: "monitor_low_battery",
    label: "Low Battery Monitor",
    description: "Alerts when a guard's device battery drops below 15%",
    icon: Battery, color: "text-orange-400",
  },
  {
    key: "generate_scheduled_patrols",
    label: "Auto-Generate Patrols",
    description: "Generates scheduled patrol records for patrol-enabled sites and monitors patrol status",
    icon: Shield, color: "text-sky-400",
  },
  {
    key: "send_shift_reminders",
    label: "Shift Reminders",
    description: "Sends a one-time reminder 2 hours before a scheduled shift",
    icon: Bell, color: "text-purple-400",
  },
];

const REPORTS = [
  {
    key: "report_daily_activity",
    label: "Daily Activity Report",
    description: "Every morning at 08:00 (SAST) — yesterday's incidents, shifts, maintenance and patrols",
    icon: BarChart3, color: "text-sky-400",
  },
  {
    key: "report_shift_reports",
    label: "Shift Reports",
    description: "Start/end-of-shift summaries, emailed as shifts end",
    icon: FileText, color: "text-emerald-400",
  },
  {
    key: "report_weekly_analysis",
    label: "Weekly Analysis",
    description: "Every Monday at 09:00 — the week's incidents, maintenance, patrols and shifts",
    icon: LineChart, color: "text-purple-400",
  },
  {
    key: "report_monthly_comparison",
    label: "Monthly Comparison",
    description: "On the 1st of each month — this month vs last month, with a branded PDF",
    icon: CalendarDays, color: "text-indigo-400",
  },
  {
    key: "report_incident_alerts",
    label: "Critical Incident Alerts",
    description: "Real-time emails when a critical-priority incident is reported",
    icon: AlertTriangle, color: "text-rose-400",
  },
  {
    key: "report_maintenance_alerts",
    label: "Maintenance Alerts",
    description: "Real-time alerts when a new maintenance request is reported",
    icon: Wrench, color: "text-orange-400",
  },
  {
    key: "report_guard_performance",
    label: "Guard Performance Report",
    description: "Board-level guard performance report — sent on demand or via a schedule (default OFF)",
    icon: Users, color: "text-cyan-400",
  },
];

function ToggleRow({ item, settings, savingKey, onToggle }) {
  const Icon = item.icon;
  const isEnabled = settings?.[item.key] === true;
  const isSaving = savingKey === item.key;
  return (
    <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-slate-700">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <Icon className={`w-5 h-5 ${item.color} flex-shrink-0 mt-0.5`} />
        <div className="min-w-0">
          <p className="text-white font-medium text-sm">{item.label}</p>
          <p className="text-xs text-slate-400 mt-0.5">{item.description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {isSaving && <Loader2 className="w-3 h-3 text-slate-400 animate-spin" />}
        <Badge className={`text-xs ${isEnabled ? "bg-emerald-500" : "bg-slate-600"}`}>
          {isEnabled ? "ON" : "OFF"}
        </Badge>
        <Switch
          checked={isEnabled}
          onCheckedChange={(checked) => onToggle(item.key, checked)}
          disabled={isSaving || !settings}
        />
      </div>
    </div>
  );
}

export default function AutomationSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke("automationAccess", { action: "get" });
      const payload = res?.data ?? res;
      setSettings(payload?.settings || null);
    } catch (err) {
      console.error("Failed to load automation settings:", err);
      setError(err?.message || "Could not load automation settings. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (key, value) => {
    if (!settings) return;
    setSavingKey(key);
    setError(null);
    const prev = settings;
    setSettings({ ...settings, [key]: value });
    try {
      const res = await base44.functions.invoke("automationAccess", { action: "toggle", key, value });
      const payload = res?.data ?? res;
      if (payload?.settings) setSettings(payload.settings);
    } catch (err) {
      console.error("Failed to update setting:", err);
      setSettings(prev);
      setError(err?.message || "Could not save the change. Please try again.");
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-sky-400" />
            Automation &amp; Automated Reports
          </CardTitle>
          <p className="text-sm text-slate-400">
            Everything this app can run automatically for your organisation, in one place. Monitoring automations
            run in a combined check every 10 minutes; scheduled reports run at their configured times. All
            monitors are disabled by default — switch one on to start it. These settings apply to your
            organisation only.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-rose-300">{error}</p>
            </div>
          )}
          {loading ? (
            <div className="py-8 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
            </div>
          ) : (
            <>
              <div>
                <h3 className="text-white font-semibold mb-3">Monitoring Automations</h3>
                <div className="space-y-3">
                  {AUTOMATIONS.map((a) => (
                    <ToggleRow key={a.key} item={a} settings={settings} savingKey={savingKey} onToggle={handleToggle} />
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-white font-semibold mb-3">Automated Reports</h3>
                <div className="space-y-3">
                  {REPORTS.map((r) => (
                    <ToggleRow key={r.key} item={r} settings={settings} savingKey={savingKey} onToggle={handleToggle} />
                  ))}
                </div>
              </div>
              <div className="flex items-start gap-2 p-3 bg-sky-500/10 border border-sky-500/20 rounded-lg">
                <Info className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-slate-300">
                  Recurring reports of the four scheduled types (Incident &amp; Maintenance Summary, Guard
                  Performance, Site Activity, Comprehensive Monthly) are created and managed in the Scheduler tab
                  and on the Report Scheduling page — active schedules there are dispatched automatically at their
                  configured day and time. Recurring reports of the six types above are controlled by the switches
                  here. Additional report recipients can be configured in System Configuration → Automated Report
                  Settings.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}