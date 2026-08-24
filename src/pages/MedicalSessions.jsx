import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Activity, Plus, Clock, CheckCircle, FileText, Loader2, Play } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import moment from "moment";

export default function MedicalSessions() {
  const [user, setUser] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all");
  const [completingSession, setCompletingSession] = useState(null);
  const [saving, setSaving] = useState(false);
  const [completeForm, setCompleteForm] = useState({
    findings: "", recommendations: "", work_capacity: "",
    restrictions: "", return_to_work_plan: "", follow_up_required: false, follow_up_notes: "",
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const u = await base44.auth.me();
      setUser(u);
      const cid = u.customer_id;
      if (!cid) { setLoading(false); return; }
      const [sess, apts] = await Promise.all([
        base44.entities.Session.filter({ customer_id: cid }).catch(() => []),
        base44.entities.Appointment.filter({ customer_id: cid }).catch(() => []),
      ]);
      setSessions(sess.sort((a, b) =>
        new Date(b.actual_start_time || b.created_date) - new Date(a.actual_start_time || a.created_date)
      ));
      setAppointments(apts);
    } catch (e) {
      console.error("Failed to load sessions:", e);
    } finally {
      setLoading(false);
    }
  };

  const startableAppointments = appointments.filter(a =>
    ["arrived"].includes(a.status) && !a.session_id
  );

  const startSession = async (apt) => {
    try {
      const now = new Date().toISOString();
      const session = await base44.entities.Session.create({
        customer_id: user.customer_id,
        appointment_id: apt.id,
        patient_id: apt.patient_id,
        patient_name: apt.patient_name,
        employer_id: apt.employer_id,
        employer_name: apt.employer_name,
        service_id: apt.service_id,
        service_name: apt.service_name,
        therapist_id: user.id,
        therapist_name: user.full_name || user.display_name,
        actual_start_time: now,
        status: "in_progress",
      });
      await base44.entities.Appointment.update(apt.id, { status: "in_session", session_id: session.id });
      await loadData();
    } catch (e) {
      console.error("Failed to start session:", e);
      alert("Failed to start session: " + e.message);
    }
  };

  const completeSession = async () => {
    if (!completingSession) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const start = new Date(completingSession.actual_start_time);
      const duration = Math.round((new Date(now) - start) / 60000);

      await base44.entities.Session.update(completingSession.id, {
        ...completeForm,
        actual_end_time: now,
        duration_minutes: duration,
        status: "completed",
        completion_user_id: user.id,
        completion_user_name: user.full_name || user.display_name,
        completed_at: now,
      });

      if (completingSession.appointment_id) {
        await base44.entities.Appointment.update(completingSession.appointment_id, {
          status: "session_completed",
        });
      }

      await base44.entities.MedicalReport.create({
        customer_id: user.customer_id,
        session_id: completingSession.id,
        patient_id: completingSession.patient_id,
        patient_name: completingSession.patient_name,
        employer_id: completingSession.employer_id,
        employer_name: completingSession.employer_name,
        service_id: completingSession.service_id,
        service_name: completingSession.service_name,
        therapist_id: completingSession.therapist_id,
        therapist_name: completingSession.therapist_name,
        assessment_date: completingSession.actual_start_time,
        report_type: "internal_clinical",
        findings: completeForm.findings,
        recommendations: completeForm.recommendations,
        work_capacity: completeForm.work_capacity,
        restrictions: completeForm.restrictions,
        return_to_work_recommendations: completeForm.return_to_work_plan,
        follow_up: completeForm.follow_up_notes,
        status: "draft",
        generated_at: now,
        generated_by_id: user.id,
        generated_by_name: user.full_name || user.display_name,
      });

      setCompletingSession(null);
      setCompleteForm({ findings: "", recommendations: "", work_capacity: "", restrictions: "", return_to_work_plan: "", follow_up_required: false, follow_up_notes: "" });
      await loadData();
    } catch (e) {
      console.error("Failed to complete session:", e);
      alert("Failed to complete session: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const filteredSessions = sessions.filter(s => {
    if (filterStatus === "all") return true;
    return s.status === filterStatus;
  });

  const statusColors = {
    in_progress: "bg-emerald-500/20 text-emerald-400",
    completed: "bg-sky-500/20 text-sky-400",
    cancelled: "bg-rose-500/20 text-rose-400",
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Sessions</h1>
            <p className="text-slate-400 text-sm">Clinical session workflow &amp; report generation</p>
          </div>
        </div>

        {/* Startable appointments */}
        {startableAppointments.length > 0 && (
          <Card className="bg-amber-500/10 border-amber-500/20 mb-6">
            <CardContent className="p-4">
              <p className="text-amber-400 text-sm font-medium mb-3 flex items-center gap-2">
                <Play className="w-4 h-4" /> Patients waiting to start session
              </p>
              <div className="space-y-2">
                {startableAppointments.map(apt => (
                  <div key={apt.id} className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg">
                    <div>
                      <p className="text-white text-sm font-medium">{apt.patient_name}</p>
                      <p className="text-slate-400 text-xs">{apt.service_name}</p>
                    </div>
                    <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600" onClick={() => startSession(apt)}>
                      <Play className="w-3 h-3 mr-1" /> Start
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filter tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {["all", "in_progress", "completed"].map(tab => (
            <button key={tab} onClick={() => setFilterStatus(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                filterStatus === tab ? "bg-emerald-500 text-white" : "bg-slate-900 text-slate-400 hover:bg-slate-800"
              }`}>
              {tab.replace(/_/g, " ")}
            </button>
          ))}
        </div>

        {filteredSessions.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="py-12 text-center">
              <Activity className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No sessions yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredSessions.map(s => (
              <Card key={s.id} className="bg-slate-900 border-slate-800">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center shrink-0">
                        <Activity className="w-5 h-5 text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-white font-medium text-sm truncate">{s.patient_name}</p>
                        <p className="text-slate-400 text-xs truncate">{s.service_name}</p>
                        <p className="text-slate-500 text-xs mt-0.5">
                          Started: {s.actual_start_time ? moment(s.actual_start_time).format("MMM D, HH:mm") : "—"}
                          {s.duration_minutes ? ` • ${s.duration_minutes}min` : ""}
                        </p>
                        {s.findings && <p className="text-slate-500 text-xs mt-1 line-clamp-1">{s.findings}</p>}
                      </div>
                    </div>
                    <Badge className={`${statusColors[s.status] || "bg-slate-500/20 text-slate-400"} text-xs shrink-0`}>
                      {(s.status || "").replace(/_/g, " ")}
                    </Badge>
                  </div>
                  {s.status === "in_progress" && (
                    <div className="mt-3 pt-3 border-t border-slate-800">
                      <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 w-full"
                        onClick={() => { setCompletingSession(s); setCompleteForm({
                          findings: s.findings || "", recommendations: s.recommendations || "",
                          work_capacity: s.work_capacity || "", restrictions: s.restrictions || "",
                          return_to_work_plan: s.return_to_work_plan || "",
                          follow_up_required: s.follow_up_required || false,
                          follow_up_notes: s.follow_up_notes || "",
                        }); }}>
                        <CheckCircle className="w-3 h-3 mr-1" /> Complete Session &amp; Generate Report
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Complete Session Dialog */}
      <Dialog open={!!completingSession} onOpenChange={(v) => !v && setCompletingSession(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Complete Session &amp; Generate Report</DialogTitle>
          </DialogHeader>
          {completingSession && (
            <div className="space-y-4 py-2">
              <div className="p-3 bg-slate-800/50 rounded-lg">
                <p className="text-white text-sm font-medium">{completingSession.patient_name}</p>
                <p className="text-slate-400 text-xs">{completingSession.service_name}</p>
                <p className="text-slate-500 text-xs mt-1">
                  Started {moment(completingSession.actual_start_time).format("HH:mm")}
                </p>
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Findings</Label>
                <Textarea value={completeForm.findings}
                  onChange={(e) => setCompleteForm({ ...completeForm, findings: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1 min-h-[80px]" />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Recommendations</Label>
                <Textarea value={completeForm.recommendations}
                  onChange={(e) => setCompleteForm({ ...completeForm, recommendations: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1 min-h-[80px]" />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Work Capacity</Label>
                <Input value={completeForm.work_capacity}
                  onChange={(e) => setCompleteForm({ ...completeForm, work_capacity: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                  placeholder="e.g., Fit for full duties, Fit for light duties" />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Restrictions</Label>
                <Input value={completeForm.restrictions}
                  onChange={(e) => setCompleteForm({ ...completeForm, restrictions: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                  placeholder="e.g., No lifting >10kg for 2 weeks" />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Return to Work Plan</Label>
                <Textarea value={completeForm.return_to_work_plan}
                  onChange={(e) => setCompleteForm({ ...completeForm, return_to_work_plan: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Follow-up Notes</Label>
                <Input value={completeForm.follow_up_notes}
                  onChange={(e) => setCompleteForm({ ...completeForm, follow_up_notes: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompletingSession(null)} className="border-slate-700 text-slate-300">
              Cancel
            </Button>
            <Button onClick={completeSession} disabled={saving} className="bg-emerald-500 hover:bg-emerald-600">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
              Complete &amp; Generate Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}