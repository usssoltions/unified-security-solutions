import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import AssessmentRunner from "./AssessmentRunner";
import {
  Loader2, X, User, Building2, Briefcase, ShieldCheck, ShieldAlert,
  ClipboardList, FileText, CheckCircle, Clock, History,
} from "lucide-react";
import moment from "moment";

// Full clinical session workspace: links the live session to its patient,
// employer, service, assessment template, and prior assessment history,
// then completes the session and generates the linked MedicalReport.
export default function SessionWorkspace({ session, user, onClose, onCompleted }) {
  const [loading, setLoading] = useState(true);
  const [patient, setPatient] = useState(null);
  const [employer, setEmployer] = useState(null);
  const [service, setService] = useState(null);
  const [template, setTemplate] = useState(null);
  const [priorAssessments, setPriorAssessments] = useState([]);
  const [responses, setResponses] = useState({});
  const [form, setForm] = useState({
    findings: "", recommendations: "", work_capacity: "", restrictions: "",
    return_to_work_plan: "", follow_up_required: false, follow_up_notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const cid = session.customer_id;
        const loads = [];
        if (session.patient_id) loads.push(base44.entities.Patient.get(session.patient_id).then(setPatient).catch(() => {}));
        if (session.service_id) loads.push(base44.entities.MedicalService.get(session.service_id).then(setService).catch(() => {}));
        if (session.employer_id) loads.push(base44.entities.Employer.get(session.employer_id).then(setEmployer).catch(() => {}));
        await Promise.all(loads);
        // Service → default assessment template
        let tmplId = service?.assessment_template_id || session.assessment_template_id;
        if (!tmplId && cid) {
          const tmpls = await base44.entities.AssessmentTemplate.filter({ customer_id: cid, service_id: session.service_id, active: true }).catch(() => []);
          if (tmpls.length) tmplId = tmpls[0].id;
          if (tmplId && !cancelled) setTemplate(tmpls[0]);
        }
        if (tmplId && !template) {
          const t = await base44.entities.AssessmentTemplate.get(tmplId).catch(() => null);
          if (t && !cancelled) setTemplate(t);
        }
        if (session.patient_id && cid) {
          const prior = await base44.entities.Assessment.filter({ patient_id: session.patient_id }).catch(() => []);
          if (!cancelled) setPriorAssessments(prior.sort((a, b) => new Date(b.completed_at || b.created_date) - new Date(a.completed_at || a.created_date)));
        }
        if (!cancelled && session) {
          setForm({
            findings: session.findings || "", recommendations: session.recommendations || "",
            work_capacity: session.work_capacity || "", restrictions: session.restrictions || "",
            return_to_work_plan: session.return_to_work_plan || "",
            follow_up_required: session.follow_up_required || false,
            follow_up_notes: session.follow_up_notes || "",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session?.id]);

  const durationMin = session?.actual_start_time
    ? Math.round((Date.now() - new Date(session.actual_start_time).getTime()) / 60000)
    : 0;

  const buildResponsesArray = () => {
    if (!template?.sections) return [];
    const out = [];
    template.sections.forEach((sec) => {
      (sec.questions || []).forEach((q) => {
        if (responses[q.id] !== undefined && responses[q.id] !== "") {
          out.push({
            section_name: sec.name || "",
            question_id: q.id,
            question_text: q.text,
            question_type: q.question_type,
            answer: String(responses[q.id]),
          });
        }
      });
    });
    return out;
  };

  const complete = async () => {
    if (!session) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const start = new Date(session.actual_start_time);
      const duration = Math.round((new Date(now) - start) / 60000);
      const responseArr = buildResponsesArray();

      // 1. Save the Assessment (if a template exists)
      let assessmentId = session.assessment_id;
      if (template && responseArr.length > 0) {
        const assessment = await base44.entities.Assessment.create({
          customer_id: session.customer_id,
          session_id: session.id,
          patient_id: session.patient_id,
          patient_name: session.patient_name,
          employer_id: session.employer_id,
          employer_name: session.employer_name,
          therapist_id: session.therapist_id,
          therapist_name: session.therapist_name,
          template_id: template.id,
          template_name: template.name,
          template_version: template.version || 1,
          service_id: session.service_id,
          service_name: session.service_name,
          responses: responseArr,
          findings: form.findings,
          recommendations: form.recommendations,
          completed_at: now,
          completed_by_id: user.id,
          completed_by_name: user.full_name || user.display_name,
          status: "completed",
        });
        assessmentId = assessment.id;
      }

      // 2. Create the MedicalReport
      const report = await base44.entities.MedicalReport.create({
        customer_id: session.customer_id,
        session_id: session.id,
        assessment_id: assessmentId || undefined,
        patient_id: session.patient_id,
        patient_name: session.patient_name,
        employer_id: session.employer_id,
        employer_name: session.employer_name,
        service_id: session.service_id,
        service_name: session.service_name,
        therapist_id: session.therapist_id,
        therapist_name: session.therapist_name,
        assessment_date: session.actual_start_time,
        report_type: "internal_clinical",
        findings: form.findings,
        recommendations: form.recommendations,
        work_capacity: form.work_capacity,
        restrictions: form.restrictions,
        return_to_work_recommendations: form.return_to_work_plan,
        follow_up: form.follow_up_notes,
        status: "draft",
        generated_at: now,
        generated_by_id: user.id,
        generated_by_name: user.full_name || user.display_name,
      });

      // 3. Update the Session (link assessment + report, mark completed)
      await base44.entities.Session.update(session.id, {
        ...form,
        assessment_id: assessmentId || undefined,
        actual_end_time: now,
        duration_minutes: duration,
        status: "completed",
        completion_user_id: user.id,
        completion_user_name: user.full_name || user.display_name,
        completed_at: now,
      });

      // 4. Link report back to the assessment
      if (assessmentId) {
        await base44.entities.Assessment.update(assessmentId, { report_id: report.id }).catch(() => {});
      }

      // 5. Advance the appointment
      if (session.appointment_id) {
        await base44.entities.Appointment.update(session.appointment_id, { status: "session_completed" }).catch(() => {});
      }

      onCompleted?.();
    } catch (e) {
      console.error("Failed to complete session:", e);
      alert("Failed to complete session: " + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const idStatus = patient?.identity_verification_status || "pending";
  const idColor = {
    verified: "bg-emerald-500/20 text-emerald-400",
    pending: "bg-amber-500/20 text-amber-400",
    failed: "bg-rose-500/20 text-rose-400",
    manual_review: "bg-sky-500/20 text-sky-400",
  }[idStatus];

  return (
    <Dialog open={!!session} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            Session Workspace
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 text-emerald-500 animate-spin" /></div>
        ) : session && (
          <div className="space-y-5 py-2">
            {/* Session header */}
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <p className="text-white font-semibold">{session.patient_name}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Started {moment(session.actual_start_time).format("HH:mm")}</span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {durationMin} min elapsed</span>
              </div>
            </div>

            {/* Patient context */}
            {patient && (
              <Card className="bg-slate-800/40 border-slate-700">
                <CardContent className="p-4 space-y-3">
                  <p className="text-slate-300 text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Patient</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <Info label="Name" value={`${patient.first_names || ""} ${patient.surname || ""}`} />
                    <Info label="Preferred" value={patient.preferred_name} />
                    <Info label="DOB" value={patient.date_of_birth ? moment(patient.date_of_birth).format("D MMM YYYY") : null} />
                    <Info label="Gender" value={patient.gender} />
                    <Info label="Mobile" value={patient.mobile} />
                    <Info label="ID" value={patient.sa_id_number} />
                  </div>
                  <div className="flex items-center gap-2">
                    {patient.identity_verified
                      ? <Badge className="bg-emerald-500/20 text-emerald-400 text-xs"><ShieldCheck className="w-3 h-3 mr-1" /> Identity verified</Badge>
                      : <Badge className={idColor + " text-xs"}><ShieldAlert className="w-3 h-3 mr-1" /> Identity: {idStatus.replace(/_/g, " ")}</Badge>}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Employer + job context */}
            {(employer || patient?.job_title || patient?.department) && (
              <Card className="bg-slate-800/40 border-slate-700">
                <CardContent className="p-4 space-y-2">
                  <p className="text-slate-300 text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Employer</p>
                  {employer && <p className="text-white text-sm font-medium">{employer.name}</p>}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <Info label="Job title" value={patient?.job_title} />
                    <Info label="Department" value={patient?.department} />
                    <Info label="Employee no." value={patient?.employee_number} />
                    <Info label="Occupation" value={patient?.occupation} />
                    <Info label="Supervisor" value={patient?.supervisor_name} />
                    <Info label="Supervisor contact" value={patient?.supervisor_contact} />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Service */}
            {(service || session.service_name) && (
              <Card className="bg-slate-800/40 border-slate-700">
                <CardContent className="p-4 space-y-1">
                  <p className="text-slate-300 text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" /> Service</p>
                  <p className="text-white text-sm font-medium">{service?.name || session.service_name}</p>
                  {service?.description && <p className="text-slate-400 text-xs">{service.description}</p>}
                  {service?.required_documents?.length > 0 && (
                    <p className="text-slate-500 text-xs">Required docs: {service.required_documents.join(", ")}</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Prior assessments */}
            {priorAssessments.length > 0 && (
              <Card className="bg-slate-800/40 border-slate-700">
                <CardContent className="p-4 space-y-1.5">
                  <p className="text-slate-300 text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Prior Assessments ({priorAssessments.length})</p>
                  {priorAssessments.slice(0, 3).map((a) => (
                    <div key={a.id} className="flex items-center justify-between text-xs">
                      <span className="text-slate-300">{a.template_name}</span>
                      <span className="text-slate-500">{a.completed_at ? moment(a.completed_at).format("D MMM YYYY") : "In progress"}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Assessment runner */}
            <div className="pt-1">
              <AssessmentRunner template={template} responses={responses} setResponses={setResponses} />
            </div>

            {/* Clinical findings */}
            <div className="space-y-3 border-t border-slate-700 pt-4">
              <p className="text-slate-300 text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5"><ClipboardList className="w-3.5 h-3.5" /> Clinical Findings</p>
              <Field label="Findings" value={form.findings} onChange={(v) => setForm({ ...form, findings: v })} textarea />
              <Field label="Recommendations" value={form.recommendations} onChange={(v) => setForm({ ...form, recommendations: v })} textarea />
              <Field label="Work Capacity" value={form.work_capacity} onChange={(v) => setForm({ ...form, work_capacity: v })} placeholder="e.g., Fit for full duties" />
              <Field label="Restrictions" value={form.restrictions} onChange={(v) => setForm({ ...form, restrictions: v })} placeholder="e.g., No lifting >10kg for 2 weeks" />
              <Field label="Return to Work Plan" value={form.return_to_work_plan} onChange={(v) => setForm({ ...form, return_to_work_plan: v })} textarea />
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.follow_up_required} onChange={(e) => setForm({ ...form, follow_up_required: e.target.checked })} className="accent-emerald-500" />
                <span className="text-slate-300 text-sm">Follow-up required</span>
              </label>
              {form.follow_up_required && (
                <Field label="Follow-up Notes" value={form.follow_up_notes} onChange={(v) => setForm({ ...form, follow_up_notes: v })} />
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-slate-700 text-slate-300">Close</Button>
          <Button onClick={complete} disabled={saving || loading} className="bg-emerald-500 hover:bg-emerald-600">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
            Complete &amp; Generate Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-slate-500 text-xs">{label}</p>
      <p className="text-slate-200 text-sm">{value}</p>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, textarea }) {
  return (
    <div>
      <Label className="text-slate-300 text-sm">{label}</Label>
      {textarea ? (
        <Textarea value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className="bg-slate-800 border-slate-700 text-white mt-1 min-h-[64px]" />
      ) : (
        <Input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className="bg-slate-800 border-slate-700 text-white mt-1 h-9" />
      )}
    </div>
  );
}