import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, UserPlus, Clock, MapPin, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function IncidentQueue({ incidents, guards }) {
  const queryClient = useQueryClient();
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [assignToGuard, setAssignToGuard] = useState("");
  const [dispatcherNotes, setDispatcherNotes] = useState("");

  const assignMutation = useMutation({
    mutationFn: async () => {
      // Update incident
      await base44.entities.Incident.update(selectedIncident.id, {
        status: "assigned",
        assigned_to: assignToGuard,
        dispatcher_notes: dispatcherNotes
      });

      // Create assignment
      const guard = guards.find(g => g.guard_id === assignToGuard);
      await base44.entities.Assignment.create({
        type: "incident",
        title: `Respond to ${selectedIncident.category} incident`,
        description: selectedIncident.description,
        priority: selectedIncident.priority,
        assigned_to: assignToGuard,
        assigned_by: (await base44.auth.me()).id,
        site_id: selectedIncident.site_id,
        site_name: selectedIncident.site_name,
        location: selectedIncident.location,
        status: "pending",
        related_id: selectedIncident.id,
        notes: dispatcherNotes
      });

      // Create alert for guard
      await base44.entities.Alert.create({
        type: "assignment",
        priority: selectedIncident.priority,
        title: "New Assignment",
        message: `You have been assigned to respond to a ${selectedIncident.category} incident at ${selectedIncident.site_name}`,
        guard_id: assignToGuard,
        guard_name: guard?.guard_name,
        site_id: selectedIncident.site_id,
        status: "active"
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["pendingIncidents"]);
      setSelectedIncident(null);
      setAssignToGuard("");
      setDispatcherNotes("");
    }
  });

  const priorityColors = {
    critical: "bg-rose-500",
    high: "bg-orange-500",
    medium: "bg-amber-500",
    low: "bg-sky-500"
  };

  return (
    <>
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            Incident Queue
            {incidents.length > 0 && (
              <Badge className="bg-amber-500 ml-auto">{incidents.length} Pending</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {incidents.map((incident) => (
              <div
                key={incident.id}
                className="p-4 bg-slate-900/50 rounded-lg border border-slate-700 hover:border-sky-500/50 transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h4 className="font-semibold text-white text-sm mb-1">{incident.title}</h4>
                    <p className="text-xs text-slate-400 line-clamp-2">{incident.description}</p>
                  </div>
                  <Badge className={priorityColors[incident.priority]}>
                    {incident.priority}
                  </Badge>
                </div>

                <div className="space-y-2 text-xs text-slate-500 mb-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3 h-3" />
                    <span>{incident.site_name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(incident.reported_at).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3" />
                    <span className="capitalize">{incident.category.replace(/_/g, ' ')}</span>
                  </div>
                </div>

                <Button
                  size="sm"
                  onClick={() => setSelectedIncident(incident)}
                  className="w-full bg-sky-600 hover:bg-sky-700"
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  Assign Guard
                </Button>
              </div>
            ))}

            {incidents.length === 0 && (
              <div className="col-span-full text-center py-12">
                <AlertTriangle className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2">No Pending Incidents</h3>
                <p className="text-slate-400">All incidents have been assigned or resolved</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Assignment Dialog */}
      <Dialog open={!!selectedIncident} onOpenChange={() => setSelectedIncident(null)}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-sky-400" />
              Assign Guard to Incident
            </DialogTitle>
          </DialogHeader>
          {selectedIncident && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                <h4 className="font-semibold text-white mb-2">{selectedIncident.title}</h4>
                <p className="text-sm text-slate-400">{selectedIncident.description}</p>
                <div className="flex gap-2 mt-3">
                  <Badge className={priorityColors[selectedIncident.priority]}>
                    {selectedIncident.priority}
                  </Badge>
                  <Badge variant="outline" className="border-slate-600 text-slate-300">
                    {selectedIncident.category}
                  </Badge>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium block mb-2">Assign to Guard</label>
                <Select value={assignToGuard} onValueChange={setAssignToGuard}>
                  <SelectTrigger className="bg-slate-900 border-slate-700">
                    <SelectValue placeholder="Select a guard..." />
                  </SelectTrigger>
                  <SelectContent>
                    {guards.map((guard) => (
                      <SelectItem key={guard.guard_id} value={guard.guard_id}>
                        {guard.guard_name} - {guard.site_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium block mb-2">Dispatcher Notes</label>
                <Textarea
                  placeholder="Instructions or additional information for the guard..."
                  value={dispatcherNotes}
                  onChange={(e) => setDispatcherNotes(e.target.value)}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>

              <Button
                onClick={() => assignMutation.mutate()}
                disabled={!assignToGuard || assignMutation.isPending}
                className="w-full bg-sky-600 hover:bg-sky-700"
              >
                <Send className="w-4 h-4 mr-2" />
                Assign & Notify Guard
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}