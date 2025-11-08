import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Plus, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CalendarView from "../components/scheduling/CalendarView";
import ShiftForm from "../components/scheduling/ShiftForm";
import BulkScheduler from "../components/scheduling/BulkScheduler";

export default function Scheduling() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());

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
            onClick={() => setShowBulk(true)}
            variant="outline"
            className="border-slate-600 text-slate-300"
          >
            <Users className="w-5 h-5 mr-2" />
            Bulk Schedule
          </Button>
          <Button
            onClick={() => setShowForm(true)}
            className="bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700"
          >
            <Plus className="w-5 h-5 mr-2" />
            New Shift
          </Button>
        </div>
      </div>

      <Tabs defaultValue="calendar" className="w-full">
        <TabsList className="bg-slate-800/50">
          <TabsTrigger value="calendar">Calendar View</TabsTrigger>
          <TabsTrigger value="list">List View</TabsTrigger>
        </TabsList>

        <TabsContent value="calendar" className="mt-6">
          <CalendarView
            shifts={shifts}
            onDateSelect={setSelectedDate}
            onShiftClick={(shift) => console.log("Edit shift:", shift)}
          />
        </TabsContent>

        <TabsContent value="list" className="mt-6">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">All Shifts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {shifts.map((shift) => (
                  <div
                    key={shift.id}
                    className="p-4 bg-slate-900/50 rounded-lg border border-slate-700 flex items-center justify-between"
                  >
                    <div>
                      <h4 className="font-semibold text-white">{shift.guard_name || "Unassigned"}</h4>
                      <p className="text-sm text-slate-400">
                        {shift.site_name} • {new Date(shift.start_time).toLocaleString()}
                      </p>
                    </div>
                    <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      shift.status === "active" ? "bg-emerald-500/20 text-emerald-400" :
                      shift.status === "scheduled" ? "bg-sky-500/20 text-sky-400" :
                      shift.status === "open" ? "bg-amber-500/20 text-amber-400" :
                      "bg-slate-500/20 text-slate-400"
                    }`}>
                      {shift.status}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {showForm && (
        <ShiftForm
          guards={guards}
          sites={sites}
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            queryClient.invalidateQueries(["allShifts"]);
          }}
        />
      )}

      {showBulk && (
        <BulkScheduler
          guards={guards}
          sites={sites}
          onClose={() => setShowBulk(false)}
          onSuccess={() => {
            setShowBulk(false);
            queryClient.invalidateQueries(["allShifts"]);
          }}
        />
      )}
    </div>
  );
}