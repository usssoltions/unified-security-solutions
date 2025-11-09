import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, MapPin, Clock, User, Calendar, CheckCircle2, XCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export default function ShiftDetailsModal({ shift, onClose }) {
  const queryClient = useQueryClient();

  const deleteShiftMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.Shift.delete(shift.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shifts"]);
      onClose();
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus) => {
      await base44.entities.Shift.update(shift.id, { status: newStatus });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shifts"]);
      onClose();
    }
  });

  const statusColors = {
    scheduled: "bg-sky-500",
    open: "bg-purple-500",
    accepted: "bg-emerald-500",
    active: "bg-emerald-500",
    completed: "bg-slate-500",
    missed: "bg-rose-500",
    cancelled: "bg-amber-500"
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl bg-slate-800 border-slate-700 max-h-[90vh] overflow-y-auto">
        <CardHeader className="border-b border-slate-700">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-white text-xl">Shift Details</CardTitle>
              <p className="text-sm text-slate-400 mt-1">
                {new Date(shift.start_time).toLocaleDateString()}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400">
              <X className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          {/* Status Badge */}
          <div>
            <Badge className={`${statusColors[shift.status]} text-white`}>
              {shift.status.toUpperCase()}
            </Badge>
          </div>

          {/* Shift Information */}
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-sky-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-slate-400">Site</p>
                <p className="text-white font-semibold">{shift.site_name}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <User className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-slate-400">Assigned Guard</p>
                <p className="text-white font-semibold">
                  {shift.guard_name || "Unassigned (Open Shift)"}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-slate-400">Shift Time</p>
                <p className="text-white font-semibold">
                  {new Date(shift.start_time).toLocaleString()} 
                </p>
                <p className="text-white font-semibold">
                  to {new Date(shift.end_time).toLocaleString()}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Duration: {Math.round((new Date(shift.end_time) - new Date(shift.start_time)) / 3600000)} hours
                </p>
              </div>
            </div>

            {shift.clock_in && (
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-slate-400">Clock In</p>
                  <p className="text-white font-semibold">
                    {new Date(shift.clock_in.timestamp).toLocaleString()}
                  </p>
                  {shift.clock_in.location && (
                    <p className="text-xs text-slate-500">
                      GPS: {shift.clock_in.location.lat.toFixed(6)}, {shift.clock_in.location.lng.toFixed(6)}
                    </p>
                  )}
                  {shift.clock_in.verified && (
                    <Badge className="bg-emerald-500 text-xs mt-1">Verified</Badge>
                  )}
                </div>
              </div>
            )}

            {shift.clock_out && (
              <div className="flex items-start gap-3">
                <XCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-slate-400">Clock Out</p>
                  <p className="text-white font-semibold">
                    {new Date(shift.clock_out.timestamp).toLocaleString()}
                  </p>
                  {shift.clock_out.location && (
                    <p className="text-xs text-slate-500">
                      GPS: {shift.clock_out.location.lat.toFixed(6)}, {shift.clock_out.location.lng.toFixed(6)}
                    </p>
                  )}
                </div>
              </div>
            )}

            {shift.notes && (
              <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700">
                <p className="text-xs text-slate-400 mb-1">Notes</p>
                <p className="text-sm text-white">{shift.notes}</p>
              </div>
            )}

            {shift.is_overtime && (
              <Badge className="bg-amber-500">Overtime Shift</Badge>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-slate-700">
            {shift.status === "scheduled" && (
              <>
                <Button
                  onClick={() => updateStatusMutation.mutate("cancelled")}
                  variant="outline"
                  className="flex-1 border-amber-500 text-amber-400 hover:bg-amber-500/10"
                >
                  Cancel Shift
                </Button>
                <Button
                  onClick={() => deleteShiftMutation.mutate()}
                  variant="outline"
                  className="flex-1 border-rose-500 text-rose-400 hover:bg-rose-500/10"
                >
                  Delete Shift
                </Button>
              </>
            )}
            {shift.status === "completed" && (
              <Button
                onClick={onClose}
                className="flex-1 bg-sky-600 hover:bg-sky-700"
              >
                Close
              </Button>
            )}
            {!["scheduled", "completed"].includes(shift.status) && (
              <Button
                onClick={onClose}
                variant="outline"
                className="flex-1 border-slate-600 text-slate-300"
              >
                Close
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}