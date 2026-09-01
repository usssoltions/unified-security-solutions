import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ClipboardList, AlertCircle } from "lucide-react";

// Renders an AssessmentTemplate's sections/questions and captures responses.
// responses: { [question_id]: string }  (arrays JSON-encoded for multiple_choice)
export default function AssessmentRunner({ template, responses, setResponses }) {
  if (!template || !Array.isArray(template.sections)) {
    return (
      <Card className="bg-slate-800/40 border-slate-700">
        <CardContent className="p-4 flex items-center gap-2 text-slate-400 text-sm">
          <AlertCircle className="w-4 h-4" /> No assessment template linked to this service.
        </CardContent>
      </Card>
    );
  }

  const setAnswer = (qId, value) => setResponses({ ...responses, [qId]: value });

  const toggleChoice = (qId, option) => {
    const cur = parseArray(responses[qId]);
    const next = cur.includes(option) ? cur.filter(o => o !== option) : [...cur, option];
    setAnswer(qId, JSON.stringify(next));
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-emerald-400" />
        <h3 className="text-white font-semibold text-sm">{template.name}</h3>
        <Badge className="bg-slate-700 text-slate-300 text-xs">v{template.version || 1}</Badge>
      </div>
      {template.sections.map((section, si) => (
        <div key={si} className="space-y-3">
          {section.name && (
            <div className="border-l-2 border-emerald-500/50 pl-3">
              <p className="text-slate-200 font-medium text-sm">{section.name}</p>
              {section.description && <p className="text-slate-500 text-xs mt-0.5">{section.description}</p>}
            </div>
          )}
          {(section.questions || []).map((q) => (
            <div key={q.id} className="space-y-1.5">
              <Label className="text-slate-300 text-sm flex items-center gap-1">
                {q.text}
                {q.required && <span className="text-rose-400">*</span>}
              </Label>
              <QuestionInput
                question={q}
                value={responses[q.id]}
                onText={(v) => setAnswer(q.id, v)}
                onChoice={(opt) => setAnswer(q.id, opt)}
                onMulti={(opt) => toggleChoice(q.id, opt)}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function QuestionInput({ question, value, onText, onChoice, onMulti }) {
  const t = question.question_type;
  if (t === "short_text" || t === "measurement" || t === "date" || t === "time") {
    return (
      <Input
        type={t === "date" ? "date" : t === "time" ? "time" : "text"}
        value={value || ""}
        onChange={(e) => onText(e.target.value)}
        placeholder={t === "measurement" ? "e.g., 120/80 mmHg" : ""}
        className="bg-slate-800 border-slate-700 text-white h-9"
      />
    );
  }
  if (t === "long_text" || t === "clinical_note") {
    return (
      <Textarea
        value={value || ""}
        onChange={(e) => onText(e.target.value)}
        className="bg-slate-800 border-slate-700 text-white min-h-[64px]"
      />
    );
  }
  if (t === "number") {
    return (
      <Input
        type="number"
        value={value ?? ""}
        onChange={(e) => onText(e.target.value)}
        className="bg-slate-800 border-slate-700 text-white h-9"
      />
    );
  }
  if (t === "yes_no") {
    return (
      <div className="flex gap-2">
        {["Yes", "No"].map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChoice(opt)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
              value === opt ? "bg-emerald-500 text-white" : "bg-slate-800 text-slate-300"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    );
  }
  if (t === "single_choice") {
    return (
      <div className="flex flex-wrap gap-2">
        {(question.options || []).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChoice(opt)}
            className={`px-3 py-1.5 rounded-lg text-sm transition ${
              value === opt ? "bg-emerald-500 text-white" : "bg-slate-800 text-slate-300"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    );
  }
  if (t === "multiple_choice") {
    const selected = parseArray(value);
    return (
      <div className="space-y-1.5">
        {(question.options || []).map((opt) => (
          <label key={opt} className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={selected.includes(opt)} onCheckedChange={() => onMulti(opt)} />
            <span className="text-slate-300 text-sm">{opt}</span>
          </label>
        ))}
      </div>
    );
  }
  if (t === "scale") {
    const min = question.scale_min ?? 0;
    const max = question.scale_max ?? 10;
    return (
      <div className="space-y-1">
        <input
          type="range"
          min={min}
          max={max}
          value={Number(value ?? min)}
          onChange={(e) => onText(e.target.value)}
          className="w-full accent-emerald-500"
        />
        <p className="text-slate-400 text-xs text-center">Value: {value ?? min} ({min}–{max})</p>
      </div>
    );
  }
  if (t === "calculated_score") {
    return <p className="text-slate-500 text-xs italic">Auto-calculated from prior responses.</p>;
  }
  return null;
}

function parseArray(v) {
  if (!v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
}