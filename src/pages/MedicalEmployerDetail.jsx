import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Building2, Phone, Mail, Users, Calendar, Loader2,
} from "lucide-react";
import moment from "moment";

export default function MedicalEmployerDetail() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const employerId = params.get("id");
  const [employer, setEmployer] = useState(null);
  const [patients, setPatients] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!employerId) { setLoading(false); return; }
    (async () => {
      try {
        const e = await base44.entities.Employer.get(employerId).catch(() => null);
        setEmployer(e);
        if (!e) { setLoading(false); return; }
        const [pts, apts] = await Promise.all([
          base44.entities.Patient.filter({ employer_id: employerId }).catch(() => []),
          base44.entities.Appointment.filter({ employer_id: employerId }).catch(() => []),
        ]);
        setPatients(pts);
        setAppointments(apts.sort((a, b) => new Date(b.start_time) - new Date(a.start_time)));
      } catch (err) {
        console.error("Failed to load employer:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [employerId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  if (!employer) {
    return (
      <div className="min-h-screen bg-slate-950 p-6">
        <Button variant="outline" onClick={() => navigate("/MedicalEmployers")} className="border-slate-700 text-slate-300 mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Employers
        </Button>
        <p className="text-slate-400">Employer not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <Button variant="outline" onClick={() => navigate("/MedicalEmployers")} className="border-slate-700 text-slate-300 mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Employers
        </Button>

        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 bg-emerald-500/20 rounded-xl flex items-center justify-center">
            <Building2 className="w-7 h-7 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-white truncate">{employer.company_name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge className={`${employer.status === "active" ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-500/20 text-slate-400"} text-xs`}>{employer.status}</Badge>
              {employer.industry && <span className="text-slate-400 text-sm">{employer.industry}</span>}
            </div>
          </div>
        </div>

        {/* Contact */}
        <Card className="bg-slate-900 border-slate-800 mb-4">
          <CardContent className="p-4 space-y-2 text-sm">
            <p className="text-white font-medium mb-2">Company Details</p>
            {employer.registration_number && <p className="text-slate-400">Reg #: {employer.registration_number}</p>}
            {employer.vat_number && <p className="text-slate-400">VAT: {employer.vat_number}</p>}
            {employer.physical_address && <p className="text-slate-400">{employer.physical_address}</p>}
            {employer.primary_contact_name && <p className="text-slate-400">Contact: {employer.primary_contact_name}</p>}
            {employer.primary_contact_phone && <p className="text-slate-400 flex items-center gap-2"><Phone className="w-4 h-4" /> {employer.primary_contact_phone}</p>}
            {employer.primary_contact_email && <p className="text-slate-400 flex items-center gap-2"><Mail className="w-4 h-4" /> {employer.primary_contact_email}</p>}
            {employer.billing_email && <p className="text-slate-400">Billing: {employer.billing_email}</p>}
          </CardContent>
        </Card>

        {/* Linked patients */}
        <Card className="bg-slate-900 border-slate-800 mb-4">
          <CardContent className="p-4">
            <p className="text-white font-medium mb-3 flex items-center gap-2"><Users className="w-4 h-4" /> Referred Employees ({patients.length})</p>
            {patients.length === 0 ? (
              <p className="text-slate-400 text-sm">No employees referred yet</p>
            ) : (
              <div className="space-y-2">
                {patients.slice(0, 15).map(p => (
                  <button key={p.id} onClick={() => navigate(`/MedicalPatientDetail?id=${p.id}`)} className="w-full flex items-center justify-between p-2 bg-slate-950/50 rounded-lg text-xs hover:bg-slate-800/50 transition text-left">
                    <span className="text-white font-medium">{p.first_names} {p.surname}</span>
                    <Badge className="bg-slate-700/50 text-slate-300 text-xs">{p.status}</Badge>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Appointments */}
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4">
            <p className="text-white font-medium mb-3 flex items-center gap-2"><Calendar className="w-4 h-4" /> Appointments ({appointments.length})</p>
            {appointments.length === 0 ? (
              <p className="text-slate-400 text-sm">No appointments yet</p>
            ) : (
              <div className="space-y-2">
                {appointments.slice(0, 15).map(a => (
                  <button key={a.id} onClick={() => navigate(`/MedicalPatientDetail?id=${a.patient_id}`)} className="w-full flex items-center justify-between p-2 bg-slate-950/50 rounded-lg text-xs hover:bg-slate-800/50 transition text-left">
                    <div>
                      <p className="text-white font-medium">{a.patient_name}</p>
                      <p className="text-slate-500">{a.service_name} • {moment(a.start_time).format("MMM D, HH:mm")}</p>
                    </div>
                    <Badge className="bg-slate-700/50 text-slate-300 text-xs">{(a.status || "").replace(/_/g, " ")}</Badge>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}