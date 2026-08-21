import React from "react";
import { Plus, UserPlus, Check, X, CheckCircle2, AlertTriangle, RefreshCw, Clock, Wrench, Bell, MapPin, Zap } from "lucide-react";

const ACTION_CONFIG = {
  created: { icon: Plus, color: "text-sky-400", bg: "bg-sky-500/10", label: "Created" },
  activated: { icon: Zap, color: "text-red-400", bg: "bg-red-500/10", label: "Activated" },
  assigned: { icon: UserPlus, color: "text-amber-400", bg: "bg-amber-500/10", label: "Assigned" },
  accepted: { icon: Check, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Accepted" },
  acknowledged: { icon: Check, color: "text-amber-400", bg: "bg-amber-500/10", label: "Acknowledged" },
  declined: { icon: X, color: "text-rose-400", bg: "bg-rose-500/10", label: "Declined" },
  resolved: { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Resolved" },
  completed: { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Completed" },
  escalated: { icon: AlertTriangle, color: "text-rose-400", bg: "bg-rose-500/10", label: "Escalated" },
  cancelled: { icon: X, color: "text-slate-400", bg: "bg-slate-500/10", label: "Cancelled" },
  notifications_sent: { icon: Bell, color: "text-sky-400", bg: "bg-sky-500/10", label: "Notifications Sent" },
  location_updated: { icon: MapPin, color: "text-purple-400", bg: "bg-purple-500/10", label: "Location Updated" },
  reassigned: { icon: RefreshCw, color: "text-amber-400", bg: "bg-amber-500/10", label: "Reassigned" },
  updated: { icon: Clock, color: "text-slate-400", bg: "bg-slate-500/10", label: "Updated" },
  closed: { icon: Check, color: "text-slate-400", bg: "bg-slate-500/10", label: "Closed" },
};

export default function ActivityTimeline({ log }) {
  if (!log || log.length === 0) {
    return <p className="text-slate-500 text-sm italic">No activity recorded yet.</p>;
  }
  const sorted = [...log].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return (
    <div className="space-y-3">
      {sorted.map((entry, i) => {
        const config = ACTION_CONFIG[entry.action] || ACTION_CONFIG.updated;
        const Icon = config.icon;
        return (
          <div key={i} className="flex gap-3 items-start">
            <div className={`w-8 h-8 rounded-full ${config.bg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-4 h-4 ${config.color}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-sm font-semibold ${config.color}`}>{config.label}</span>
                {entry.by_user_name && <span className="text-xs text-slate-400">by {entry.by_user_name}</span>}
              </div>
              <p className="text-xs text-slate-500">
                {new Date(entry.timestamp).toLocaleString("en-ZA")}
                {entry.from_status && entry.to_status ? ` • ${entry.from_status} → ${entry.to_status}` : ""}
              </p>
              {entry.notes && <p className="text-sm text-slate-300 mt-1">{entry.notes}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}