import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Search, ArrowUpDown, Shield, User } from "lucide-react";

const COLUMNS = [
  { key: "timestamp", label: "Date/Time" },
  { key: "person_name", label: "Visitor" },
  { key: "event_type", label: "Event" },
  { key: "gate_name", label: "Gate" },
  { key: "scan_method", label: "Scan Type" },
  { key: "sa_id_number", label: "SA ID" },
  { key: "driver_licence_number", label: "Licence No" },
  { key: "vehicle_registration", label: "Reg" },
  { key: "vehicle_make", label: "Vehicle" },
  { key: "destination", label: "Destination" },
  { key: "visit_or_work", label: "Visit/Work" },
  { key: "work_type", label: "Work Type" },
  { key: "guard_name", label: "Guard" },
];

function fmt(v) {
  if (v == null || v === "") return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    try { return new Date(v).toLocaleString(); } catch (_) { return v; }
  }
  return String(v);
}

export default function AccessHistory() {
  const [filters, setFilters] = useState({
    q: "", event_type: "", gate: "", scan_method: "", visit_or_work: "", destination: "", work_type: "",
    dateFrom: "", dateTo: "",
  });
  const [sortDir, setSortDir] = useState("desc");

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["access_logs_all"],
    queryFn: () => base44.entities.AccessLog.list("-timestamp", 500),
  });

  const gates = useMemo(() => Array.from(new Set(logs.map((l) => l.gate_name).filter(Boolean))), [logs]);
  const destinations = useMemo(() => Array.from(new Set(logs.map((l) => l.destination).filter(Boolean))), [logs]);
  const workTypes = useMemo(() => Array.from(new Set(logs.map((l) => l.work_type).filter(Boolean))), [logs]);

  const filtered = useMemo(() => {
    const q = filters.q.toLowerCase().trim();
    const from = filters.dateFrom ? new Date(filters.dateFrom + "T00:00:00") : null;
    const to = filters.dateTo ? new Date(filters.dateTo + "T23:59:59") : null;
    let out = logs.filter((l) => {
      if (filters.event_type && l.event_type !== filters.event_type) return false;
      if (filters.gate && l.gate_name !== filters.gate) return false;
      if (filters.scan_method && l.scan_method !== filters.scan_method) return false;
      if (filters.visit_or_work && l.visit_or_work !== filters.visit_or_work) return false;
      if (filters.destination && l.destination !== filters.destination) return false;
      if (filters.work_type && l.work_type !== filters.work_type) return false;
      const t = new Date(l.timestamp);
      if (from && t < from) return false;
      if (to && t > to) return false;
      if (q) {
        const hay = [l.person_name, l.sa_id_number, l.driver_licence_number, l.vehicle_registration,
          l.vehicle_licence_disc_number, l.destination, l.work_type, l.guard_name, l.qr_code].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      const ta = new Date(a.timestamp).getTime(), tb = new Date(b.timestamp).getTime();
      return sortDir === "desc" ? tb - ta : ta - tb;
    });
    return out;
  }, [logs, filters, sortDir]);

  const stats = useMemo(() => ({
    total: filtered.length,
    entries: filtered.filter((l) => l.event_type === "entry").length,
    exits: filtered.filter((l) => l.event_type === "exit").length,
    denied: filtered.filter((l) => l.event_type === "denied").length,
    visitors: new Set(filtered.filter((l) => l.visitor_id).map((l) => l.visitor_id)).size,
    vehicles: new Set(filtered.map((l) => l.vehicle_registration).filter(Boolean)).size,
  }), [filtered]);

  const exportCSV = () => {
    const header = COLUMNS.map((c) => c.label).join(",");
    const rows = filtered.map((l) =>
      COLUMNS.map((c) => {
        const val = fmt(l[c.key]);
        return `"${(val || "").replace(/"/g, '""')}"`;
      }).join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `access-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const setF = (k) => (v) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pb-10">
      <div className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-xl border-b border-slate-700/50 px-4 py-3">
        <div className="flex items-center justify-between max-w-5xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">Access History</h1>
              <p className="text-slate-400 text-xs">Permanent entry & exit records</p>
            </div>
          </div>
          <Button onClick={exportCSV} disabled={filtered.length === 0} className="bg-sky-500 hover:bg-sky-600">
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            { label: "Total", value: stats.total, color: "text-white" },
            { label: "Entries", value: stats.entries, color: "text-emerald-400" },
            { label: "Exits", value: stats.exits, color: "text-amber-400" },
            { label: "Denied", value: stats.denied, color: "text-rose-400" },
            { label: "Visitors", value: stats.visitors, color: "text-sky-400" },
            { label: "Vehicles", value: stats.vehicles, color: "text-purple-400" },
          ].map((s) => (
            <div key={s.label} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3 text-center">
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-slate-400 text-xs">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Search visitor, ID, licence, registration, destination…" value={filters.q} onChange={(e) => setF("q")(e.target.value)} className="pl-9 bg-slate-900 border-slate-700 text-white" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Select value={filters.event_type} onValueChange={setF("event_type")}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white h-10 text-sm"><SelectValue placeholder="Event" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All events</SelectItem>
                <SelectItem value="entry">Entry</SelectItem>
                <SelectItem value="exit">Exit</SelectItem>
                <SelectItem value="denied">Denied</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.visit_or_work} onValueChange={setF("visit_or_work")}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white h-10 text-sm"><SelectValue placeholder="Visit/Work" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All</SelectItem>
                <SelectItem value="visit">Visit</SelectItem>
                <SelectItem value="work">Work</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.gate} onValueChange={setF("gate")}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white h-10 text-sm"><SelectValue placeholder="Gate" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All gates</SelectItem>
                {gates.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.scan_method} onValueChange={setF("scan_method")}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white h-10 text-sm"><SelectValue placeholder="Scan Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All types</SelectItem>
                <SelectItem value="qr_code">QR</SelectItem>
                <SelectItem value="sa_id">SA ID</SelectItem>
                <SelectItem value="drivers_licence">Licence</SelectItem>
                <SelectItem value="vehicle_disc">Vehicle Disc</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.destination} onValueChange={setF("destination")}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white h-10 text-sm"><SelectValue placeholder="Destination" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All destinations</SelectItem>
                {destinations.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.work_type} onValueChange={setF("work_type")}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white h-10 text-sm"><SelectValue placeholder="Work Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All work types</SelectItem>
                {workTypes.map((w) => <SelectItem key={w} value={w}>{w}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={filters.dateFrom} onChange={(e) => setF("dateFrom")(e.target.value)} className="bg-slate-900 border-slate-700 text-white h-10 text-sm" />
            <Input type="date" value={filters.dateTo} onChange={(e) => setF("dateTo")(e.target.value)} className="bg-slate-900 border-slate-700 text-white h-10 text-sm" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs">{filtered.length} record{filtered.length === 1 ? "" : "s"}</span>
            <Button variant="outline" size="sm" onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))} className="border-slate-600 text-slate-300">
              <ArrowUpDown className="w-3.5 h-3.5 mr-1.5" /> {sortDir === "desc" ? "Newest first" : "Oldest first"}
            </Button>
          </div>
        </div>

        {/* Table (desktop) */}
        <div className="hidden lg:block overflow-x-auto rounded-2xl border border-slate-700/50">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60 text-slate-300">
              <tr>
                {COLUMNS.map((c) => <th key={c.key} className="text-left px-3 py-2 font-medium whitespace-nowrap">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((l) => (
                <tr key={l.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                  {COLUMNS.map((c) => (
                    <td key={c.key} className="px-3 py-2 text-slate-200 whitespace-nowrap">
                      {c.key === "event_type"
                        ? <Badge className={l.event_type === "entry" ? "bg-emerald-600" : l.event_type === "exit" ? "bg-amber-600" : "bg-rose-600"}>{l.event_type}</Badge>
                        : fmt(l[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Cards (mobile) */}
        <div className="lg:hidden space-y-2">
          {filtered.slice(0, 100).map((l) => (
            <div key={l.id} className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {l.photo_url
                    ? <img src={l.photo_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                    : <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center shrink-0"><User className="w-4 h-4 text-slate-300" /></div>}
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{l.person_name || "Unknown"}</p>
                    <p className="text-slate-400 text-xs">{fmt(l.timestamp)}</p>
                  </div>
                </div>
                <Badge className={l.event_type === "entry" ? "bg-emerald-600" : l.event_type === "exit" ? "bg-amber-600" : "bg-rose-600"}>{l.event_type}</Badge>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {l.gate_name && <span className="text-slate-400">Gate: <span className="text-slate-200">{l.gate_name}</span></span>}
                {l.scan_method && <span className="text-slate-400">Type: <span className="text-slate-200">{l.scan_method}</span></span>}
                {l.vehicle_registration && <span className="text-slate-400">Reg: <span className="text-slate-200">{l.vehicle_registration}</span></span>}
                {l.destination && <span className="text-slate-400">Dest: <span className="text-slate-200">{l.destination}</span></span>}
                {l.work_type && <span className="text-slate-400">Work: <span className="text-slate-200">{l.work_type}</span></span>}
                {l.guard_name && <span className="text-slate-400">Guard: <span className="text-slate-200">{l.guard_name}</span></span>}
              </div>
            </div>
          ))}
          {filtered.length === 0 && !isLoading && (
            <div className="text-center py-10 text-slate-500">
              <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No records match your filters</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}