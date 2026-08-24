import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calendar, Plus, Clock, Loader2, CheckCircle, XCircle, UserCheck } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import moment from "moment";
import PatientCheckIn from "@/components/medical/PatientCheckIn";

export default function MedicalAppointments() {
  const [user, setUser] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [patients, setPatients] = useState([]);
  const [services, setServices] = useState([]);
  const [therapists, setTherapists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checkInAppointment, setCheckInAppointment] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [formData, setFormData] = useState({
    patient_id: "", service_id: "", therapist_id: "",
    date: "", time: "09:00", duration_minutes: 60, notes: "",
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const u = await base44.auth.me();
      setUser(u);
      const cid = u.customer_id;
      if (!cid) { setLoading(false); return; }

      const [apts, pts, svcs, users] = await Promise.all([
        base44.entities.Appointment.filter({ customer_id: cid }).catch(() => []),
        base44.entities.Patient.filter({ customer_id: cid, status: "active" }).catch(() => []),
        base44.entities.MedicalService.filter({ customer_id: cid, active: true }).catch(() => []),
        base44.entities.User.list().catch(() => []),
      ]);
      setAppointments(apts.sort((a, b) => new Date(b.start_time) - new Date(a.start_time)));
      setPatients(pts);
      setServices(svcs);
      setTherapists(users.filter(u => u.role_type === "admin" || u.role_type === "dispatcher" || u.role_type === "therapist"));
    } catch (e) {
      console.error("Failed to load appointments:", e);
    } finally {
      setLoading(false);
    }
  };

  const filteredAppointments = appointments.filter(a => {
    if (filterStatus === "all") return true;
    if (filterStatus === "upcoming") return new Date(a.start_time) >= new Date() && !["cancelled", "no_show"].includes(a.status);
    if (filterStatus === "today") return a.start_time?.startsWith(moment().format("YYYY-MM-DD"));
    return a.status === filterStatus;
  });

  const handleSave = async () => {
    if (!formData.patient_id || !formData.service_id || !formData.date || !formData.time) return;
    setSaving(true);
    try {
      const patient = patients.find(p => p.id === formData.patient_id);
      const service = services.find(s => s.id === formData.service_id);
      const therapist = therapists.find(t => t.id === formData.therapist_id);
      const start = moment(`${formData.date}T${formData.time}:00`).toISOString();
      const duration = formData.duration_minutes || service?.default_duration_minutes || 60;
      const end = moment(start).add(duration, "minutes").toISOString();

      await base44.entities.Appointment.create({
        customer_id: user.customer_id,
        patient_id: formData.patient_id,
        patient_name: patient ? `${patient.first_names} ${patient.surname}` : "",
        employer_id: patient?.employer_id || "",
        employer_name: patient?.employer_name || "",
        service_id: formData.service_id,
        service_name: service?.name || "",
        therapist_id: formData.therapist_id || "",
        therapist_name: therapist?.full_name || "",
        start_time: start,
        end_time: end,
        duration_minutes: duration,
        booking_source: "reception",
        status: "confirmed",
        notes: formData.notes,
      });
      setShowForm(false);
      setFormData({ patient_id: "", service_id: "", therapist_id: "", date: "", time: "09:00", duration_minutes: 60, notes: "" });
      await loadData();
    } catch (e) {
      console.error("Failed to create appointment:", e);
      alert("Failed to create appointment: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (aptId, newStatus) => {
    try {
      await base44.entities.Appointment.update(aptId, { status: newStatus });
      await loadData();
    } catch (e) {
      console.error("Failed to update appointment:", e);
      alert("Failed to update: " + e.message);
    }
  };

  const statusColors = {
    requested: "bg-slate-500/20 text-slate-400",
    awaiting_confirmation: "bg-amber-500/20 text-amber-400",
    confirmed: "bg-sky-500/20 text-sky-400",
    scheduled: "bg-sky-500/20 text-sky-400",
    arrived: "bg-amber-500/20 text-amber-400",
    in_session: "bg-emerald-500/20 text-emerald-400",
    session_completed: "bg-emerald-500/20 text-emerald-400",
    report_pending: "bg-purple-500/20 text-purple-400",
    report_completed: "bg-emerald-500/20 text-emerald-400",
    no_show: "bg-rose-500/20 text-rose-400",
    cancelled: "bg-rose-500/20 text-rose-400",
    rescheduled: "bg-amber-500/20 text-amber-400",
  };

  const filterTabs = [
    { key: "all", label: "All" },
    { key: "upcoming", label: "Upcoming" },
    { key: "today", label: "Today" },
    { key: "confirmed", label: "Confirmed" },
    { key: "arrived", label: "Arrived" },
    { key: "cancelled", label: "Cancelled" },
  ];

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
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center">
              <Calendar className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Appointments</h1>
              <p className="text-slate-400 text-sm">{appointments.length} total</p>
            </div>
          </div>
          <Button className="bg-emerald-500 hover:bg-emerald-600" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" /> New Appointment
          </Button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {filterTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilterStatus(tab.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                filterStatus === tab.key
                  ? "bg-emerald-500 text-white"
                  : "bg-slate-900 text-slate-400 hover:bg-slate-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {filteredAppointments.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="py-12 text-center">
              <Calendar className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No appointments found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredAppointments.map((apt) => (
              <Card key={apt.id} className="bg-slate-900 border-slate-800">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center shrink-0">
                        <Clock className="w-5 h-5 text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-white font-medium text-sm truncate">
                          {apt.patient_name || "Unknown Patient"}
                        </p>
                        <p className="text-slate-400 text-xs truncate">
                          {apt.service_name || "Consultation"}
                          {apt.therapist_name && ` • ${apt.therapist_name}`}
                        </p>
                        <p className="text-slate-500 text-xs mt-0.5">
                          {moment(apt.start_time).format("ddd, MMM D • HH:mm")}
                          {apt.duration_minutes ? ` (${apt.duration_minutes}min)` : ""}
                        </p>
                        {apt.notes && (
                          <p className="text-slate-500 text-xs mt-1 truncate">{apt.notes}</p>
                        )}
                      </div>
                    </div>
                    <Badge className={`${statusColors[apt.status] || statusColors.requested} text-xs shrink-0`}>
                      {(apt.status || "").replace(/_/g, " ")}
                    </Badge>
                  </div>

                  {/* Quick actions */}
                  {(apt.status === "confirmed" || apt.status === "scheduled") && (
                    <div className="flex gap-2 mt-3 pt-3 border-t border-slate-800">
                      <Button
                        size="sm"
                        className="bg-emerald-500 hover:bg-emerald-600 text-xs h-8"
                        onClick={() => setCheckInAppointment(apt)}
                      >
                        <UserCheck className="w-3 h-3 mr-1" /> Check-In
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-rose-600/50 text-rose-400 hover:bg-rose-500/10 text-xs h-8"
                        onClick={() => updateStatus(apt.id, "cancelled")}
                      >
                        <XCircle className="w-3 h-3 mr-1" /> Cancel
                      </Button>
                    </div>
                  )}
                  {apt.status === "arrived" && (
                    <div className="flex gap-2 mt-3 pt-3 border-t border-slate-800">
                      <Button
                        size="sm"
                        className="bg-emerald-500 hover:bg-emerald-600 text-xs h-8"
                        onClick={() => updateStatus(apt.id, "in_session")}
                      >
                        <CheckCircle className="w-3 h-3 mr-1" /> Start Session
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-rose-600/50 text-rose-400 hover:bg-rose-500/10 text-xs h-8"
                        onClick={() => updateStatus(apt.id, "no_show")}
                      >
                        <XCircle className="w-3 h-3 mr-1" /> No Show
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* New Appointment Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">New Appointment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-slate-300 text-sm">Patient *</Label>
              <Select
                value={formData.patient_id}
                onValueChange={(v) => setFormData({ ...formData, patient_id: v })}
              >
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1">
                  <SelectValue placeholder="Select patient" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {patients.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-white">
                      {p.first_names} {p.surname}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Service *</Label>
              <Select
                value={formData.service_id}
                onValueChange={(v) => {
                  const svc = services.find(s => s.id === v);
                  setFormData({ ...formData, service_id: v, duration_minutes: svc?.default_duration_minutes || 60 });
                }}
              >
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1">
                  <SelectValue placeholder="Select service" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-white">
                      {s.name} ({s.default_duration_minutes || 60}min)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Therapist</Label>
              <Select
                value={formData.therapist_id}
                onValueChange={(v) => setFormData({ ...formData, therapist_id: v })}
              >
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1">
                  <SelectValue placeholder="Select therapist (optional)" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {therapists.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-white">
                      {t.full_name || t.display_name || t.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-slate-300 text-sm">Date *</Label>
                <Input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Time *</Label>
                <Input
                  type="time"
                  value={formData.time}
                  onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Duration (min)</Label>
                <Input
                  type="number"
                  value={formData.duration_minutes}
                  onChange={(e) => setFormData({ ...formData, duration_minutes: parseInt(e.target.value) || 60 })}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Notes</Label>
              <Input
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="bg-slate-800 border-slate-700 text-white mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} className="border-slate-700 text-slate-300">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !formData.patient_id || !formData.service_id || !formData.date}
              className="bg-emerald-500 hover:bg-emerald-600"
            >
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Create Appointment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {checkInAppointment && user && (
        <PatientCheckIn
          appointment={checkInAppointment}
          user={user}
          onClose={() => setCheckInAppointment(null)}
          onVerified={() => loadData()}
        />
      )}
    </div>
  );
}