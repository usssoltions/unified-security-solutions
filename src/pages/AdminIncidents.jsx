import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Wrench, User, MapPin, Clock, CheckCircle2, XCircle, History, Loader2 } from "lucide-react";
import PullToRefresh from "../components/PullToRefresh";
import ActivityTimeline from "@/components/shared/ActivityTimeline";

export default function AdminIncidents() {
  const [user, setUser] = useState(null);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [selectedMaintenance, setSelectedMaintenance] = useState(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [notes, setNotes] = useState("");
  const [resolveModal, setResolveModal] = useState(null); // { type, id, title }
  const [resolveNotes, setResolveNotes] = useState("");
  const queryClient = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser).catch(() => {}); }, []);

  // ── Queries (NO polling — realtime subscription drives updates) ──────────
  const { data: incidents = [] } = useQuery({
    queryKey: ["adminIncidents"],
    queryFn: () => base44.entities.Incident.filter(
      { status: { $in: ["reported", "assigned", "accepted", "in_progress", "declined"] } },
      "-created_date", 50
    ),
    enabled: !!user,
  });

  const { data: maintenance = [] } = useQuery({
    queryKey: ["adminMaintenance"],
    queryFn: () => base44.entities.MaintenanceRequest.filter(
      { status: { $in: ["reported", "assigned", "accepted", "in_progress", "declined"] } },
      "-created_date", 50
    ),
    enabled: !!user,
  });

  // ── Dynamic assignee list (10-min cache to avoid repeated User.list) ─────
  const { data: assignees = [] } = useQuery({
    queryKey: ["assignableUsers"],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      const shifts = await base44.entities.Shift.filter({ status: "active" });
      const onDutyMap = {};
      shifts.forEach(s => { if (s.guard_id) onDutyMap[s.guard_id] = s.site_name || "On duty"; });
      return (users || [])
        .filter(u => ["guard", "supervisor", "dispatcher", "admin", "estate_manager"].includes(u.role_type))
        .map(u => ({
          id: u.id,
          name: u.display_name || u.full_name,
          role: u.role_type,
          onDuty: onDutyMap[u.id] || null,
        }));
    },
    staleTime: 10 * 60 * 1000,
    enabled: !!user,
  });

  // ── Realtime subscriptions (replace 5s polling) ──────────────────────────
  useEffect(() => {
    if (!user) return;
    const unsubI = base44.entities.Incident.subscribe(() => {
      queryClient.invalidateQueries({ queryKey: ["adminIncidents"] });
    });
    const unsubM = base44.entities.MaintenanceRequest.subscribe(() => {
      queryClient.invalidateQueries({ queryKey: ["adminMaintenance"] });
    });
    return () => { unsubI(); unsubM(); };
  }, [user, queryClient]);

  // ── Mutations ────────────────────────────────────────────────────────────
  const assignIncident = useMutation({
    mutationFn: async ({ id, item }) => {
      const assignee = assignees.find(a => a.id === assigneeId);
      if (!assignee) throw new Error("Select an assignee");
      const nowIso = new Date().toISOString();
      await base44.entities.Incident.update(id, {
        assigned_to: assignee.id,
        assigned_to_name: assignee.name,
        status: "assigned",
        assigned_by: user.id,
        assigned_by_name: user.display_name || user.full_name,
        assigned_at: nowIso,
        dispatcher_notes: notes || undefined,
        activity_log: [...(item.activity_log || []), {
          timestamp: nowIso, action: "assigned",
          by_user_id: user.id, by_user_name: user.display_name || user.full_name,
          from_status: item.status, to_status: "assigned",
          notes: `Assigned to ${assignee.name} (${assignee.role})`
        }]
      });
      await base44.functions.invoke("notifyIncidentWorkflow", {
        action: "assigned", incidentId: id,
        incidentNumber: item.incident_number, performedByUserId: user.id, performedByName: user.display_name || user.full_name,
        assigneeId: assignee.id, assigneeName: assignee.name,
        incidentTitle: item.title, incidentType: item.category, category: item.category,
        priority: item.priority, siteName: item.site_name, location: item.location
      });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["adminIncidents"] }); setSelectedIncident(null); setAssigneeId(""); setNotes(""); }
  });

  const assignMaintenance = useMutation({
    mutationFn: async ({ id, item }) => {
      const assignee = assignees.find(a => a.id === assigneeId);
      if (!assignee) throw new Error("Select an assignee");
      const nowIso = new Date().toISOString();
      await base44.entities.MaintenanceRequest.update(id, {
        assigned_to: assignee.id,
        assigned_to_name: assignee.name,
        status: "assigned",
        assigned_by: user.id,
        assigned_by_name: user.display_name || user.full_name,
        assigned_at: nowIso,
        activity_log: [...(item.activity_log || []), {
          timestamp: nowIso, action: "assigned",
          by_user_id: user.id, by_user_name: user.display_name || user.full_name,
          from_status: item.status, to_status: "assigned",
          notes: `Assigned to ${assignee.name} (${assignee.role})`
        }]
      });
      await base44.functions.invoke("notifyMaintenanceWorkflow", {
        action: "assigned", maintenanceId: id,
        requestNumber: item.request_number, performedByUserId: user.id, performedByName: user.display_name || user.full_name,
        assigneeId: assignee.id, assigneeName: assignee.name,
        title: item.title, category: item.category, urgency: item.urgency, siteName: item.site_name, location: item.location
      });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["adminMaintenance"] }); setSelectedMaintenance(null); setAssigneeId(""); setNotes(""); }
  });

  const resolveItem = useMutation({
    mutationFn: async () => {
      const { type, id, item } = resolveModal;
      const nowIso = new Date().toISOString();
      if (type === "incident") {
        await base44.entities.Incident.update(id, {
          status: "resolved", resolved_at: nowIso,
          resolved_by: user.id, resolved_by_name: user.display_name || user.full_name,
          resolution_notes: resolveNotes,
          activity_log: [...(item.activity_log || []), {
            timestamp: nowIso, action: "resolved",
            by_user_id: user.id, by_user_name: user.display_name || user.full_name,
            from_status: item.status, to_status: "resolved", notes: resolveNotes
          }]
        });
        await base44.functions.invoke("notifyIncidentWorkflow", {
          action: "resolved", incidentId: id, incidentNumber: item.incident_number,
          performedByUserId: user.id, performedByName: user.display_name || user.full_name,
          resolutionNotes: resolveNotes, incidentTitle: item.title, incidentType: item.category,
          category: item.category, priority: item.priority, siteName: item.site_name, location: item.location
        });
      } else {
        await base44.entities.MaintenanceRequest.update(id, {
          status: "completed", completed_at: nowIso,
          completed_by: user.id, completed_by_name: user.display_name || user.full_name,
          completion_notes: resolveNotes,
          activity_log: [...(item.activity_log || []), {
            timestamp: nowIso, action: "completed",
            by_user_id: user.id, by_user_name: user.display_name || user.full_name,
            from_status: item.status, to_status: "completed", notes: resolveNotes
          }]
        });
        await base44.functions.invoke("notifyMaintenanceWorkflow", {
          action: "completed", maintenanceId: id, requestNumber: item.request_number,
          performedByUserId: user.id, performedByName: user.display_name || user.full_name,
          completionNotes: resolveNotes, title: item.title, category: item.category,
          urgency: item.urgency, siteName: item.site_name, location: item.location
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminIncidents"] });
      queryClient.invalidateQueries({ queryKey: ["adminMaintenance"] });
      setResolveModal(null); setResolveNotes("");
    }
  });

  const priorityColors = { critical: "bg-rose-500", high: "bg-orange-500", medium: "bg-amber-500", low: "bg-sky-500" };
  const statusColors = {
    reported: "bg-slate-500", assigned: "bg-sky-500", accepted: "bg-emerald-500",
    in_progress: "bg-amber-500", resolved: "bg-emerald-600", closed: "bg-slate-600",
    declined: "bg-rose-600", completed: "bg-emerald-600", cancelled: "bg-slate-600",
    reassigned: "bg-amber-500"
  };

  const renderLocation = (loc) => {
    if (!loc || loc.lat == null) return null;
    return (
      <a href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`} target="_blank" rel="noopener noreferrer"
         className="flex items-center gap-1 text-sky-400 hover:underline text-xs">
        <MapPin className="w-3 h-3" /> {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}
      </a>
    );
  };

  const renderCard = (item, type) => {
    const isIncident = type === "incident";
    const isSelected = isIncident ? selectedIncident?.id === item.id : selectedMaintenance?.id === item.id;
    const canAssign = ["reported", "declined"].includes(item.status);
    const canResolve = ["assigned", "accepted", "in_progress"].includes(item.status);
    const levelField = isIncident ? item.priority : item.urgency;
    return (
      <div key={item.id} className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-semibold truncate">{item.title}</h3>
            {item.incident_number || item.request_number ? (
              <p className="text-xs text-slate-500">{isIncident ? item.incident_number : item.request_number}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1 items-end">
            <Badge className={priorityColors[levelField] || "bg-slate-500"}>{levelField}</Badge>
            <Badge className={statusColors[item.status] || "bg-slate-500"}>{item.status}</Badge>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-slate-400">
          <div className="flex items-center gap-1"><User className="w-3 h-3" /> {item.guard_name}</div>
          <div className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {item.site_name}</div>
          <div className="flex items-center gap-1 col-span-2"><Clock className="w-3 h-3" /> {new Date(item.reported_at || item.created_date).toLocaleString("en-ZA")}</div>
          {item.location && <div className="col-span-2">{renderLocation(item.location)}</div>}
          {item.assigned_to_name && <div className="col-span-2 text-amber-400">Assigned: {item.assigned_to_name}</div>}
        </div>

        {isSelected ? (
          <div className="mt-4 space-y-3 pt-3 border-t border-slate-700">
            {canAssign && (
              <>
                <Select value={assigneeId} onValueChange={setAssigneeId}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white"><SelectValue placeholder="Select person to assign..." /></SelectTrigger>
                  <SelectContent>
                    {assignees.map(a => (
                      <SelectItem key={a.id} value={a.id}>
                        <span className="flex items-center gap-2">
                          {a.name} <span className="text-xs text-slate-400">({a.role})</span>
                          {a.onDuty && <span className="text-xs text-emerald-400">● {a.onDuty}</span>}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea placeholder="Assignment notes (optional)..." value={notes} onChange={e => setNotes(e.target.value)}
                  className="bg-slate-800 border-slate-600 text-white min-h-16" />
                <Button onClick={() => (isIncident ? assignIncident : assignMaintenance).mutate({ id: item.id, item })}
                  disabled={!assigneeId || (isIncident ? assignIncident.isPending : assignMaintenance.isPending)}
                  className="w-full bg-emerald-600 hover:bg-emerald-700">
                  {(isIncident ? assignIncident : assignMaintenance).isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <User className="w-4 h-4 mr-2" />}
                  Assign
                </Button>
              </>
            )}
            {canResolve && (
              <Button onClick={() => setResolveModal({ type, id: item.id, item })} variant="outline" className="w-full border-emerald-600 text-emerald-400">
                <CheckCircle2 className="w-4 h-4 mr-2" /> {isIncident ? "Resolve" : "Complete"}
              </Button>
            )}
            {item.description && (
              <div className="bg-slate-800/50 rounded p-3 max-h-40 overflow-y-auto">
                <p className="text-xs text-slate-400 mb-1">Description:</p>
                <pre className="text-xs text-slate-300 whitespace-pre-wrap font-sans">{item.description.substring(0, 500)}</pre>
              </div>
            )}
            {item.media && item.media.length > 0 && (
              <div className="flex gap-2 overflow-x-auto">
                {item.media.map((m, i) => (
                  <a key={i} href={m.url} target="_blank" rel="noopener noreferrer">
                    {m.type === "video" ? <video src={m.url} className="h-16 w-16 object-cover rounded" /> : <img src={m.url} alt="" className="h-16 w-16 object-cover rounded" />}
                  </a>
                ))}
              </div>
            )}
            <div>
              <p className="text-xs text-slate-400 mb-2 flex items-center gap-1"><History className="w-3 h-3" /> Activity Timeline</p>
              <ActivityTimeline log={item.activity_log} />
            </div>
            <Button onClick={() => { isIncident ? setSelectedIncident(null) : setSelectedMaintenance(null); setAssigneeId(""); setNotes(""); }}
              variant="ghost" size="sm" className="w-full text-slate-400"><XCircle className="w-4 h-4 mr-2" /> Close</Button>
          </div>
        ) : (
          <Button onClick={() => { isIncident ? setSelectedIncident(item) : setSelectedMaintenance(item); setAssigneeId(item.assigned_to || ""); setNotes(""); }}
            className="w-full mt-3 bg-sky-600 hover:bg-sky-700" size="sm">Manage</Button>
        )}
      </div>
    );
  };

  if (!user) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-sky-400" /></div>;

  return (
    <PullToRefresh onRefresh={async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["adminIncidents"] }), queryClient.invalidateQueries({ queryKey: ["adminMaintenance"] })]);
    }}>
      <div className="min-h-screen p-4 lg:p-6 space-y-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-rose-400" /> Incident & Maintenance Queue
          </h1>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader><CardTitle className="text-white flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-rose-400" /> Incidents ({incidents.length})</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {incidents.length === 0 ? <p className="text-slate-400 text-center py-8">No active incidents</p> : incidents.map(i => renderCard(i, "incident"))}
              </CardContent>
            </Card>
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader><CardTitle className="text-white flex items-center gap-2"><Wrench className="w-5 h-5 text-amber-400" /> Maintenance ({maintenance.length})</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {maintenance.length === 0 ? <p className="text-slate-400 text-center py-8">No active maintenance</p> : maintenance.map(m => renderCard(m, "maintenance"))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {resolveModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl p-5">
            <h3 className="text-white font-bold text-lg mb-1">{resolveModal.type === "incident" ? "Resolve Incident" : "Complete Maintenance"}</h3>
            <p className="text-slate-400 text-sm mb-3">{resolveModal.item.title}</p>
            <Textarea placeholder={resolveModal.type === "incident" ? "Resolution notes..." : "Completion notes..."} value={resolveNotes}
              onChange={e => setResolveNotes(e.target.value)} className="bg-slate-800 border-slate-600 text-white min-h-24 mb-3" />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setResolveModal(null)} className="flex-1 border-slate-600">Cancel</Button>
              <Button onClick={() => resolveItem.mutate()} disabled={!resolveNotes.trim() || resolveItem.isPending}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700">
                {resolveItem.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                {resolveModal.type === "incident" ? "Resolve" : "Complete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </PullToRefresh>
  );
}