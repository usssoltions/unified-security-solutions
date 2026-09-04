import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, FileText, Download, Table, AlertCircle, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { useBranding } from "@/hooks/useBranding";
import { generateOfficialRegisterPdf, downloadBlob } from "@/lib/attendancePdf";
import { generateOfficialRegisterExcel, attendanceRegisterFilename } from "@/lib/attendanceExcel";
import { attendanceCall, withSignatures } from "@/lib/attendanceApi";
import { dateRangeISO } from "@/lib/attendanceDropdowns";

const PRESETS = [
  { label: "Today", key: "today" },
  { label: "Yesterday", key: "yesterday" },
  { label: "This Week", key: "this_week" },
  { label: "Last Week", key: "last_week" },
  { label: "This Month", key: "this_month" },
  { label: "Last Month", key: "last_month" },
  { label: "Custom", key: "custom" },
];

export default function AttendanceReports() {
  const [preset, setPreset] = useState("this_week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [filterCompany, setFilterCompany] = useState("");
  const [filterMedical, setFilterMedical] = useState("");
  const [filterAssessment, setFilterAssessment] = useState("");
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [generatingXlsx, setGeneratingXlsx] = useState(false);
  const [pdfError, setPdfError] = useState(null);
  const [xlsxError, setXlsxError] = useState(null);

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
    queryKey: ["att_report_records", range.from, range.to],
    queryFn: () => attendanceCall("list_records", { from: range.from, to: range.to }).then(r => r.records || []),
    enabled: !!ctx?.authorized && !!range.from && !!range.to,
    staleTime: 20000,
  });

  const filtered = records.filter(r => {
    const mc = !filterCompany || (r.company_snapshot || "").toLowerCase().includes(filterCompany.toLowerCase());
    const mm = !filterMedical || r.medical_centre === filterMedical;
    const ma = !filterAssessment || r.assessment_type === filterAssessment;
    return mc && mm && ma;
  });

  const formatDate = d => d ? d.split("-").reverse().join("/") : "—";
  const rangeLabel = range.from && range.to
    ? (range.from === range.to ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}`)
    : "No range selected";

  const handlePdf = async () => {
    setGeneratingPdf(true); setPdfError(null);
    try {
      // Fetch signatures fresh at generation time (scoped server-side).
      const withSigs = await withSignatures(filtered);
      const blob = generateOfficialRegisterPdf(withSigs, branding);
      if (!blob) throw new Error("Empty PDF");
      downloadBlob(blob, `rfa_attendance_register_${range.from}_${range.to}.pdf`);
    } catch (e) {
      setPdfError("PDF generation failed. Please try again.");
    } finally { setGeneratingPdf(false); }
  };

  const handleExcel = async () => {
    setGeneratingXlsx(true); setXlsxError(null);
    try {
      // Same filtered dataset + fresh signatures as the Official PDF — one
      // shared register dataset feeding both renderers.
      const withSigs = await withSignatures(filtered);
      const blob = await generateOfficialRegisterExcel(withSigs, branding, range.from, range.to);
      downloadBlob(blob, attendanceRegisterFilename(range.from, range.to));
    } catch (e) {
      setXlsxError("Excel export failed. Please try again.");
    } finally { setGeneratingXlsx(false); }
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
    <div className="p-4 max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-3 mb-2">
        <Link to="/AttendanceDashboard" className="text-slate-400 text-sm hover:text-white">← Dashboard</Link>
        <h1 className="text-white text-xl font-bold">Reports</h1>
      </div>

      {/* Period selection */}
      <div>
        <p className="text-slate-400 text-xs mb-2 font-medium uppercase tracking-wide">Reporting Period</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => setPreset(p.key)}
              className={`px-3.5 py-2.5 min-h-[44px] rounded-lg text-sm font-medium transition active:scale-95
                ${preset === p.key ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex gap-3 mt-3">
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
      </div>

      {/* Optional filters */}
      <div className="bg-slate-800/50 rounded-xl p-3 space-y-3">
        <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide">Optional Filters</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-slate-500 text-xs mb-1 block">Company</label>
            <Input value={filterCompany} onChange={e => setFilterCompany(e.target.value)} placeholder="All companies"
              className="bg-slate-900 border-slate-700 text-white text-sm h-9" />
          </div>
          <div>
            <label className="text-slate-500 text-xs mb-1 block">Medical Centre</label>
            <select value={filterMedical} onChange={e => setFilterMedical(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-2 py-1.5 text-sm">
              <option value="">All</option>
              {dropdowns.medicalCentres.map(mc => <option key={mc} value={mc}>{mc}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-slate-500 text-xs mb-1 block">Assessment Type</label>
            <select value={filterAssessment} onChange={e => setFilterAssessment(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-2 py-1.5 text-sm">
              <option value="">All</option>
              {dropdowns.assessmentTypes.map(at => <option key={at} value={at}>{at}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Summary card */}
      <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-4 space-y-1">
        <p className="text-slate-400 text-sm">Selected period: <span className="text-white font-semibold">{rangeLabel}</span></p>
        <p className="text-slate-400 text-sm">
          {isLoading ? "Loading…" : <><span className="text-white font-semibold">{filtered.length}</span> record{filtered.length !== 1 ? "s" : ""} match</>}
        </p>
      </div>

      {/* Generate buttons */}
      <div className="space-y-3">
        {pdfError && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 flex items-center gap-2 text-rose-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" /> {pdfError}
          </div>
        )}
        <Button onClick={handlePdf} disabled={filtered.length === 0 || generatingPdf || isLoading}
          className="w-full h-14 text-base bg-sky-600 hover:bg-sky-700">
          {generatingPdf ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <FileText className="w-5 h-5 mr-2" />}
          Generate Official PDF Register
        </Button>

        {xlsxError && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 flex items-center gap-2 text-rose-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" /> {xlsxError}
          </div>
        )}
        <Button onClick={handleExcel} disabled={filtered.length === 0 || generatingXlsx || isLoading}
          variant="outline" className="w-full h-14 text-base border-emerald-700 text-emerald-400 hover:bg-emerald-900/20">
          {generatingXlsx ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Table className="w-5 h-5 mr-2" />}
          Export Excel (.xlsx)
        </Button>
      </div>

      <p className="text-slate-600 text-xs text-center">
        The PDF Official Register groups records by date, matching the RFA Attendance Register format.<br />
        Each date appears on its own page. Multi-page days continue on the next page.
      </p>
    </div>
  );
}