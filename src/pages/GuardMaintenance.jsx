import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Wrench, Clock, MapPin, CheckCircle2, History, Loader2, UserCheck, UserX, Camera } from "lucide-react";
import MaintenanceForm from "../components/guard/MaintenanceForm";
import ActivityTimeline from "@/components/shared/ActivityTimeline";
import { uploadOptimizedImage } from "@/lib/imageOptimize";

export default function GuardMaintenance() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [location, setLocation] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [shift, setShift] = useState(null);
  const [tab, setTab] = useState("mine");
  const [actionModal, setActionModal] = useState(null); // { type: 'decline'|'complete', item }
  const [actionNotes, setActionNotes] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [completionMedia, setCompletionMedia] = useState([]);
  const [uploading, setUploading] = useState(false);

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
  const { data: myRequests = [] } = useQuery({
    queryKey: ["maintenance", user?.id],
    queryFn: () => base44.entities.MaintenanceRequest.filter({ guard_id: user.id }, "-reported_at", 30),
    enabled: !!user,
  });

  const { data: assignedRequests = [] } = useQuery({
    queryKey: ["assignedMaintenance", user?.id],
    queryFn: () => base44.entities.MaintenanceRequest.filter({ assigned_to: user.id }, "-reported_at", 30),
    enabled: !!user,
  });

  // ── Realtime subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const unsub = base44.entities.MaintenanceRequest.subscribe((event) => {
      const d = event.data;
      if (!d) return;
      if (d.guard_id !== user.id && d.assigned_to !== user.id) return;
      queryClient.invalidateQueries({ queryKey: ["maintenance", user.id] });
      queryClient.invalidateQueries({ queryKey: ["assignedMaintenance", user.id] });
    });
    return () => unsub();
  }, [user, queryClient]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const acceptRequest = useMutation({
    mutationFn: async (item) => {
      const nowIso = new Date().toISOString();
      await base44.entities.MaintenanceRequest.update(item.id, {
        status: "accepted", accepted_at: nowIso,
        accepted_by: user.id, accepted_by_name: user.display_name || user.full_name,
        activity_log: [...(item.activity_log || []), {
          timestamp: nowIso, action: "accepted",
          by_user_id: user.id, by_user_name: user.display_name || user.full_name,
          from_status: item.status, to_status: "accepted",
          notes: `Accepted by ${user.display_name || user.full_name}`
        }]
      });
      await base44.functions.invoke("notifyMaintenanceWorkflow", {
        action: "accepted", maintenanceId: item.id, requestNumber: item.request_number,
        performedByUserId: user.id, performedByName: user.display_name || user.full_name,
        title: item.title, category: item.category, urgency: item.urgency, siteName: item.site_name, location: item.location
      });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["assignedMaintenance", user.id] }); }
  });

  const submitAction = useMutation({
    mutationFn: async () => {
      const { type, item } = actionModal;
      const nowIso = new Date().toISOString();
      if (type === "decline") {
        await base44.entities.MaintenanceRequest.update(item.id, {
          status: "declined", declined_at: nowIso,
          declined_by: user.id, declined_by_name: user.display_name || user.full_name,
          decline_reason: actionNotes,
          activity_log: [...(item.activity_log || []), {
            timestamp: nowIso, action: "declined",
            by_user_id: user.id, by_user_name: user.display_name || user.full_name,
            from_status: item.status, to_status: "declined", notes: actionNotes
          }]
        });
        await base44.functions.invoke("notifyMaintenanceWorkflow", {
          action: "declined", maintenanceId: item.id, requestNumber: item.request_number,
          performedByUserId: user.id, performedByName: user.display_name || user.full_name,
          declineReason: actionNotes, title: item.title, category: item.category,
          urgency: item.urgency, siteName: item.site_name, location: item.location
        });
      } else if (type === "complete") {
        await base44.entities.MaintenanceRequest.update(item.id, {
          status: "completed", completed_at: nowIso,
          completed_by: user.id, completed_by_name: user.display_name || user.full_name,
          completion_notes: actionNotes, recommendations, follow_up_required: followUp,
          completion_media: completionMedia,
          activity_log: [...(item.activity_log || []), {
            timestamp: nowIso, action: "completed",
            by_user_id: user.id, by_user_name: user.display_name || user.full_name,
            from_status: item.status, to_status: "completed",
            notes: actionNotes + (followUp ? " (Follow-up required)" : "")
          }]
        });
        await base44.functions.invoke("notifyMaintenanceWorkflow", {
          action: "completed", maintenanceId: item.id, requestNumber: item.request_number,
          performedByUserId: user.id, performedByName: user.display_name || user.full_name,
          completionNotes: actionNotes, recommendations, followUpRequired: followUp,
          title: item.title, category: item.category, urgency: item.urgency, siteName: item.site_name, location: item.location
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignedMaintenance", user.id] });
      queryClient.invalidateQueries({ queryKey: ["maintenance", user.id] });
      setActionModal(null); setActionNotes(""); setRecommendations(""); setFollowUp(false); setCompletionMedia([]);
    }
  });

  const handleCompletionPhoto = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    for (const file of files) {
      try {
        const url = await uploadOptimizedImage(file, { maxDim: 1000, quality: 0.7 });
        if (url) setCompletionMedia(prev => [...prev, { type: "photo", url }]);
      } catch {}
    }
    setUploading(false);
  };

  const urgencyColors = { critical: "bg-rose-500", high: "bg-orange-500", medium: "bg-amber-500", low: "bg-sky-500" };
  const statusColors = {
    reported: "bg-slate-500", assigned: "bg-sky-500", accepted: "bg-emerald-500",
    in_progress: "bg-amber-500", completed: "bg-emerald-600", cancelled: "bg-slate-600", declined: "bg-rose-600"
  };

  const renderCard = (item, isAssigned) => {
    const canAccept = isAssigned && item.status === "assigned";
    const canDecline = isAssigned && item.status === "assigned";
    const canComplete = isAssigned && ["accepted", "in_progress"].includes(item.status);
    return (
      <Card key={item.id} className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Wrench className="w-5 h-5 text-amber-400 shrink-0" />
                <CardTitle className="text-white truncate">{item.title}</CardTitle>
              </div>
              {item.request_number && <p className="text-xs text-slate-500">{item.request_number}</p>}
            </div>
            <div className="flex flex-col gap-1">
              <Badge className={urgencyColors[item.urgency]}>{item.urgency}</Badge>
              <Badge className={statusColors[item.status]}>{item.status}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2 text-slate-400"><MapPin className="w-4 h-4" /> {item.site_name}</div>
            <div className="flex items-center gap-2 text-slate-400"><Clock className="w-4 h-4" /> {new Date(item.reported_at || item.created_date).toLocaleString("en-ZA")}</div>
          </div>
          {item.location && item.location.lat != null && (
            <a href={`https://www.google.com/maps?q=${item.location.lat},${item.location.lng}`} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-sky-400 hover:underline text-sm">
              <MapPin className="w-4 h-4" /> View Location on Map
            </a>
          )}
          {item.description && (
            <div className="bg-slate-900/50 rounded p-2 max-h-32 overflow-y-auto">
              <pre className="text-xs text-slate-300 whitespace-pre-wrap font-sans">{item.description.substring(0, 300)}</pre>
            </div>
          )}
          {item.media && item.media.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              {item.media.map((m, i) => (
                <a key={i} href={m.url} target="_blank" rel="noopener noreferrer">
                  {m.type === "video" ? <video src={m.url} className="h-20 w-20 object-cover rounded border border-slate-700" /> : <img src={m.url} alt="" className="h-20 w-20 object-cover rounded border border-slate-700" />}
                </a>
              ))}
            </div>
          )}
          {item.completion_media && item.completion_media.length > 0 && (
            <div>
              <p className="text-xs text-emerald-400 mb-1">Completion Photos:</p>
              <div className="flex gap-2 overflow-x-auto">
                {item.completion_media.map((m, i) => <img key={i} src={m.url} alt="" className="h-20 w-20 object-cover rounded border border-emerald-700" />)}
              </div>
            </div>
          )}
          {(canAccept || canDecline || canComplete) && (
            <div className="flex gap-2 pt-2">
              {canAccept && (
                <Button onClick={() => acceptRequest.mutate(item)} disabled={acceptRequest.isPending}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700">
                  <UserCheck className="w-4 h-4 mr-1" /> Accept
                </Button>
              )}
              {canDecline && (
                <Button onClick={() => setActionModal({ type: "decline", item })} variant="outline"
                  className="flex-1 border-rose-600 text-rose-400">
                  <UserX className="w-4 h-4 mr-1" /> Decline
                </Button>
              )}
              {canComplete && (
                <Button onClick={() => setActionModal({ type: "complete", item })} variant="outline"
                  className="flex-1 border-emerald-600 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 mr-1" /> Complete
                </Button>
              )}
            </div>
          )}
          {item.completion_notes && (
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded">
              <p className="text-xs text-emerald-400 font-semibold">Completion Notes:</p>
              <p className="text-sm text-slate-300">{item.completion_notes}</p>
            </div>
          )}
          {item.activity_log && item.activity_log.length > 0 && (
            <div>
              <p className="text-xs text-slate-400 mb-2 flex items-center gap-1"><History className="w-3 h-3" /> Timeline</p>
              <ActivityTimeline log={item.activity_log} />
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (!user) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-amber-400" /></div>;

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white">Maintenance Requests</h1>
          <p className="text-slate-400 mt-1">Report facility issues and track repairs</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="bg-gradient-to-r from-amber-500 to-amber-600 w-full sm:w-auto">
          <Plus className="w-5 h-5 mr-2" /> New Request
        </Button>
      </div>

      {showForm && (
        <MaintenanceForm user={user} shift={shift} location={location}
          onClose={() => setShowForm(false)}
          onSuccess={() => { setShowForm(false); queryClient.invalidateQueries({ queryKey: ["maintenance", user.id] }); }}
        />
      )}

      <div className="flex gap-2">
        <Button onClick={() => setTab("mine")} variant={tab === "mine" ? "default" : "outline"}
          className={tab === "mine" ? "bg-amber-600" : "border-slate-600 text-slate-300"}>
          My Requests ({myRequests.length})
        </Button>
        <Button onClick={() => setTab("assigned")} variant={tab === "assigned" ? "default" : "outline"}
          className={tab === "assigned" ? "bg-sky-600" : "border-slate-600 text-slate-300"}>
          Assigned to Me ({assignedRequests.length})
        </Button>
      </div>

      <div className="grid gap-4">
        {tab === "mine" && myRequests.map(r => renderCard(r, false))}
        {tab === "assigned" && assignedRequests.map(r => renderCard(r, true))}
        {((tab === "mine" && myRequests.length === 0) || (tab === "assigned" && assignedRequests.length === 0)) && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-12 pb-12 text-center">
              <Wrench className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">{tab === "mine" ? "No maintenance requests yet." : "No tasks assigned to you."}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Decline / Complete Modal */}
      {actionModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl p-5 my-8">
            <h3 className="text-white font-bold text-lg mb-1">
              {actionModal.type === "decline" ? "Decline Task" : "Complete Task"}
            </h3>
            <p className="text-slate-400 text-sm mb-3">{actionModal.item.title}</p>
            <Textarea
              placeholder={actionModal.type === "decline" ? "Reason for declining (required)..." : "Work performed / completion notes (required)..."}
              value={actionNotes} onChange={e => setActionNotes(e.target.value)}
              className="bg-slate-800 border-slate-600 text-white min-h-24 mb-3" required
            />
            {actionModal.type === "complete" && (
              <>
                <Textarea placeholder="Recommendations / follow-up notes (optional)..." value={recommendations}
                  onChange={e => setRecommendations(e.target.value)}
                  className="bg-slate-800 border-slate-600 text-white min-h-16 mb-3" />
                <label className="flex items-center gap-2 mb-3 text-sm text-slate-300">
                  <Checkbox checked={followUp} onCheckedChange={setFollowUp} /> Follow-up required
                </label>
                <div className="mb-3">
                  <p className="text-sm text-slate-400 mb-2">Completion Photos:</p>
                  <input type="file" accept="image/*" multiple onChange={handleCompletionPhoto} className="hidden" id="completion-photos" />
                  <label htmlFor="completion-photos">
                    <Button type="button" variant="outline" className="w-full border-slate-600" asChild>
                      <div><Camera className="w-4 h-4 mr-2" /> {uploading ? "Uploading..." : "Add Photos"}</div>
                    </Button>
                  </label>
                  {completionMedia.length > 0 && (
                    <div className="flex gap-2 mt-2 overflow-x-auto">
                      {completionMedia.map((m, i) => <img key={i} src={m.url} alt="" className="h-16 w-16 object-cover rounded" />)}
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setActionModal(null); setActionNotes(""); setRecommendations(""); setFollowUp(false); setCompletionMedia([]); }}
                className="flex-1 border-slate-600">Cancel</Button>
              <Button onClick={() => submitAction.mutate()} disabled={!actionNotes.trim() || submitAction.isPending}
                className={`flex-1 ${actionModal.type === "decline" ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                {submitAction.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {actionModal.type === "decline" ? "Decline" : "Complete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}