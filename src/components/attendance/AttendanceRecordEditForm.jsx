import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Save, Camera } from "lucide-react";
import IdDocCapture from "./IdDocCapture";
import IdPhotoPair from "./IdPhotoPair";
import { attendanceCall } from "@/lib/attendanceApi";

const TEXT_FIELDS = [
  ["surname_snapshot", "Surname *"], ["initials_snapshot", "Initials"],
  ["id_number_snapshot", "ID / Passport Number *"], ["company_snapshot", "Company / Customer *"],
  ["job_description_snapshot", "Job Description *"], ["cellphone_snapshot", "Cellphone Number *"],
];

/** Authorised correction of one attendance record. Signature/date/time are never editable. */
export default function AttendanceRecordEditForm({ record, medicalCentres, assessmentTypes, onSaved, onCancel }) {
  const editable = [...TEXT_FIELDS.map(([k]) => k), "id_type_snapshot", "medical_centre", "assessment_type", "additional_information"];
  const [fields, setFields] = useState(() => Object.fromEntries(editable.map(k => [k, record[k] ?? ""])));
  const [photos, setPhotos] = useState(null); // {frontUrl, backUrl} when newly captured
  const [capturing, setCapturing] = useState(false);
  const [applyToWorker, setApplyToWorker] = useState(true);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (v) => setFields(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const changed = Object.fromEntries(editable.filter(k => String(fields[k] ?? "") !== String(record[k] ?? "")).map(k => [k, fields[k]]));
      const payload = { record_id: record.id, reason, fields: changed };
      if (photos) Object.assign(payload, { id_photo_front_url: photos.frontUrl, id_photo_back_url: photos.backUrl || null, apply_photos_to_worker: applyToWorker });
      const res = await attendanceCall("update_attendance_record", payload);
      onSaved(res.record);
    } catch (e) { setError(e.message || "Save failed."); }
    finally { setSaving(false); }
  };

  if (capturing) {
    return <IdDocCapture idType={fields.id_type_snapshot || "sa_id"}
      onComplete={(p) => { setPhotos(p); setCapturing(false); }} onSkip={() => setCapturing(false)} />;
  }

  const sel = (k, opts) => (
    <Select value={fields[k] || "__none__"} onValueChange={v => set(k)(v === "__none__" ? "" : v)}>
      <SelectTrigger className="w-full bg-slate-900 border-slate-700 text-white h-11"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">Select…</SelectItem>
        {[...new Set([...opts, fields[k]].filter(Boolean))].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-3">
      <p className="text-slate-400 text-xs">The signature, attendance date and time cannot be changed. Every edit is logged with your name and reason.</p>
      {TEXT_FIELDS.map(([k, label]) => (
        <div key={k}>
          <label className="text-slate-400 text-xs mb-1 block">{label}</label>
          <Input value={fields[k]} onChange={e => set(k)(e.target.value)} className="bg-slate-900 border-slate-700 text-white" />
        </div>
      ))}
      <div>
        <label className="text-slate-400 text-xs mb-1 block">Document Type</label>
        <Select value={fields.id_type_snapshot || "sa_id"} onValueChange={set("id_type_snapshot")}>
          <SelectTrigger className="w-full bg-slate-900 border-slate-700 text-white h-11"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="sa_id">SA ID</SelectItem><SelectItem value="drivers_licence">Driver's Licence</SelectItem>
            <SelectItem value="passport">Passport</SelectItem><SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div><label className="text-slate-400 text-xs mb-1 block">Medical Centre *</label>{sel("medical_centre", medicalCentres)}</div>
      <div><label className="text-slate-400 text-xs mb-1 block">Assessment Type *</label>{sel("assessment_type", assessmentTypes)}</div>
      <div>
        <label className="text-slate-400 text-xs mb-1 block">Additional Information</label>
        <textarea value={fields.additional_information} onChange={e => set("additional_information")(e.target.value)} rows={2}
          className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm" />
      </div>

      <div className="bg-[var(--surface-raised)] rounded-xl p-3 space-y-3">
        <p className="text-white text-sm font-semibold">ID Document Photos</p>
        {photos
          ? <IdPhotoPair front={photos.frontView} back={photos.backView} source="attached_by_edit" />
          : <IdPhotoPair front={record.id_photo_front_url ? record.id_photo_front_view_url : null} back={record.id_photo_back_url ? record.id_photo_back_view_url : null} source={record.id_photo_source} capturedAt={record.id_photo_captured_at} capturedBy={record.id_photo_captured_by_name} />}
        <Button variant="outline" onClick={() => setCapturing(true)} className="w-full h-11 border-[var(--border-default)] text-slate-200">
          <Camera className="w-4 h-4 mr-2" /> {record.id_photo_front_url || photos ? "Replace photos" : "Attach photos"}
        </Button>
        {photos && (
          <label className="flex items-center gap-2 text-slate-300 text-sm">
            <Checkbox checked={applyToWorker} onCheckedChange={v => setApplyToWorker(!!v)} />
            Also save these photos on the worker profile
          </label>
        )}
      </div>

      <div>
        <label className="text-slate-400 text-xs mb-1 block">Reason for correction *</label>
        <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Corrected surname from ID document"
          className="bg-slate-900 border-slate-700 text-white" />
      </div>
      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 text-rose-400 text-sm">{error}</div>}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} disabled={saving} className="flex-1 h-12 border-slate-600 text-slate-300">Cancel</Button>
        <Button variant="brand" onClick={save} disabled={saving || reason.trim().length < 5} className="flex-1 h-12">
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />} Save Changes
        </Button>
      </div>
    </div>
  );
}