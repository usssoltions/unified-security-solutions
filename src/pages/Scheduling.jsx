
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Plus, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge"; // Added Badge import
import CalendarView from "../components/scheduling/CalendarView";
import ShiftForm from "../components/scheduling/ShiftForm";
import BulkScheduler from "../components/scheduling/BulkScheduler";
import ShiftDetailsModal from "../components/scheduling/ShiftDetailsModal"; // Added ShiftDetailsModal import

export default function Scheduling() {
  const queryClient = useQueryClient();
  const [view, setView] = useState("calendar"); // Added view state
  const [showShiftForm, setShowShiftForm] = useState(false); // Renamed showForm to showShiftForm
  const [showBulkScheduler, setShowBulkScheduler] = useState(false); // Renamed showBulk to showBulkScheduler
  const [selectedShift, setSelectedShift] = useState(null); // Added selectedShift state
  // Removed selectedDate state

  const { data: shifts } = useQuery({
    queryKey: ["allShifts"],
    queryFn: async () => {
      return await base44.entities.Shift.list("-start_time", 100);
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

  const { data: sites } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => {
      return await base44.entities.Site.list();
    },
    initialData: []
  });

  const handleShiftClick = (shift) => {
    setSelectedShift(shift);
  };

  const handleDateSelect = (date) => {
    // Could open form with pre-selected date, for now just logging
    // console.log("Selected date:", date);
  };

  const statusColors = {
    active: "bg-emerald-500/20 text-emerald-400",
    scheduled: "bg-sky-500/20 text-sky-400",
    open: "bg-amber-500/20 text-amber-400",
    completed: "bg-green-500/20 text-green-400",
    canceled: "bg-red-500/20 text-red-400",
    default: "bg-slate-500/20 text-slate-400",
  };

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-purple-600 rounded-full flex items-center justify-center">
            <Calendar className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Shift Scheduling</h1>
            <p className="text-slate-400">Manage guard shifts and assignments</p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            onClick={() => setShowBulkScheduler(true)} // Updated state setter
            variant="outline"
            className="border-slate-600 text-slate-300"
          >
            <Users className="w-5 h-5 mr-2" />
            Bulk Schedule
          </Button>
          <Button
            onClick={() => setShowShiftForm(true)} // Updated state setter
            className="bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700"
          >
            <Plus className="w-5 h-5 mr-2" />
            New Shift
          </Button>
        </div>
      </div>

      {/* Tabs List for view selection - now controlling local state */}
      <TabsList className="bg-slate-800/50 w-full md:w-auto">
        <TabsTrigger
          value="calendar"
          onClick={() => setView("calendar")}
          data-state={view === "calendar" ? "active" : "inactive"}
        >
          Calendar View
        </TabsTrigger>
        <TabsTrigger
          value="list"
          onClick={() => setView("list")}
          data-state={view === "list" ? "active" : "inactive"}
        >
          List View
        </TabsTrigger>
      </TabsList>

      {/* Calendar View */}
      {view === "calendar" && (
        <CalendarView
          shifts={shifts}
          onShiftClick={handleShiftClick} // Updated prop
          onDateSelect={handleDateSelect} // Updated prop
        />
      )}

      {/* List View */}
      {view === "list" && (
        <Card className="bg-slate-800/50 border-slate-700 mt-6">
          <CardContent className="p-4"> {/* Added p-4 padding */}
            <div className="space-y-3">
              {shifts.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No shifts scheduled</p>
              ) : (
                shifts.map((shift) => (
                  <div
                    key={shift.id}
                    onClick={() => handleShiftClick(shift)} // Added onClick to open details modal
                    className="p-4 bg-slate-900/50 rounded-lg border border-slate-700 hover:border-sky-500/50 transition-colors cursor-pointer" // Added hover and cursor styles
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-semibold text-white">{shift.site_name}</h4> {/* Moved site_name to h4 */}
                        <p className="text-sm text-slate-400 mt-1">
                          {shift.guard_name || "Unassigned"}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          {new Date(shift.start_time).toLocaleString()} - {new Date(shift.end_time).toLocaleTimeString()} {/* Updated date format */}
                        </p>
                      </div>
                      <Badge className={statusColors[shift.status] || statusColors.default}> {/* Used Badge component */}
                        {shift.status}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Shift Details Modal */}
      {selectedShift && (
        <ShiftDetailsModal
          shift={selectedShift}
          onClose={() => setSelectedShift(null)}
        />
      )}

      {showShiftForm && ( // Updated state variable
        <ShiftForm
          guards={guards}
          sites={sites}
          onClose={() => setShowShiftForm(false)} // Updated state setter
          onSuccess={() => {
            setShowShiftForm(false); // Updated state setter
            queryClient.invalidateQueries(["allShifts"]);
          }}
        />
      )}

      {showBulkScheduler && ( // Updated state variable
        <BulkScheduler
          guards={guards}
          sites={sites}
          onClose={() => setShowBulkScheduler(false)} // Updated state setter
          onSuccess={() => {
            setShowBulkScheduler(false); // Updated state setter
            queryClient.invalidateQueries(["allShifts"]);
          }}
        />
      )}
    </div>
  );
}
