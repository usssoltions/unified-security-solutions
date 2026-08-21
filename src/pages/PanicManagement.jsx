import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle, MapPin, CheckCircle2, UserCheck,
  Loader2, Users, Zap
} from "lucide-react";
import ActivityTimeline from "@/components/shared/ActivityTimeline";
import { managePanic } from "@/lib/panicService";

const STATUS_CONFIG = {
  active:      { label: "ACTIVE",      color: "bg-red-500",      text: "text-red-400",      border: "border-red-500/50" },
  acknowledged:{ label: "ACKNOWLEDGED", color: "bg-amber-500",    text: "text-amber-400",    border: "border-amber-500/50" },
  assigned:   { label: "ASSIGNED",     color: "bg-sky-500",      text: "text-sky-400",      border: "border-sky-500/50" },
  accepted:   { label: "ACCEPTED",     color: "bg-indigo-500",   text: "text-indigo-400",   border: "border-indigo-500/50" },
  resolved:   { label: "RESOLVED",     color: "bg-emerald-500",   text: "text-emerald-400",   border: "border-emerald-500/50" },
  cancelled:  { label: "CANCELLED",    color: "bg-slate-500",    text: "text-slate-400",    border: "border-slate-500/50" },
};

function elapsed(activatedAt) {
  const ms = Date.now() - new Date(activatedAt).getTime();
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function PanicCard({ panic, user, assignees, onAction }) {
  const [showAssign, setShowAssign] = useState(false);
  const [showResolve, setShowResolve] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const [acting, setActing] = useState(false);

  const config = STATUS_CONFIG[panic.status] || STATUS_CONFIG.active;
  const isActive = ["active", "acknowledged", "assigned", "accepted"].includes(panic.status);
  const canManage = ["admin", "dispatcher", "supervisor", "estate_manager", "management"].includes(user?.role_type);
  const canAccept = panic.assigned_to === user?.id;

  const handleAcknowledge = async () => {
    setActing(true);
    try { await onAction(panic.id, "acknowledge"); } finally { setActing(false); }
  };
  const handleAssign = async () => {
    if (!selectedAssignee) return;
    const assignee = assignees.find(a => a.id === selectedAssignee);
    setActing(true);
    try {
      await onAction(panic.id, "assign", { assigneeId: assignee.id, assigneeName: assignee.display_name || assignee.full_name });
      setShowAssign(false);
      setSelectedAssignee("");
    } finally { setActing(false); }
  };
  const handleAccept = async () => {
    setActing(true);
    try { await onAction(panic.id, "accept"); } finally { setActing(false); }
  };
  const handleResolve = async () => {
    if (resolutionNotes.trim().length < 5) return;
    setActing(true);
    try {
      await onAction(panic.id, "resolve", { resolutionNotes });
      setShowResolve(false);
      setResolutionNotes("");
    } finally { setActing(false); }
  };

  const mapsUrl = panic.location?.lat && panic.location?.lng
    ? `https://www.google.com/maps?q=${panic.location.lat},${panic.location.lng}`
    : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border-2 ${config.border} bg-slate-800/50 overflow-hidden`}
    >
      {/* Header */}
      <div className={`px-4 py-3 ${config.color} bg-opacity-10 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <AlertTriangle className={`w-5 h-5 ${config.text}`} />
          <span className={`font-bold ${config.text}`}>{config.label}</span>
          {panic.escalated && (
            <Badge className="bg-red-600 text-white animate-pulse">ESCALATED</Badge>
          )}
        </div>
        <span className="text-xs text-slate-400 font-mono">{panic.panic_number}</span>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-slate-500 text-xs">Person</p>
            <p className="text-white font-semibold">{panic.user_name}</p>
            <p className="text-slate-400 text-xs">{panic.user_role}{panic.badge_number ? ` · #${panic.badge_number}` : ""}</p>
          </div>
          <div>
            <p className="text-slate-500 text-xs">Site</p>
            <p className="text-white font-semibold">{panic.site_name || "Unknown"}</p>
          </div>
          <div>
            <p className="text-slate-500 text-xs">Activated</p>
            <p className="text-white">{new Date(panic.activated_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}</p>
            {isActive && (
              <p className={`text-xs font-semibold ${config.text}`}>⏱ {elapsed(panic.activated_at)} ago</p>
            )}
          </div>
          <div>
            <p className="text-slate-500 text-xs">GPS Source</p>
            <p className="text-white text-sm">{panic.location_source || "—"}</p>
            {panic.gps_accuracy && <p className="text-slate-400 text-xs">±{Math.round(panic.gps_accuracy)}m</p>}
          </div>
        </div>

        {panic.notes && (
          <div className="bg-slate-900/50 rounded-lg p-2">
            <p className="text-slate-500 text-xs">Notes</p>
            <p className="text-slate-200 text-sm">{panic.notes}</p>
          </div>
        )}

        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-red-600/20 border border-red-500/30 rounded-lg p-3 text-red-400 hover:bg-red-600/30 transition active:scale-95"
          >
            <MapPin className="w-5 h-5 shrink-0" />
            <div>
              <p className="font-semibold text-sm">📍 View Location — Open in Google Maps</p>
              <p className="text-xs text-slate-400 font-mono">
                {panic.location.lat.toFixed(6)}, {panic.location.lng.toFixed(6)}
              </p>
            </div>
          </a>
        )}

        {/* Assignee / Acknowledged by info */}
        {panic.acknowledged_by_name && (
          <div className="flex items-center gap-2 text-sm text-amber-400">
            <CheckCircle2 className="w-4 h-4" />
            Acknowledged by {panic.acknowledged_by_name}
          </div>
        )}
        {panic.assigned_to_name && (
          <div className="flex items-center gap-2 text-sm text-sky-400">
            <UserCheck className="w-4 h-4" />
            Assigned to {panic.assigned_to_name}
            {panic.accepted_by_name && <span className="text-emerald-400">· Accepted by {panic.accepted_by_name}</span>}
          </div>
        )}
        {panic.resolved_by_name && (
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            Resolved by {panic.resolved_by_name}
          </div>
        )}

        {/* Activity Timeline */}
        {panic.activity_log && panic.activity_log.length > 0 && (
          <ActivityTimeline log={panic.activity_log} />
        )}

        {/* Action buttons */}
        {canManage && isActive && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-700">
            {panic.status === "active" && (
              <Button size="sm" onClick={handleAcknowledge} disabled={acting} className="bg-amber-600 hover:bg-amber-700">
                {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Acknowledge
              </Button>
            )}
            {["active", "acknowledged"].includes(panic.status) && (
              <Button size="sm" variant="outline" onClick={() => setShowAssign(!showAssign)} className="border-sky-500/50 text-sky-400">
                <Users className="w-4 h-4" /> Assign
              </Button>
            )}
            {["active", "acknowledged", "assigned", "accepted"].includes(panic.status) && (
              <Button size="sm" variant="outline" onClick={() => setShowResolve(!showResolve)} className="border-emerald-500/50 text-emerald-400">
                <CheckCircle2 className="w-4 h-4" /> Resolve
              </Button>
            )}
          </div>
        )}
        {canAccept && panic.status === "assigned" && (
          <div className="flex gap-2 pt-2 border-t border-slate-700">
            <Button size="sm" onClick={handleAccept} disabled={acting} className="bg-indigo-600 hover:bg-indigo-700 flex-1">
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
              Accept Assignment
            </Button>
          </div>
        )}

        {/* Assign selector */}
        {showAssign && (
          <div className="bg-slate-900/50 rounded-lg p-3 space-y-2">
            <p className="text-slate-400 text-xs font-semibold">Select Responder</p>
            <select
              value={selectedAssignee}
              onChange={(e) => setSelectedAssignee(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg p-2 text-sm"
            >
              <option value="">Choose a responder...</option>
              {assignees.map(a => (
                <option key={a.id} value={a.id}>
                  {a.display_name || a.full_name} ({a.role_type})
                </option>
              ))}
            </select>
            <Button size="sm" onClick={handleAssign} disabled={!selectedAssignee || acting} className="w-full bg-sky-600 hover:bg-sky-700">
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Confirm Assignment
            </Button>
          </div>
        )}

        {/* Resolve form */}
        {showResolve && (
          <div className="bg-slate-900/50 rounded-lg p-3 space-y-2">
            <p className="text-slate-400 text-xs font-semibold">Resolution Notes (required)</p>
            <Textarea
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              placeholder="Describe how the emergency was resolved..."
              className="bg-slate-800 border-slate-700 text-white text-sm"
              rows={3}
            />
            <Button size="sm" onClick={handleResolve} disabled={resolutionNotes.trim().length < 5 || acting} className="w-full bg-emerald-600 hover:bg-emerald-700">
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Confirm Resolution
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function PanicManagement() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [filter, setFilter] = useState("active");

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  // Fetch panics
  const { data: panics = [], isLoading } = useQuery({
    queryKey: ["panics", filter],
    queryFn: async () => {
      if (filter === "active") {
        const active = await base44.entities.PanicAlert.filter({ status: "active" }, "-activated_at", 50);
        const ack = await base44.entities.PanicAlert.filter({ status: "acknowledged" }, "-activated_at", 50);
        const assigned = await base44.entities.PanicAlert.filter({ status: "assigned" }, "-activated_at", 50);
        const accepted = await base44.entities.PanicAlert.filter({ status: "accepted" }, "-activated_at", 50);
        return [...active, ...ack, ...assigned, ...accepted].sort((a, b) =>
          new Date(b.activated_at) - new Date(a.activated_at)
        );
      } else if (filter === "resolved") {
        const resolved = await base44.entities.PanicAlert.filter({ status: "resolved" }, "-activated_at", 50);
        const cancelled = await base44.entities.PanicAlert.filter({ status: "cancelled" }, "-activated_at", 50);
        return [...resolved, ...cancelled].sort((a, b) =>
          new Date(b.activated_at) - new Date(a.activated_at)
        );
      }
      return await base44.entities.PanicAlert.list("-activated_at", 50);
    },
    enabled: !!user,
    staleTime: 0,
  });

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const unsub = base44.entities.PanicAlert.subscribe(() => {
      queryClient.invalidateQueries(["panics"]);
    });
    return unsub;
  }, [user, queryClient]);

  // Fetch potential assignees (operational roles)
  const { data: assignees = [] } = useQuery({
    queryKey: ["panicAssignees"],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u =>
        ["admin", "dispatcher", "supervisor", "guard", "estate_manager", "management"].includes(u.role_type)
      );
    },
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
  });

  const handleAction = async (panicId, action, extra = {}) => {
    await managePanic(panicId, action, extra);
    queryClient.invalidateQueries(["panics"]);
  };

  const activePanics = panics.filter(p => ["active", "acknowledged", "assigned", "accepted"].includes(p.status));
  const hasActive = activePanics.length > 0;

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-red-600 to-red-800 rounded-xl flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-white text-xl font-bold">Panic Management</h1>
            <p className="text-slate-400 text-sm">Emergency alert monitoring & response</p>
          </div>
        </div>
        {hasActive && (
          <Badge className="bg-red-600 text-white animate-pulse text-sm">
            <Zap className="w-3 h-3 mr-1" /> {activePanics.length} ACTIVE
          </Badge>
        )}
      </div>

      {/* Active alert banner */}
      {hasActive && (
        <div className="bg-gradient-to-r from-red-600/20 to-red-800/20 border-2 border-red-500/50 rounded-2xl p-4">
          <div className="flex items-center gap-2 text-red-400 font-bold">
            <AlertTriangle className="w-5 h-5 animate-pulse" />
            {activePanics.length} active panic alert{activePanics.length > 1 ? "s" : ""} requiring immediate attention
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setFilter("active")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${filter === "active" ? "bg-red-600 text-white" : "bg-slate-800 text-slate-400"}`}
        >
          Active ({activePanics.length})
        </button>
        <button
          onClick={() => setFilter("resolved")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${filter === "resolved" ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-400"}`}
        >
          Resolved
        </button>
        <button
          onClick={() => setFilter("all")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${filter === "all" ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-400"}`}
        >
          All
        </button>
      </div>

      {/* Panic list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
        </div>
      ) : panics.length === 0 ? (
        <div className="text-center py-12">
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-2" />
          <p className="text-slate-400">No panic alerts in this category</p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {panics.map(panic => (
              <PanicCard
                key={panic.id}
                panic={panic}
                user={user}
                assignees={assignees}
                onAction={handleAction}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}