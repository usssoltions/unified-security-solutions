import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Plus, X, Trash2, Edit } from "lucide-react";

export default function ReportTemplateManager({ user, onClose }) {
  const [view, setView] = useState("list");
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    template_type: "shift_end",
    sections: [
      { title: "Patrol Summary", include_data: ["patrols", "checkpoints"], ai_summary: true },
      { title: "Incidents", include_data: ["incidents"], ai_summary: true },
      { title: "Maintenance", include_data: ["maintenance"], ai_summary: true }
    ],
    auto_generate: true,
    recipients: []
  });
  const [newRecipient, setNewRecipient] = useState("");
  const queryClient = useQueryClient();

  const { data: templates = [] } = useQuery({
    queryKey: ["reportTemplates"],
    queryFn: () => base44.entities.ReportTemplate.filter({ status: "active" }),
    initialData: []
  });

  const createTemplateMutation = useMutation({
    mutationFn: (data) => base44.entities.ReportTemplate.create({
      ...data,
      created_by: user.id
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(["reportTemplates"]);
      setView("list");
    }
  });

  const dataTypeOptions = [
    { value: "patrols", label: "Patrol Logs" },
    { value: "incidents", label: "Incidents" },
    { value: "maintenance", label: "Maintenance Requests" },
    { value: "trainings", label: "Training Progress" },
    { value: "alerts", label: "Alerts & Responses" },
    { value: "checkpoints", label: "Checkpoints" },
    { value: "stay_awake", label: "Stay Awake Logs" }
  ];

  const addSection = () => {
    setFormData(prev => ({
      ...prev,
      sections: [...prev.sections, { title: "", include_data: [], ai_summary: true }]
    }));
  };

  const updateSection = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      sections: prev.sections.map((s, i) => i === index ? { ...s, [field]: value } : s)
    }));
  };

  const removeSection = (index) => {
    setFormData(prev => ({
      ...prev,
      sections: prev.sections.filter((_, i) => i !== index)
    }));
  };

  const addRecipient = () => {
    if (newRecipient && newRecipient.includes("@")) {
      setFormData(prev => ({
        ...prev,
        recipients: [...prev.recipients, newRecipient]
      }));
      setNewRecipient("");
    }
  };

  if (view === "create") {
    return (
      <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
        <div className="min-h-screen p-4 py-20">
          <Card className="max-w-4xl mx-auto bg-slate-800 border-slate-700">
            <CardHeader className="border-b border-slate-700">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Create Report Template</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setView("list")}>
                  <X />
                </Button>
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-white font-medium block mb-2">Template Name *</label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Shift End Report"
                    className="bg-slate-900 border-slate-700 text-white"
                  />
                </div>

                <div>
                  <label className="text-white font-medium block mb-2">Report Type</label>
                  <Select value={formData.template_type} onValueChange={(v) => setFormData(prev => ({ ...prev, template_type: v }))}>
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shift_end">Shift End</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="incident_summary">Incident Summary</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2 pt-8">
                  <input
                    type="checkbox"
                    checked={formData.auto_generate}
                    onChange={(e) => setFormData(prev => ({ ...prev, auto_generate: e.target.checked }))}
                    className="w-4 h-4"
                  />
                  <label className="text-white text-sm">Auto-generate at shift end</label>
                </div>

                <div className="col-span-2">
                  <label className="text-white font-medium block mb-2">Description</label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    className="bg-slate-900 border-slate-700 text-white h-20"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-white font-medium">Report Sections</label>
                  <Button size="sm" onClick={addSection} className="bg-sky-600 hover:bg-sky-700">
                    <Plus className="w-4 h-4 mr-1" />
                    Add Section
                  </Button>
                </div>

                <div className="space-y-3">
                  {formData.sections.map((section, index) => (
                    <div key={index} className="p-4 bg-slate-900 rounded-lg border border-slate-700 space-y-3">
                      <div className="flex items-start justify-between">
                        <Input
                          value={section.title}
                          onChange={(e) => updateSection(index, "title", e.target.value)}
                          placeholder="Section title"
                          className="bg-slate-800 border-slate-700 text-white flex-1 mr-2"
                        />
                        <Button size="sm" variant="ghost" onClick={() => removeSection(index)} className="text-rose-400">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>

                      <div>
                        <label className="text-xs text-slate-400 block mb-2">Include Data:</label>
                        <div className="flex flex-wrap gap-2">
                          {dataTypeOptions.map(opt => (
                            <label key={opt.value} className="flex items-center gap-2 p-2 bg-slate-800 rounded cursor-pointer text-sm">
                              <input
                                type="checkbox"
                                checked={section.include_data.includes(opt.value)}
                                onChange={(e) => {
                                  const newData = e.target.checked
                                    ? [...section.include_data, opt.value]
                                    : section.include_data.filter(d => d !== opt.value);
                                  updateSection(index, "include_data", newData);
                                }}
                                className="w-3 h-3"
                              />
                              <span className="text-white">{opt.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={section.ai_summary}
                          onChange={(e) => updateSection(index, "ai_summary", e.target.checked)}
                          className="w-3 h-3"
                        />
                        <span className="text-slate-300">Generate AI summary for this section</span>
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Auto-Send Recipients</label>
                <div className="flex gap-2 mb-2">
                  <Input
                    value={newRecipient}
                    onChange={(e) => setNewRecipient(e.target.value)}
                    placeholder="email@example.com"
                    className="bg-slate-900 border-slate-700 text-white"
                    onKeyPress={(e) => e.key === "Enter" && addRecipient()}
                  />
                  <Button size="sm" onClick={addRecipient} className="bg-sky-600">Add</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {formData.recipients.map((email, i) => (
                    <Badge key={i} className="bg-slate-700">
                      {email}
                      <X
                        className="w-3 h-3 ml-2 cursor-pointer"
                        onClick={() => setFormData(prev => ({
                          ...prev,
                          recipients: prev.recipients.filter((_, idx) => idx !== i)
                        }))}
                      />
                    </Badge>
                  ))}
                </div>
              </div>

              <Button
                onClick={() => createTemplateMutation.mutate(formData)}
                disabled={!formData.name || formData.sections.length === 0}
                className="w-full bg-emerald-600 hover:bg-emerald-700"
              >
                Create Template
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
      <div className="min-h-screen p-4 py-20">
        <Card className="max-w-6xl mx-auto bg-slate-800 border-slate-700">
          <CardHeader className="border-b border-slate-700">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white flex items-center gap-2">
                <FileText className="w-6 h-6 text-sky-400" />
                Report Templates
              </CardTitle>
              <div className="flex gap-2">
                <Button onClick={() => setView("create")} className="bg-sky-600 hover:bg-sky-700">
                  <Plus className="w-5 h-5 mr-2" />
                  Create Template
                </Button>
                <Button variant="ghost" size="icon" onClick={onClose}>
                  <X />
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {templates.map(template => (
                <Card key={template.id} className="bg-slate-900 border-slate-700">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="text-white font-semibold">{template.name}</h4>
                        <p className="text-xs text-slate-400 mt-1">{template.description}</p>
                      </div>
                      <Badge className="bg-sky-600">{template.template_type}</Badge>
                    </div>

                    <div className="space-y-2 text-xs text-slate-400">
                      <p>📋 {template.sections?.length || 0} sections</p>
                      {template.auto_generate && <p className="text-emerald-400">✓ Auto-generate enabled</p>}
                      {template.recipients?.length > 0 && (
                        <p>📧 {template.recipients.length} recipient(s)</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}