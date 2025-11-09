import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Loader2, Package } from "lucide-react";

export default function AssetForm({ asset, onClose, onSuccess }) {
  const [formData, setFormData] = useState(asset || {
    asset_name: "",
    asset_number: "",
    category: "equipment",
    status: "active",
    purchase_date: "",
    purchase_cost: "",
    current_value: "",
    site_id: "",
    assigned_to: "",
    last_service_date: "",
    next_service_date: "",
    service_interval_days: "",
    warranty_expiry: "",
    notes: ""
  });
  const [submitting, setSubmitting] = useState(false);

  const { data: sites } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => await base44.entities.Site.list(),
    initialData: []
  });

  const { data: guards } = useQuery({
    queryKey: ["guards"],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role_type === "guard");
    },
    initialData: []
  });

  const categories = [
    { value: "vehicle", label: "Vehicle" },
    { value: "equipment", label: "Equipment" },
    { value: "electronics", label: "Electronics" },
    { value: "furniture", label: "Furniture" },
    { value: "tools", label: "Tools" },
    { value: "safety_gear", label: "Safety Gear" },
    { value: "other", label: "Other" }
  ];

  const statuses = [
    { value: "active", label: "Active" },
    { value: "maintenance", label: "In Maintenance" },
    { value: "retired", label: "Retired" },
    { value: "lost", label: "Lost/Stolen" }
  ];

  const handleSubmit = async () => {
    if (!formData.asset_name || !formData.asset_number) {
      alert("Please fill in required fields");
      return;
    }

    setSubmitting(true);

    try {
      const site = sites.find(s => s.id === formData.site_id);
      const guard = guards.find(g => g.id === formData.assigned_to);

      const data = {
        ...formData,
        site_name: site?.name || "",
        assigned_to_name: guard?.full_name || "",
        purchase_cost: formData.purchase_cost ? parseFloat(formData.purchase_cost) : 0,
        current_value: formData.current_value ? parseFloat(formData.current_value) : 0,
        service_interval_days: formData.service_interval_days ? parseInt(formData.service_interval_days) : null
      };

      if (asset) {
        await base44.entities.Asset.update(asset.id, data);
      } else {
        await base44.entities.Asset.create(data);
      }

      onSuccess();
    } catch (error) {
      alert("Failed to save asset");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
      <div className="min-h-screen p-4 flex items-start justify-center pt-20">
        <Card className="w-full max-w-3xl bg-slate-800 border-slate-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center">
                  <Package className="w-6 h-6 text-white" />
                </div>
                <CardTitle className="text-white text-xl">
                  {asset ? "Edit Asset" : "Add New Asset"}
                </CardTitle>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400">
                <X />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">
                  Asset Name <span className="text-rose-400">*</span>
                </label>
                <Input
                  placeholder="e.g., Patrol Vehicle #1"
                  value={formData.asset_name}
                  onChange={(e) => setFormData({ ...formData, asset_name: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">
                  Asset Number <span className="text-rose-400">*</span>
                </label>
                <Input
                  placeholder="Unique identifier"
                  value={formData.asset_number}
                  onChange={(e) => setFormData({ ...formData, asset_number: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">Category</label>
                <Select
                  value={formData.category}
                  onValueChange={(value) => setFormData({ ...formData, category: value })}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">Status</label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData({ ...formData, status: value })}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statuses.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">Location (Site)</label>
                <Select
                  value={formData.site_id}
                  onValueChange={(value) => setFormData({ ...formData, site_id: value })}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue placeholder="Select site..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((site) => (
                      <SelectItem key={site.id} value={site.id}>
                        {site.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">Assigned To</label>
                <Select
                  value={formData.assigned_to}
                  onValueChange={(value) => setFormData({ ...formData, assigned_to: value })}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue placeholder="Select guard..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>Unassigned</SelectItem>
                    {guards.map((guard) => (
                      <SelectItem key={guard.id} value={guard.id}>
                        {guard.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">Purchase Date</label>
                <Input
                  type="date"
                  value={formData.purchase_date}
                  onChange={(e) => setFormData({ ...formData, purchase_date: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">Purchase Cost</label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={formData.purchase_cost}
                  onChange={(e) => setFormData({ ...formData, purchase_cost: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">Current Value</label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={formData.current_value}
                  onChange={(e) => setFormData({ ...formData, current_value: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>
            </div>

            <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700 space-y-4">
              <h3 className="font-semibold text-white">Service Schedule</h3>
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-sm text-slate-300 font-medium block mb-2">Last Service</label>
                  <Input
                    type="date"
                    value={formData.last_service_date}
                    onChange={(e) => setFormData({ ...formData, last_service_date: e.target.value })}
                    className="bg-slate-900 border-slate-700 text-white"
                  />
                </div>

                <div>
                  <label className="text-sm text-slate-300 font-medium block mb-2">Next Service</label>
                  <Input
                    type="date"
                    value={formData.next_service_date}
                    onChange={(e) => setFormData({ ...formData, next_service_date: e.target.value })}
                    className="bg-slate-900 border-slate-700 text-white"
                  />
                </div>

                <div>
                  <label className="text-sm text-slate-300 font-medium block mb-2">Interval (days)</label>
                  <Input
                    type="number"
                    placeholder="e.g., 90"
                    value={formData.service_interval_days}
                    onChange={(e) => setFormData({ ...formData, service_interval_days: e.target.value })}
                    className="bg-slate-900 border-slate-700 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">Warranty Expiry</label>
                <Input
                  type="date"
                  value={formData.warranty_expiry}
                  onChange={(e) => setFormData({ ...formData, warranty_expiry: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>
            </div>

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">Notes</label>
              <Textarea
                placeholder="Additional information about this asset..."
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="bg-slate-900 border-slate-700 text-white min-h-24"
              />
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1 border-slate-600 text-slate-300"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 bg-gradient-to-r from-emerald-500 to-emerald-600"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  asset ? "Update Asset" : "Create Asset"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}