import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { hasMedicalOversight } from "@/lib/medicalOversight";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, Calendar, FileText, Activity, Clock, Plus, Stethoscope } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import moment from "moment";

export default function MedicalDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ patients: 0, appointmentsToday: 0, pendingSessions: 0, reports: 0 });
  const [upcomingAppointments, setUpcomingAppointments] = useState([]);
  const [recentAppointments, setRecentAppointments] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const u = await base44.auth.me();
      const cid = u.customer_id;
      const oversight = hasMedicalOversight(u);
      if (!cid && !oversight) { setLoading(false); return; }
      const scope = oversight ? {} : { customer_id: cid };

      const [patients, appointments, sessions, reports] = await Promise.all([
        base44.entities.Patient.filter(scope).catch(() => []),
        base44.entities.Appointment.filter(scope).catch(() => []),
        base44.entities.Session.filter({ ...scope, status: "in_progress" }).catch(() => []),
        base44.entities.MedicalReport.filter(scope).catch(() => []),
      ]);

      const today = moment().format("YYYY-MM-DD");
      const todayApps = appointments.filter(a => a.start_time?.startsWith(today));
      const upcoming = appointments
        .filter(a => new Date(a.start_time) >= new Date() && !["cancelled", "no_show"].includes(a.status))
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
        .slice(0, 5);

      setStats({
        patients: patients.length,
        appointmentsToday: todayApps.length,
        pendingSessions: sessions.length,
        reports: reports.length,
      });
      setUpcomingAppointments(upcoming);
      setRecentAppointments(appointments.slice(-5).reverse());
    } catch (e) {
      console.error("Medical dashboard error:", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const statCards = [
    { label: "Active Patients", value: stats.patients, icon: Users, color: "emerald" },
    { label: "Appointments Today", value: stats.appointmentsToday, icon: Calendar, color: "sky" },
    { label: "Sessions In Progress", value: stats.pendingSessions, icon: Activity, color: "amber" },
    { label: "Reports Generated", value: stats.reports, icon: FileText, color: "purple" },
  ];

  const colorMap = {
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    sky: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    purple: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  };

  const statusColors = {
    requested: "bg-slate-500/20 text-slate-400",
    confirmed: "bg-sky-500/20 text-sky-400",
    scheduled: "bg-sky-500/20 text-sky-400",
    arrived: "bg-amber-500/20 text-amber-400",
    in_session: "bg-emerald-500/20 text-emerald-400",
    session_completed: "bg-emerald-500/20 text-emerald-400",
    report_pending: "bg-purple-500/20 text-purple-400",
    report_completed: "bg-emerald-500/20 text-emerald-400",
    no_show: "bg-rose-500/20 text-rose-400",
    cancelled: "bg-rose-500/20 text-rose-400",
  };

  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center">
              <Stethoscope className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Medical Dashboard</h1>
              <p className="text-slate-400 text-sm">Occupational therapy &amp; work-ability practice</p>
            </div>
          </div>
          <Link to="/MedicalAppointments">
            <Button className="bg-emerald-500 hover:bg-emerald-600">
              <Plus className="w-4 h-4 mr-2" /> New Appointment
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {statCards.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.label} className={`bg-slate-900 border-slate-800 ${colorMap[stat.color]}`}>
                <CardContent className="p-4">
                  <Icon className="w-5 h-5 mb-2" />
                  <p className="text-2xl font-bold text-white">{stat.value}</p>
                  <p className="text-xs text-slate-400 mt-1">{stat.label}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white text-base flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-400" /> Upcoming Appointments
              </CardTitle>
            </CardHeader>
            <CardContent>
              {upcomingAppointments.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-6">No upcoming appointments</p>
              ) : (
                <div className="space-y-3">
                  {upcomingAppointments.map((apt) => (
                    <button
                      key={apt.id}
                      type="button"
                      onClick={() => apt.status === "in_session" ? navigate("/MedicalSessions") : apt.patient_id ? navigate(`/MedicalPatientDetail?id=${apt.patient_id}`) : navigate("/MedicalAppointments")}
                      className="w-full flex items-center justify-between p-3 bg-slate-800/50 rounded-lg text-left hover:bg-slate-800 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{apt.patient_name || "Unknown"}</p>
                        <p className="text-slate-400 text-xs truncate">{apt.service_name || "Consultation"}</p>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <p className="text-slate-300 text-xs">{moment(apt.start_time).format("MMM D, HH:mm")}</p>
                        <span className={`inline-block px-2 py-0.5 rounded text-xs mt-1 ${statusColors[apt.status] || "bg-slate-500/20 text-slate-400"}`}>
                          {(apt.status || "").replace(/_/g, " ")}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white text-base flex items-center gap-2">
                <Calendar className="w-4 h-4 text-sky-400" /> Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentAppointments.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-6">No recent appointments</p>
              ) : (
                <div className="space-y-3">
                  {recentAppointments.map((apt) => (
                    <button
                      key={apt.id}
                      type="button"
                      onClick={() => apt.status === "in_session" ? navigate("/MedicalSessions") : apt.patient_id ? navigate(`/MedicalPatientDetail?id=${apt.patient_id}`) : navigate("/MedicalAppointments")}
                      className="w-full flex items-center justify-between p-3 bg-slate-800/50 rounded-lg text-left hover:bg-slate-800 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{apt.patient_name || "Unknown"}</p>
                        <p className="text-slate-400 text-xs truncate">{apt.service_name || "Consultation"}</p>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <p className="text-slate-300 text-xs">{moment(apt.start_time).format("MMM D, HH:mm")}</p>
                        <span className={`inline-block px-2 py-0.5 rounded text-xs mt-1 ${statusColors[apt.status] || "bg-slate-500/20 text-slate-400"}`}>
                          {(apt.status || "").replace(/_/g, " ")}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 flex gap-3">
          <Link to="/MedicalPatients" className="flex-1">
            <Button variant="outline" className="w-full border-slate-700 text-slate-200 hover:bg-slate-800">
              <Users className="w-4 h-4 mr-2" /> Manage Patients
            </Button>
          </Link>
          <Link to="/MedicalAppointments" className="flex-1">
            <Button variant="outline" className="w-full border-slate-700 text-slate-200 hover:bg-slate-800">
              <Calendar className="w-4 h-4 mr-2" /> Manage Appointments
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}