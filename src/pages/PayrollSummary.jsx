import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Clock, Download, User, TrendingUp, AlertTriangle, Calendar } from "lucide-react";
import moment from "moment";

export default function PayrollSummary() {
  const [selectedMonth, setSelectedMonth] = useState(moment().format("YYYY-MM"));
  const [selectedSite, setSelectedSite] = useState("all");
  const [hourlyRate, setHourlyRate] = useState(65);

  const monthStart = moment(selectedMonth).startOf("month").toISOString();
  const monthEnd = moment(selectedMonth).endOf("month").toISOString();

  const { data: shifts = [], isLoading } = useQuery({
    queryKey: ["payrollShifts", selectedMonth],
    queryFn: async () => {
      const all = await base44.entities.Shift.list("-start_time", 500);
      return all.filter(s => {
        const t = s.clock_in?.timestamp || s.start_time;
        return t && t >= monthStart && t <= monthEnd;
      });
    },
  });

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: () => base44.entities.Site.list(),
  });

  const guardSummaries = useMemo(() => {
    const filtered = selectedSite === "all" ? shifts : shifts.filter(s => s.site_id === selectedSite);
    const map = {};

    filtered.forEach(shift => {
      const gid = shift.guard_id;
      if (!gid) return;
      if (!map[gid]) {
        map[gid] = {
          guard_id: gid,
          guard_name: shift.guard_name || "Unknown",
          shifts: [],
          total_hours: 0,
          regular_hours: 0,
          overtime_hours: 0,
          missed_shifts: 0,
          late_clockins: 0,
          sites: new Set(),
        };
      }
      map[gid].shifts.push(shift);
      map[gid].sites.add(shift.site_name);

      if (shift.status === "missed") { map[gid].missed_shifts++; return; }

      const cin = shift.clock_in?.timestamp;
      const cout = shift.clock_out?.timestamp;
      if (cin && cout) {
        const hrs = moment(cout).diff(moment(cin), "hours", true);
        map[gid].total_hours += hrs;
        const reg = Math.min(hrs, 8);
        const ot = Math.max(0, hrs - 8);
        map[gid].regular_hours += reg;
        map[gid].overtime_hours += ot;
      }

      if (shift.start_time && cin) {
        const diff = moment(cin).diff(moment(shift.start_time), "minutes");
        if (diff > 15) map[gid].late_clockins++;
      }
    });

    return Object.values(map).map(g => ({
      ...g,
      sites: [...g.sites].join(", "),
      gross_pay: (g.regular_hours * hourlyRate + g.overtime_hours * hourlyRate * 1.5),
    })).sort((a, b) => b.total_hours - a.total_hours);
  }, [shifts, selectedSite, hourlyRate]);

  const totals = useMemo(() => ({
    guards: guardSummaries.length,
    hours: guardSummaries.reduce((s, g) => s + g.total_hours, 0),
    overtime: guardSummaries.reduce((s, g) => s + g.overtime_hours, 0),
    gross: guardSummaries.reduce((s, g) => s + g.gross_pay, 0),
    missed: guardSummaries.reduce((s, g) => s + g.missed_shifts, 0),
  }), [guardSummaries]);

  const exportCSV = () => {
    const headers = ["Guard", "Sites", "Shifts", "Total Hrs", "Regular Hrs", "Overtime Hrs", "Missed", "Late", "Gross Pay (ZAR)"];
    const rows = guardSummaries.map(g => [
      g.guard_name, g.sites, g.shifts.length,
      g.total_hours.toFixed(2), g.regular_hours.toFixed(2), g.overtime_hours.toFixed(2),
      g.missed_shifts, g.late_clockins, g.gross_pay.toFixed(2),
    ]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `payroll-${selectedMonth}.csv`;
    a.click();
  };

  const monthOptions = Array.from({ length: 12 }, (_, i) => moment().subtract(i, "months").format("YYYY-MM"));

  const fmt = n => `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
            <DollarSign className="w-8 h-8 text-emerald-400" /> Payroll Summary
          </h1>
          <p className="text-slate-400 mt-1">Monthly hours & pay calculations per guard</p>
        </div>
        <Button onClick={exportCSV} className="bg-emerald-600 hover:bg-emerald-700">
          <Download className="w-4 h-4 mr-2" /> Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Month</label>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700">
                {monthOptions.map(m => (
                  <SelectItem key={m} value={m} className="text-white">{moment(m).format("MMMM YYYY")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Site</label>
            <Select value={selectedSite} onValueChange={setSelectedSite}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700">
                <SelectItem value="all" className="text-white">All Sites</SelectItem>
                {sites.map(s => <SelectItem key={s.id} value={s.id} className="text-white">{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Hourly Rate (ZAR)</label>
            <Input type="number" value={hourlyRate} onChange={e => setHourlyRate(parseFloat(e.target.value) || 0)}
              className="bg-slate-900 border-slate-700 text-white" />
          </div>
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Guards", value: totals.guards, icon: User, color: "text-sky-400" },
          { label: "Total Hours", value: totals.hours.toFixed(1), icon: Clock, color: "text-emerald-400" },
          { label: "Overtime Hrs", value: totals.overtime.toFixed(1), icon: TrendingUp, color: "text-amber-400" },
          { label: "Missed Shifts", value: totals.missed, icon: AlertTriangle, color: "text-rose-400" },
          { label: "Gross Payroll", value: fmt(totals.gross), icon: DollarSign, color: "text-purple-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-4 text-center">
              <Icon className={`w-5 h-5 ${color} mx-auto mb-1`} />
              <p className={`text-lg font-bold ${color} leading-tight`}>{value}</p>
              <p className="text-xs text-slate-400 mt-0.5">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Guard Table */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Guard Breakdown — {moment(selectedMonth).format("MMMM YYYY")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-400 mx-auto" />
            </div>
          ) : guardSummaries.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No shift data for this period</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400 text-left">
                    <th className="pb-3 pr-4">Guard</th>
                    <th className="pb-3 pr-4">Sites</th>
                    <th className="pb-3 pr-3 text-right">Shifts</th>
                    <th className="pb-3 pr-3 text-right">Total Hrs</th>
                    <th className="pb-3 pr-3 text-right">Regular</th>
                    <th className="pb-3 pr-3 text-right">OT</th>
                    <th className="pb-3 pr-3 text-right">Missed</th>
                    <th className="pb-3 pr-3 text-right">Late</th>
                    <th className="pb-3 text-right">Gross Pay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {guardSummaries.map(g => (
                    <tr key={g.guard_id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 bg-sky-500/20 rounded-full flex items-center justify-center shrink-0">
                            <span className="text-sky-400 text-xs font-bold">{g.guard_name[0]}</span>
                          </div>
                          <span className="text-white font-medium">{g.guard_name}</span>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-slate-400 text-xs max-w-[120px] truncate">{g.sites || "—"}</td>
                      <td className="py-3 pr-3 text-right text-white">{g.shifts.length}</td>
                      <td className="py-3 pr-3 text-right text-white font-semibold">{g.total_hours.toFixed(1)}</td>
                      <td className="py-3 pr-3 text-right text-emerald-400">{g.regular_hours.toFixed(1)}</td>
                      <td className="py-3 pr-3 text-right">
                        {g.overtime_hours > 0 ? <span className="text-amber-400 font-semibold">{g.overtime_hours.toFixed(1)}</span> : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="py-3 pr-3 text-right">
                        {g.missed_shifts > 0 ? <Badge className="bg-rose-700 text-xs">{g.missed_shifts}</Badge> : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="py-3 pr-3 text-right">
                        {g.late_clockins > 0 ? <Badge className="bg-amber-700 text-xs">{g.late_clockins}</Badge> : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="py-3 text-right text-emerald-400 font-bold">{fmt(g.gross_pay)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-600 font-bold text-sm">
                    <td colSpan={2} className="pt-3 text-slate-400">TOTAL</td>
                    <td className="pt-3 text-right text-white">{guardSummaries.reduce((s, g) => s + g.shifts.length, 0)}</td>
                    <td className="pt-3 text-right text-white">{totals.hours.toFixed(1)}</td>
                    <td className="pt-3 text-right text-emerald-400">{guardSummaries.reduce((s, g) => s + g.regular_hours, 0).toFixed(1)}</td>
                    <td className="pt-3 text-right text-amber-400">{totals.overtime.toFixed(1)}</td>
                    <td className="pt-3 text-right text-rose-400">{totals.missed}</td>
                    <td className="pt-3 text-right text-amber-400">{guardSummaries.reduce((s, g) => s + g.late_clockins, 0)}</td>
                    <td className="pt-3 text-right text-emerald-400">{fmt(totals.gross)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}