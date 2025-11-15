import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { FileText, Send, Loader2, CheckCircle2, Clock, MapPin, Shield } from "lucide-react";

export default function DailyReport() {
  const [user, setUser] = useState(null);
  const [report, setReport] = useState({
    summary: "",
    incidents_count: 0,
    patrols_completed: 0,
    maintenance_issues: 0,
    notes: ""
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    const currentUser = await base44.auth.me();
    setUser(currentUser);
  };

  const { data: activeShift } = useQuery({
    queryKey: ["activeShift", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const shifts = await base44.entities.Shift.filter({
        guard_id: user.id,
        status: "active"
      });
      return shifts[0] || null;
    },
    enabled: !!user
  });

  const { data: todayIncidents } = useQuery({
    queryKey: ["todayIncidents", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const incidents = await base44.entities.Incident.filter({
        guard_id: user.id
      });
      
      return incidents.filter(inc => 
        new Date(inc.reported_at) >= today
      );
    },
    enabled: !!user,
    initialData: []
  });

  const { data: todayPatrols } = useQuery({
    queryKey: ["todayPatrols", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const patrols = await base44.entities.PatrolLog.filter({
        guard_id: user.id
      });
      
      return patrols.filter(patrol => 
        new Date(patrol.timestamp) >= today
      );
    },
    enabled: !!user,
    initialData: []
  });

  const { data: todayMaintenance } = useQuery({
    queryKey: ["todayMaintenance", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const maintenance = await base44.entities.MaintenanceRequest.filter({
        guard_id: user.id
      });
      
      return maintenance.filter(req => 
        new Date(req.reported_at) >= today
      );
    },
    enabled: !!user,
    initialData: []
  });

  useEffect(() => {
    if (todayIncidents && todayPatrols && todayMaintenance) {
      setReport(prev => ({
        ...prev,
        incidents_count: todayIncidents.length,
        patrols_completed: todayPatrols.length,
        maintenance_issues: todayMaintenance.length
      }));
    }
  }, [todayIncidents, todayPatrols, todayMaintenance]);

  const handleSubmit = async () => {
    if (!activeShift || !user) {
      alert("You must be on an active shift to submit a report");
      return;
    }

    if (!report.summary.trim()) {
      alert("Please provide a summary of your shift");
      return;
    }

    setSubmitting(true);
    try {
      // Create incident for daily report (using incident entity to store reports)
      await base44.entities.Incident.create({
        title: `Daily Shift Report - ${new Date().toLocaleDateString()}`,
        description: `
Summary: ${report.summary}

Statistics:
- Incidents Reported: ${report.incidents_count}
- Patrols Completed: ${report.patrols_completed}
- Maintenance Issues: ${report.maintenance_issues}

Additional Notes:
${report.notes || 'None'}
        `,
        category: "other",
        priority: "low",
        status: "reported",
        guard_id: user.id,
        guard_name: user.full_name,
        site_id: activeShift.site_id,
        site_name: activeShift.site_name,
        shift_id: activeShift.id,
        reported_at: new Date().toISOString()
      });

      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        setReport({
          summary: "",
          incidents_count: todayIncidents.length,
          patrols_completed: todayPatrols.length,
          maintenance_issues: todayMaintenance.length,
          notes: ""
        });
      }, 3000);
    } catch (error) {
      alert("Failed to submit report: " + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400" />
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen p-4 lg:p-6 flex items-center justify-center">
        <Card className="max-w-md bg-gradient-to-br from-emerald-500/10 to-emerald-600/10 border-emerald-500/20">
          <CardContent className="pt-12 pb-12 text-center">
            <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Report Submitted!</h2>
            <p className="text-slate-400">
              Your daily activity report has been recorded
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-purple-600 rounded-full flex items-center justify-center">
          <FileText className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Daily Activity Report</h1>
          <p className="text-slate-400">Document your shift activities</p>
        </div>
      </div>

      {activeShift && (
        <Card className="bg-gradient-to-r from-sky-500/10 to-sky-600/10 border-sky-500/20">
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2 text-slate-300">
                <Shield className="w-4 h-4 text-sky-400" />
                <div>
                  <p className="text-xs text-slate-500">Site</p>
                  <p className="text-sm font-semibold text-white">{activeShift.site_name}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-slate-300">
                <Clock className="w-4 h-4 text-sky-400" />
                <div>
                  <p className="text-xs text-slate-500">Shift Time</p>
                  <p className="text-sm font-semibold text-white">
                    {new Date(activeShift.start_time).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Today's Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg text-center">
              <p className="text-2xl font-bold text-white">{report.incidents_count}</p>
              <p className="text-xs text-slate-400 mt-1">Incidents</p>
            </div>
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-center">
              <p className="text-2xl font-bold text-white">{report.patrols_completed}</p>
              <p className="text-xs text-slate-400 mt-1">Patrols</p>
            </div>
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg text-center">
              <p className="text-2xl font-bold text-white">{report.maintenance_issues}</p>
              <p className="text-xs text-slate-400 mt-1">Maintenance</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Shift Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm text-slate-300 font-medium mb-2 block">
              Overall Summary <span className="text-rose-400">*</span>
            </label>
            <Textarea
              placeholder="Provide a brief summary of your shift activities, observations, and any notable events..."
              value={report.summary}
              onChange={(e) => setReport({ ...report, summary: e.target.value })}
              className="bg-slate-900 border-slate-700 text-white min-h-32"
              required
            />
          </div>

          <div>
            <label className="text-sm text-slate-300 font-medium mb-2 block">
              Additional Notes
            </label>
            <Textarea
              placeholder="Any other information or concerns to report..."
              value={report.notes}
              onChange={(e) => setReport({ ...report, notes: e.target.value })}
              className="bg-slate-900 border-slate-700 text-white min-h-24"
            />
          </div>

          <Button
            onClick={handleSubmit}
            disabled={submitting || !activeShift}
            className="w-full h-12 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-lg font-semibold"
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Submitting Report...
              </>
            ) : (
              <>
                <Send className="w-5 h-5 mr-2" />
                Submit Report
              </>
            )}
          </Button>

          {!activeShift && (
            <p className="text-xs text-rose-400 text-center">
              You must be on an active shift to submit a daily report
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}