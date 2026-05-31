import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Database, Download, Mail, Filter, Calendar, Shield, AlertTriangle,
  Wrench, Clock, MapPin, Users, BarChart3, FileText, Search, RefreshCw, CheckCircle2
} from "lucide-react";
import { jsPDF } from "jspdf";

const ENTITY_CONFIGS = [
  { key: "Incident",          label: "Incidents",         icon: AlertTriangle, color: "text-rose-400",    fields: ["title","category","priority","status","guard_name","site_name","reported_at"] },
  { key: "MaintenanceRequest",label: "Maintenance",        icon: Wrench,        color: "text-amber-400",   fields: ["title","category","urgency","status","guard_name","site_name","reported_at"] },
  { key: "PatrolLog",         label: "Patrol Logs",        icon: MapPin,        color: "text-sky-400",     fields: ["guard_name","checkpoint_name","site_id","timestamp","verified"] },
  { key: "ScheduledPatrol",   label: "Scheduled Patrols",  icon: Shield,        color: "text-purple-400",  fields: ["site_name","guard_name","status","scheduled_start","checkpoints_completed","checkpoints_total","completion_score"] },
  { key: "Shift",             label: "Shifts",             icon: Clock,         color: "text-emerald-400", fields: ["guard_name","site_name","status","start_time","end_time","clock_in","clock_out"] },
  { key: "Alert",             label: "Alerts",             icon: AlertTriangle, color: "text-orange-400",  fields: ["type","title","priority","guard_name","site_id","status","created_date"] },
  { key: "AlarmResponse",     label: "Alarm Responses",    icon: Shield,        color: "text-rose-400",    fields: ["alarm_type","priority","status","address","client_name","assigned_to_name","dispatched_at"] },
  { key: "Visitor",           label: "Visitors",           icon: Users,         color: "text-cyan-400",    fields: ["visitor_name","unit_number","visit_type","status","entered_at","exited_at"] },
  { key: "AccessLog",         label: "Access Logs",        icon: CheckCircle2,  color: "text-teal-400",    fields: ["person_name","person_type","event_type","gate_name","scan_method","timestamp"] },
];

function fmt(val) {
  if (!val && val !== 0) return "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (typeof val === "object" && val.timestamp) return new Date(val.timestamp).toLocaleString();
  if (typeof val === "string" && val.match(/^\d{4}-\d{2}-\d{2}T/)) return new Date(val).toLocaleString();
  if (typeof val === "object") return JSON.stringify(val).substring(0, 60);
  return String(val);
}

