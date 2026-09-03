import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardList, Plus, Users, FileText,
  Calendar, Activity, CheckCircle2, Loader2, ShieldAlert
} from "lucide-react";
import { Link } from "react-router-dom";
import { useBranding } from "@/hooks/useBranding";
import AttendanceBrandingHeader from "@/components/attendance/AttendanceBrandingHeader";
import NewAttendanceWizard from "@/components/attendance/NewAttendanceWizard";
import { attendanceCall } from "@/lib/attendanceApi";
import { todayISO } from "@/lib/attendanceDropdowns";

export default function AttendanceDashboard() {
  const queryClient = useQueryClient();
  const [showWizard, setShowWizard] = useState(false);
  const [successInfo, setSuccessInfo] = useState(null);

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

  const handleSuccess = (info) => {
    setShowWizard(false);
    setSuccessInfo(info);
    queryClient.invalidateQueries(["att_today"]);
    queryClient.invalidateQueries(["att_month_count"]);
    queryClient.invalidateQueries(["att_workers_count"]);
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
          <h2 className="text-white text-2xl font-bold">Attendance Registered</h2>
          <p className="text-slate-300">{successInfo.workerName}</p>
          <p className="text-slate-400 text-sm">Registered at {successInfo.attendanceTime}</p>
          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={() => { setSuccessInfo(null); setShowWizard(true); }} className="w-full h-12 bg-sky-600 hover:bg-sky-700">
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

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Today", value: todayRecords.length, icon: Calendar, color: "sky" },
          { label: "This Month", value: monthRecords.length, icon: Activity, color: "emerald" },
          { label: "Workers / Patients", value: workerCount, icon: Users, color: "violet" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className={`bg-slate-800/60 rounded-2xl border border-slate-700 p-4 text-center`}>
            <Icon className={`w-6 h-6 mx-auto mb-1 text-${color}-400`} />
            <p className="text-white text-2xl font-bold">{value}</p>
            <p className="text-slate-400 text-xs mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Primary Action */}
      <Button onClick={() => setShowWizard(true)}
        className="w-full h-16 text-lg font-bold"
        style={{ background: branding?.primary_color ? `linear-gradient(135deg, ${branding.primary_color}, ${branding.accent_color || branding.primary_color}cc)` : undefined }}>
        <Plus className="w-6 h-6 mr-3" /> + New Attendance
      </Button>

      {/* Quick nav */}
      <div className="grid grid-cols-3 gap-3">
        <Link to="/AttendanceRecords">
          <button className="w-full bg-slate-800/60 rounded-xl border border-slate-700 p-4 text-center hover:border-slate-500 active:scale-95 transition">
            <ClipboardList className="w-6 h-6 text-slate-400 mx-auto mb-1.5" />
            <p className="text-white text-xs font-medium">Records</p>
          </button>
        </Link>
        <Link to="/AttendanceWorkers">
          <button className="w-full bg-slate-800/60 rounded-xl border border-slate-700 p-4 text-center hover:border-slate-500 active:scale-95 transition">
            <Users className="w-6 h-6 text-slate-400 mx-auto mb-1.5" />
            <p className="text-white text-xs font-medium">Workers</p>
          </button>
        </Link>
        <Link to="/AttendanceReports">
          <button className="w-full bg-slate-800/60 rounded-xl border border-slate-700 p-4 text-center hover:border-slate-500 active:scale-95 transition">
            <FileText className="w-6 h-6 text-slate-400 mx-auto mb-1.5" />
            <p className="text-white text-xs font-medium">Reports</p>
          </button>
        </Link>
      </div>

      {/* Recent attendance */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold">Recent Attendance — Today</h3>
          <Link to="/AttendanceRecords" className="text-sky-400 text-sm">View all →</Link>
        </div>
        {recent.length === 0 ? (
          <div className="bg-slate-800/40 rounded-xl border border-slate-700 p-8 text-center">
            <ClipboardList className="w-10 h-10 text-slate-600 mx-auto mb-2" />
            <p className="text-slate-400 text-sm">No attendance registered yet today.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recent.map(r => (
              <div key={r.id} className="bg-slate-800/60 rounded-xl border border-slate-700 px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4 text-slate-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">
                    {r.surname_snapshot}{r.initials_snapshot ? `, ${r.initials_snapshot}` : ""}
                  </p>
                  <p className="text-slate-400 text-xs truncate">{r.company_snapshot || "—"} · {r.medical_centre || "—"}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-slate-300 text-xs">{r.attendance_time}</p>
                  <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400">{r.assessment_type || "—"}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}