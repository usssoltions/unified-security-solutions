import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { X, Loader2, Pencil, Download } from "lucide-react";
import { attendanceCall } from "@/lib/attendanceApi";
import { idTypeLabel } from "@/lib/attendanceDropdowns";
import IdPhotoPair from "./IdPhotoPair";
import AttendanceRecordEditForm from "./AttendanceRecordEditForm";
import EditHistoryList from "./EditHistoryList";

const fmtDate = (d) => (d ? d.split("-").reverse().join("/") : "—");

/** Full-screen detail view for one attendance record (+ authorised edit). */
export default function AttendanceRecordDetail({ recordId, medicalCentres, assessmentTypes, onClose, onDownloadPdf }) {
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["att_record", recordId],
    queryFn: () => attendanceCall("get_record", { record_id: recordId }),
  });
  const r = data?.record;

  const handleSaved = () => {
    setEditing(false);
    queryClient.invalidateQueries({ queryKey: ["att_record", recordId] });
    queryClient.invalidateQueries({ queryKey: ["att_records"] });
    queryClient.invalidateQueries({ queryKey: ["att_records_all"] });
  };

  const rows = r ? [
    ["Surname, Initials", `${r.surname_snapshot || ""}${r.initials_snapshot ? ", " + r.initials_snapshot : ""}`],
    ["ID / Passport Number", r.id_number_snapshot], ["Document Type", idTypeLabel(r.id_type_snapshot)],
    ["Company / Customer", r.company_snapshot], ["Job Description", r.job_description_snapshot],
    ["Cellphone Number", r.cellphone_snapshot], ["Date", fmtDate(r.attendance_date)], ["Time", r.attendance_time],
    ["Medical Centre", r.medical_centre], ["Assessment Type", r.assessment_type],
    ["Additional Information", r.additional_information], ["Captured By", r.captured_by_name],
  ] : [];

  return (
    <div className="fixed inset-0 z-[60] bg-[var(--surface-base)] overflow-y-auto" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="max-w-2xl mx-auto p-4 space-y-4 pb-10">
        <div className="flex items-center gap-2">
          <h2 className="text-white text-lg font-bold flex-1">{editing ? "Edit Attendance Record" : "Attendance Record"}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400 h-11 w-11"><X className="w-5 h-5" /></Button>
        </div>
        {isLoading && <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 text-slate-500 animate-spin" /></div>}
        {error && <p className="text-rose-400 text-sm">{error.message}</p>}
        {r && editing && (
          <AttendanceRecordEditForm record={r} medicalCentres={medicalCentres} assessmentTypes={assessmentTypes}
            onSaved={handleSaved} onCancel={() => setEditing(false)} />
        )}
        {r && !editing && (
          <>
            <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] divide-y divide-slate-700/50">
              {rows.map(([label, val]) => (
                <div key={label} className="flex gap-3 px-4 py-2.5">
                  <span className="text-slate-400 text-sm w-36 shrink-0">{label}</span>
                  <span className="text-white text-sm break-words min-w-0 flex-1">{val || "—"}</span>
                </div>
              ))}
            </div>
            <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] p-4">
              <p className="text-slate-400 text-xs mb-2">Signature</p>
              {r.signature_data_url
                ? <img src={r.signature_data_url} alt="Signature" className="h-20 bg-white rounded-lg border border-slate-600" />
                : <p className="text-slate-500 text-sm">No signature on record</p>}
            </div>
            <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] p-4">
              <IdPhotoPair front={r.id_photo_front_url} back={r.id_photo_back_url} source={r.id_photo_source}
                capturedAt={r.id_photo_captured_at} capturedBy={r.id_photo_captured_by_name} />
              {!r.id_photo_front_url && data.worker?.id_front_url && (
                <p className="text-slate-400 text-xs mt-2">The worker profile has photos on file — use Edit to attach them to this visit if they are the document used.</p>
              )}
            </div>
            <EditHistoryList history={r.edit_history} />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onDownloadPdf(r)} className="flex-1 h-12 border-[var(--border-default)] text-slate-200">
                <Download className="w-4 h-4 mr-2" /> PDF
              </Button>
              {data.can_edit && (
                <Button variant="brand" onClick={() => setEditing(true)} className="flex-1 h-12">
                  <Pencil className="w-4 h-4 mr-2" /> Edit
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}