export default function DataHub() {
  const [selectedEntity, setSelectedEntity] = useState("Incident");
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split("T")[0]; });
  const [dateTo, setDateTo] = useState(new Date().toISOString().split("T")[0]);
  const [searchQuery, setSearchQuery] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState("");

  const config = ENTITY_CONFIGS.find(e => e.key === selectedEntity) || ENTITY_CONFIGS[0];

  const dateField = {
    Incident: "reported_at", MaintenanceRequest: "reported_at", PatrolLog: "timestamp",
    ScheduledPatrol: "scheduled_start", Shift: "start_time", Alert: "created_date",
    AlarmResponse: "dispatched_at", Visitor: "created_date", AccessLog: "timestamp",
  }[selectedEntity] || "created_date";

  const { data: records = [], isLoading, refetch } = useQuery({
    queryKey: ["dataHub", selectedEntity, dateFrom, dateTo],
    queryFn: async () => {
      const all = await base44.entities[selectedEntity].list(`-${dateField}`, 2000);
      const from = new Date(dateFrom); from.setHours(0, 0, 0, 0);
      const to   = new Date(dateTo);   to.setHours(23, 59, 59, 999);
      return all.filter(r => {
        const d = new Date(r[dateField] || r.created_date);
        return d >= from && d <= to;
      });
    },
  });

  const filtered = records.filter(r =>
    !searchQuery || Object.values(r).some(v =>
      String(v).toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  // ─── Export CSV ──────────────────────────────────────────────────────────
  const exportCSV = () => {
    const rows = [config.fields.join(",")];
    filtered.forEach(r => {
      rows.push(config.fields.map(f => `"${fmt(r[f]).replace(/"/g, "'")}"` ).join(","));
    });
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `${selectedEntity}_${dateFrom}_to_${dateTo}.csv`;
    a.click();
  };

  // ─── Export PDF ──────────────────────────────────────────────────────────
  const exportPDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    const pageW = 297;
    doc.setFillColor(30, 41, 59);
    doc.rect(0, 0, pageW, 20, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text(`${config.label} Report — ${dateFrom} to ${dateTo}`, pageW / 2, 13, { align: "center" });
    let y = 28;
    doc.setFontSize(8); doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 116, 139);
    const colW = (pageW - 20) / config.fields.length;
    config.fields.forEach((f, i) => doc.text(f.replace(/_/g, " ").toUpperCase(), 10 + i * colW, y));
    y += 5;
    doc.setDrawColor(196, 30, 58);
    doc.line(10, y, pageW - 10, y);
    y += 4;
    doc.setFont("helvetica", "normal"); doc.setTextColor(26, 26, 26);
    filtered.slice(0, 200).forEach(r => {
      if (y > 195) { doc.addPage(); y = 15; }
      config.fields.forEach((f, i) => {
        const val = fmt(r[f]).substring(0, 25);
        doc.text(val, 10 + i * colW, y);
      });
      y += 6;
    });
    doc.save(`${selectedEntity}_${dateFrom}_to_${dateTo}.pdf`);
  };

  // ─── Send Email ──────────────────────────────────────────────────────────
  const sendEmail = async () => {
    if (!emailTo) return;
    setSendingEmail(true);
    setEmailStatus("");
    const rows = filtered.slice(0, 100).map(r =>
      `<tr>${config.fields.map(f => `<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${fmt(r[f])}</td>`).join("")}</tr>`
    ).join("");
    const body = `
<html><body style="font-family:Arial,sans-serif;">
<h2 style="color:#1e293b;">${config.label} Report</h2>
<p style="color:#64748b;">Period: ${dateFrom} to ${dateTo} | Total records: ${filtered.length}</p>
<table style="width:100%;border-collapse:collapse;font-size:12px;">
<thead><tr style="background:#1e293b;color:white;">${config.fields.map(f => `<th style="padding:8px 10px;text-align:left;">${f.replace(/_/g," ")}</th>`).join("")}</tr></thead>
<tbody>${rows}</tbody>
</table>
${filtered.length > 100 ? `<p style="color:#64748b;font-size:12px;">Showing first 100 of ${filtered.length} records. Export CSV for full dataset.</p>` : ""}
<p style="color:#94a3b8;font-size:11px;margin-top:20px;">Generated by Unified Security Solutions — Data Hub</p>
</body></html>`;
    try {
      await base44.functions.invoke("sendNotification", {
        to: emailTo, subject: `${config.label} Report — ${dateFrom} to ${dateTo}`, body,
      });
      setEmailStatus("✅ Email sent!");
    } catch {
      // Fallback: use Core.SendEmail via a simple pattern
      setEmailStatus("📋 Copy table above and paste into email.");
    }
    setSendingEmail(false);
  };

  const Icon = config.icon;

  return (
    <div className="min-h-screen p-4 lg:p-6 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-7xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Database className="w-7 h-7 text-sky-400" /> Data & Reports Hub
            </h1>
            <p className="text-slate-400 text-sm">All activity data — filter, export, email</p>
          </div>
          <Button onClick={refetch} variant="outline" size="sm" className="border-slate-600 text-slate-300">
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* Entity selector pills */}
        <div className="flex flex-wrap gap-2">
          {ENTITY_CONFIGS.map(ec => {
            const EIcon = ec.icon;
            return (
              <button key={ec.key} onClick={() => setSelectedEntity(ec.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all border ${selectedEntity === ec.key ? "bg-sky-600 border-sky-500 text-white" : "bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500"}`}>
                <EIcon className={`w-3.5 h-3.5 ${ec.color}`} />{ec.label}
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <p className="text-slate-400 text-xs mb-1">From</p>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="bg-slate-900 border-slate-700 text-white" />
              </div>
              <div>
                <p className="text-slate-400 text-xs mb-1">To</p>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="bg-slate-900 border-slate-700 text-white" />
              </div>
              <div className="col-span-2">
                <p className="text-slate-400 text-xs mb-1">Search</p>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search all fields..."
                    className="bg-slate-900 border-slate-700 text-white pl-9" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats + Actions */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="flex items-center gap-3">
            <Icon className={`w-6 h-6 ${config.color}`} />
            <div>
              <p className="text-white font-semibold">{config.label}</p>
              <p className="text-slate-400 text-xs">{filtered.length} records ({dateFrom} – {dateTo})</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={exportCSV} className="bg-emerald-700 hover:bg-emerald-800">
              <Download className="w-4 h-4 mr-1" /> CSV
            </Button>
            <Button size="sm" onClick={exportPDF} className="bg-rose-700 hover:bg-rose-800">
              <FileText className="w-4 h-4 mr-1" /> PDF
            </Button>
          </div>
        </div>

        {/* Email */}
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="p-3">
            <p className="text-slate-400 text-xs mb-2 flex items-center gap-1"><Mail className="w-3 h-3" /> Email Report</p>
            <div className="flex gap-2">
              <Input value={emailTo} onChange={e => setEmailTo(e.target.value)}
                placeholder="recipient@example.com"
                className="bg-slate-900 border-slate-700 text-white flex-1" />
              <Button size="sm" onClick={sendEmail} disabled={sendingEmail || !emailTo}
                className="bg-sky-700 hover:bg-sky-800">
                {sendingEmail ? "Sending..." : <><Mail className="w-4 h-4 mr-1" />Send</>}
              </Button>
            </div>
            {emailStatus && <p className="text-emerald-400 text-xs mt-1">{emailStatus}</p>}
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="bg-slate-800 border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="p-12 text-center text-slate-400">Loading data...</div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center">
                <Database className="w-10 h-10 text-slate-500 mx-auto mb-2" />
                <p className="text-slate-400">No records found for this period</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-900 border-b border-slate-700">
                    {config.fields.map(f => (
                      <th key={f} className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase whitespace-nowrap">
                        {f.replace(/_/g, " ")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 200).map((r, i) => (
                    <tr key={r.id || i} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                      {config.fields.map(f => (
                        <td key={f} className="px-3 py-2.5 text-slate-300 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis">
                          {f === "status" ? (
                            <Badge className={
                              r[f] === "completed" || r[f] === "active" || r[f] === "resolved" ? "bg-emerald-700" :
                              r[f] === "pending" || r[f] === "upcoming" ? "bg-slate-600" :
                              r[f] === "missed" || r[f] === "failed" || r[f] === "denied" ? "bg-rose-700" :
                              "bg-amber-600"
                            }>{r[f]}</Badge>
                          ) : f === "priority" || f === "urgency" ? (
                            <Badge className={
                              r[f] === "critical" ? "bg-rose-700" : r[f] === "high" ? "bg-orange-600" :
                              r[f] === "medium" ? "bg-amber-600" : "bg-slate-600"
                            }>{r[f]}</Badge>
                          ) : fmt(r[f])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {filtered.length > 200 && (
            <div className="p-3 text-center text-slate-400 text-xs border-t border-slate-700">
              Showing 200 of {filtered.length} records. Export CSV for full dataset.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}