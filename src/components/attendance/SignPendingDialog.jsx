/**
 * Capture Signature dialog for a PENDING attendance visit (deferred save) or
 * a legacy unsigned visit flagged for review.
 *
 * Shows the person's name, ID and the ORIGINAL visit details for confirmation,
 * reuses AttendanceSignaturePad, and posts the signature against that EXACT
 * record through the attendanceAccess gateway (sign_pending). The server
 * re-validates scope, the pending state, the confirmed identity and that no
 * signature exists yet — an existing signature is never replaced and no new
 * visit is ever created.
 */
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, Clock, X } from "lucide-react";
import AttendanceSignaturePad from "./AttendanceSignaturePad";
import { attendanceCall } from "@/lib/attendanceApi";

export default function SignPendingDialog({ record, onClose, onSigned }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleAccept = async (dataUrl) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await attendanceCall("sign_pending", {
        record_id: record.id,
        signature_data_url: dataUrl,
        confirm_id_number: record.id_number_snapshot || "",
      });
      if (res?.already_signed) {
        setError("This visit was already signed. The lists will refresh.");
      } else {
        onSigned(record);
      }
    } catch (e) {
      setError(e?.message || "Failed to save the signature. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const fmtDate = (d) => {
    const [y, m, dd] = String(d || "").split("-");
    return dd ? `${dd}/${m}/${y}` : "—";
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-[var(--surface-card)] w-full max-w-lg rounded-2xl border border-[var(--border-default)] p-4 space-y-4 my-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-300" />
            <h3 className="text-white font-semibold">Capture Signature</h3>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} className="h-9 w-9 text-slate-400">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Original visit details — confirmed BEFORE the signature is taken */}
        <div className="bg-[var(--surface-raised)] rounded-xl border border-[var(--border-default)] divide-y divide-slate-700/50">
          {[
            ["Person", `${record.surname_snapshot || ""}${record.initials_snapshot ? ", " + record.initials_snapshot : ""}`],
            ["ID / Passport Number", record.id_number_snapshot || "—"],
            ["Visit Date", fmtDate(record.attendance_date)],
            ["Visit Time", record.attendance_time || "—"],
            ["Medical Centre", record.medical_centre || "—"],
            ["Assessment Type", record.assessment_type || "—"],
          ].map(([label, val]) => (
            <div key={label} className="flex items-start gap-3 px-3 py-2">
              <span className="text-slate-400 text-xs w-40 shrink-0">{label}</span>
              <span className="text-white text-sm font-medium flex-1 break-words">{val}</span>
            </div>
          ))}
        </div>
        <p className="text-slate-400 text-xs">
          Verify this is the correct person and visit before signing. The signature is attached to THIS visit only — the original visit date and time are preserved and no new visit is created.
        </p>

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 flex items-start gap-2 text-rose-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {saving ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-7 h-7 text-slate-400 animate-spin" />
          </div>
        ) : (
          <AttendanceSignaturePad onAccept={handleAccept} onCancel={onClose} />
        )}
      </div>
    </div>
  );
}