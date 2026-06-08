import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MapPin, Clock, CheckCircle2, XCircle, RefreshCw, Calendar, Loader2 } from "lucide-react";

const STATUS_COLORS = {
  scheduled: "bg-sky-500/20 text-sky-300 border border-sky-500/30",
  active: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
  completed: "bg-slate-500/20 text-slate-300 border border-slate-500/30",
  missed: "bg-rose-500/20 text-rose-300 border border-rose-500/30",
  cancelled: "bg-red-500/20 text-red-300 border border-red-500/30",
};

const ACK_CONFIG = {
  accepted:           { icon: CheckCircle2, color: "text-emerald-400", label: "Accepted" },
  declined:           { icon: XCircle,      color: "text-rose-400",    label: "Declined" },
  revision_requested: { icon: RefreshCw,    color: "text-amber-400",   label: "Revision Requested" },
};

export default function GuardMyShifts() {
  const [user, setUser] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState(null); // shift id
  const [ackNote, setAckNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const me = await base44.auth.me();
      setUser(me);
      const now = new Date();
      const upcoming = await base44.entities.Shift.filter(
        { guard_id: me.id },
        "-start_time",
        50
      );
      // Show upcoming + recent (last 7 days)
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - 7);
      setShifts(upcoming.filter(s => new Date(s.end_time) >= cutoff));
      setLoading(false);
    })();
  }, []);

  const handleAcknowledge = async (shift, status) => {
    setSaving(true);
    await base44.entities.Shift.update(shift.id, {
      guard_ack_status: status,
      guard_ack_note: ackNote,
      guard_ack_at: new Date().toISOString(),
    });
    setShifts(prev =>
      prev.map(s =>
        s.id === shift.id
          ? { ...s, guard_ack_status: status, guard_ack_note: ackNote, guard_ack_at: new Date().toISOString() }
          : s
      )
    );
    // In-app notification to admins
    base44.entities.Notification.create({
      type: "shift_reminder",
      priority: "high",
      title: `Shift ${status.replace("_", " ")} — ${user?.full_name}`,
      message: `${user?.full_name} has ${status.replace("_", " ")} the shift at ${shift.site_name} on ${new Date(shift.start_time).toLocaleDateString("en-ZA")}.${ackNote ? ` Note: ${ackNote}` : ""}`,
      read: false,
      related_entity: "shift",
      related_id: shift.id,
    }).catch(() => {});
    setResponding(null);
    setAckNote("");
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
      </div>
    );
  }

  const upcoming = shifts.filter(s => ["scheduled", "active"].includes(s.status));
  const past = shifts.filter(s => !["scheduled", "active"].includes(s.status));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 md:p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center">
            <Calendar className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">My Shifts</h1>
            <p className="text-slate-400 text-sm">Review and confirm your upcoming assignments</p>
          </div>
        </div>

        {/* Upcoming shifts */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Upcoming</h2>
          {upcoming.length === 0 && (
            <div className="text-center py-10 text-slate-500">No upcoming shifts scheduled.</div>
          )}
          {upcoming.map(shift => {
            const ack = ACK_CONFIG[shift.guard_ack_status];
            const isResponding = responding === shift.id;
            return (
              <Card key={shift.id} className="bg-slate-800 border-slate-700">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span className="font-semibold text-white">{shift.site_name}</span>
                        <Badge className={STATUS_COLORS[shift.status]}>{shift.status}</Badge>
                      </div>
                      <div className="flex items-center gap-2 text-slate-400 text-sm ml-6">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(shift.start_time).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" })}
                        {" · "}
                        {new Date(shift.start_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
                        {" – "}
                        {new Date(shift.end_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      {shift.notes && (
                        <p className="text-slate-500 text-xs ml-6">{shift.notes}</p>
                      )}
                    </div>
                    {ack && !isResponding && (
                      <div className={`flex items-center gap-1 text-xs font-medium ${ack.color} shrink-0`}>
                        <ack.icon className="w-3.5 h-3.5" />
                        {ack.label}
                      </div>
                    )}
                  </div>

                  {/* Acknowledgement panel */}
                  {!isResponding && !shift.guard_ack_status && shift.status === "scheduled" && (
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => { setResponding(shift.id); }}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Respond
                      </Button>
                    </div>
                  )}

                  {isResponding && (
                    <div className="space-y-3 pt-1 border-t border-slate-700">
                      <Textarea
                        placeholder="Optional note (e.g. reason for decline or revision request)..."
                        value={ackNote}
                        onChange={e => setAckNote(e.target.value)}
                        rows={2}
                        className="bg-slate-900 border-slate-700 text-white text-sm"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setResponding(null); setAckNote(""); }}
                          className="border-slate-600 text-slate-300"
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                          disabled={saving}
                          onClick={() => handleAcknowledge(shift, "accepted")}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Accept
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1 bg-amber-600 hover:bg-amber-700"
                          disabled={saving}
                          onClick={() => handleAcknowledge(shift, "revision_requested")}
                        >
                          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Request Revision
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1 bg-rose-600 hover:bg-rose-700"
                          disabled={saving}
                          onClick={() => handleAcknowledge(shift, "declined")}
                        >
                          <XCircle className="w-3.5 h-3.5 mr-1" /> Decline
                        </Button>
                      </div>
                    </div>
                  )}

                  {shift.guard_ack_status && !isResponding && (
                    <div className="text-xs text-slate-500 pt-1 border-t border-slate-700/50">
                      Responded {shift.guard_ack_at ? new Date(shift.guard_ack_at).toLocaleString("en-ZA") : ""}
                      {shift.guard_ack_note && <span className="ml-2 italic">"{shift.guard_ack_note}"</span>}
                      <button
                        className="ml-3 text-sky-400 underline"
                        onClick={() => { setResponding(shift.id); setAckNote(shift.guard_ack_note || ""); }}
                      >
                        Change
                      </button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Past shifts */}
        {past.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Recent (last 7 days)</h2>
            {past.map(shift => (
              <Card key={shift.id} className="bg-slate-800/50 border-slate-700/50 opacity-75">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-slate-500 shrink-0" />
                    <span className="text-slate-300 font-medium">{shift.site_name}</span>
                    <Badge className={STATUS_COLORS[shift.status]}>{shift.status}</Badge>
                    <span className="text-slate-500 text-sm ml-auto">
                      {new Date(shift.start_time).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}