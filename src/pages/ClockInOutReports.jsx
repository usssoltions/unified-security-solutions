import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, MapPin, Calendar, User, Download, Filter, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import moment from "moment";

export default function ClockInOutReports() {
  const [dateFrom, setDateFrom] = useState(moment().subtract(7, 'days').format('YYYY-MM-DD'));
  const [dateTo, setDateTo] = useState(moment().format('YYYY-MM-DD'));
  const [selectedSite, setSelectedSite] = useState("all");
  const [selectedGuard, setSelectedGuard] = useState("all");

  const { data: shifts = [], isLoading } = useQuery({
    queryKey: ['clockInOutReports', dateFrom, dateTo],
    queryFn: async () => {
      const allShifts = await base44.entities.Shift.list();
      return allShifts.filter(shift => {
        if (!shift.clock_in?.timestamp) return false;
        const shiftDate = moment(shift.clock_in.timestamp).format('YYYY-MM-DD');
        return shiftDate >= dateFrom && shiftDate <= dateTo;
      });
    }
  });

  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: () => base44.entities.Site.list()
  });

  const { data: guards = [] } = useQuery({
    queryKey: ['guards'],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role_type === 'guard');
    }
  });

  // Filter shifts
  const filteredShifts = useMemo(() => {
    return shifts.filter(shift => {
      if (selectedSite !== "all" && shift.site_id !== selectedSite) return false;
      if (selectedGuard !== "all" && shift.guard_id !== selectedGuard) return false;
      return true;
    });
  }, [shifts, selectedSite, selectedGuard]);

  // Calculate statistics per site
  const siteSummaries = useMemo(() => {
    const summaries = {};
    
    filteredShifts.forEach(shift => {
      if (!summaries[shift.site_id]) {
        summaries[shift.site_id] = {
          site_name: shift.site_name,
          total_shifts: 0,
          total_hours: 0,
          guards: new Set(),
          on_time: 0,
          late: 0
        };
      }
      
      summaries[shift.site_id].total_shifts++;
      summaries[shift.site_id].guards.add(shift.guard_id);
      
      if (shift.clock_in?.timestamp && shift.clock_out?.timestamp) {
        const duration = moment(shift.clock_out.timestamp).diff(moment(shift.clock_in.timestamp), 'hours', true);
        summaries[shift.site_id].total_hours += duration;
      }
      
      // Check if on time (within 15 mins of scheduled start)
      if (shift.start_time && shift.clock_in?.timestamp) {
        const scheduledStart = moment(shift.start_time);
        const actualStart = moment(shift.clock_in.timestamp);
        const diff = actualStart.diff(scheduledStart, 'minutes');
        
        if (diff <= 15) {
          summaries[shift.site_id].on_time++;
        } else {
          summaries[shift.site_id].late++;
        }
      }
    });
    
    return Object.values(summaries).map(s => ({
      ...s,
      guards: s.guards.size,
      avg_hours: s.total_shifts > 0 ? (s.total_hours / s.total_shifts).toFixed(1) : 0
    }));
  }, [filteredShifts]);

  const exportToCSV = () => {
    const headers = ['Date', 'Guard', 'Site', 'Clock In Time', 'Clock In Location', 'Clock Out Time', 'Clock Out Location', 'Duration (hrs)', 'Status'];
    
    const rows = filteredShifts.map(shift => {
      const clockIn = shift.clock_in?.timestamp ? moment(shift.clock_in.timestamp).format('YYYY-MM-DD HH:mm') : 'N/A';
      const clockOut = shift.clock_out?.timestamp ? moment(shift.clock_out.timestamp).format('YYYY-MM-DD HH:mm') : 'Not clocked out';
      
      const duration = (shift.clock_in?.timestamp && shift.clock_out?.timestamp)
        ? moment(shift.clock_out.timestamp).diff(moment(shift.clock_in.timestamp), 'hours', true).toFixed(2)
        : 'N/A';
      
      const clockInLoc = shift.clock_in?.location ? `${shift.clock_in.location.lat.toFixed(6)}, ${shift.clock_in.location.lng.toFixed(6)}` : 'N/A';
      const clockOutLoc = shift.clock_out?.location ? `${shift.clock_out.location.lat.toFixed(6)}, ${shift.clock_out.location.lng.toFixed(6)}` : 'N/A';
      
      return [
        moment(shift.clock_in?.timestamp || shift.start_time).format('YYYY-MM-DD'),
        shift.guard_name || 'N/A',
        shift.site_name || 'N/A',
        clockIn,
        clockInLoc,
        clockOut,
        clockOutLoc,
        duration,
        shift.status
      ];
    });
    
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clock-in-out-report-${dateFrom}-to-${dateTo}.csv`;
    a.click();
  };

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
            <Clock className="w-8 h-8 text-sky-400" />
            Clock In/Out Reports
          </h1>
          <p className="text-slate-400 mt-1">View and export attendance records</p>
        </div>
        <Button onClick={exportToCSV} className="bg-emerald-600 hover:bg-emerald-700">
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="text-sm text-slate-400 mb-2 block">From Date</label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-slate-900 border-slate-700 text-white"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400 mb-2 block">To Date</label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-slate-900 border-slate-700 text-white"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400 mb-2 block">Site</label>
            <Select value={selectedSite} onValueChange={setSelectedSite}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700">
                <SelectItem value="all" className="text-white">All Sites</SelectItem>
                {sites.map(site => (
                  <SelectItem key={site.id} value={site.id} className="text-white">
                    {site.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm text-slate-400 mb-2 block">Guard</label>
            <Select value={selectedGuard} onValueChange={setSelectedGuard}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700">
                <SelectItem value="all" className="text-white">All Guards</SelectItem>
                {guards.map(guard => (
                  <SelectItem key={guard.id} value={guard.id} className="text-white">
                    {guard.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Site Summaries */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            Summary by Site
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {siteSummaries.map((summary, idx) => (
              <div key={idx} className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                <h3 className="font-semibold text-white mb-3">{summary.site_name}</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total Shifts:</span>
                    <span className="text-white font-semibold">{summary.total_shifts}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total Hours:</span>
                    <span className="text-white font-semibold">{summary.total_hours.toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Avg Hours/Shift:</span>
                    <span className="text-white font-semibold">{summary.avg_hours}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Guards:</span>
                    <span className="text-white font-semibold">{summary.guards}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">On Time:</span>
                    <span className="text-emerald-400 font-semibold">{summary.on_time}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Late:</span>
                    <span className="text-amber-400 font-semibold">{summary.late}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Detailed Records */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">
            Detailed Records ({filteredShifts.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-400 mx-auto" />
            </div>
          ) : filteredShifts.length === 0 ? (
            <div className="text-center py-12">
              <Clock className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No records found for the selected filters</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredShifts.map((shift) => {
                const duration = (shift.clock_in?.timestamp && shift.clock_out?.timestamp)
                  ? moment(shift.clock_out.timestamp).diff(moment(shift.clock_in.timestamp), 'hours', true).toFixed(1)
                  : null;

                return (
                  <div key={shift.id} className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-sky-500/20 rounded-full flex items-center justify-center">
                          <User className="w-5 h-5 text-sky-400" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-white">{shift.guard_name}</h4>
                          <p className="text-sm text-slate-400">{shift.site_name}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Badge className={
                          shift.status === 'completed' ? 'bg-emerald-500' :
                          shift.status === 'active' ? 'bg-sky-500' :
                          'bg-slate-500'
                        }>
                          {shift.status}
                        </Badge>
                        {duration && (
                          <Badge variant="outline" className="border-slate-600 text-slate-300">
                            {duration} hrs
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      {/* Clock In */}
                      <div className="p-3 bg-slate-800/50 rounded">
                        <div className="flex items-center gap-2 text-emerald-400 mb-2">
                          <Clock className="w-4 h-4" />
                          <span className="font-medium">Clock In</span>
                        </div>
                        {shift.clock_in?.timestamp ? (
                          <>
                            <p className="text-white mb-1">
                              {moment(shift.clock_in.timestamp).format('MMM D, YYYY - HH:mm')}
                            </p>
                            {shift.clock_in.location && (
                              <div className="flex items-start gap-1 text-xs text-slate-400">
                                <MapPin className="w-3 h-3 mt-0.5" />
                                <a
                                  href={`https://www.google.com/maps?q=${shift.clock_in.location.lat},${shift.clock_in.location.lng}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:text-sky-400"
                                >
                                  {shift.clock_in.location.lat.toFixed(6)}, {shift.clock_in.location.lng.toFixed(6)}
                                </a>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-slate-500">Not clocked in</p>
                        )}
                      </div>

                      {/* Clock Out */}
                      <div className="p-3 bg-slate-800/50 rounded">
                        <div className="flex items-center gap-2 text-rose-400 mb-2">
                          <Clock className="w-4 h-4" />
                          <span className="font-medium">Clock Out</span>
                        </div>
                        {shift.clock_out?.timestamp ? (
                          <>
                            <p className="text-white mb-1">
                              {moment(shift.clock_out.timestamp).format('MMM D, YYYY - HH:mm')}
                            </p>
                            {shift.clock_out.location && (
                              <div className="flex items-start gap-1 text-xs text-slate-400">
                                <MapPin className="w-3 h-3 mt-0.5" />
                                <a
                                  href={`https://www.google.com/maps?q=${shift.clock_out.location.lat},${shift.clock_out.location.lng}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:text-sky-400"
                                >
                                  {shift.clock_out.location.lat.toFixed(6)}, {shift.clock_out.location.lng.toFixed(6)}
                                </a>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-slate-500">Not clocked out</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}