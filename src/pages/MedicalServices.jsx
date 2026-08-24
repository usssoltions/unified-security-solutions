import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Stethoscope, Plus, Clock, DollarSign, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export default function MedicalServices() {
  const [user, setUser] = useState(null);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: "", category: "clinical", description: "",
    default_duration_minutes: 60, price: "", active: true,
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
      const svcs = await base44.entities.MedicalService.filter({ customer_id: cid }).catch(() => []);
      setServices(svcs.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
    } catch (e) {
      console.error("Failed to load services:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.name) return;
    setSaving(true);
    try {
      await base44.entities.MedicalService.create({
        ...formData,
        customer_id: user.customer_id,
        price: formData.price ? parseFloat(formData.price) : null,
        available_days: ["mon", "tue", "wed", "thu", "fri"],
      });
      setShowForm(false);
      setFormData({ name: "", category: "clinical", description: "", default_duration_minutes: 60, price: "", active: true });
      await loadData();
    } catch (e) {
      console.error("Failed to create service:", e);
      alert("Failed to create service: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (svc) => {
    try {
      await base44.entities.MedicalService.update(svc.id, { active: !svc.active });
      await loadData();
    } catch (e) {
      console.error("Failed to toggle service:", e);
    }
  };

  const categoryColors = {
    clinical: "bg-sky-500/20 text-sky-400",
    work_ability: "bg-emerald-500/20 text-emerald-400",
    pre_work_screening: "bg-amber-500/20 text-amber-400",
    other: "bg-slate-500/20 text-slate-400",
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
              <Stethoscope className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Medical Services</h1>
              <p className="text-slate-400 text-sm">{services.length} services configured</p>
            </div>
          </div>
          <Button className="bg-emerald-500 hover:bg-emerald-600" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" /> Add Service
          </Button>
        </div>

        {services.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="py-12 text-center">
              <Stethoscope className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No services configured yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {services.map((svc) => (
              <Card key={svc.id} className={`bg-slate-900 border-slate-800 ${!svc.active ? "opacity-50" : ""}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                        <Stethoscope className="w-4 h-4 text-emerald-400" />
                      </div>
                      <p className="text-white font-medium text-sm">{svc.name}</p>
                    </div>
                    <Badge className={`text-xs ${categoryColors[svc.category] || categoryColors.other}`}>
                      {svc.category?.replace(/_/g, " ")}
                    </Badge>
                  </div>

                  {svc.description && (
                    <p className="text-slate-400 text-xs mb-3 line-clamp-2">{svc.description}</p>
                  )}

                  <div className="flex items-center gap-3 text-xs text-slate-400 mb-3">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {svc.default_duration_minutes || 60}min
                    </span>
                    {svc.price && (
                      <span className="flex items-center gap-1">
                        <DollarSign className="w-3 h-3" /> R{svc.price}
                      </span>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    className={`w-full text-xs h-8 ${svc.active ? "border-rose-600/50 text-rose-400 hover:bg-rose-500/10" : "border-emerald-600/50 text-emerald-400 hover:bg-emerald-500/10"}`}
                    onClick={() => toggleActive(svc)}
                  >
                    {svc.active ? "Deactivate" : "Activate"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Add Service</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-slate-300 text-sm">Service Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="bg-slate-800 border-slate-700 text-white mt-1"
                placeholder="e.g., Occupational Therapy, FCE, Ergonomics"
              />
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Category</Label>
              <Select
                value={formData.category}
                onValueChange={(v) => setFormData({ ...formData, category: v })}
              >
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="clinical" className="text-white">Clinical</SelectItem>
                  <SelectItem value="work_ability" className="text-white">Work Ability</SelectItem>
                  <SelectItem value="pre_work_screening" className="text-white">Pre-Work Screening</SelectItem>
                  <SelectItem value="other" className="text-white">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Description</Label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="bg-slate-800 border-slate-700 text-white mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 text-sm">Duration (min)</Label>
                <Input
                  type="number"
                  value={formData.default_duration_minutes}
                  onChange={(e) => setFormData({ ...formData, default_duration_minutes: parseInt(e.target.value) || 60 })}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Price (R)</Label>
                <Input
                  type="number"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} className="border-slate-700 text-slate-300">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !formData.name} className="bg-emerald-500 hover:bg-emerald-600">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Add Service
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}