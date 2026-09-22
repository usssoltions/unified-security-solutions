import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { medicalApi } from "@/lib/medicalApi";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2, Building2, User, Briefcase } from "lucide-react";
import ReportDetailDialog from "@/components/medical/ReportDetailDialog";
import moment from "moment";

// Medical Reports — every clinical report generated from a patient's
// session. ALL data flows through the medicalAccess gateway: therapists see
// only their own reports, practice admins oversee the practice's reports,
// reception has no access, and releasing to an employer is an explicit
// audited practice-admin decision (never automatic).
export default function MedicalReports() {
  const [reports, setReports] = useState([]);
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [activeId, setActiveId] = useState(null);
  const navigate = useNavigate();

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      // Report visibility is ownership-scoped server-side (therapists see
      // their own; practice admins see all; reception is denied at the gate).
      const [ctxRes, repRes] = await Promise.all([
        medicalApi.getContext().catch(() => null),
        medicalApi.listReports(),
      ]);
      setCtx(ctxRes);
      setReports(repRes?.reports || []);
    } catch (e) {
      setLoadError(e?.message || "Failed to load reports.");
    } finally {
      setLoading(false);
    }
  };

  const isAdmin = !!(ctx && (ctx.is_practice_admin || ctx.is_platform_admin || ctx.is_reseller_admin));
  const isClinical = isAdmin || !!(ctx && ctx.is_therapist);

  const filterTabs = [
    { key: "all", label: "All" },
    { key: "draft", label: "Draft" },
    { key: "pending_approval", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "released", label: "Released" },
  ];
  const matchesFilter = (r) => {
    if (filterStatus === "all") return true;
    if (filterStatus === "released") return r.shared_with_employer === true || r.status === "released";
    return r.status === filterStatus;
  };
  const filtered = reports.filter(matchesFilter);
  const active = reports.find((r) => r.id === activeId) || null;

  const applyUpdate = (updated) => {
    setReports((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  };

  const statusColors = {
    draft: "bg-slate-500/20 text-slate-400",
    pending_approval: "bg-amber-500/20 text-amber-400",
    approved: "bg-sky-500/20 text-sky-400",
    released: "bg-emerald-500/20 text-emerald-400",
    archived: "bg-slate-500/20 text-slate-400",
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
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center">
            <FileText className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Reports</h1>
            <p className="text-slate-400 text-sm">Clinical reports — tied to patient records, access-controlled</p>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {filterTabs.map(tab => (
            <button key={tab.key} onClick={() => setFilterStatus(tab.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                filterStatus === tab.key ? "bg-emerald-500 text-white" : "bg-slate-900 text-slate-400 hover:bg-slate-800"
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {loadError ? (
          <Card className="bg-rose-500/10 border-rose-500/20">
            <CardContent className="py-10 text-center">
              <p className="text-rose-400 text-sm">{loadError}</p>
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="py-12 text-center">
              <FileText className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No reports found</p>
              <p className="text-slate-500 text-xs mt-1">Reports are generated when a clinical session is completed.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map(r => {
              const isReleased = r.shared_with_employer === true || r.status === "released";
              const label = isReleased ? "released" : (r.status || "draft");
              return (
                <Card key={r.id} className="bg-slate-900 border-slate-800">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center shrink-0">
                          <FileText className="w-5 h-5 text-emerald-400" />
                        </div>
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => r.patient_id && navigate(`/MedicalPatientDetail?id=${r.patient_id}`)}
                            className="text-white font-medium text-sm truncate text-left hover:text-emerald-400 transition-colors block"
                          >
                            <User className="w-3 h-3 inline mr-1 -mt-0.5" />
                            {r.patient_name || "Unknown Patient"}
                          </button>
                          <p className="text-slate-400 text-xs truncate">{r.report_number} • {r.service_name || "Consultation"}</p>
                          <p className="text-slate-500 text-xs mt-0.5">
                            {r.generated_at ? moment(r.generated_at).format("MMM D, YYYY") : ""}
                            {r.therapist_name ? ` • ${r.therapist_name}` : ""}
                          </p>
                          {r.employer_name && (
                            <p className="text-slate-500 text-xs flex items-center gap-1 mt-0.5 truncate">
                              <Building2 className="w-3 h-3" /> {r.employer_name}
                            </p>
                          )}
                          {r.work_capacity && (
                            <p className="text-slate-500 text-xs mt-1 flex items-center gap-1 truncate">
                              <Briefcase className="w-3 h-3" /> {r.work_capacity}
                            </p>
                          )}
                        </div>
                      </div>
                      <Badge className={`${statusColors[label] || statusColors.draft} text-xs shrink-0`}>
                        {label.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <div className="mt-3 pt-3 border-t border-slate-800">
                      <Button size="sm" variant="outline" className="border-slate-700 text-slate-200 hover:bg-slate-800 w-full"
                        onClick={() => setActiveId(r.id)}>
                        View Report
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail / workflow dialog — actions authorized server-side */}
      <ReportDetailDialog
        report={active}
        isAdmin={isAdmin}
        isClinical={isClinical}
        onClose={() => setActiveId(null)}
        onChanged={applyUpdate}
      />
    </div>
  );
}