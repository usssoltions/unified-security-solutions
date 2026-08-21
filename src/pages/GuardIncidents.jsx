import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Plus, AlertTriangle, Clock, MapPin, CheckCircle2, History, Loader2, UserCheck, UserX } from "lucide-react";
import IncidentForm from "../components/guard/IncidentForm";
import ActivityTimeline from "@/components/shared/ActivityTimeline";

export default function GuardIncidents() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [location, setLocation] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [shift, setShift] = useState(null);
  const [tab, setTab] = useState("mine");
  const [actionModal, setActionModal] = useState(null); // { type: 'decline'|'resolve', incident }
  const [actionNotes, setActionNotes] = useState("");

  useEffect(() => { loadData(); getLocation(); }, []);

  const loadData = async () => {
    const currentUser = await base44.auth.me();
    setUser(currentUser);
    try {
      const shifts = await base44.entities.Shift.filter({ guard_id: currentUser.id, status: "active" });
      if (shifts.length > 0) setShift(shifts[0]);
    } catch {}
  };

  const getLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      }, () => {}, { enableHighAccuracy: true, timeout: 10000 });
    }
  };

  // ── Queries (NO polling) ──────────────────────────────────────────────────
  const { data: myIncidents = [] } = useQuery({
    queryKey: ["incidents", user?.id],
    queryFn: () => base44.entities.Incident.filter({ guard_id: user.id }, "-reported_at", 30),
    enabled: !!user,
  });

  const { data: assignedIncidents = [] } = useQuery({
    queryKey: ["assignedIncidents", user?.id],
    queryFn: () => base44.entities.Incident.filter({ assigned_to: user.id }, "-reported_at", 30),
    enabled: !!user,
  });

  // ── Realtime subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const unsub = base44.entities.Incident.subscribe((event) => {
      const d = event.data;
      if (!d) return;
      if (d.guard_id !== user.id && d.assigned_to !== user.id) return;
      queryClient.invalidateQueries({ queryKey: ["incidents", user.id] });
      queryClient.invalidateQueries({ queryKey: ["assignedIncidents", user.id] });
    });
    return () => unsub();
  }, [user, queryClient]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const acceptIncident = useMutation({
    mutationFn: async (incident) => {
      const nowIso = new Date().toISOString();
      await base44.entities.Incident.update(incident.id, {
        status: "accepted", accepted_at: nowIso,
        accepted_by: user.id, accepted_by_name: user.display_name || user.full_name,
        activity_log: [...(incident.activity_log || []), {
          timestamp: nowIso, action: "accepted",
          by_user_id: user.id, by_user_name: user.display_name || user.full_name,
          from_status: incident.status, to_status: "accepted",
          notes: `Accepted by ${user.display_name || user.full_name}`
        }]
      });
      await base44.functions.invoke("notifyIncidentWorkflow", {
        action: "accepted", incidentId: incident.id, incidentNumber: incident.incident_number,
        performedByUserId: user.id, performedByName: user.display_name || user.full_name,
        incidentTitle: incident.title, incidentType: incident.category, category: incident.category,
        priority: incident.priority, siteName: incident.site_name, location: incident.location
      });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["assignedIncidents", user.id] }); }
  });

  const submitAction = useMutation({
    mutationFn: async () => {
      const { type, incident } = actionModal;
      const nowIso = new Date().toISOString();
      if (type === "decline") {
        await base44.entities.Incident.update(incident.id, {
          status: "declined", declined_at: nowIso,
          declined_by: user.id, declined_by_name: user.display_name || user.full_name,
          decline_reason: actionNotes,
          activity_log: [...(incident.activity_log || []), {
            timestamp: nowIso, action: "declined",
            by_user_id: user.id, by_user_name: user.display_name || user.full_name,
            from_status: incident.status, to_status: "declined", notes: actionNotes
          }]
        });
        await base44.functions.invoke("notifyIncidentWorkflow", {
          action: "declined", incidentId: incident.id, incidentNumber: incident.incident_number,
          performedByUserId: user.id, performedByName: user.display_name || user.full_name,
          declineReason: actionNotes, incidentTitle: incident.title, incidentType: incident.category,
          category: incident.category, priority: incident.priority, siteName: incident.site_name, location: incident.location
        });
      } else if (type === "resolve") {
        await base44.entities.Incident.update(incident.id, {
          status: "resolved", resolved_at: nowIso,
          resolved_by: user.id, resolved_by_name: user.display_name || user.full_name,
          resolution_notes: actionNotes,
          activity_log: [...(incident.activity_log || []), {
            timestamp: nowIso, action: "resolved",
            by_user_id: user.id, by_user_name: user.display_name || user.full_name,
            from_status: incident.status, to_status: "resolved", notes: actionNotes
          }]
        });
        await base44.functions.invoke("notifyIncidentWorkflow", {
          action: "resolved", incidentId: incident.id, incidentNumber: incident.incident_number,
          performedByUserId: user.id, performedByName: user.display_name || user.full_name,
          resolutionNotes: actionNotes, incidentTitle: incident.title, incidentType: incident.category,
          category: incident.category, priority: incident.priority, siteName: incident.site_name, location: incident.location
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignedIncidents", user.id] });
      queryClient.invalidateQueries({ queryKey: ["incidents", user.id] });
      setActionModal(null); setActionNotes("");
    }
  });

  const priorityColors = { critical: "bg-rose-500", high: "bg-orange-500", medium: "bg-amber-500", low: "bg-sky-500" };
  const statusColors = {
    reported: "bg-slate-500", assigned: "bg-sky-500", accepted: "bg-emerald-500",
    in_progress: "bg-amber-500", resolved: "bg-emerald-600", closed: "bg-slate-600", declined: "bg-rose-600"
  };

  const renderCard = (incident, isAssigned) => {
    const canAccept = isAssigned && incident.status === "assigned";
    const canDecline = isAssigned && incident.status === "assigned";
    const canResolve = isAssigned && ["accepted", "in_progress"].includes(incident.status);
    return (
      <Card key={incident.id} className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                <CardTitle className="text-white truncate">{incident.title}</CardTitle>
              </div>
              {incident.incident_number && <p className="text-xs text-slate-500">{incident.incident_number}</p>}
            </div>
            <div className="flex flex-col gap-1">
              <Badge className={priorityColors[incident.priority]}>{incident.priority}</Badge>
              <Badge className={statusColors[incident.status]}>{incident.status}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2 text-slate-400"><MapPin className="w-4 h-4" /> {incident.site_name}</div>
            <div className="flex items-center gap-2 text-slate-400"><Clock className="w-4 h-4" /> {new Date(incident.reported_at || incident.created_date).toLocaleString("en-ZA")}</div>
          </div>
          {incident.location && incident.location.lat != null && (
            <a href={`https://www.google.com/maps?q=${incident.location.lat},${incident.location.lng}`} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-sky-400 hover:underline text-sm">
              <MapPin className="w-4 h-4" /> View Location on Map
            </a>
          )}
          {incident.description && (
            <div className="bg-slate-900/50 rounded p-2 max-h-32 overflow-y-auto">
              <pre className="text-xs text-slate-300 whitespace-pre-wrap font-sans">{incident.description.substring(0, 300)}</pre>
            </div>
          )}
          {incident.media && incident.media.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              {incident.media.map((m, i) => (
                <a key={i} href={m.url} target="_blank" rel="noopener noreferrer">
                  {m.type === "video" ? <video src={m.url} className="h-20 w-20 object-cover rounded border border-slate-700" /> : <img src={m.url} alt="" className="h-20 w-20 object-cover rounded border border-slate-700" />}
                </a>
              ))}
            </div>
          )}
          {(canAccept || canDecline || canResolve) && (
            <div className="flex gap-2 pt-2">
              {canAccept && (
                <Button onClick={() => acceptIncident.mutate(incident)} disabled={acceptIncident.isPending}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700">
                  <UserCheck className="w-4 h-4 mr-1" /> Accept
                </Button>
              )}
              {canDecline && (
                <Button onClick={() => setActionModal({ type: "decline", incident })} variant="outline"
                  className="flex-1 border-rose-600 text-rose-400">
                  <UserX className="w-4 h-4 mr-1" /> Decline
                </Button>
              )}
              {canResolve && (
                <Button onClick={() => setActionModal({ type: "resolve", incident })} variant="outline"
                  className="flex-1 border-emerald-600 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 mr-1" /> Resolve
                </Button>
              )}
            </div>
          )}
          {incident.dispatcher_notes && (
            <div className="p-2 bg-sky-500/10 border border-sky-500/20 rounded">
              <p className="text-xs text-sky-400 font-semibold">Dispatcher Notes:</p>
              <p className="text-sm text-slate-300">{incident.dispatcher_notes}</p>
            </div>
          )}
          {incident.activity_log && incident.activity_log.length > 0 && (
            <div>
              <p className="text-xs text-slate-400 mb-2 flex items-center gap-1"><History className="w-3 h-3" /> Timeline</p>
              <ActivityTimeline log={incident.activity_log} />
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (!user) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-sky-400" /></div>;

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">Incident Reports</h1>
          <p className="text-slate-400 mt-1">Document and track security incidents</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="bg-gradient-to-r from-rose-500 to-rose-600 w-full sm:w-auto">
          <Plus className="w-5 h-5 mr-2" /> Report Incident
        </Button>
      </div>

      {showForm && (
        <IncidentForm user={user} shift={shift} location={location}
          onClose={() => setShowForm(false)}
          onSuccess={() => { setShowForm(false); queryClient.invalidateQueries({ queryKey: ["incidents", user.id] }); }}
        />
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        <Button onClick={() => setTab("mine")} variant={tab === "mine" ? "default" : "outline"}
          className={tab === "mine" ? "bg-sky-600" : "border-slate-600 text-slate-300"}>
          My Reports ({myIncidents.length})
        </Button>
        <Button onClick={() => setTab("assigned")} variant={tab === "assigned" ? "default" : "outline"}
          className={tab === "assigned" ? "bg-amber-600" : "border-slate-600 text-slate-300"}>
          Assigned to Me ({assignedIncidents.length})
        </Button>
      </div>

      <div className="grid gap-4">
        {tab === "mine" && myIncidents.map(i => renderCard(i, false))}
        {tab === "assigned" && assignedIncidents.map(i => renderCard(i, true))}
        {((tab === "mine" && myIncidents.length === 0) || (tab === "assigned" && assignedIncidents.length === 0)) && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-12 pb-12 text-center">
              <AlertTriangle className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">{tab === "mine" ? "No incidents reported yet." : "No incidents assigned to you."}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Decline / Resolve Modal */}
      {actionModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl p-5">
            <h3 className="text-white font-bold text-lg mb-1">
              {actionModal.type === "decline" ? "Decline Incident" : "Resolve Incident"}
            </h3>
            <p className="text-slate-400 text-sm mb-3">{actionModal.incident.title}</p>
            <Textarea
              placeholder={actionModal.type === "decline" ? "Reason for declining (required)..." : "Resolution notes (required)..."}
              value={actionNotes} onChange={e => setActionNotes(e.target.value)}
              className="bg-slate-800 border-slate-600 text-white min-h-24 mb-3" required
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setActionModal(null)} className="flex-1 border-slate-600">Cancel</Button>
              <Button onClick={() => submitAction.mutate()} disabled={!actionNotes.trim() || submitAction.isPending}
                className={`flex-1 ${actionModal.type === "decline" ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                {submitAction.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {actionModal.type === "decline" ? "Decline" : "Resolve"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}