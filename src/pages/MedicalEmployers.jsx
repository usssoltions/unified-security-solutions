import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { hasMedicalOversight } from "@/lib/medicalOversight";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus, Search, Phone, Mail, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export default function MedicalEmployers() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [employers, setEmployers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    company_name: "", registration_number: "", vat_number: "",
    industry: "", primary_contact_name: "", primary_contact_email: "",
    primary_contact_phone: "", billing_email: "", physical_address: "",
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
      const oversight = hasMedicalOversight(u);
      if (!cid && !oversight) { setLoading(false); return; }
      const scope = oversight ? {} : { customer_id: cid };
      const emps = await base44.entities.Employer.filter(scope).catch(() => []);
      setEmployers(emps);
    } catch (e) {
      console.error("Failed to load employers:", e);
    } finally {
      setLoading(false);
    }
  };

  const filtered = employers.filter(e => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      e.company_name?.toLowerCase().includes(q) ||
      e.industry?.toLowerCase().includes(q) ||
      e.primary_contact_name?.toLowerCase().includes(q)
    );
  });

  const handleSave = async () => {
    if (!formData.company_name) return;
    setSaving(true);
    try {
      await base44.entities.Employer.create({
        ...formData,
        customer_id: user.customer_id,
        status: "active",
      });
      setShowForm(false);
      setFormData({
        company_name: "", registration_number: "", vat_number: "",
        industry: "", primary_contact_name: "", primary_contact_email: "",
        primary_contact_phone: "", billing_email: "", physical_address: "",
        notes: "",
      });
      await loadData();
    } catch (e) {
      console.error("Failed to create employer:", e);
      alert("Failed to create employer: " + e.message);
    } finally {
      setSaving(false);
    }
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
              <Building2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Employers</h1>
              <p className="text-slate-400 text-sm">{employers.length} corporate clients</p>
            </div>
          </div>
          <Button className="bg-emerald-500 hover:bg-emerald-600" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" /> Add Employer
          </Button>
        </div>

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <Input
            placeholder="Search by company, industry, or contact..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-slate-900 border-slate-700 text-white"
          />
        </div>

        {filtered.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="py-12 text-center">
              <Building2 className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">
                {searchQuery ? "No employers found" : "No employers registered yet"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((emp) => (
              <Card key={emp.id} onClick={() => navigate(`/MedicalEmployerDetail?id=${emp.id}`)} className="bg-slate-900 border-slate-800 hover:border-emerald-500/30 transition-all cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-white font-medium text-sm">{emp.company_name}</p>
                        {emp.industry && <p className="text-slate-400 text-xs">{emp.industry}</p>}
                      </div>
                    </div>
                    <Badge className={`text-xs ${emp.status === "active" ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-500/20 text-slate-400"}`}>
                      {emp.status}
                    </Badge>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    {emp.primary_contact_name && (
                      <p className="text-slate-400">Contact: {emp.primary_contact_name}</p>
                    )}
                    {emp.primary_contact_phone && (
                      <p className="text-slate-400 flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {emp.primary_contact_phone}
                      </p>
                    )}
                    {emp.primary_contact_email && (
                      <p className="text-slate-400 flex items-center gap-1 truncate">
                        <Mail className="w-3 h-3 shrink-0" /> {emp.primary_contact_email}
                      </p>
                    )}
                    {emp.registration_number && (
                      <p className="text-slate-400">Reg: {emp.registration_number}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">Add Employer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-slate-300 text-sm">Company Name *</Label>
              <Input
                value={formData.company_name}
                onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                className="bg-slate-800 border-slate-700 text-white mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 text-sm">Registration Number</Label>
                <Input
                  value={formData.registration_number}
                  onChange={(e) => setFormData({ ...formData, registration_number: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">VAT Number</Label>
                <Input
                  value={formData.vat_number}
                  onChange={(e) => setFormData({ ...formData, vat_number: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Industry</Label>
              <Input
                value={formData.industry}
                onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                className="bg-slate-800 border-slate-700 text-white mt-1"
                placeholder="e.g., Manufacturing, Mining, Logistics"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 text-sm">Primary Contact</Label>
                <Input
                  value={formData.primary_contact_name}
                  onChange={(e) => setFormData({ ...formData, primary_contact_name: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Contact Phone</Label>
                <Input
                  value={formData.primary_contact_phone}
                  onChange={(e) => setFormData({ ...formData, primary_contact_phone: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 text-sm">Contact Email</Label>
                <Input
                  value={formData.primary_contact_email}
                  onChange={(e) => setFormData({ ...formData, primary_contact_email: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Billing Email</Label>
                <Input
                  value={formData.billing_email}
                  onChange={(e) => setFormData({ ...formData, billing_email: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Physical Address</Label>
              <Input
                value={formData.physical_address}
                onChange={(e) => setFormData({ ...formData, physical_address: e.target.value })}
                className="bg-slate-800 border-slate-700 text-white mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} className="border-slate-700 text-slate-300">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !formData.company_name} className="bg-emerald-500 hover:bg-emerald-600">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Add Employer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}