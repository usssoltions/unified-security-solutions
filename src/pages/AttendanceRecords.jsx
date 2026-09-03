import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardList, Filter, Search, Download, Loader2, ShieldAlert, X
} from "lucide-react";
import { Link } from "react-router-dom";
import { generateOfficialRegisterPdf, generateIndividualAttendancePdf, downloadBlob } from "@/lib/attendancePdf";
import { useBranding } from "@/hooks/useBranding";
import { attendanceCall, withSignatures } from "@/lib/attendanceApi";
import { dateRangeISO } from "@/lib/attendanceDropdowns";

const PRESETS = [
  { label: "Today", key: "today" },
  { label: "Yesterday", key: "yesterday" },
  { label: "This Week", key: "this_week" },
  { label: "Last Week", key: "last_week" },
  { label: "This Month", key: "this_month" },
  { label: "Last Month", key: "last_month" },
];

export default function AttendanceRecords() {
  const [preset, setPreset] = useState("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [searchText, setSearchText] = useState("");
  const [filterCompany, setFilterCompany] = useState("");
  const [filterMedical, setFilterMedical] = useState("");
  const [filterAssessment, setFilterAssessment] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

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

  const range = preset === "custom" ? { from: customFrom, to: customTo } : dateRangeISO(preset);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["att_records", range.from, range.to],
    queryFn: () => attendanceCall("list_records", { from: range.from, to: range.to }).then(r => r.records || []),
    enabled: !!ctx?.authorized && !!range.from && !!range.to,
    staleTime: 15000,
  });

  const filtered = records.filter(r => {
    const txt = searchText.toLowerCase();
    const matchText = !txt || [r.surname_snapshot, r.initials_snapshot, r.id_number_snapshot, r.company_snapshot, r.cellphone_snapshot].some(v => (v || "").toLowerCase().includes(txt));
    const matchCompany = !filterCompany || (r.company_snapshot || "").toLowerCase().includes(filterCompany.toLowerCase());
    const matchMedical = !filterMedical || r.medical_centre === filterMedical;
    const matchAssess = !filterAssessment || r.assessment_type === filterAssessment;
    return matchText && matchCompany && matchMedical && matchAssess;
  });

  // Signatures are fetched fresh from the gateway at generation time (they
  // are stripped from list responses to keep payloads lean).
  const handleGeneratePdf = async () => {
    setGeneratingPdf(true);
    try {
      const withSigs = await withSignatures(filtered);
      const blob = generateOfficialRegisterPdf(withSigs, branding);
      downloadBlob(blob, `attendance_register_${range.from}_${range.to}.pdf`);
    } catch (e) { alert("PDF generation failed. Please try again."); }
    finally { setGeneratingPdf(false); }
  };

  const handleIndividualPdf = async (record) => {
    try {
      const withSigs = await withSignatures([record]);
      const blob = generateIndividualAttendancePdf(withSigs[0], {}, branding);
      downloadBlob(blob, `attendance_${record.id_number_snapshot}_${record.attendance_date}.pdf`);
    } catch (e) { alert("PDF generation failed."); }
  };

  const formatDate = (d) => {
    if (!d) return "—";
    const [y, m, dt] = d.split("-");
    return `${dt}/${m}/${y}`;
  };

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
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <Link to="/AttendanceDashboard" className="text-slate-400 text-sm hover:text-white">← Dashboard</Link>
        <h1 className="text-white text-xl font-bold flex-1">Attendance Records</h1>
      </div>

      {/* Date preset tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {PRESETS.map(p => (
          <button key={p.key} onClick={() => setPreset(p.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition
              ${preset === p.key ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
            {p.label}
          </button>
        ))}
        <button onClick={() => setPreset("custom")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition
            ${preset === "custom" ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
          Custom
        </button>
      </div>

      {preset === "custom" && (
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-slate-400 text-xs mb-1 block">From</label>
            <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="bg-slate-900 border-slate-700 text-white" />
          </div>
          <div className="flex-1">
            <label className="text-slate-400 text-xs mb-1 block">To</label>
            <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="bg-slate-900 border-slate-700 text-white" />
          </div>
        </div>
      )}

      {/* Search + filters */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="Search name, ID, company…"
            className="bg-slate-900 border-slate-700 text-white pl-9" />
        </div>
        <Button variant="outline" size="icon" onClick={() => setShowFilters(!showFilters)}
          className="border-slate-700 text-slate-400">
          <Filter className="w-4 h-4" />
        </Button>
      </div>
      {showFilters && (
        <div className="grid grid-cols-2 gap-2 bg-slate-800/50 rounded-xl p-3">
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Company</label>
            <Input value={filterCompany} onChange={e => setFilterCompany(e.target.value)} placeholder="Filter company…"
              className="bg-slate-900 border-slate-700 text-white text-sm h-9" />
          </div>
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Medical Centre</label>
            <select value={filterMedical} onChange={e => setFilterMedical(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-2 py-1.5 text-sm">
              <option value="">All</option>
              {dropdowns.medicalCentres.map(mc => <option key={mc} value={mc}>{mc}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-slate-400 text-xs mb-1 block">Assessment Type</label>
            <select value={filterAssessment} onChange={e => setFilterAssessment(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-2 py-1.5 text-sm">
              <option value="">All</option>
              {dropdowns.assessmentTypes.map(at => <option key={at} value={at}>{at}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Result count + actions */}
      <div className="flex items-center justify-between">
        <span className="text-slate-400 text-sm">{filtered.length} record{filtered.length !== 1 ? "s" : ""}</span>
        <Button onClick={handleGeneratePdf} disabled={filtered.length === 0 || generatingPdf} size="sm"
          className="bg-sky-600 hover:bg-sky-700">
          {generatingPdf ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Download className="w-4 h-4 mr-1.5" />}
          Official PDF
        </Button>
      </div>

      {/* Records list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <ClipboardList className="w-12 h-12 text-slate-600 mx-auto mb-2" />
          <p className="text-slate-400">No records for this period.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(r => (
            <div key={r.id} className="bg-slate-800/60 rounded-xl border border-slate-700 p-3 space-y-2">
              <div className="flex items-start gap-3">
                <div>
                  <p className="text-white font-semibold text-sm">
                    {r.surname_snapshot}{r.initials_snapshot ? `, ${r.initials_snapshot}` : ""}
                  </p>
                  <p className="text-slate-400 text-xs">{r.id_number_snapshot}</p>
                </div>
                <div className="ml-auto text-right shrink-0">
                  <p className="text-slate-300 text-xs">{formatDate(r.attendance_date)} {r.attendance_time}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {r.company_snapshot && <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-300">{r.company_snapshot}</Badge>}
                {r.medical_centre && <Badge variant="outline" className="text-[10px] border-sky-700 text-sky-400">{r.medical_centre}</Badge>}
                {r.assessment_type && <Badge variant="outline" className="text-[10px] border-emerald-700 text-emerald-400">{r.assessment_type}</Badge>}
              </div>
              <div className="flex justify-end">
                <Button size="sm" variant="ghost" onClick={() => handleIndividualPdf(r)} className="text-slate-400 text-xs h-7">
                  <Download className="w-3 h-3 mr-1" /> PDF
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}