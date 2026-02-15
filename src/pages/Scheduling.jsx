import React, { useState, useEffect } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ShiftForm from "../components/scheduling/ShiftForm";
import BulkScheduler from "../components/scheduling/BulkScheduler";
import CalendarView from "../components/scheduling/CalendarView";
import ShiftDetailsModal from "../components/scheduling/ShiftDetailsModal";
import ShiftHistory from "../components/scheduling/ShiftHistory";
import PrintableSchedule from "../components/scheduling/PrintableSchedule";
import ShiftListView from "../components/scheduling/ShiftListView";
import BulkShiftActions from "../components/scheduling/BulkShiftActions";
import ShiftSwapManager from "../components/scheduling/ShiftSwapManager";
import OnCallScheduling from "../components/scheduling/OnCallScheduling";
import DayShiftsModal from "../components/scheduling/DayShiftsModal";

export default function Scheduling() {
  const [user, setUser] = useState(null);
  
  useEffect(() => {
    loadUser();
  }, []);
  
  const loadUser = async () => {
    const currentUser = await base44.auth.me();
    setUser(currentUser);
  };
  const [showShiftForm, setShowShiftForm] = useState(false);
  const [showBulkScheduler, setShowBulkScheduler] = useState(false);
  const [selectedShift, setSelectedShift] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showDayModal, setShowDayModal] = useState(false);
  const [dayModalShifts, setDayModalShifts] = useState([]);
  const [siteFilter, setSiteFilter] = useState("all");
  const [guardFilter, setGuardFilter] = useState("all");
  const [viewMode, setViewMode] = useState("calendar"); // calendar or list
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [showPrintView, setShowPrintView] = useState(false);
  const [selectedShifts, setSelectedShifts] = useState([]);
  const queryClient = useQueryClient();

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts'],
    queryFn: async () => {
      const data = await base44.entities.Shift.list('-start_time', 500);
      return Array.isArray(data) ? data : [];
    },
    initialData: [],
    refetchInterval: 10000,
    staleTime: 0,
    cacheTime: 0
  });

  const { data: guards = [] } = useQuery({
    queryKey: ['guards'],
    queryFn: async () => {
      const users = await base44.entities.User.filter({ role_type: 'guard' });
      return Array.isArray(users) ? users : [];
    },
    initialData: [],
    refetchInterval: 30000,
    staleTime: 0,
    cacheTime: 0
  });

  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: async () => {
      const data = await base44.entities.Site.list();
      return Array.isArray(data) ? data : [];
    },
    initialData: [],
    refetchInterval: 30000,
    staleTime: 0,
    cacheTime: 0
  });

  const shiftsArray = Array.isArray(shifts) ? shifts : [];
  const filteredShifts = shiftsArray.filter(shift => {
    const matchesSite = siteFilter === "all" || shift.site_id === siteFilter;
    const matchesGuard = guardFilter === "all" || shift.guard_id === guardFilter;
    
    // Only filter by month/year if we are in calendar or list view and not in print preview (print view handles its own filtering)
    // The printable schedule component will take care of filtering its own content
    const shiftDate = new Date(shift.start_time);
    const matchesMonthYear = shiftDate.getMonth() === currentMonth && shiftDate.getFullYear() === currentYear;
    
    return matchesSite && matchesGuard && matchesMonthYear;
  });

  const handleSelectShift = (shiftId, checked) => {
    if (checked) {
      setSelectedShifts([...selectedShifts, shiftId]);
    } else {
      setSelectedShifts(selectedShifts.filter(id => id !== shiftId));
    }
  };

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedShifts(filteredShifts.map(s => s.id));
    } else {
      setSelectedShifts([]);
    }
  };

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
    <div className="min-h-screen p-3 sm:p-4 lg:p-6 w-full overflow-x-hidden">
      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">
        <div className="flex flex-col gap-3 sm:gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white">Shift Scheduling</h1>
              <p className="text-xs sm:text-sm text-slate-400 mt-1">Manage guard shifts and assignments</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={handlePrint} variant="outline" size="sm" className="border-slate-600 text-xs sm:text-sm">
                <Printer className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                Print
              </Button>
              <Button onClick={() => setShowBulkScheduler(true)} variant="outline" size="sm" className="border-slate-600 text-xs sm:text-sm">
                <CalendarIcon className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                Bulk
              </Button>
              <Button onClick={() => setShowShiftForm(true)} size="sm" className="bg-sky-600 hover:bg-sky-700 text-xs sm:text-sm">
                <Plus className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                New
              </Button>
            </div>
          </div>

          {/* Bulk Actions Bar */}
          {selectedShifts.length > 0 && (
            <BulkShiftActions
              selectedShifts={selectedShifts}
              allShifts={filteredShifts}
              guards={guards}
              sites={sites}
              onClearSelection={() => setSelectedShifts([])}
            />
          )}
        </div>

        <Card className="bg-slate-800/50 border-slate-700 w-full overflow-hidden">
          <CardHeader className="p-3 sm:p-4 lg:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
              <CardTitle className="text-white text-base sm:text-lg">Schedule Overview</CardTitle>
              <div className="flex gap-2">
                <Button
                  variant={viewMode === "calendar" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("calendar")}
                  className={viewMode === "calendar" ? "bg-sky-600 text-xs sm:text-sm" : "border-slate-600 text-slate-300 text-xs sm:text-sm"}
                >
                  <Grid className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                  Calendar
                </Button>
                <Button
                  variant={viewMode === "list" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("list")}
                  className={viewMode === "list" ? "bg-sky-600 text-xs sm:text-sm" : "border-slate-600 text-slate-300 text-xs sm:text-sm"}
                >
                  <List className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                  List
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 sm:space-y-4 p-3 sm:p-4 lg:p-6 pt-0">
            <div className="flex flex-col gap-3 sm:gap-4">
              <Select value={siteFilter} onValueChange={setSiteFilter}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white text-sm">
                  <SelectValue placeholder="All Sites" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sites</SelectItem>
                  {sites.map(site => (
                    <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Select value={guardFilter} onValueChange={setGuardFilter}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white text-sm">
                  <SelectValue placeholder="All Guards" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Guards</SelectItem>
                  {guards.map(guard => (
                    <SelectItem key={guard.id} value={guard.id}>{guard.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {viewMode === "calendar" ? (
              <CalendarView
                shifts={filteredShifts}
                guards={guards}
                sites={sites}
                onShiftClick={setSelectedShift}
                onDateSelect={(date) => {
                  const dayShifts = shiftsArray.filter(shift => {
                    const shiftDate = new Date(shift.start_time);
                    const matchesDate = shiftDate.toDateString() === date.toDateString();
                    const matchesSite = siteFilter === "all" || shift.site_id === siteFilter;
                    const matchesGuard = guardFilter === "all" || shift.guard_id === guardFilter;
                    return matchesDate && matchesSite && matchesGuard;
                  });
                  setSelectedDate(date);
                  setDayModalShifts(dayShifts);
                  setShowDayModal(true);
                }}
                currentMonth={currentMonth}
                currentYear={currentYear}
                onMonthChange={(month, year) => {
                  setCurrentMonth(month);
                  setCurrentYear(year);
                }}
              />
            ) : (
              <ShiftListView
                shifts={filteredShifts}
                guards={guards}
                sites={sites}
                onShiftClick={setSelectedShift}
                selectedShifts={selectedShifts}
                onSelectShift={handleSelectShift}
                onSelectAll={handleSelectAll}
              />
            )}
          </CardContent>
        </Card>

        {showShiftForm && (
          <ShiftForm
            guards={guards}
            sites={sites}
            preselectedDate={selectedDate}
            onClose={() => {
              setShowShiftForm(false);
              setSelectedDate(null);
            }}
            onSuccess={() => {
              setShowShiftForm(false);
              setSelectedDate(null);
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

        {/* Shift Swap Manager */}
        {user && <ShiftSwapManager user={user} />}

        {/* On-Call Scheduling */}
        {user && <OnCallScheduling user={user} />}

        {/* Day Shifts Modal */}
        {showDayModal && selectedDate && (
          <DayShiftsModal
            date={selectedDate}
            shifts={dayModalShifts}
            onClose={() => {
              setShowDayModal(false);
              setSelectedDate(null);
              setDayModalShifts([]);
            }}
            onCreateShift={() => {
              setShowDayModal(false);
              setShowShiftForm(true);
            }}
            onEditShift={(shift) => {
              setShowDayModal(false);
              setSelectedShift(shift);
            }}
          />
        )}
      </div>
    </div>
  );
}