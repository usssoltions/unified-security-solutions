
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Calendar as CalendarIcon,
  Plus,
  Clock,
  MapPin,
  User,
  Printer,
  Filter,
  List,
  Grid
} from "lucide-react";
import ShiftForm from "../components/scheduling/ShiftForm";
import BulkScheduler from "../components/scheduling/BulkScheduler";
import CalendarView from "../components/scheduling/CalendarView";
import ShiftDetailsModal from "../components/scheduling/ShiftDetailsModal";
import ShiftHistory from "../components/scheduling/ShiftHistory";
import PrintableSchedule from "../components/scheduling/PrintableSchedule";

export default function Scheduling() {
  const [showShiftForm, setShowShiftForm] = useState(false);
  const [showBulkScheduler, setShowBulkScheduler] = useState(false);
  const [selectedShift, setSelectedShift] = useState(null);
  const [siteFilter, setSiteFilter] = useState("all");
  const [guardFilter, setGuardFilter] = useState("all");
  const [viewMode, setViewMode] = useState("calendar"); // calendar or list
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [showPrintView, setShowPrintView] = useState(false);
  const queryClient = useQueryClient();

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => base44.entities.Shift.list('-start_time', 500),
    initialData: [],
    refetchInterval: 10000,
    staleTime: 0,
    cacheTime: 0
  });

  const { data: guards = [] } = useQuery({
    queryKey: ['guards'],
    queryFn: async () => {
      const users = await base44.entities.User.filter({ role_type: 'guard' });
      return users || [];
    },
    initialData: [],
    refetchInterval: 30000,
    staleTime: 0,
    cacheTime: 0
  });

  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: () => base44.entities.Site.list(),
    initialData: [],
    refetchInterval: 30000,
    staleTime: 0,
    cacheTime: 0
  });

  const filteredShifts = shifts.filter(shift => {
    const matchesSite = siteFilter === "all" || shift.site_id === siteFilter;
    const matchesGuard = guardFilter === "all" || shift.guard_id === guardFilter;
    
    // Only filter by month/year if we are in calendar or list view and not in print preview (print view handles its own filtering)
    // The printable schedule component will take care of filtering its own content
    const shiftDate = new Date(shift.start_time);
    const matchesMonthYear = shiftDate.getMonth() === currentMonth && shiftDate.getFullYear() === currentYear;
    
    return matchesSite && matchesGuard && matchesMonthYear;
  });

  const handlePrint = () => {
    setShowPrintView(true);
    // Give a small delay for the PrintableSchedule component to render before printing
    setTimeout(() => {
      window.print();
      setShowPrintView(false);
    }, 500);
  };

  if (showPrintView) {
    return (
      <div className="print-wrapper">
        <PrintableSchedule
          shifts={filteredShifts} // The filteredShifts should already be based on the currentMonth/Year from the main view
          guards={guards}
          month={currentMonth}
          year={currentYear}
          siteName={siteFilter === "all" ? "All Sites" : sites.find(s => s.id === siteFilter)?.name}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">Shift Scheduling</h1>
            <p className="text-slate-400 mt-1">Manage guard shifts and assignments</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handlePrint} variant="outline" className="border-slate-600">
              <Printer className="w-4 h-4 mr-2" />
              Print
            </Button>
            <Button onClick={() => setShowBulkScheduler(true)} variant="outline" className="border-slate-600">
              <CalendarIcon className="w-4 h-4 mr-2" />
              Bulk Schedule
            </Button>
            <Button onClick={() => setShowShiftForm(true)} className="bg-sky-600 hover:bg-sky-700">
              <Plus className="w-4 h-4 mr-2" />
              New Shift
            </Button>
          </div>
        </div>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <CardTitle className="text-white">Schedule Overview</CardTitle>
              <div className="flex gap-2">
                <Button
                  variant={viewMode === "calendar" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("calendar")}
                  className={viewMode === "calendar" ? "bg-sky-600" : "border-slate-600 text-slate-300"}
                >
                  <Grid className="w-4 h-4 mr-2" />
                  Calendar
                </Button>
                <Button
                  variant={viewMode === "list" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("list")}
                  className={viewMode === "list" ? "bg-sky-600" : "border-slate-600 text-slate-300"}
                >
                  <List className="w-4 h-4 mr-2" />
                  List
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col md:flex-row gap-4">
              <select
                value={siteFilter}
                onChange={(e) => setSiteFilter(e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-700 text-white rounded-md p-2"
              >
                <option value="all">All Sites</option>
                {sites.map(site => (
                  <option key={site.id} value={site.id}>{site.name}</option>
                ))}
              </select>
              <select
                value={guardFilter}
                onChange={(e) => setGuardFilter(e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-700 text-white rounded-md p-2"
              >
                <option value="all">All Guards</option>
                {guards.map(guard => (
                  <option key={guard.id} value={guard.id}>{guard.full_name}</option>
                ))}
              </select>
            </div>

            {viewMode === "calendar" ? (
              <CalendarView
                shifts={filteredShifts}
                guards={guards}
                sites={sites}
                onShiftClick={setSelectedShift}
                currentMonth={currentMonth}
                currentYear={currentYear}
                onMonthChange={(month, year) => {
                  setCurrentMonth(month);
                  setCurrentYear(year);
                }}
              />
            ) : (
              <ShiftHistory
                shifts={filteredShifts}
                onShiftClick={setSelectedShift}
              />
            )}
          </CardContent>
        </Card>

        {showShiftForm && (
          <ShiftForm
            guards={guards}
            sites={sites}
            onClose={() => setShowShiftForm(false)}
            onSuccess={() => {
              setShowShiftForm(false);
              queryClient.invalidateQueries(['shifts']);
            }}
          />
        )}

        {showBulkScheduler && (
          <BulkScheduler
            guards={guards}
            sites={sites}
            onClose={() => setShowBulkScheduler(false)}
            onSuccess={() => {
              setShowBulkScheduler(false);
              queryClient.invalidateQueries(['shifts']);
            }}
          />
        )}

        {selectedShift && (
          <ShiftDetailsModal
            shift={selectedShift}
            guards={guards}
            sites={sites}
            onClose={() => setSelectedShift(null)}
            onUpdate={() => {
              queryClient.invalidateQueries(['shifts']);
            }}
          />
        )}
      </div>
    </div>
  );
}
