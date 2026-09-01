import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, Users, Calendar, FileText, Loader2, Clock, CheckCircle, Phone } from "lucide-react";
import moment from "moment";
import { getUserDisplayName } from "@/lib/userDisplayName";

export default function EmployerPortal() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [patients, setPatients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [reports, setReports] = useState([]);
  const [tab, setTab] = useState("overview");

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const u = await base44.auth.me();
      setUser(u);
      const empId = u.employer_id;
      if (!empId) { setLoading(false); return; }

      const [pts, apts, reps] = await Promise.all([
        base44.entities.Patient.filter({}).catch(() => []),
        base44.entities.Appointment.filter({}).catch(() => []),
        base44.entities.MedicalReport.filter({}).catch(() => []),
      ]);

      // Employer isolation: only see own employees' data
      setPatients(pts.filter(p => p.employer_id === empId));
      setAppointments(apts.filter(a => a.employer_id === empId));
      setReports(reps.filter(r => r.employer_id === empId && r.shared_with_employer));
    } catch (e) {
      console.error("EmployerPortal error:", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-950"><Loader2 className="w-8 h-8 text-emerald-500 animate-spin" /></div>;
  }

  if (!user?.employer_id) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <Card className="bg-slate-900 border-slate-800 max-w-md">
          <CardContent className="p-8 text-center">
            <Building2 className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <h2 className="text-white font-bold text-lg mb-2">Employer Access Required</h2>
            <p className="text-slate-400 text-sm">This portal is only available to authorised employer contacts.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const upcomingApts = appointments.filter(a => new Date(a.start_time) > new Date() && ['confirmed', 'scheduled', 'arrived', 'in_session'].includes(a.status));
  const pastApts = appointments.filter(a => ['session_completed', 'report_completed', 'no_show', 'cancelled'].includes(a.status));

  const statusColors = {
    requested: "bg-amber-500/20 text-amber-400",
    confirmed: "bg-sky-500/20 text-sky-400",
    scheduled: "bg-sky-500/20 text-sky-400",
    arrived: "bg-emerald-500/20 text-emerald-400",
    in_session: "bg-violet-500/20 text-violet-400",
    session_completed: "bg-indigo-500/20 text-indigo-400",
    report_completed: "bg-emerald-500/20 text-emerald-400",
    no_show: "bg-rose-500/20 text-rose-400",
    cancelled: "bg-slate-500/20 text-slate-400",
  };

  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Employer Portal</h1>
            <p className="text-slate-400 text-sm">{getUserDisplayName(user)}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-emerald-400" />
                <p className="text-slate-400 text-xs">Employees</p>
              </div>
              <p className="text-2xl font-bold text-white">{patients.length}</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-4 h-4 text-sky-400" />
                <p className="text-slate-400 text-xs">Upcoming</p>
              </div>
              <p className="text-2xl font-bold text-white">{upcomingApts.length}</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-violet-400" />
                <p className="text-slate-400 text-xs">Completed</p>
              </div>
              <p className="text-2xl font-bold text-white">{pastApts.length}</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="w-4 h-4 text-amber-400" />
                <p className="text-slate-400 text-xs">Reports</p>
              </div>
              <p className="text-2xl font-bold text-white">{reports.length}</p>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {["overview", "appointments", "employees", "reports"].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${tab === t ? "bg-emerald-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"}`}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="space-y-3">
            {upcomingApts.slice(0, 5).map(a => (
              <Card key={a.id} className="bg-slate-900 border-slate-800">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium text-sm">{a.patient_name}</p>
                    <p className="text-slate-400 text-xs">{a.service_name} • {moment(a.start_time).format("MMM D, HH:mm")}</p>
                  </div>
                  <Badge className={`text-xs ${statusColors[a.status] || "bg-slate-500/20 text-slate-400"}`}>{(a.status || "").replace(/_/g, " ")}</Badge>
                </CardContent>
              </Card>
            ))}
            {upcomingApts.length === 0 && <p className="text-slate-500 text-sm text-center py-8">No upcoming appointments</p>}
          </div>
        )}

        {tab === "appointments" && (
          <div className="space-y-3">
            {appointments.map(a => (
              <Card key={a.id} className="bg-slate-900 border-slate-800">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium text-sm">{a.patient_name}</p>
                    <p className="text-slate-400 text-xs">{a.service_name} • {moment(a.start_time).format("MMM D, HH:mm")}</p>
                  </div>
                  <Badge className={`text-xs ${statusColors[a.status] || "bg-slate-500/20 text-slate-400"}`}>{(a.status || "").replace(/_/g, " ")}</Badge>
                </CardContent>
              </Card>
            ))}
            {appointments.length === 0 && <p className="text-slate-500 text-sm text-center py-8">No appointments</p>}
          </div>
        )}

        {tab === "employees" && (
          <div className="space-y-3">
            {patients.map(p => (
              <Card key={p.id} className="bg-slate-900 border-slate-800">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium text-sm">{p.first_names} {p.surname}</p>
                    <p className="text-slate-400 text-xs">{p.job_title || p.department || "Employee"}</p>
                  </div>
                  {p.identity_verified && <Badge className="text-xs bg-emerald-500/20 text-emerald-400">Verified</Badge>}
                </CardContent>
              </Card>
            ))}
            {patients.length === 0 && <p className="text-slate-500 text-sm text-center py-8">No employees registered</p>}
          </div>
        )}

        {tab === "reports" && (
          <div className="space-y-3">
            {reports.map(r => (
              <Card key={r.id} className="bg-slate-900 border-slate-800">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-white font-medium text-sm">{r.patient_name}</p>
                    <p className="text-slate-400 text-xs">{r.service_name} • {moment(r.generated_at).format("MMM D, YYYY")}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Badge className="text-xs bg-emerald-500/20 text-emerald-400">Released</Badge>
                    {r.file_url && <a href={r.file_url} target="_blank" rel="noopener noreferrer" className="text-sky-400 text-xs">View</a>}
                  </div>
                </CardContent>
              </Card>
            ))}
            {reports.length === 0 && <p className="text-slate-500 text-sm text-center py-8">No released reports available</p>}
          </div>
        )}
      </div>
    </div>
  );
}