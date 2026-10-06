import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardList, Plus, Users, FileText,
  Calendar, Activity, CheckCircle2, Loader2, ShieldAlert, Clock, PenTool
} from "lucide-react";
import { Link } from "react-router-dom";
import { useBranding } from "@/hooks/useBranding";
import AttendanceBrandingHeader from "@/components/attendance/AttendanceBrandingHeader";
import NewAttendanceWizard from "@/components/attendance/NewAttendanceWizard";
import SignPendingDialog from "@/components/attendance/SignPendingDialog";
import { attendanceCall } from "@/lib/attendanceApi";
import { todayISO } from "@/lib/attendanceDropdowns";

export default function AttendanceDashboard() {
  const queryClient = useQueryClient();
  const [showWizard, setShowWizard] = useState(false);
  const [successInfo, setSuccessInfo] = useState(null);
  const [signingRecord, setSigningRecord] = useState(null);

  // Authoritative tenant context — the attendanceAccess gateway resolves the
  // caller's tenant server-side from their User record (no client trust, no
  // JWT custom claims) and enforces the ATTENDANCE_REGISTER module licence.
  const { data: ctx } = useQuery({
    queryKey: ["att_context"],
    queryFn: () => attendanceCall("get_context"),
    staleTime: 60000,
  });

  const { data: branding } = useBranding(ctx?.customer_id, ctx?.reseller_id);

  const { data: dropdowns = { medicalCentres: [], assessmentTypes: [] } } = useQuery({
    queryKey: ["att_options"],
    queryFn: async () => {
      const r = await attendanceCall("list_options");
      return { medicalCentres: r.medicalCentres || [], assessmentTypes: r.assessmentTypes || [] };
    },
    enabled: !!ctx?.authorized, staleTime: 60000,
  });

  const today = todayISO();
  const monthStart = today.slice(0, 8) + "01";

  const { data: todayRecords = [] } = useQuery({
    queryKey: ["att_today", today],
    queryFn: () => attendanceCall("list_records", { from: today, to: today }).then(r => r.records || []),
    enabled: !!ctx?.authorized, staleTime: 30000,
  });

  const { data: monthRecords = [] } = useQuery({
    queryKey: ["att_month_count", monthStart],
    queryFn: () => attendanceCall("list_records", { from: monthStart, to: today }).then(r => r.records || []),
    enabled: !!ctx?.authorized, staleTime: 60000,
  });

  const { data: workerCount = 0 } = useQuery({
    queryKey: ["att_workers_count"],
    queryFn: () => attendanceCall("list_workers", { active_only: true }).then(r => (r.workers || []).length),
    enabled: !!ctx?.authorized, staleTime: 120000,
  });

  const recent = todayRecords.slice(0, 8);

  // Awaiting Signatures — outstanding visits from ANY day (deferred saves
  // plus earlier unsigned records flagged for review), date-independent
  // server-side query. Refreshed on save, signing and every return to the
  // app (React Query refetches stale queries when the app regains focus).
  const { data: pendingData } = useQuery({
    queryKey: ["att_pending"],
    queryFn: () => attendanceCall("list_pending"),
    enabled: !!ctx?.authorized, staleTime: 30000,
  });
  const pendingRecords = pendingData?.records || [];
  const awaitingList = pendingRecords.slice(0, 5);

  const handleSuccess = (info) => {
    setShowWizard(false);
    setSuccessInfo(info);
    queryClient.invalidateQueries({ queryKey: ["att_today"] });
    queryClient.invalidateQueries({ queryKey: ["att_month_count"] });
    queryClient.invalidateQueries({ queryKey: ["att_workers_count"] });
    queryClient.invalidateQueries({ queryKey: ["att_pending"] });
  };

  // A deferred visit was signed — refresh every attendance surface.
  const handleSigned = (r) => {
    setSigningRecord(null);
    setSuccessInfo({
      workerName: `${r.surname_snapshot || ""}${r.initials_snapshot ? ", " + r.initials_snapshot : ""}`,
      attendanceTime: r.attendance_time || "",
      signed: true,
    });
    queryClient.invalidateQueries({ queryKey: ["att_pending"] });
    queryClient.invalidateQueries({ queryKey: ["att_today"] });
    queryClient.invalidateQueries({ queryKey: ["att_month_count"] });
    queryClient.invalidateQueries({ queryKey: ["att_records"] });
  };

  const fmtDate = (d) => {
    const [y, m, dd] = String(d || "").split("-");
    return dd ? `${dd}/${m}/${y}` : "—";
  };

  if (showWizard) {
    return (
      <div className="min-h-screen bg-slate-950 p-4">
        <Button variant="ghost" onClick={() => setShowWizard(false)} className="mb-4 text-slate-400">
          ← Back to Dashboard
        </Button>
        <NewAttendanceWizard
          user={ctx}
          customerId={ctx?.customer_id}
          medicalCentres={dropdowns.medicalCentres}
          assessmentTypes={dropdowns.assessmentTypes}
          deferredEnabled={!!ctx?.deferred_signatures_enabled}
          onSuccess={handleSuccess}
          onCancel={() => setShowWizard(false)}
        />
      </div>
    );
  }

  if (successInfo) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-800/80 rounded-3xl border-2 border-emerald-500/40 p-8 text-center space-y-5">
          <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
          </div>
          <h2 className="text-white text-2xl font-bold">{successInfo.signed ? "Signature Captured" : "Attendance Registered"}</h2>
          <p className="text-slate-300">{successInfo.workerName}</p>
          {successInfo.signed ? (
            <p className="text-slate-400 text-sm">Signature captured against the original visit at {successInfo.attendanceTime || "—"}</p>
          ) : (
            <p className="text-slate-400 text-sm">Registered at {successInfo.attendanceTime}</p>
          )}
          {successInfo.signatureStatus === "pending" && (
            <p className="text-amber-300 text-sm">Saved without a signature — Awaiting Signature. Capture it from the dashboard or records at any time.</p>
          )}
          {successInfo.photoSummary && <p className="text-slate-300 text-sm">{successInfo.photoSummary}</p>}
          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={() => { setSuccessInfo(null); setShowWizard(true); }} variant="brand" className="w-full h-12">
              <Plus className="w-4 h-4 mr-2" /> Register Another
            </Button>
            <Link to={`/AttendanceRecords`}>
              <Button variant="outline" className="w-full h-12 border-slate-600 text-slate-300">
                View Attendance Records
              </Button>
            </Link>
            <Button variant="ghost" onClick={() => setSuccessInfo(null)} className="w-full text-slate-500">
              Return to Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
      </div>
    );
  }

  if (!ctx.authorized) {
    return (
      <div className="p-4 max-w-md mx-auto text-center py-16">
        <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <ShieldAlert className="w-8 h-8 text-slate-500" />
        </div>
        <h2 className="text-white text-lg font-semibold mb-2">Attendance Register unavailable</h2>
        <p className="text-slate-400 text-sm">{ctx.reason}</p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-5">
      <AttendanceBrandingHeader branding={branding} subtitle="Digital Attendance Register" />

      {/* Awaiting Signatures — prominent counter + outstanding visits from
          ANY day; each opens the signature capture dialog */}
      {pendingRecords.length > 0 && (
        <div className="bg-amber-500/10 border-2 border-amber-500/40 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-300" />
            <h3 className="text-amber-300 font-semibold">Awaiting Signatures</h3>
            <Badge className="bg-amber-500 text-white text-xs ml-auto">{pendingRecords.length}</Badge>
          </div>
          <div className="space-y-2">
            {awaitingList.map(r => (
              <div key={r.id} className="bg-[var(--surface-card)] rounded-xl border border-[var(--border-default)] px-3 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">
                    {r.surname_snapshot}{r.initials_snapshot ? `, ${r.initials_snapshot}` : ""}
                  </p>
                  <p className="text-slate-400 text-xs truncate">{r.id_number_snapshot} · {fmtDate(r.attendance_date)} {r.attendance_time}</p>
                </div>
                {r.signature_status === "needs_review" && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300 shrink-0">Review</Badge>
                )}
                <Button size="sm" variant="brand" onClick={() => setSigningRecord(r)} className="h-10 shrink-0 active:scale-95 transition">
                  <PenTool className="w-3.5 h-3.5 mr-1.5" /> Sign
                </Button>
              </div>
            ))}
          </div>
          {pendingRecords.length > awaitingList.length && (
            <Link to="/AttendanceRecords?pending=1" className="block text-amber-300 text-sm brand-focus">
              View all {pendingRecords.length} in Records →
            </Link>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Today", value: todayRecords.length, icon: Calendar, iconClass: "text-[var(--brand-link)]" },
          { label: "This Month", value: monthRecords.length, icon: Activity, iconClass: "text-[var(--brand-accent)]" },
          { label: "Workers / Patients", value: workerCount, icon: Users, iconClass: "text-[var(--brand-link)]" },
        ].map(({ label, value, icon: Icon, iconClass }) => (
          <div key={label} className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] p-4 text-center">
            <Icon className={`w-6 h-6 mx-auto mb-1 ${iconClass}`} />
            <p className="text-white text-2xl font-bold">{value}</p>
            <p className="text-slate-400 text-xs mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Primary Action — solid brand primary (brandPrimaryAction token) */}
      <Button onClick={() => setShowWizard(true)} variant="brand"
        className="w-full h-16 text-lg font-bold">
        <Plus className="w-6 h-6 mr-3" /> + New Attendance
      </Button>

      {/* Quick nav */}
      <div className="grid grid-cols-3 gap-3">
        <Link to="/AttendanceRecords">
          <button className="w-full bg-[var(--surface-card)] rounded-xl border border-[var(--border-default)] p-4 text-center hover:border-[var(--brand-primary)] active:scale-95 transition">
            <ClipboardList className="w-6 h-6 text-slate-400 mx-auto mb-1.5" />
            <p className="text-white text-xs font-medium">Records</p>
          </button>
        </Link>
        <Link to="/AttendanceWorkers">
          <button className="w-full bg-[var(--surface-card)] rounded-xl border border-[var(--border-default)] p-4 text-center hover:border-[var(--brand-primary)] active:scale-95 transition">
            <Users className="w-6 h-6 text-slate-400 mx-auto mb-1.5" />
            <p className="text-white text-xs font-medium">Workers</p>
          </button>
        </Link>
        <Link to="/AttendanceReports">
          <button className="w-full bg-[var(--surface-card)] rounded-xl border border-[var(--border-default)] p-4 text-center hover:border-[var(--brand-primary)] active:scale-95 transition">
            <FileText className="w-6 h-6 text-slate-400 mx-auto mb-1.5" />
            <p className="text-white text-xs font-medium">Reports</p>
          </button>
        </Link>
      </div>

      {/* Recent attendance */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold">Recent Attendance — Today</h3>
          <Link to="/AttendanceRecords" className="text-[var(--brand-link)] text-sm brand-focus">View all →</Link>
        </div>
        {recent.length === 0 ? (
          <div className="bg-[var(--surface-raised)] rounded-xl border border-[var(--border-default)] p-8 text-center">
            <ClipboardList className="w-10 h-10 text-slate-600 mx-auto mb-2" />
            <p className="text-slate-400 text-sm">No attendance registered yet today.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recent.map(r => (
              <Link key={r.id} to={`/AttendanceRecords?record=${encodeURIComponent(r.id)}`}
                className="bg-[var(--surface-card)] rounded-xl border border-[var(--border-default)] px-4 py-3 flex items-center gap-3 min-h-[56px] hover:bg-[var(--surface-raised)] active:scale-[0.99] transition brand-focus">
                <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4 text-slate-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium break-words">
                    {r.surname_snapshot}{r.initials_snapshot ? `, ${r.initials_snapshot}` : ""}
                  </p>
                  <p className="text-slate-400 text-xs truncate">{r.company_snapshot || "—"} · {r.medical_centre || "—"}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-slate-300 text-xs">{r.attendance_time}</p>
                  <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400">{r.assessment_type || "—"}</Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {signingRecord && (
        <SignPendingDialog record={signingRecord} onClose={() => setSigningRecord(null)} onSigned={handleSigned} />
      )}
    </div>
  );
}