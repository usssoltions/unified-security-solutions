import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, Trash2, Save } from "lucide-react";

export default function ChecklistTemplateForm({ template, sites, onClose, onSuccess }) {
  const [formData, setFormData] = useState(template || {
    name: "",
    site_id: "",
    checkpoint_id: "",
    items: [],
    requires_signature: true,
    status: "active"
  });

  const [newItem, setNewItem] = useState({ text: "", type: "checkbox", required: true });
  const [selectedSite, setSelectedSite] = useState(null);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (template) {
        return await base44.entities.ChecklistTemplate.update(template.id, data);
      } else {
        return await base44.entities.ChecklistTemplate.create(data);
      }
    },
    onSuccess: () => {
      onSuccess();
    }
  });

  const handleAddItem = () => {
    if (!newItem.text.trim()) return;
    
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { ...newItem, id: Date.now().toString() }]
    }));
    setNewItem({ text: "", type: "checkbox", required: true });
  };

  const handleRemoveItem = (id) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter(item => item.id !== id)
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    saveMutation.mutate(formData);
  };

  const site = selectedSite || sites.find(s => s.id === formData.site_id);
  const checkpoints = site?.checkpoints || [];

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
      <div className="min-h-screen p-4 flex items-center justify-center">
        <Card className="w-full max-w-2xl bg-slate-800 border-slate-700">
          <CardHeader className="border-b border-slate-700">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white">
                {template ? "Edit Checklist" : "Create New Checklist"}
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="w-5 h-5 text-slate-400" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">
                  Checklist Name *
                </label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Morning Patrol Checklist"
                  className="bg-slate-900 border-slate-700 text-white"
                  required
                />
              </div>

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">
                  Site
                </label>
                <Select
                  value={formData.site_id}
                  onValueChange={(value) => {
                    setFormData(prev => ({ ...prev, site_id: value, checkpoint_id: "" }));
                    setSelectedSite(sites.find(s => s.id === value));
                  }}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue placeholder="Select site..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sites</SelectItem>
                    {sites.map(site => (
                      <SelectItem key={site.id} value={site.id}>
                        {site.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {checkpoints.length > 0 && (
                <div>
                  <label className="text-sm text-slate-300 font-medium block mb-2">
                    Link to Checkpoint (Optional)
                  </label>
                  <Select
                    value={formData.checkpoint_id}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, checkpoint_id: value }))}
                  >
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                      <SelectValue placeholder="Select checkpoint..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={null}>No Checkpoint</SelectItem>
                      {checkpoints.map(cp => (
                        <SelectItem key={cp.id} value={cp.id}>
                          {cp.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">
                  Checklist Items *
                </label>
                <div className="space-y-2 mb-3">
                  {formData.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 p-3 bg-slate-900 rounded-lg">
                      <div className="flex-1">
                        <p className="text-white text-sm">{item.text}</p>
                        <div className="flex gap-2 mt-1">
                          <span className="text-xs text-slate-400 px-2 py-0.5 bg-slate-800 rounded">
                            {item.type}
                          </span>
                          {item.required && (
                            <span className="text-xs text-emerald-400 px-2 py-0.5 bg-emerald-500/10 rounded">
                              Required
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => handleRemoveItem(item.id)}
                        className="text-rose-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="p-4 bg-slate-900 rounded-lg space-y-3">
                  <Input
                    value={newItem.text}
                    onChange={(e) => setNewItem(prev => ({ ...prev, text: e.target.value }))}
                    placeholder="Item description..."
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                  <div className="flex gap-2">
                    <Select
                      value={newItem.type}
                      onValueChange={(value) => setNewItem(prev => ({ ...prev, type: value }))}
                    >
                      <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="checkbox">Checkbox</SelectItem>
                        <SelectItem value="text">Text Input</SelectItem>
                        <SelectItem value="photo">Photo Required</SelectItem>
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-2 text-sm text-slate-300 px-3 bg-slate-800 rounded border border-slate-700">
                      <input
                        type="checkbox"
                        checked={newItem.required}
                        onChange={(e) => setNewItem(prev => ({ ...prev, required: e.target.checked }))}
                        className="w-4 h-4"
                      />
                      Required
                    </label>
                    <Button
                      type="button"
                      onClick={handleAddItem}
                      className="bg-sky-600 hover:bg-sky-700"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 p-3 bg-slate-900 rounded-lg">
                <input
                  type="checkbox"
                  checked={formData.requires_signature}
                  onChange={(e) => setFormData(prev => ({ ...prev, requires_signature: e.target.checked }))}
                  className="w-4 h-4"
                />
                <label className="text-sm text-slate-300">Require signature on completion</label>
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="flex-1 border-slate-600"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={saveMutation.isPending || formData.items.length === 0}
                  className="flex-1 bg-sky-600 hover:bg-sky-700"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {saveMutation.isPending ? "Saving..." : "Save Checklist"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}