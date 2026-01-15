import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Mail, Settings, Plus, Trash2, Save } from "lucide-react";

export default function ReportSchedulingSettings() {
  const queryClient = useQueryClient();
  const [customEmails, setCustomEmails] = useState([]);
  const [newEmail, setNewEmail] = useState("");
  const [reportSettings, setReportSettings] = useState({
    daily_activity: true,
    shift_reports: true,
    weekly_analysis: true,
    monthly_comparison: true,
    incident_alerts: true
  });

  // Load existing settings
  const { data: existingSchedules = [] } = useQuery({
    queryKey: ["reportSchedules"],
    queryFn: async () => {
      return await base44.entities.ReportSchedule.filter({ status: "active" });
    }
  });

  const { data: user } = useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => await base44.auth.me()
  });

  // Load saved email preferences
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await base44.entities.User.filter({ id: user?.id });
        if (prefs[0]?.report_email_preferences) {
          setCustomEmails(prefs[0].report_email_preferences.custom_emails || []);
          setReportSettings(prefs[0].report_email_preferences.enabled_reports || reportSettings);
        }
      } catch (error) {
        console.error("Failed to load preferences:", error);
      }
    };
    
    if (user) loadPreferences();
  }, [user]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await base44.auth.updateMe({
        report_email_preferences: {
          custom_emails: customEmails,
          enabled_reports: reportSettings,
          updated_at: new Date().toISOString()
        }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["currentUser"]);
      alert("Report settings saved successfully!");
    }
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

  const removeEmail = (email) => {
    setCustomEmails(customEmails.filter(e => e !== email));
  };

  const toggleReport = (reportType) => {
    setReportSettings({
      ...reportSettings,
      [reportType]: !reportSettings[reportType]
    });
  };

  const reportTypes = [
    { key: "daily_activity", label: "Daily Activity Report", description: "Sent every morning at 8:00 AM" },
    { key: "shift_reports", label: "Shift Reports", description: "Start/End of shift summaries" },
    { key: "weekly_analysis", label: "Weekly Analysis", description: "Sent every Monday at 9:00 AM" },
    { key: "monthly_comparison", label: "Monthly Comparison", description: "Sent on 1st of each month" },
    { key: "incident_alerts", label: "Incident Alerts", description: "Real-time critical incident notifications" }
  ];

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Settings className="w-5 h-5 text-sky-400" />
            Automated Report Settings
          </CardTitle>
          <p className="text-sm text-slate-400 mt-2">
            Control which reports are automatically generated and sent. Changes apply immediately.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Report Type Toggles */}
          <div>
            <h3 className="text-white font-semibold mb-4">Enable/Disable Reports</h3>
            <div className="space-y-3">
              {reportTypes.map((report) => (
                <div
                  key={report.key}
                  className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-slate-700"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-white font-medium">{report.label}</p>
                      {reportSettings[report.key] && (
                        <Badge className="bg-emerald-500">Active</Badge>
                      )}
                    </div>
                    <p className="text-sm text-slate-400">{report.description}</p>
                  </div>
                  <Switch
                    checked={reportSettings[report.key]}
                    onCheckedChange={() => toggleReport(report.key)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Custom Email Recipients */}
          <div>
            <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
              <Mail className="w-5 h-5 text-sky-400" />
              Additional Email Recipients
            </h3>
            <p className="text-sm text-slate-400 mb-3">
              Add custom email addresses to receive reports (in addition to admins)
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
                <Plus className="w-4 h-4 mr-2" />
                Add
              </Button>
            </div>

            {customEmails.length > 0 ? (
              <div className="space-y-2">
                {customEmails.map((email) => (
                  <div
                    key={email}
                    className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg border border-slate-700"
                  >
                    <span className="text-white">{email}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeEmail(email)}
                      className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                    >
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
          </div>

          {/* Save Button */}
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="w-full bg-emerald-600 hover:bg-emerald-700 h-12"
          >
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </CardContent>
      </Card>

      {/* Data Storage Info */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white text-lg">📊 Data Storage & Backup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-slate-300 text-sm">
          <p>
            <strong className="text-white">All your data is securely stored</strong> in Base44's cloud infrastructure powered by Supabase (PostgreSQL database).
          </p>
          <ul className="list-disc list-inside space-y-2 text-slate-400">
            <li>✅ <strong>Automatic backups</strong> every day</li>
            <li>✅ <strong>99.9% uptime</strong> guarantee</li>
            <li>✅ <strong>Enterprise-grade security</strong> with encryption</li>
            <li>✅ <strong>Point-in-time recovery</strong> up to 30 days</li>
            <li>✅ <strong>Scalable storage</strong> - never lose data</li>
          </ul>
          <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg p-3 mt-4">
            <p className="text-sky-300">
              <strong>Access Anytime:</strong> Your customers can retrieve all reports, incidents, patrols, and activity logs 24/7 through the web portal and mobile app.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}