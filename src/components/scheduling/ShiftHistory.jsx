import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, MapPin, User, Calendar, Search, Filter, Download, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

export default function ShiftHistory() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterGuard, setFilterGuard] = useState("all");
  const [dateRange, setDateRange] = useState("30");

  const { data: shifts, isLoading } = useQuery({
    queryKey: ["shiftHistory", dateRange],
    queryFn: async () => {
      const days = parseInt(dateRange);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const allShifts = await base44.entities.Shift.list("-created_date", 500);
      return allShifts.filter(s => {
        const shiftDate = new Date(s.start_time);
        return shiftDate >= startDate;
      });
    },
    initialData: []
  });

  const { data: guards } = useQuery({
    queryKey: ["guards"],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role_type === "guard");
    },
    initialData: []
  });

  const exportToCSV = () => {
    const headers = ["Guard", "Site", "Start Time", "End Time", "Status", "Clock In", "Clock Out", "Notes"];
    const rows = filteredShifts.map(shift => [
      shift.guard_name || "Unassigned",
      shift.site_name,
      new Date(shift.start_time).toLocaleString(),
      new Date(shift.end_time).toLocaleString(),
      shift.status,
      shift.clock_in?.timestamp ? new Date(shift.clock_in.timestamp).toLocaleString() : "N/A",
      shift.clock_out?.timestamp ? new Date(shift.clock_out.timestamp).toLocaleString() : "N/A",
      shift.notes || ""
    ]);

    const csv = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shift-history-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredShifts = shifts.filter(shift => {
    const matchesSearch = 
      shift.guard_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      shift.site_name?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = filterStatus === "all" || shift.status === filterStatus;
    const matchesGuard = filterGuard === "all" || shift.guard_id === filterGuard;

    return matchesSearch && matchesStatus && matchesGuard;
  });

  const statusColors = {
    scheduled: "bg-sky-500",
    open: "bg-amber-500",
    accepted: "bg-purple-500",
    active: "bg-emerald-500",
    completed: "bg-green-600",
    missed: "bg-rose-500",
    cancelled: "bg-red-600"
  };

  const statusIcons = {
    completed: <CheckCircle2 className="w-4 h-4" />,
    missed: <XCircle className="w-4 h-4" />,
    cancelled: <AlertCircle className="w-4 h-4" />
  };

  const calculateShiftDuration = (shift) => {
    if (!shift.clock_in?.timestamp || !shift.clock_out?.timestamp) return "N/A";
    
    const start = new Date(shift.clock_in.timestamp);
    const end = new Date(shift.clock_out.timestamp);
    const diff = end - start;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    return `${hours}h ${minutes}m`;
  };

  const stats = {
    total: filteredShifts.length,
    completed: filteredShifts.filter(s => s.status === "completed").length,
    missed: filteredShifts.filter(s => s.status === "missed").length,
    cancelled: filteredShifts.filter(s => s.status === "cancelled").length
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Total Shifts</p>
                <p className="text-2xl font-bold text-white">{stats.total}</p>
              </div>
              <Calendar className="w-8 h-8 text-sky-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-green-500/10 border-green-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-green-400">Completed</p>
                <p className="text-2xl font-bold text-white">{stats.completed}</p>
              </div>
              <CheckCircle2 className="w-8 h-8 text-green-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-rose-500/10 border-rose-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-rose-400">Missed</p>
                <p className="text-2xl font-bold text-white">{stats.missed}</p>
              </div>
              <XCircle className="w-8 h-8 text-rose-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-red-500/10 border-red-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-red-400">Cancelled</p>
                <p className="text-2xl font-bold text-white">{stats.cancelled}</p>
              </div>
              <AlertCircle className="w-8 h-8 text-red-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-white">Shift History</CardTitle>
            <Button
              onClick={exportToCSV}
              variant="outline"
              size="sm"
              className="border-sky-600 text-sky-400"
            >
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search shifts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-slate-900 border-slate-700 text-white"
              />
            </div>

            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 Days</SelectItem>
                <SelectItem value="30">Last 30 Days</SelectItem>
                <SelectItem value="90">Last 90 Days</SelectItem>
                <SelectItem value="365">Last Year</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="missed">Missed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="active">Active</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterGuard} onValueChange={setFilterGuard}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                <SelectValue placeholder="Filter by guard" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Guards</SelectItem>
                {guards.map(guard => (
                  <SelectItem key={guard.id} value={guard.id}>
                    {guard.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            {filteredShifts.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                No shifts found matching your filters
              </div>
            ) : (
              filteredShifts.map((shift) => (
                <div
                  key={shift.id}
                  className="p-4 bg-slate-900/50 rounded-lg border border-slate-700 hover:border-slate-600 transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-slate-700 rounded-full flex items-center justify-center">
                        <User className="w-5 h-5 text-slate-300" />
                      </div>
                      <div>
                        <p className="font-semibold text-white">{shift.guard_name || "Unassigned"}</p>
                        <p className="text-sm text-slate-400">{shift.site_name}</p>
                      </div>
                    </div>
                    <Badge className={statusColors[shift.status]}>
                      {statusIcons[shift.status]}
                      <span className="ml-1">{shift.status}</span>
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <p className="text-slate-400 mb-1">Scheduled</p>
                      <p className="text-white font-medium">
                        {new Date(shift.start_time).toLocaleDateString()}
                      </p>
                      <p className="text-slate-500 text-xs">
                        {new Date(shift.start_time).toLocaleTimeString()} - {new Date(shift.end_time).toLocaleTimeString()}
                      </p>
                    </div>

                    {shift.clock_in && (
                      <div>
                        <p className="text-slate-400 mb-1">Clock In</p>
                        <p className="text-emerald-400 font-medium">
                          {new Date(shift.clock_in.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    )}

                    {shift.clock_out && (
                      <div>
                        <p className="text-slate-400 mb-1">Clock Out</p>
                        <p className="text-sky-400 font-medium">
                          {new Date(shift.clock_out.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    )}

                    <div>
                      <p className="text-slate-400 mb-1">Duration</p>
                      <p className="text-white font-medium">
                        {calculateShiftDuration(shift)}
                      </p>
                    </div>
                  </div>

                  {shift.notes && (
                    <div className="mt-3 pt-3 border-t border-slate-700">
                      <p className="text-xs text-slate-400 mb-1">Notes</p>
                      <p className="text-sm text-slate-300">{shift.notes}</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}