import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, Save, Loader2 } from "lucide-react";

export default function NotificationPreferences() {
  const [user, setUser] = useState(null);
  const [preferences, setPreferences] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    const currentUser = await base44.auth.me();
    setUser(currentUser);
  };

  const { data: existingPref, isLoading } = useQuery({
    queryKey: ["notificationPreference", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const prefs = await base44.entities.NotificationPreference.filter({
        user_id: user.id
      });
      return prefs[0] || null;
    },
    enabled: !!user
  });

  useEffect(() => {
    if (existingPref) {
      setPreferences(existingPref);
    } else if (user) {
      setPreferences({
        user_id: user.id,
        incident_assigned: { enabled: true, push: true, email: false, sms: false },
        maintenance_assigned: { enabled: true, push: true, email: false, sms: false },
        incident_critical: { enabled: true, push: true, email: true, sms: false },
        status_change: { enabled: true, push: false, email: false, sms: false },
        alarm_dispatch: { enabled: true, push: true, email: false, sms: true },
        shift_reminder: { enabled: true, push: true, email: false, sms: false },
        training_assigned: { enabled: true, push: true, email: true, sms: false },
        quiet_hours: { enabled: false, start: "22:00", end: "07:00" }
      });
    }
  }, [existingPref, user]);

  const saveMutation = useMutation({
    mutationFn: async (prefs) => {
      if (existingPref) {
        await base44.entities.NotificationPreference.update(existingPref.id, prefs);
      } else {
        await base44.entities.NotificationPreference.create(prefs);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["notificationPreference"]);
      alert("Notification preferences saved successfully!");
    }
  });

  const handleSave = () => {
    saveMutation.mutate(preferences);
  };

  const updatePreference = (type, field, value) => {
    setPreferences(prev => ({
      ...prev,
      [type]: {
        ...prev[type],
        [field]: value
      }
    }));
  };

  const notificationTypes = [
    { key: "incident_assigned", label: "Incident Assigned to Me", description: "When a new incident is assigned to you" },
    { key: "maintenance_assigned", label: "Maintenance Assigned to Me", description: "When a maintenance task is assigned to you" },
    { key: "incident_critical", label: "Critical Incidents", description: "When a critical incident is reported" },
    { key: "status_change", label: "Status Changes", description: "When status changes on your tasks" },
    { key: "alarm_dispatch", label: "Alarm Dispatch", description: "When you're dispatched to an alarm" },
    { key: "shift_reminder", label: "Shift Reminders", description: "Reminders before your shift starts" },
    { key: "training_assigned", label: "Training Assignments", description: "When new training is assigned to you" }
  ];

  if (isLoading || !preferences) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Bell className="w-8 h-8 text-sky-400" />
              Notification Preferences
            </h1>
            <p className="text-slate-400 mt-1">Manage how you receive notifications</p>
          </div>
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Preferences
              </>
            )}
          </Button>
        </div>

        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="border-b border-slate-700">
            <CardTitle className="text-white">Notification Types</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            {notificationTypes.map((type) => (
              <div key={type.key} className="border border-slate-700 rounded-lg p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-white">{type.label}</h3>
                    <p className="text-sm text-slate-400">{type.description}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preferences[type.key]?.enabled}
                      onChange={(e) => updatePreference(type.key, "enabled", e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>

                {preferences[type.key]?.enabled && (
                  <div className="flex gap-4 mt-3 pl-4 border-l-2 border-slate-700">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={preferences[type.key]?.push}
                        onChange={(e) => updatePreference(type.key, "push", e.target.checked)}
                        className="w-4 h-4 text-sky-600 bg-slate-700 border-slate-600 rounded focus:ring-sky-500"
                      />
                      <span className="text-sm text-slate-300">Push</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={preferences[type.key]?.email}
                        onChange={(e) => updatePreference(type.key, "email", e.target.checked)}
                        className="w-4 h-4 text-sky-600 bg-slate-700 border-slate-600 rounded focus:ring-sky-500"
                      />
                      <span className="text-sm text-slate-300">Email</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={preferences[type.key]?.sms}
                        onChange={(e) => updatePreference(type.key, "sms", e.target.checked)}
                        className="w-4 h-4 text-sky-600 bg-slate-700 border-slate-600 rounded focus:ring-sky-500"
                      />
                      <span className="text-sm text-slate-300">SMS</span>
                      <Badge className="bg-amber-500 text-xs">Coming Soon</Badge>
                    </label>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-slate-800 border-slate-700">
          <CardHeader className="border-b border-slate-700">
            <CardTitle className="text-white">Quiet Hours</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-white">Enable Quiet Hours</h3>
                <p className="text-sm text-slate-400">Mute non-critical notifications during specific hours</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={preferences.quiet_hours?.enabled}
                  onChange={(e) => updatePreference("quiet_hours", "enabled", e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>

            {preferences.quiet_hours?.enabled && (
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-sm text-slate-400 block mb-2">Start Time</label>
                  <input
                    type="time"
                    value={preferences.quiet_hours?.start}
                    onChange={(e) => updatePreference("quiet_hours", "start", e.target.value)}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-md text-white"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-sm text-slate-400 block mb-2">End Time</label>
                  <input
                    type="time"
                    value={preferences.quiet_hours?.end}
                    onChange={(e) => updatePreference("quiet_hours", "end", e.target.value)}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-md text-white"
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}