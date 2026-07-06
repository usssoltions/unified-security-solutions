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
    description: "Sends a one-time email reminder 2 hours before a scheduled shift",
    icon: Bell,
    color: "text-purple-400",
  },
];

export default function AutomationToggles() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const records = await base44.entities.AutomationSetting.list();
      if (records && records.length > 0) {
        setSettings(records[0]);
      } else {
        // Create default record with all disabled
        const created = await base44.entities.AutomationSetting.create({
          monitor_overdue_patrols: false,
          monitor_missed_clockins: false,
          monitor_low_battery: false,
          generate_scheduled_patrols: false,
          send_shift_reminders: false,
        });
        setSettings(created);
      }
    } catch (err) {
      console.error("Failed to load automation settings:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (key, value) => {
    if (!settings) return;
    setSaving(key);
    const prevSettings = settings;
    setSettings({ ...settings, [key]: value });
    try {
      const updated = await base44.entities.AutomationSetting.update(settings.id, { [key]: value });
      setSettings(updated);
    } catch (err) {
      console.error("Failed to update setting:", err);
      setSettings(prevSettings);
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
          Enable or disable background automation monitors. All are disabled by default to conserve resources.
          Toggle on only when needed.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {AUTOMATIONS.map((automation) => {
          const Icon = automation.icon;
          const isEnabled = settings?.[automation.key] || false;
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
                  disabled={isSaving}
                />
              </div>
            </div>
          );
        })}
        <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300">
            Changes take effect on the next scheduled run of each automation. Shift reminders are sent at most once per shift.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}