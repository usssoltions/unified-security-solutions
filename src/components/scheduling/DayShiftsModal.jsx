import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Clock, MapPin, User } from "lucide-react";

export default function DayShiftsModal({ date, shifts, onClose, onCreateShift, onEditShift }) {
  const dateStr = date.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  const getStatusColor = (status) => {
    switch (status) {
      case "scheduled": return "bg-sky-500";
      case "active": return "bg-emerald-500";
      case "completed": return "bg-slate-500";
      case "missed": return "bg-rose-500";
      case "open": return "bg-purple-500";
      default: return "bg-amber-500";
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
      <div className="min-h-screen p-4 flex items-start justify-center pt-20">
        <Card className="w-full max-w-2xl bg-slate-800 border-slate-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white text-xl">{dateStr}</CardTitle>
              <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400">
                <X />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {shifts.length > 0 ? (
              <div className="space-y-3">
                {shifts.map((shift) => (
                  <div
                    key={shift.id}
                    onClick={() => onEditShift(shift)}
                    className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 hover:border-sky-500/50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className={`${getStatusColor(shift.status)} text-white`}>
                            {shift.status}
                          </Badge>
                          <span className="text-sm text-slate-400">
                            {new Date(shift.start_time).toLocaleTimeString('en-US', { 
                              hour: '2-digit', 
                              minute: '2-digit' 
                            })}
                            {' - '}
                            {new Date(shift.end_time).toLocaleTimeString('en-US', { 
                              hour: '2-digit', 
                              minute: '2-digit' 
                            })}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-2 text-slate-300">
                          <User className="w-4 h-4 text-slate-500" />
                          <span className="text-sm">{shift.guard_name || "Open Shift"}</span>
                        </div>
                        
                        <div className="flex items-center gap-2 text-slate-300">
                          <MapPin className="w-4 h-4 text-slate-500" />
                          <span className="text-sm">{shift.site_name}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Clock className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400">No shifts scheduled for this day</p>
              </div>
            )}

            <Button
              onClick={onCreateShift}
              className="w-full bg-sky-600 hover:bg-sky-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create New Shift for This Day
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}