import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Zap, Save, Users, Clock, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function StayAwakeConfiguration() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [guardSettings, setGuardSettings] = useState({});
  const [globalSettings, setGlobalSettings] = useState({
    enabled: true,
    interval_minutes: 30,
    response_timeout_seconds: 30
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    const currentUser = await base44.auth.me();
    setUser(currentUser);
  };

  const { data: guards } = useQuery({
    queryKey: ["guards"],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role_type === "guard");
    },
    enabled: !!user,
    initialData: []
  });

  useEffect(() => {
    if (guards.length > 0) {
      const settings = {};
      guards.forEach(guard => {
        settings[guard.id] = {
          enabled: guard.stay_awake_enabled !== false,
          interval_minutes: guard.stay_awake_interval_minutes || 30
        };
      });
      setGuardSettings(settings);
    }
  }, [guards]);

  const handleGuardToggle = (guardId, enabled) => {
    setGuardSettings({
      ...guardSettings,
      [guardId]: {
        ...guardSettings[guardId],
        enabled
      }
    });
  };

  const handleGuardIntervalChange = (guardId, interval) => {
    setGuardSettings({
      ...guardSettings,
      [guardId]: {
        ...guardSettings[guardId],
        interval_minutes: parseInt(interval) || 30
      }
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Update each guard's settings
      for (const guardId in guardSettings) {
        await base44.entities.User.update(guardId, {
          stay_awake_enabled: guardSettings[guardId].enabled,
          stay_awake_interval_minutes: guardSettings[guardId].interval_minutes
        });
      }

      alert("✅ Stay Awake settings saved successfully!");
      queryClient.invalidateQueries(["guards"]);
    } catch (error) {
      alert("Failed to save settings: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  if (!user || (user.role_type !== "admin" && user.role_type !== "dispatcher")) {
    return (
      <div className="min-h-screen p-4 flex items-center justify-center">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="pt-12 pb-12 text-center">
            <AlertCircle className="w-16 h-16 text-rose-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">Access Denied</h3>
            <p className="text-slate-400">Only administrators and dispatchers can access this page</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-amber-600 rounded-full flex items-center justify-center">
          <Zap className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Stay Awake Configuration</h1>
          <p className="text-slate-400">Configure alertness check settings per guard</p>
        </div>
      </div>

      <Alert className="bg-sky-500/10 border-sky-500/20">
        <AlertCircle className="w-4 h-4 text-sky-400" />
        <AlertDescription className="text-slate-300">
          <strong>How it works:</strong> Guards receive periodic alerts during their shifts requiring immediate response. 
          Failure to respond triggers a notification to the control room.
        </AlertDescription>
      </Alert>

      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-sky-400" />
            Guard Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4">
            {guards.map((guard) => (
              <Card key={guard.id} className="bg-slate-900/50 border-slate-700">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 bg-sky-500 rounded-full flex items-center justify-center">
                          <span className="text-white font-semibold">
                            {guard.full_name?.[0]?.toUpperCase() || "G"}
                          </span>
                        </div>
                        <div>
                          <h4 className="font-semibold text-white">{guard.full_name}</h4>
                          <p className="text-sm text-slate-400">{guard.badge_number || guard.email}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-6 mt-4">
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={guardSettings[guard.id]?.enabled || false}
                            onCheckedChange={(checked) => handleGuardToggle(guard.id, checked)}
                          />
                          <span className="text-sm text-slate-300">
                            {guardSettings[guard.id]?.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>

                        {guardSettings[guard.id]?.enabled && (
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-slate-400" />
                            <span className="text-sm text-slate-400">Alert every</span>
                            <Input
                              type="number"
                              min="5"
                              max="120"
                              value={guardSettings[guard.id]?.interval_minutes || 30}
                              onChange={(e) => handleGuardIntervalChange(guard.id, e.target.value)}
                              className="w-20 h-8 bg-slate-800 border-slate-700 text-white text-center"
                            />
                            <span className="text-sm text-slate-400">minutes</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <Badge 
                      className={guardSettings[guard.id]?.enabled 
                        ? "bg-emerald-500" 
                        : "bg-slate-600"
                      }
                    >
                      {guardSettings[guard.id]?.enabled ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}

            {guards.length === 0 && (
              <div className="text-center py-12">
                <Users className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                <p className="text-slate-400">No guards found</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"
        >
          {saving ? (
            <>
              <Clock className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save All Settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}