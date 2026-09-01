import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Users, Search, Plus, Phone, Mail, Building2, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import moment from "moment";

export default function MedicalPatients() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [patients, setPatients] = useState([]);
  const [employers, setEmployers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    first_names: "", surname: "", sa_id_number: "", mobile: "", email: "",
    employer_id: "", job_title: "", referral_source: "self", gender: "unspecified",
    notes: "",
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

      const [pts, emps] = await Promise.all([
        base44.entities.Patient.filter({ customer_id: cid }).catch(() => []),
        base44.entities.Employer.filter({ customer_id: cid, status: "active" }).catch(() => []),
      ]);
      setPatients(pts);
      setEmployers(emps);
    } catch (e) {
      console.error("Failed to load patients:", e);
    } finally {
      setLoading(false);
    }
  };

  const filteredPatients = patients.filter(p => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.first_names?.toLowerCase().includes(q) ||
      p.surname?.toLowerCase().includes(q) ||
      p.sa_id_number?.includes(q) ||
      p.mobile?.includes(q)
    );
  });

  const handleSave = async () => {
    if (!formData.first_names || !formData.surname) return;
    setSaving(true);
    try {
      const employer = employers.find(e => e.id === formData.employer_id);
      await base44.entities.Patient.create({
        ...formData,
        customer_id: user.customer_id,
        employer_name: employer?.company_name || "",
        identity_verification_status: "pending",
        status: "active",
      });
      setShowForm(false);
      setFormData({
        first_names: "", surname: "", sa_id_number: "", mobile: "", email: "",
        employer_id: "", job_title: "", referral_source: "self", gender: "unspecified",
        notes: "",
      });
      await loadData();
    } catch (e) {
      console.error("Failed to create patient:", e);
      alert("Failed to create patient: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const statusColors = {
    active: "bg-emerald-500/20 text-emerald-400",
    inactive: "bg-slate-500/20 text-slate-400",
    archived: "bg-rose-500/20 text-rose-400",
    pending: "bg-amber-500/20 text-amber-400",
    verified: "bg-emerald-500/20 text-emerald-400",
    failed: "bg-rose-500/20 text-rose-400",
    manual_review: "bg-amber-500/20 text-amber-400",
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
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center">
              <Users className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Patients</h1>
              <p className="text-slate-400 text-sm">{patients.length} registered</p>
            </div>
          </div>
          <Button className="bg-emerald-500 hover:bg-emerald-600" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" /> Add Patient
          </Button>
        </div>

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <Input
            placeholder="Search by name, ID number, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-slate-900 border-slate-700 text-white"
          />
        </div>

        {filteredPatients.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="py-12 text-center">
              <Users className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">
                {searchQuery ? "No patients found" : "No patients registered yet"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPatients.map((patient) => (
              <Card key={patient.id} onClick={() => navigate(`/MedicalPatientDetail?id=${patient.id}`)} className="bg-slate-900 border-slate-800 hover:border-emerald-500/30 transition-all cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-emerald-500/20 rounded-full flex items-center justify-center">
                        <span className="text-emerald-400 font-bold">
                          {patient.first_names?.[0]?.toUpperCase()}{patient.surname?.[0]?.toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="text-white font-medium text-sm">
                          {patient.first_names} {patient.surname}
                        </p>
                        {patient.preferred_name && (
                          <p className="text-slate-400 text-xs">aka {patient.preferred_name}</p>
                        )}
                      </div>
                    </div>
                    <Badge className={`${statusColors[patient.status] || statusColors.active} text-xs`}>
                      {patient.status}
                    </Badge>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    {patient.sa_id_number && (
                      <p className="text-slate-400">ID: {patient.sa_id_number}</p>
                    )}
                    {patient.mobile && (
                      <p className="text-slate-400 flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {patient.mobile}
                      </p>
                    )}
                    {patient.email && (
                      <p className="text-slate-400 flex items-center gap-1 truncate">
                        <Mail className="w-3 h-3 shrink-0" /> {patient.email}
                      </p>
                    )}
                    {patient.employer_name && (
                      <p className="text-slate-400 flex items-center gap-1">
                        <Building2 className="w-3 h-3" /> {patient.employer_name}
                      </p>
                    )}
                    {patient.job_title && (
                      <p className="text-slate-400">Role: {patient.job_title}</p>
                    )}
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between">
                    <Badge className={`${statusColors[patient.identity_verification_status] || statusColors.pending} text-xs`}>
                      ID: {patient.identity_verification_status?.replace(/_/g, " ")}
                    </Badge>
                    {patient.date_of_birth && (
                      <span className="text-slate-500 text-xs">
                        DOB: {moment(patient.date_of_birth).format("YYYY-MM-DD")}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Add Patient Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Register New Patient</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 text-sm">First Names *</Label>
                <Input
                  value={formData.first_names}
                  onChange={(e) => setFormData({ ...formData, first_names: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Surname *</Label>
                <Input
                  value={formData.surname}
                  onChange={(e) => setFormData({ ...formData, surname: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 text-sm">SA ID Number</Label>
                <Input
                  value={formData.sa_id_number}
                  onChange={(e) => setFormData({ ...formData, sa_id_number: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Mobile</Label>
                <Input
                  value={formData.mobile}
                  onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Email</Label>
              <Input
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="bg-slate-800 border-slate-700 text-white mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 text-sm">Employer</Label>
                <Select
                  value={formData.employer_id}
                  onValueChange={(v) => setFormData({ ...formData, employer_id: v })}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1">
                    <SelectValue placeholder="Select employer" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {employers.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id} className="text-white">
                        {emp.company_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Job Title</Label>
                <Input
                  value={formData.job_title}
                  onChange={(e) => setFormData({ ...formData, job_title: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 text-sm">Referral Source</Label>
                <Select
                  value={formData.referral_source}
                  onValueChange={(v) => setFormData({ ...formData, referral_source: v })}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="self" className="text-white">Self</SelectItem>
                    <SelectItem value="employer" className="text-white">Employer</SelectItem>
                    <SelectItem value="gp" className="text-white">GP</SelectItem>
                    <SelectItem value="other" className="text-white">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Gender</Label>
                <Select
                  value={formData.gender}
                  onValueChange={(v) => setFormData({ ...formData, gender: v })}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="unspecified" className="text-white">Unspecified</SelectItem>
                    <SelectItem value="male" className="text-white">Male</SelectItem>
                    <SelectItem value="female" className="text-white">Female</SelectItem>
                    <SelectItem value="other" className="text-white">Other</SelectItem>
                  </SelectContent>
                </Select>
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
            <Button onClick={handleSave} disabled={saving || !formData.first_names || !formData.surname} className="bg-emerald-500 hover:bg-emerald-600">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Register Patient
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}