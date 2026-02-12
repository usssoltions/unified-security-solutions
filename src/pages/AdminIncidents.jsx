import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, User, MapPin, Clock, CheckCircle2, Wrench, XCircle } from "lucide-react";
import PullToRefresh from "../components/PullToRefresh";

export default function AdminIncidents() {
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [selectedMaintenance, setSelectedMaintenance] = useState(null);
  const [assignGuard, setAssignGuard] = useState("");
  const [notes, setNotes] = useState("");
  const queryClient = useQueryClient();

  const { data: incidents = [] } = useQuery({
    queryKey: ["adminIncidents"],
    queryFn: () => base44.entities.Incident.filter({
      status: { $in: ["reported", "assigned"] }
    }, "-created_date"),
    refetchInterval: 5000
  });

  const { data: maintenance = [] } = useQuery({
    queryKey: ["adminMaintenance"],
    queryFn: () => base44.entities.MaintenanceRequest.filter({
      status: { $in: ["reported", "assigned"] }
    }, "-created_date"),
    refetchInterval: 5000
  });

  const { data: guards = [] } = useQuery({
    queryKey: ["activeGuards"],
    queryFn: async () => {
      const shifts = await base44.entities.Shift.filter({ status: "active" });
      return shifts.map(s => ({ id: s.guard_id, name: s.guard_name }));
    }
  });

  const assignIncidentMutation = useMutation({
    mutationFn: async ({ id, guardId, guardName, notes }) => {
      await base44.entities.Incident.update(id, {
        assigned_to: guardId,
        status: "assigned",
        dispatcher_notes: notes
      });
      
      await base44.entities.Notification.create({
        recipient_id: guardId,
        recipient_name: guardName,
        type: "incident_assigned",
        priority: "high",
        title: "Incident Assigned to You",
        message: `You have been assigned to handle an incident. Check details now.`,
        related_entity: "incident",
        related_id: id
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["adminIncidents"]);
      setSelectedIncident(null);
      setAssignGuard("");
      setNotes("");
    }
  });

  const assignMaintenanceMutation = useMutation({
    mutationFn: async ({ id, guardId, guardName, notes }) => {
      await base44.entities.MaintenanceRequest.update(id, {
        assigned_to: guardId,
        status: "assigned",
        dispatcher_notes: notes
      });
      
      await base44.entities.Notification.create({
        recipient_id: guardId,
        recipient_name: guardName,
        type: "maintenance_assigned",
        priority: "medium",
        title: "Maintenance Request Assigned",
        message: `You have been assigned a maintenance task.`,
        related_entity: "maintenance",
        related_id: id
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["adminMaintenance"]);
      setSelectedMaintenance(null);
      setAssignGuard("");
      setNotes("");
    }
  });

  const resolveIncidentMutation = useMutation({
    mutationFn: (id) => base44.entities.Incident.update(id, { status: "resolved" }),
    onSuccess: () => queryClient.invalidateQueries(["adminIncidents"])
  });

  const resolveMaintenanceMutation = useMutation({
    mutationFn: (id) => base44.entities.MaintenanceRequest.update(id, { status: "completed" }),
    onSuccess: () => queryClient.invalidateQueries(["adminMaintenance"])
  });

  const priorityColors = {
    critical: "bg-rose-500",
    high: "bg-orange-500",
    medium: "bg-amber-500",
    low: "bg-sky-500"
  };

  const urgencyColors = {
    critical: "bg-rose-500",
    high: "bg-orange-500",
    medium: "bg-amber-500",
    low: "bg-sky-500"
  };

  return (
    <PullToRefresh onRefresh={async () => {
      await Promise.all([
        queryClient.invalidateQueries(["adminIncidents"]),
        queryClient.invalidateQueries(["adminMaintenance"])
      ]);
    }}>
      <div className="min-h-screen p-4 lg:p-6 space-y-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-white mb-6">Incident & Maintenance Queue</h1>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Incidents */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-rose-400" />
                  Pending Incidents ({incidents.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {incidents.length === 0 ? (
                  <p className="text-slate-400 text-center py-8">No pending incidents</p>
                ) : (
                  incidents.map((incident) => (
                    <div key={incident.id} className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <h3 className="text-white font-semibold">{incident.title}</h3>
                          <p className="text-sm text-slate-400 mt-1">{incident.description}</p>
                        </div>
                        <Badge className={priorityColors[incident.priority]}>
                          {incident.priority}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-slate-400">
                        <div className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {incident.guard_name}
                        </div>
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {incident.site_name}
                        </div>
                        <div className="flex items-center gap-1 col-span-2">
                          <Clock className="w-3 h-3" />
                          {new Date(incident.created_date).toLocaleString()}
                        </div>
                      </div>

                      {selectedIncident?.id === incident.id ? (
                        <div className="mt-4 space-y-3 pt-3 border-t border-slate-700">
                          <Select value={assignGuard} onValueChange={setAssignGuard}>
                            <SelectTrigger className="bg-slate-800 border-slate-600">
                              <SelectValue placeholder="Assign to guard..." />
                            </SelectTrigger>
                            <SelectContent>
                              {guards.map((guard) => (
                                <SelectItem key={guard.id} value={guard.id}>
                                  {guard.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <Textarea
                            placeholder="Dispatcher notes..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="bg-slate-800 border-slate-600 text-white min-h-20"
                          />

                          <div className="flex gap-2">
                            <Button
                              onClick={() => {
                                const guard = guards.find(g => g.id === assignGuard);
                                assignIncidentMutation.mutate({
                                  id: incident.id,
                                  guardId: assignGuard,
                                  guardName: guard?.name,
                                  notes
                                });
                              }}
                              disabled={!assignGuard}
                              className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                            >
                              <User className="w-4 h-4 mr-2" />
                              Assign
                            </Button>
                            <Button
                              onClick={() => resolveIncidentMutation.mutate(incident.id)}
                              variant="outline"
                              className="flex-1 border-slate-600"
                            >
                              <CheckCircle2 className="w-4 h-4 mr-2" />
                              Resolve
                            </Button>
                            <Button
                              onClick={() => setSelectedIncident(null)}
                              variant="ghost"
                              size="icon"
                            >
                              <XCircle className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          onClick={() => setSelectedIncident(incident)}
                          className="w-full mt-3 bg-sky-600 hover:bg-sky-700"
                          size="sm"
                        >
                          Manage
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Maintenance */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Wrench className="w-5 h-5 text-amber-400" />
                  Pending Maintenance ({maintenance.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {maintenance.length === 0 ? (
                  <p className="text-slate-400 text-center py-8">No pending maintenance</p>
                ) : (
                  maintenance.map((item) => (
                    <div key={item.id} className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <h3 className="text-white font-semibold">{item.title}</h3>
                          <p className="text-sm text-slate-400 mt-1">{item.description}</p>
                        </div>
                        <Badge className={urgencyColors[item.urgency]}>
                          {item.urgency}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-slate-400">
                        <div className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {item.guard_name}
                        </div>
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {item.site_name}
                        </div>
                        <div className="flex items-center gap-1 col-span-2">
                          <Clock className="w-3 h-3" />
                          {new Date(item.created_date).toLocaleString()}
                        </div>
                      </div>

                      {selectedMaintenance?.id === item.id ? (
                        <div className="mt-4 space-y-3 pt-3 border-t border-slate-700">
                          <Select value={assignGuard} onValueChange={setAssignGuard}>
                            <SelectTrigger className="bg-slate-800 border-slate-600">
                              <SelectValue placeholder="Assign to guard..." />
                            </SelectTrigger>
                            <SelectContent>
                              {guards.map((guard) => (
                                <SelectItem key={guard.id} value={guard.id}>
                                  {guard.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <Textarea
                            placeholder="Dispatcher notes..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="bg-slate-800 border-slate-600 text-white min-h-20"
                          />

                          <div className="flex gap-2">
                            <Button
                              onClick={() => {
                                const guard = guards.find(g => g.id === assignGuard);
                                assignMaintenanceMutation.mutate({
                                  id: item.id,
                                  guardId: assignGuard,
                                  guardName: guard?.name,
                                  notes
                                });
                              }}
                              disabled={!assignGuard}
                              className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                            >
                              <User className="w-4 h-4 mr-2" />
                              Assign
                            </Button>
                            <Button
                              onClick={() => resolveMaintenanceMutation.mutate(item.id)}
                              variant="outline"
                              className="flex-1 border-slate-600"
                            >
                              <CheckCircle2 className="w-4 h-4 mr-2" />
                              Complete
                            </Button>
                            <Button
                              onClick={() => setSelectedMaintenance(null)}
                              variant="ghost"
                              size="icon"
                            >
                              <XCircle className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          onClick={() => setSelectedMaintenance(item)}
                          className="w-full mt-3 bg-sky-600 hover:bg-sky-700"
                          size="sm"
                        >
                          Manage
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </PullToRefresh>
  );
}