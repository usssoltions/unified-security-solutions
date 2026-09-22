import React, { useState, useEffect } from "react";
import { medicalApi } from "@/lib/medicalApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Save, Send, CheckCircle, Share2, Lock } from "lucide-react";
import moment from "moment";

// Report detail / workflow dialog. EVERY action routes through the
// medicalAccess gateway, which re-verifies role + tenant + ownership
// server-side:
//   Save / Submit for approval → clinical (record owner) only
//   Approve                   → practice admin only
//   Release to employer       → practice admin only, audited with the
//                                recipient's name; only approved reports.
export default function ReportDetailDialog({ report, isAdmin, isClinical, onClose, onChanged }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [shareName, setShareName] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setForm({
      findings: report?.findings || "",
      recommendations: report?.recommendations || "",
      work_capacity: report?.work_capacity || "",
      restrictions: report?.restrictions || "",
      return_to_work_recommendations: report?.return_to_work_recommendations || "",
      accommodation_recommendations: report?.accommodation_recommendations || "",
      follow_up: report?.follow_up || "",
    });
    setShareName("");
    setReturnReason("");
    setError("");
  }, [report?.id]);

  if (!report || !form) return null;

  const isReleased = report.shared_with_employer === true || report.status === "released";
  const editable = !isReleased && ["draft", "pending_approval"].includes(report.status);

  const run = async (fn) => {
    setSaving(true);
    setError("");
    try {
      const res = await fn();
      onChanged?.(res?.record || report);
    } catch (e) {
      setError(e?.message || "Action failed.");
    } finally {
      setSaving(false);
    }
  };

  const saveFields = (extra = {}, reason) => run(() => medicalApi.updateReport(report.id, { ...form, ...extra }, reason));

  const release = () => {
    if (!shareName.trim()) {
      setError("A recipient name is required for the release audit.");
      return;
    }
    run(() => medicalApi.shareReport(report.id, shareName.trim()));
  };

  const returnForChanges = () => {
    if (!returnReason.trim()) {
      setError("A reason is required to return a report.");
      return;
    }
    run(() => medicalApi.updateReport(report.id, { status: "draft" }, returnReason.trim()));
  };

  return (
    <Dialog open={!!report} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white flex flex-wrap items-center gap-2">
            Report {report.report_number}
            <StatusBadge report={report} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Record linkage — a report is always tied to its patient record */}
          <div className="p-3 bg-slate-800/50 border border-slate-700 rounded-lg grid grid-cols-2 gap-2 text-sm">
            <Meta label="Patient" value={report.patient_name} />
            <Meta label="Employer" value={report.employer_name} />
            <Meta label="Service" value={report.service_name} />
            <Meta label="Therapist" value={report.therapist_name} />
            <Meta label="Assessment date" value={report.assessment_date ? moment(report.assessment_date).format("D MMM YYYY") : null} />
            <Meta label="Generated" value={report.generated_at ? moment(report.generated_at).format("D MMM YYYY, HH:mm") : null} />
          </div>

          <div className="space-y-3">
            <Field label="Findings" value={form.findings} onChange={(v) => setForm({ ...form, findings: v })} disabled={!editable} textarea />
            <Field label="Recommendations" value={form.recommendations} onChange={(v) => setForm({ ...form, recommendations: v })} disabled={!editable} textarea />
            <Field label="Work Capacity" value={form.work_capacity} onChange={(v) => setForm({ ...form, work_capacity: v })} disabled={!editable} placeholder="e.g., Fit for full duties" />
            <Field label="Restrictions" value={form.restrictions} onChange={(v) => setForm({ ...form, restrictions: v })} disabled={!editable} placeholder="e.g., No lifting >10kg for 2 weeks" />
            <Field label="Return to Work Recommendations" value={form.return_to_work_recommendations} onChange={(v) => setForm({ ...form, return_to_work_recommendations: v })} disabled={!editable} textarea />
            <Field label="Accommodation Recommendations" value={form.accommodation_recommendations} onChange={(v) => setForm({ ...form, accommodation_recommendations: v })} disabled={!editable} textarea />
            <Field label="Follow-up" value={form.follow_up} onChange={(v) => setForm({ ...form, follow_up: v })} disabled={!editable} />
          </div>

          {!editable && !isReleased && (
            <p className="text-slate-500 text-xs flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" /> This report is locked — only draft and pending reports can be edited.
            </p>
          )}

          {/* Release audit trail (employer-facing transparency) */}
          {isReleased && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs space-y-1">
              <p className="text-emerald-400 font-medium flex items-center gap-1.5">
                <Share2 className="w-3.5 h-3.5" /> Released to employer
              </p>
              <p className="text-slate-300">
                Recipient: {report.shared_recipient_name || "—"} • By {report.shared_by_name || "—"}
                {report.shared_at ? ` • ${moment(report.shared_at).format("D MMM YYYY, HH:mm")}` : ""}
              </p>
            </div>
          )}

          {/* Release control — practice admin only, approved reports only */}
          {report.status === "approved" && !isReleased && isAdmin && (
            <div className="p-3 bg-slate-800/50 border border-slate-700 rounded-lg space-y-2">
              <p className="text-slate-300 text-xs font-semibold uppercase tracking-wide">Release to Employer</p>
              {report.employer_id ? (
                <>
                  <Input
                    value={shareName}
                    onChange={(e) => setShareName(e.target.value)}
                    placeholder="Recipient name (recorded in the release audit)"
                    className="bg-slate-800 border-slate-700 text-white h-9"
                    disabled={saving}
                  />
                  <Button size="sm" onClick={release} disabled={saving} className="bg-emerald-500 hover:bg-emerald-600">
                    {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5 mr-1.5" />}
                    Release Report
                  </Button>
                </>
              ) : (
                <p className="text-slate-500 text-xs">This patient has no employer linked — there is no employer to release to.</p>
              )}
            </div>
          )}

          {/* Return-for-changes control — practice admin only, reason required */}
          {report.status === "pending_approval" && isAdmin && (
            <div className="p-3 bg-slate-800/50 border border-slate-700 rounded-lg space-y-2">
              <p className="text-slate-300 text-xs font-semibold uppercase tracking-wide">Return for Changes</p>
              <Input
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="Reason (required — recorded in the audit trail)"
                className="bg-slate-800 border-slate-700 text-white h-9"
                disabled={saving}
              />
              <Button size="sm" variant="outline" onClick={returnForChanges} disabled={saving}
                className="border-amber-600/50 text-amber-400 hover:bg-amber-500/10">
                Return to Draft
              </Button>
            </div>
          )}

          {error && <p className="text-rose-400 text-xs">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-slate-700 text-slate-300">Close</Button>
          {editable && isClinical && (
            <Button variant="secondary" onClick={() => saveFields()} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save Changes
            </Button>
          )}
          {report.status === "draft" && !isReleased && isClinical && (
            <Button onClick={() => saveFields({ status: "pending_approval" })} disabled={saving} className="bg-emerald-500 hover:bg-emerald-600">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              Submit for Approval
            </Button>
          )}
          {report.status === "pending_approval" && isAdmin && (
            <Button onClick={() => saveFields({ status: "approved" })} disabled={saving} className="bg-emerald-500 hover:bg-emerald-600">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
              Approve
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ report }) {
  const isReleased = report.shared_with_employer === true || report.status === "released";
  const colors = {
    draft: "bg-slate-500/20 text-slate-400",
    pending_approval: "bg-amber-500/20 text-amber-400",
    approved: "bg-sky-500/20 text-sky-400",
    released: "bg-emerald-500/20 text-emerald-400",
    archived: "bg-slate-500/20 text-slate-400",
  };
  const label = isReleased ? "released" : (report.status || "draft");
  return <Badge className={`${colors[label] || colors.draft} text-xs`}>{label.replace(/_/g, " ")}</Badge>;
}

function Meta({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-slate-500 text-xs">{label}</p>
      <p className="text-slate-200">{value}</p>
    </div>
  );
}

function Field({ label, value, onChange, disabled, placeholder, textarea }) {
  return (
    <div>
      <Label className="text-slate-300 text-sm">{label}</Label>
      {textarea ? (
        <Textarea
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="bg-slate-800 border-slate-700 text-white mt-1 min-h-[64px] disabled:opacity-60"
        />
      ) : (
        <Input
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="bg-slate-800 border-slate-700 text-white mt-1 h-9 disabled:opacity-60"
        />
      )}
    </div>
  );
}