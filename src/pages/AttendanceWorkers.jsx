import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Users, Search, Download, Loader2, User,
  Calendar, ChevronDown, ChevronUp, ShieldAlert, UserPlus, Pencil
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import AddWorkerFlow from "@/components/attendance/AddWorkerFlow";
import { Link } from "react-router-dom";
import { generateWorkerIdPdf, downloadBlob } from "@/lib/attendancePdf";
import { useBranding } from "@/hooks/useBranding";
import { attendanceCall } from "@/lib/attendanceApi";
import { idTypeLabel, formatDisplayName } from "@/lib/attendanceDropdowns";

export default function AttendanceWorkers() {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [flow, setFlow] = useState(null); // null | { mode: "create" } | { mode: "edit", worker }
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Profile created/updated/existing-selected — refresh the directory,
  // reveal the profile and confirm with a toast.
  const handleFlowDone = (worker, kind) => {
    const wasEdit = flow?.mode === "edit";
    setFlow(null);
    queryClient.invalidateQueries({ queryKey: ["att_workers"] });
    if (worker?.id) setExpanded(worker.id);
    toast({
      title: kind === "existing" ? "Existing profile opened"
        : wasEdit ? "Profile updated" : "Worker / Patient registered",
      description: worker ? `${formatDisplayName(worker)} · ${worker.id_number}` : undefined,
    });
  };

  const { data: ctx } = useQuery({
    queryKey: ["att_context"],
    queryFn: () => attendanceCall("get_context"),
    staleTime: 60000,
  });
  const { data: branding } = useBranding(ctx?.customer_id, ctx?.reseller_id);

  const { data: workers = [], isLoading } = useQuery({
    queryKey: ["att_workers"],
    queryFn: () => attendanceCall("list_workers").then(r => r.workers || []),
    enabled: !!ctx?.authorized, staleTime: 30000,
  });

  const { data: allRecords = [] } = useQuery({
    queryKey: ["att_records_all"],
    queryFn: () => attendanceCall("list_records").then(r => r.records || []),
    enabled: !!ctx?.authorized, staleTime: 60000,
  });

  const recordsByWorker = React.useMemo(() => {
    const m = {};
    allRecords.forEach(r => { if (!m[r.worker_id]) m[r.worker_id] = []; m[r.worker_id].push(r); });
    return m;
  }, [allRecords]);

  const filtered = workers.filter(w => {
    const q = search.toLowerCase();
    if (!q) return true;
    return [w.surname, w.initials, w.first_names, w.id_number, w.company, w.cellphone]
      .some(v => (v || "").toLowerCase().includes(q));
  });

  const handleWorkerPdf = (worker) => {
    try {
      const blob = generateWorkerIdPdf(worker, branding);
      downloadBlob(blob, `id_doc_${worker.id_number}.pdf`);
    } catch (e) { alert("PDF generation failed."); }
  };

  const formatDate = d => d ? new Date(d).toLocaleDateString("en-ZA") : "—";

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

  // The profile creation / edit flow takes over the page until done or cancelled.
  if (flow) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <AddWorkerFlow
          mode={flow.mode}
          worker={flow.worker}
          onDone={handleFlowDone}
          onCancel={() => setFlow(null)}
        />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <Link to="/AttendanceDashboard" className="text-slate-400 text-sm hover:text-white">← Dashboard</Link>
        <h1 className="text-white text-xl font-bold">Workers / Patients</h1>
        <span className="text-slate-400 text-sm">{filtered.length}</span>
        <Button
          onClick={() => setFlow({ mode: "create" })}
          variant="brand" className="ml-auto h-10 px-4"
        >
          <UserPlus className="w-4 h-4 mr-1.5" /> Add Worker / Patient
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, ID, company, cell…"
          className="bg-slate-900 border-slate-700 text-white pl-9" />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 px-4">
          <Users className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          {workers.length === 0 ? (
            <>
              <p className="text-white font-semibold">No workers / patients registered yet.</p>
              <p className="text-slate-400 text-sm mt-1 mb-5">Register your first worker / patient to start capturing attendance.</p>
              <Button onClick={() => setFlow({ mode: "create" })} variant="brand" className="h-11 px-5">
                <UserPlus className="w-4 h-4 mr-1.5" /> Register Worker / Patient
              </Button>
            </>
          ) : (
            <p className="text-slate-400">No workers / patients match your search.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(w => {
            const recs = (recordsByWorker[w.id] || []).sort((a, b) =>
              (b.attendance_timestamp || "").localeCompare(a.attendance_timestamp || ""));
            const isOpen = expanded === w.id;
            return (
              <div key={w.id} className="bg-[var(--surface-card)] rounded-xl border border-[var(--border-default)] overflow-hidden">
                <button className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-slate-800 transition"
                  onClick={() => setExpanded(isOpen ? null : w.id)}>
                  <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                    <User className="w-5 h-5 text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm">{formatDisplayName(w)}</p>
                    <p className="text-slate-400 text-xs mt-0.5">{w.id_number} · {idTypeLabel(w.id_type)}</p>
                    <p className="text-slate-400 text-xs">{w.company || "—"}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400">{recs.length} visits</Badge>
                    {isOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-700 p-4 space-y-4">
                    {/* Profile details */}
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {[["First Names", w.first_names], ["Cellphone", w.cellphone], ["Job Description", w.job_description]].map(([label, val]) => (
                        <div key={label}>
                          <p className="text-slate-500 text-xs">{label}</p>
                          <p className="text-slate-200">{val || "—"}</p>
                        </div>
                      ))}
                      <div>
                        <p className="text-slate-500 text-xs">Profile Created</p>
                        <p className="text-slate-200">{formatDate(w.created_date)}</p>
                      </div>
                    </div>
                    <Button variant="outline" onClick={() => setFlow({ mode: "edit", worker: w })}
                      className="border-slate-600 text-slate-300 hover:bg-slate-700 h-11">
                      <Pencil className="w-4 h-4 mr-1.5" /> Edit Details
                    </Button>

                    {/* ID document */}
                    <div>
                      <p className="text-slate-400 text-xs font-semibold mb-2">Identification Document</p>
                      {w.id_front_url ? (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <img src={w.id_front_url} alt="ID Front" className="h-24 rounded-lg object-cover border border-slate-600" />
                            {w.id_back_url && <img src={w.id_back_url} alt="ID Back" className="h-24 rounded-lg object-cover border border-slate-600" />}
                          </div>
                          {w.id_captured_at && <p className="text-slate-500 text-xs">Captured {formatDate(w.id_captured_at)}</p>}
                          <Button onClick={() => handleWorkerPdf(w)} variant="brand" className="h-11">
                            <Download className="w-4 h-4 mr-1.5" /> Download ID PDF
                          </Button>
                        </div>
                      ) : (
                        <p className="text-slate-500 text-xs italic">No document on file.</p>
                      )}
                    </div>

                    {/* Attendance history */}
                    <div>
                      <p className="text-slate-400 text-xs font-semibold mb-2">Attendance History ({recs.length})</p>
                      {recs.length === 0 ? (
                        <p className="text-slate-500 text-xs italic">No attendance records.</p>
                      ) : (
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {recs.map(r => (
                            <div key={r.id} className="flex items-center gap-2 text-xs text-slate-400 bg-slate-900/50 rounded-lg px-3 py-2">
                              <Calendar className="w-3 h-3 shrink-0" />
                              <span className="text-slate-300">{r.attendance_date ? r.attendance_date.split("-").reverse().join("/") : "—"}</span>
                              <span>{r.attendance_time}</span>
                              <span className="text-[var(--brand-link)]">{r.medical_centre}</span>
                              <span className="text-[var(--brand-accent)]">{r.assessment_type}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}