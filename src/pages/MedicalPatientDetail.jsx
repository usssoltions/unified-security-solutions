import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Users, Phone, Mail, Building2, Calendar, Activity,
  ShieldCheck, FileText, Loader2, CreditCard,
} from "lucide-react";
import moment from "moment";

const STATUS_COLORS = {
  active: "bg-emerald-500/20 text-emerald-400",
  inactive: "bg-slate-500/20 text-slate-400",
  archived: "bg-rose-500/20 text-rose-400",
  pending: "bg-amber-500/20 text-amber-400",
  verified: "bg-emerald-500/20 text-emerald-400",
  failed: "bg-rose-500/20 text-rose-400",
  manual_review: "bg-amber-500/20 text-amber-400",
};

export default function MedicalPatientDetail() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const patientId = params.get("id");
  const [patient, setPatient] = useState(null);
  const [employer, setEmployer] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [consents, setConsents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!patientId) { setLoading(false); return; }
    (async () => {
      try {
        const p = await base44.entities.Patient.get(patientId).catch(() => null);
        setPatient(p);
        if (!p) { setLoading(false); return; }
        const [emps, apts, sess, cons] = await Promise.all([
          p.employer_id ? base44.entities.Employer.get(p.employer_id).catch(() => null) : Promise.resolve(null),
          base44.entities.Appointment.filter({ patient_id: patientId }).catch(() => []),
          base44.entities.Session.filter({ patient_id: patientId }).catch(() => []),
          base44.entities.ConsentRecord.filter({ patient_id: patientId }).catch(() => []),
        ]);
        setEmployer(emps);
        setAppointments(apts.sort((a, b) => new Date(b.start_time) - new Date(a.start_time)));
        setSessions(sess.sort((a, b) =>
          new Date(b.actual_start_time || b.created_date) - new Date(a.actual_start_time || a.created_date)
        ));
        setConsents(cons.sort((a, b) => new Date(b.captured_at || b.created_date) - new Date(a.captured_at || a.created_date)));
      } catch (e) {
        console.error("Failed to load patient:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [patientId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="min-h-screen bg-slate-950 p-6">
        <Button variant="outline" onClick={() => navigate("/MedicalPatients")} className="border-slate-700 text-slate-300 mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Patients
        </Button>
        <p className="text-slate-400">Patient not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <Button variant="outline" onClick={() => navigate("/MedicalPatients")} className="border-slate-700 text-slate-300 mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Patients
        </Button>

        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 bg-emerald-500/20 rounded-full flex items-center justify-center">
            <span className="text-emerald-400 font-bold text-lg">
              {patient.first_names?.[0]?.toUpperCase()}{patient.surname?.[0]?.toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-white truncate">
              {patient.first_names} {patient.surname}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge className={`${STATUS_COLORS[patient.status] || STATUS_COLORS.active} text-xs`}>{patient.status}</Badge>
              <Badge className={`${STATUS_COLORS[patient.identity_verification_status] || STATUS_COLORS.pending} text-xs`}>
                Identity Verification: {(patient.identity_verification_status || "pending").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
              </Badge>
            </div>
          </div>
        </div>

        {/* Demographics */}
        <Card className="bg-slate-900 border-slate-800 mb-4">
          <CardContent className="p-4 space-y-2 text-sm">
            <p className="text-white font-medium mb-2">Demographics</p>
            {patient.sa_id_number && <p className="text-slate-400 flex items-center gap-2"><CreditCard className="w-4 h-4" /> SA ID: {patient.sa_id_number}</p>}
            {patient.date_of_birth && <p className="text-slate-400">DOB: {moment(patient.date_of_birth).format("YYYY-MM-DD")}</p>}
            {patient.gender && <p className="text-slate-400">Gender: {patient.gender}</p>}
            {patient.mobile && <p className="text-slate-400 flex items-center gap-2"><Phone className="w-4 h-4" /> {patient.mobile}</p>}
            {patient.email && <p className="text-slate-400 flex items-center gap-2"><Mail className="w-4 h-4" /> {patient.email}</p>}
            {patient.address && <p className="text-slate-400">{patient.address}</p>}
            {patient.preferred_name && <p className="text-slate-400">Preferred: {patient.preferred_name}</p>}
          </CardContent>
        </Card>

        {/* Employment */}
        <Card className="bg-slate-900 border-slate-800 mb-4">
          <CardContent className="p-4 space-y-2 text-sm">
            <p className="text-white font-medium mb-2 flex items-center gap-2"><Building2 className="w-4 h-4" /> Employment</p>
            {employer ? (
              <button onClick={() => navigate(`/MedicalEmployerDetail?id=${employer.id}`)} className="text-emerald-400 hover:underline text-left">
                {employer.company_name}
              </button>
            ) : (
              <p className="text-slate-400">Self-referred / private</p>
            )}
            {patient.job_title && <p className="text-slate-400">Role: {patient.job_title}</p>}
            {patient.department && <p className="text-slate-400">Department: {patient.department}</p>}
            {patient.employee_number && <p className="text-slate-400">Employee #: {patient.employee_number}</p>}
            {patient.supervisor_name && <p className="text-slate-400">Supervisor: {patient.supervisor_name}</p>}
          </CardContent>
        </Card>

        {/* Appointments */}
        <Card className="bg-slate-900 border-slate-800 mb-4">
          <CardContent className="p-4">
            <p className="text-white font-medium mb-3 flex items-center gap-2"><Calendar className="w-4 h-4" /> Appointments ({appointments.length})</p>
            {appointments.length === 0 ? (
              <p className="text-slate-400 text-sm">No appointments yet</p>
            ) : (
              <div className="space-y-2">
                {appointments.slice(0, 10).map(a => (
                  <div key={a.id} className="flex items-center justify-between p-2 bg-slate-950/50 rounded-lg text-xs">
                    <div>
                      <p className="text-white font-medium">{a.service_name}</p>
                      <p className="text-slate-500">{moment(a.start_time).format("MMM D, YYYY HH:mm")}</p>
                    </div>
                    <Badge className="bg-slate-700/50 text-slate-300 text-xs">{(a.status || "").replace(/_/g, " ")}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sessions */}
        <Card className="bg-slate-900 border-slate-800 mb-4">
          <CardContent className="p-4">
            <p className="text-white font-medium mb-3 flex items-center gap-2"><Activity className="w-4 h-4" /> Sessions ({sessions.length})</p>
            {sessions.length === 0 ? (
              <p className="text-slate-400 text-sm">No clinical sessions yet</p>
            ) : (
              <div className="space-y-2">
                {sessions.slice(0, 10).map(s => (
                  <div key={s.id} className="flex items-center justify-between p-2 bg-slate-950/50 rounded-lg text-xs">
                    <div>
                      <p className="text-white font-medium">{s.service_name}</p>
                      <p className="text-slate-500">{s.actual_start_time ? moment(s.actual_start_time).format("MMM D, HH:mm") : "—"}{s.duration_minutes ? ` • ${s.duration_minutes}min` : ""}</p>
                    </div>
                    <Badge className={`${s.status === "completed" ? "bg-sky-500/20 text-sky-400" : "bg-emerald-500/20 text-emerald-400"} text-xs`}>{(s.status || "").replace(/_/g, " ")}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Consent records */}
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4">
            <p className="text-white font-medium mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Consent Records ({consents.length})</p>
            {consents.length === 0 ? (
              <p className="text-slate-400 text-sm">No consent records</p>
            ) : (
              <div className="space-y-2">
                {consents.slice(0, 10).map(c => (
                  <div key={c.id} className="flex items-center justify-between p-2 bg-slate-950/50 rounded-lg text-xs">
                    <div>
                      <p className="text-white font-medium">{(c.consent_type || "").replace(/_/g, " ")}</p>
                      {c.captured_at && <p className="text-slate-500">{moment(c.captured_at).format("MMM D, YYYY")}</p>}
                    </div>
                    <Badge className={`${c.result === "accepted" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"} text-xs`}>{c.result}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}