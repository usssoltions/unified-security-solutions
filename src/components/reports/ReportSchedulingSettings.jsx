import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Mail, Settings, Plus, Trash2, Save, Loader2, AlertCircle } from "lucide-react";

// Per-tenant automated-report switches, stored on the caller's OWN
// AutomationSetting row and changed ONLY through the automationAccess
// gateway (server-resolved tenant, admin-only writes, audit-logged).
const REPORT_TOGGLES = [
  { key: "report_daily_activity", label: "Daily Activity Report", description: "Sent every morning at 8:00 AM (SAST)" },
  { key: "report_shift_reports", label: "Shift Reports", description: "Start/End of shift summaries" },
  { key: "report_weekly_analysis", label: "Weekly Analysis", description: "Sent every Monday at 9:00 AM" },
  { key: "report_monthly_comparison", label: "Monthly Comparison", description: "Sent on the 1st of each month" },
  { key: "report_incident_alerts", label: "Incident Alerts", description: "Real-time critical incident notifications" },
  { key: "report_maintenance_alerts", label: "Maintenance Alerts", description: "Real-time notifications when a new maintenance request is submitted" },
  { key: "report_guard_performance", label: "Guard Performance Report", description: "Board-level guard performance report (monthly, sent on demand or when scheduled)" },
];

export default function ReportSchedulingSettings() {
  const queryClient = useQueryClient();
  const [customEmails, setCustomEmails] = useState([]);
  const [newEmail, setNewEmail] = useState("");
  const [reportSettings, setReportSettings] = useState(null);
  const [settingsId, setSettingsId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [toggleError, setToggleError] = useState(null);
  const [savingKey, setSavingKey] = useState(null);

  // Load THIS tenant's automation settings through the gateway.
  const loadSettings = async () => {
    setLoadError(null);
    try {
      const res = await base44.functions.invoke("automationAccess", { action: "get" });
      const payload = res?.data ?? res;
      setSettingsId(payload?.settings_id || null);
      setReportSettings(payload?.settings || null);
      return payload?.settings || null;
    } catch (err) {
      console.error("Failed to load report settings:", err);
      setLoadError(err?.message || "Could not load report settings. Please try again.");
      return null;
    }
  };

  const { isLoading } = useQuery({
    queryKey: ["automationSettings", "tenant"],
    queryFn: loadSettings,
  });

  useEffect(() => {
    if (reportSettings) {
      setSettingsId(settingsId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportSettings]);

  // Custom email recipients stay per-user (report_email_preferences on the
  // authenticated user record — never shared across tenants).
  const { data: user } = useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => await base44.auth.me(),
  });

  useEffect(() => {
    if (user?.report_email_preferences) {
      setCustomEmails(user.report_email_preferences.custom_emails || []);
    }
  }, [user]);

  const toggleMutation = useMutation({
    mutationFn: async ({ key, value }) => {
      if (!settingsId) throw new Error("Settings not loaded yet");
      const res = await base44.functions.invoke("automationAccess", {
        action: "toggle",
        key,
        value,
      });
      return res?.data ?? res;
    },
    onSuccess: (res) => {
      if (res?.settings) setReportSettings(res.settings);
      queryClient.invalidateQueries(["automationSettings"]);
    },
    onError: (err) => {
      setToggleError(err?.message || "Could not save the change. Please try again.");
      loadSettings();
    },
  });

  const saveEmailsMutation = useMutation({
    mutationFn: async () => {
      await base44.auth.updateMe({
        report_email_preferences: {
          custom_emails: customEmails,
          updated_at: new Date().toISOString(),
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["currentUser"]);
      alert("Custom recipients saved!");
    },
  });

  const addEmail = () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (newEmail && emailRegex.test(newEmail) && !customEmails.includes(newEmail)) {
      setCustomEmails([...customEmails, newEmail]);
      setNewEmail("");
    } else {
      alert("Please enter a valid email address");
    }
  };

  const removeEmail = (email) => setCustomEmails(customEmails.filter((e) => e !== email));

  const handleToggle = (key, value) => {
    setToggleError(null);
    setSavingKey(key);
    setReportSettings((prev) => ({ ...prev, [key]: value }));
    toggleMutation.mutate({ key, value }, { onSettled: () => setSavingKey(null) });
  };

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Settings className="w-5 h-5 text-sky-400" />
            Automated Report Settings
          </CardTitle>
          <p className="text-sm text-slate-400 mt-2">
            Control which reports are automatically generated and sent for your organisation. Changes apply
            immediately and never affect other customers. Toggles marked OFF mean that report is not being sent.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="text-white font-semibold mb-4">Enable/Disable Reports</h3>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
              </div>
            ) : loadError ? (
              <div className="flex items-start gap-2 p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-rose-300">{loadError}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {REPORT_TOGGLES.map((report) => {
                  const isOn = reportSettings?.[report.key] === true;
                  const isSaving = savingKey === report.key;
                  return (
                    <div
                      key={report.key}
                      className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-slate-700"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-white font-medium">{report.label}</p>
                          {isOn && <Badge className="bg-emerald-500">Active</Badge>}
                        </div>
                        <p className="text-sm text-slate-400">{report.description}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {isSaving && <Loader2 className="w-3 h-3 text-slate-400 animate-spin" />}
                        <Switch
                          checked={isOn}
                          onCheckedChange={(checked) => handleToggle(report.key, checked)}
                          disabled={isSaving || !reportSettings}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
              <Mail className="w-5 h-5 text-sky-400" />
              Additional Email Recipients
            </h3>
            <p className="text-sm text-slate-400 mb-3">
              Add custom email addresses to receive reports (in addition to admins). These are saved to your account.
            </p>
            <div className="flex gap-2 mb-4">
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="email@example.com"
                className="bg-slate-900 border-slate-700 text-white"
                onKeyPress={(e) => e.key === "Enter" && addEmail()}
              />
              <Button onClick={addEmail} className="bg-sky-600 hover:bg-sky-700">
                <Plus className="w-4 h-4 mr-2" /> Add
              </Button>
            </div>
            {customEmails.length > 0 ? (
              <div className="space-y-2">
                {customEmails.map((email) => (
                  <div key={email} className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg border border-slate-700">
                    <span className="text-white">{email}</span>
                    <Button size="sm" variant="ghost" onClick={() => removeEmail(email)} className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 bg-slate-900/30 rounded-lg border border-slate-700/50">
                <p className="text-slate-400 text-sm">No custom recipients added yet</p>
              </div>
            )}
            <Button onClick={() => saveEmailsMutation.mutate()} disabled={saveEmailsMutation.isPending} className="w-full bg-emerald-600 hover:bg-emerald-700 h-12 mt-4">
              <Save className="w-4 h-4 mr-2" />
              {saveEmailsMutation.isPending ? "Saving..." : "Save Recipients"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}