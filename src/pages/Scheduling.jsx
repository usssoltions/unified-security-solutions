import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Calendar as CalendarIcon, List, Clock, History } from "lucide-react";
import ShiftForm from "../components/scheduling/ShiftForm";
import BulkScheduler from "../components/scheduling/BulkScheduler";
import CalendarView from "../components/scheduling/CalendarView";
import ShiftDetailsModal from "../components/scheduling/ShiftDetailsModal";
import ShiftHistory from "../components/scheduling/ShiftHistory";

export default function Scheduling() {
  const [showShiftForm, setShowShiftForm] = useState(false);
  const [showBulkScheduler, setShowBulkScheduler] = useState(false);
  const [selectedShift, setSelectedShift] = useState(null);
  const [view, setView] = useState("calendar");

  const { data: shifts = [], refetch } = useQuery({
    queryKey: ["allShifts"],
    queryFn: async () => {
      return await base44.entities.Shift.list();
    }
  });

  const { data: guards = [] } = useQuery({
    queryKey: ["guards"],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role_type === "guard");
    }
  });

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => {
      return await base44.entities.Site.list();
    }
  });

  const handleShiftClick = (shift) => {
    setSelectedShift(shift);
  };

  const handleFormSuccess = () => {
    setShowShiftForm(false);
    refetch();
  };

  const handleBulkSuccess = () => {
    setShowBulkScheduler(false);
    refetch();
  };

  const statusColors = {
    scheduled: "bg-sky-500",
    open: "bg-amber-500",
    accepted: "bg-purple-500",
    active: "bg-emerald-500",
    completed: "bg-green-500",
    missed: "bg-rose-500",
    cancelled: "bg-red-500"
  };

  const upcomingShifts = shifts
    .filter(s => new Date(s.start_time) > new Date() && s.status !== "cancelled")
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .slice(0, 5);

  const openShifts = shifts.filter(s => s.status === "open" || !s.guard_id);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Shift Management</h1>
            <p className="text-slate-400 mt-1">Schedule and manage guard shifts</p>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={() => setView(view === "calendar" ? "list" : "calendar")}
              variant="outline"
              className="border-slate-600 text-slate-300"
            >
              {view === "calendar" ? (
                <>
                  <List className="w-4 h-4 mr-2" />
                  List View
                </>
              ) : (
                <>
                  <CalendarIcon className="w-4 h-4 mr-2" />
                  Calendar
                </>
              )}
            </Button>
            <Button
              onClick={() => setView("history")}
              variant="outline"
              className="border-slate-600 text-slate-300"
            >
              <History className="w-4 h-4 mr-2" />
              History
            </Button>
            <Button
              onClick={() => setShowBulkScheduler(true)}
              className="bg-purple-600 hover:bg-purple-700"
            >
              <Clock className="w-5 h-5 mr-2" />
              Bulk Schedule
            </Button>
            <Button
              onClick={() => setShowShiftForm(true)}
              className="bg-sky-600 hover:bg-sky-700"
            >
              <Plus className="w-5 h-5 mr-2" />
              Add Shift
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">Total Shifts</p>
                  <p className="text-3xl font-bold text-white">{shifts.length}</p>
                </div>
                <CalendarIcon className="w-8 h-8 text-sky-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-amber-500/10 border-amber-500/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-amber-400">Open Shifts</p>
                  <p className="text-3xl font-bold text-white">{openShifts.length}</p>
                  <p className="text-xs text-slate-400 mt-1">Need assignment</p>
                </div>
                <Clock className="w-8 h-8 text-amber-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-emerald-500/10 border-emerald-500/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-emerald-400">Active Now</p>
                  <p className="text-3xl font-bold text-white">
                    {shifts.filter(s => s.status === "active").length}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Guards on duty</p>
                </div>
                <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center">
                  <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {view === "history" ? (
          <ShiftHistory />
        ) : (
          <>
            {openShifts.length > 0 && (
              <Card className="bg-amber-500/10 border-amber-500/20">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Clock className="w-5 h-5 text-amber-400" />
                    Open Shifts - Need Assignment
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {openShifts.map((shift) => (
                      <div
                        key={shift.id}
                        onClick={() => handleShiftClick(shift)}
                        className="p-3 bg-slate-900/50 rounded-lg border border-slate-700 hover:border-amber-500/50 cursor-pointer transition-all"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-white">{shift.site_name}</p>
                            <p className="text-sm text-slate-400">
                              {new Date(shift.start_time).toLocaleString()} - {new Date(shift.end_time).toLocaleTimeString()}
                            </p>
                          </div>
                          <Badge className="bg-amber-500">
                            Unassigned
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {view === "calendar" ? (
              <CalendarView shifts={shifts} onShiftClick={handleShiftClick} />
            ) : (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white">All Shifts</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {shifts.length === 0 ? (
                      <div className="text-center py-12 text-slate-400">
                        <CalendarIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
                        <p>No shifts scheduled yet</p>
                        <p className="text-sm mt-2">Create your first shift to get started</p>
                      </div>
                    ) : (
                      shifts.map((shift) => (
                        <div
                          key={shift.id}
                          onClick={() => handleShiftClick(shift)}
                          className="p-4 bg-slate-900/50 rounded-lg border border-slate-700 hover:border-sky-500/50 cursor-pointer transition-all"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-sky-500 rounded-full flex items-center justify-center">
                                <span className="text-white font-semibold text-sm">
                                  {shift.guard_name?.[0] || "?"}
                                </span>
                              </div>
                              <div>
                                <p className="font-semibold text-white">
                                  {shift.guard_name || "Unassigned"}
                                </p>
                                <p className="text-sm text-slate-400">{shift.site_name}</p>
                              </div>
                            </div>
                            <Badge className={statusColors[shift.status]}>
                              {shift.status}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm text-slate-400">
                            <div>
                              <span className="text-slate-500">Start:</span>{" "}
                              {new Date(shift.start_time).toLocaleString()}
                            </div>
                            <div>
                              <span className="text-slate-500">End:</span>{" "}
                              {new Date(shift.end_time).toLocaleTimeString()}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {showShiftForm && (
        <ShiftForm
          guards={guards}
          sites={sites}
          onClose={() => setShowShiftForm(false)}
          onSuccess={handleFormSuccess}
        />
      )}

      {showBulkScheduler && (
        <BulkScheduler
          guards={guards}
          sites={sites}
          onClose={() => setShowBulkScheduler(false)}
          onSuccess={handleBulkSuccess}
        />
      )}

      {selectedShift && (
        <ShiftDetailsModal
          shift={selectedShift}
          onClose={() => {
            setSelectedShift(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}