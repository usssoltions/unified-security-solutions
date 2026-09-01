import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { hasMedicalOversight } from "@/lib/medicalOversight";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, Plus, Trash2, Loader2, GripVertical } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const QUESTION_TYPES = [
  { value: "short_text", label: "Short Text" },
  { value: "long_text", label: "Long Text" },
  { value: "yes_no", label: "Yes / No" },
  { value: "number", label: "Number" },
  { value: "single_choice", label: "Single Choice" },
  { value: "multiple_choice", label: "Multiple Choice" },
  { value: "scale", label: "Scale (1-10)" },
  { value: "date", label: "Date" },
];

export default function MedicalAssessmentTemplates() {
  const [user, setUser] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: "", description: "", service_id: "",
    sections: [{ name: "General", description: "", questions: [{ id: "q1", text: "", question_type: "short_text", required: false }] }],
  });
  const [services, setServices] = useState([]);
  const [viewingTemplate, setViewingTemplate] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const u = await base44.auth.me();
      setUser(u);
      const cid = u.customer_id;
      const oversight = hasMedicalOversight(u);
      if (!cid && !oversight) { setLoading(false); return; }
      const scope = oversight ? {} : { customer_id: cid };
      const [tmpls, svcs] = await Promise.all([
        base44.entities.AssessmentTemplate.filter(scope).catch(() => []),
        base44.entities.MedicalService.filter({ ...scope, active: true }).catch(() => []),
      ]);
      setTemplates(tmpls);
      setServices(svcs);
    } catch (e) {
      console.error("Failed to load templates:", e);
    } finally {
      setLoading(false);
    }
  };

  const addSection = () => {
    setFormData({
      ...formData,
      sections: [...formData.sections, {
        name: `Section ${formData.sections.length + 1}`, description: "",
        questions: [{ id: `q${Date.now()}`, text: "", question_type: "short_text", required: false }],
      }],
    });
  };

  const addQuestion = (sectionIdx) => {
    const sections = [...formData.sections];
    sections[sectionIdx].questions.push({
      id: `q${Date.now()}`, text: "", question_type: "short_text", required: false,
    });
    setFormData({ ...formData, sections });
  };

  const updateQuestion = (sectionIdx, qIdx, field, value) => {
    const sections = [...formData.sections];
    sections[sectionIdx].questions[qIdx][field] = value;
    setFormData({ ...formData, sections });
  };

  const removeQuestion = (sectionIdx, qIdx) => {
    const sections = [...formData.sections];
    sections[sectionIdx].questions.splice(qIdx, 1);
    setFormData({ ...formData, sections });
  };

  const removeSection = (sectionIdx) => {
    const sections = [...formData.sections];
    sections.splice(sectionIdx, 1);
    setFormData({ ...formData, sections });
  };

  const addOption = (sectionIdx, qIdx) => {
    const sections = [...formData.sections];
    const q = sections[sectionIdx].questions[qIdx];
    q.options = [...(q.options || []), ""];
    setFormData({ ...formData, sections });
  };

  const updateOption = (sectionIdx, qIdx, oIdx, value) => {
    const sections = [...formData.sections];
    sections[sectionIdx].questions[qIdx].options[oIdx] = value;
    setFormData({ ...formData, sections });
  };

  const removeOption = (sectionIdx, qIdx, oIdx) => {
    const sections = [...formData.sections];
    sections[sectionIdx].questions[qIdx].options.splice(oIdx, 1);
    setFormData({ ...formData, sections });
  };

  const toggleTemplateActive = async (tmpl) => {
    try {
      await base44.entities.AssessmentTemplate.update(tmpl.id, { active: !tmpl.active });
      setViewingTemplate({ ...tmpl, active: !tmpl.active });
      await loadData();
    } catch (e) {
      alert("Failed to update template: " + e.message);
    }
  };

  const handleSave = async () => {
    if (!formData.name) return;
    setSaving(true);
    try {
      const svc = services.find(s => s.id === formData.service_id);
      await base44.entities.AssessmentTemplate.create({
        ...formData,
        customer_id: user.customer_id,
        service_name: svc?.name || "",
        version: 1,
        active: true,
      });
      setShowForm(false);
      setFormData({
        name: "", description: "", service_id: "",
        sections: [{ name: "General", description: "", questions: [{ id: "q1", text: "", question_type: "short_text", required: false }] }],
      });
      await loadData();
    } catch (e) {
      console.error("Failed to create template:", e);
      alert("Failed to create template: " + e.message);
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
              <ClipboardList className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Assessment Templates</h1>
              <p className="text-slate-400 text-sm">{templates.length} templates configured</p>
            </div>
          </div>
          <Button className="bg-emerald-500 hover:bg-emerald-600" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" /> New Template
          </Button>
        </div>

        {templates.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="py-12 text-center">
              <ClipboardList className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No assessment templates yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map(tmpl => (
              <Card key={tmpl.id} onClick={() => setViewingTemplate(tmpl)} className={`bg-slate-900 border-slate-800 hover:border-emerald-500/40 transition-all cursor-pointer ${!tmpl.active ? "opacity-50" : ""}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-white font-medium text-sm">{tmpl.name}</p>
                    <Badge className="text-xs bg-emerald-500/20 text-emerald-400">v{tmpl.version || 1}</Badge>
                  </div>
                  {tmpl.description && <p className="text-slate-400 text-xs mb-2 line-clamp-2">{tmpl.description}</p>}
                  {tmpl.service_name && <p className="text-slate-500 text-xs">Service: {tmpl.service_name}</p>}
                  <p className="text-slate-500 text-xs mt-2">
                    {tmpl.sections?.length || 0} sections • {tmpl.sections?.reduce((acc, s) => acc + (s.questions?.length || 0), 0) || 0} questions
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">New Assessment Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 text-sm">Template Name *</Label>
                <Input value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Service</Label>
                <Select value={formData.service_id}
                  onValueChange={(v) => setFormData({ ...formData, service_id: v })}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1">
                    <SelectValue placeholder="Optional" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {services.map(s => <SelectItem key={s.id} value={s.id} className="text-white">{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Description</Label>
              <Input value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="bg-slate-800 border-slate-700 text-white mt-1" />
            </div>

            {/* Sections */}
            {formData.sections.map((section, sIdx) => (
              <div key={sIdx} className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <Input value={section.name}
                    onChange={(e) => {
                      const sections = [...formData.sections];
                      sections[sIdx].name = e.target.value;
                      setFormData({ ...formData, sections });
                    }}
                    className="bg-slate-900 border-slate-700 text-white text-sm font-medium" />
                  <Button size="sm" variant="ghost" className="text-rose-400 hover:bg-rose-500/10"
                    onClick={() => removeSection(sIdx)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>

                {section.questions.map((q, qIdx) => (
                  <div key={qIdx} className="mb-2">
                    <div className="flex gap-2">
                      <Input value={q.text}
                        onChange={(e) => updateQuestion(sIdx, qIdx, "text", e.target.value)}
                        className="bg-slate-900 border-slate-700 text-white text-sm flex-1"
                        placeholder="Question text" />
                      <Select value={q.question_type}
                        onValueChange={(v) => updateQuestion(sIdx, qIdx, "question_type", v)}>
                        <SelectTrigger className="bg-slate-900 border-slate-700 text-white text-sm w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-slate-700">
                          {QUESTION_TYPES.map(t => <SelectItem key={t.value} value={t.value} className="text-white text-sm">{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="ghost" className="text-rose-400 hover:bg-rose-500/10"
                        onClick={() => removeQuestion(sIdx, qIdx)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    {(q.question_type === "single_choice" || q.question_type === "multiple_choice") && (
                      <div className="mt-2 ml-2 pl-3 border-l-2 border-emerald-500/30 space-y-2">
                        {(q.options || []).map((opt, oIdx) => (
                          <div key={oIdx} className="flex gap-2">
                            <Input value={opt}
                              onChange={(e) => updateOption(sIdx, qIdx, oIdx, e.target.value)}
                              className="bg-slate-900 border-slate-700 text-white text-sm flex-1"
                              placeholder={`Option ${oIdx + 1}`} />
                            <Button size="sm" variant="ghost" className="text-rose-400 hover:bg-rose-500/10"
                              onClick={() => removeOption(sIdx, qIdx, oIdx)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                        <Button size="sm" variant="ghost" className="text-emerald-400 hover:bg-emerald-500/10 text-xs"
                          onClick={() => addOption(sIdx, qIdx)}>
                          <Plus className="w-3 h-3 mr-1" /> Add Option
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
                <Button size="sm" variant="ghost" className="text-emerald-400 hover:bg-emerald-500/10 text-xs"
                  onClick={() => addQuestion(sIdx)}>
                  <Plus className="w-3 h-3 mr-1" /> Add Question
                </Button>
              </div>
            ))}
            <Button variant="outline" className="border-slate-700 text-slate-300 w-full"
              onClick={addSection}>
              <Plus className="w-4 h-4 mr-2" /> Add Section
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} className="border-slate-700 text-slate-300">Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !formData.name} className="bg-emerald-500 hover:bg-emerald-600">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Create Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewingTemplate} onOpenChange={(v) => !v && setViewingTemplate(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-2xl max-h-[90vh] overflow-y-auto">
          {viewingTemplate && (
            <>
              <DialogHeader>
                <DialogTitle className="text-white">{viewingTemplate.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                {viewingTemplate.description && <p className="text-slate-400 text-sm">{viewingTemplate.description}</p>}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="text-xs bg-emerald-500/20 text-emerald-400">v{viewingTemplate.version || 1}</Badge>
                  {viewingTemplate.service_name && <Badge className="text-xs bg-sky-500/20 text-sky-400">{viewingTemplate.service_name}</Badge>}
                  <Badge className={`text-xs ${viewingTemplate.active ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-500/20 text-slate-400"}`}>
                    {viewingTemplate.active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                {viewingTemplate.sections?.map((section, sIdx) => (
                  <div key={sIdx} className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                    <p className="text-white text-sm font-medium mb-1">{section.name}</p>
                    {section.description && <p className="text-slate-500 text-xs mb-2">{section.description}</p>}
                    <div className="space-y-1.5">
                      {section.questions?.map((q, qIdx) => (
                        <div key={qIdx} className="text-xs text-slate-300 flex items-start gap-2">
                          <span className="text-slate-500 shrink-0">{qIdx + 1}.</span>
                          <div>
                            <span>{q.text}</span>
                            <span className="text-slate-500 ml-2">({q.question_type?.replace(/_/g, " ")})</span>
                            {q.required && <span className="text-amber-400 ml-1">*</span>}
                            {q.options?.length > 0 && (
                              <div className="text-slate-500 mt-0.5">Options: {q.options.join(", ")}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex gap-2 pt-2">
                  <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600" onClick={() => toggleTemplateActive(viewingTemplate)}>
                    {viewingTemplate.active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button size="sm" variant="outline" className="border-slate-700 text-slate-300" onClick={() => setViewingTemplate(null)}>
                    Close
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}