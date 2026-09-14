import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, Plus, Trash2, Shield, Zap } from "lucide-react";

const FREQUENCY_OPTIONS = [
  { label: "Every 30 minutes", value: 30 },
  { label: "Every 1 hour", value: 60 },
  { label: "Every 2 hours", value: 120 },
  { label: "Every 3 hours", value: 180 },
  { label: "Every 4 hours", value: 240 },
  { label: "Custom", value: 0 },
];

export default function PatrolSiteConfig({ patrolConfig = {}, onChange }) {
  const cfg = {
    enabled: false,
    schedules: [],
    duration_target_minutes: 30,
    random_route: true,
    ai_route_optimization: true,
    alert_before_minutes: 10,
    escalation_after_minutes: 15,
    supervisor_escalation: true,
    ...patrolConfig,
  };

  const update = (patch) => onChange({ ...cfg, ...patch });

  // CUSTOM MINUTES DRAFT STATE — kept LOCAL while typing so the input never
  // remounts or loses focus on a keystroke. The schedule value commits ONLY
  // when the draft is a valid positive integer.
  const [customDrafts, setCustomDrafts] = useState({});

  const addSchedule = () => {
    update({
      schedules: [...cfg.schedules, { start_time: "06:00", end_time: "18:00", frequency_minutes: 60 }],
    });
  };

  const updateSchedule = (i, patch) => {
    const updated = cfg.schedules.map((s, idx) => idx === i ? { ...s, ...patch } : s);
    update({ schedules: updated });
  };

  const removeSchedule = (i) => {
    update({ schedules: cfg.schedules.filter((_, idx) => idx !== i) });
    // Keep drafts aligned with the shifted schedule indexes.
    setCustomDrafts(prev => {
      const next = {};
      Object.entries(prev).forEach(([k, v]) => {
        const n = Number(k);
        if (n < i) next[k] = v;
        else if (n > i) next[String(n - 1)] = v;
      });
      return next;
    });
  };

  // Calculate patrols per day for a schedule
  const calcPatrols = (s) => {
    if (!s.start_time || !s.end_time) return 0;
    const [sh, sm] = s.start_time.split(":").map(Number);
    const [eh, em] = s.end_time.split(":").map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) mins += 24 * 60;
    if (s.random_timing) return s.patrol_count || Math.max(1, Math.floor(mins / (s.frequency_minutes || 60)));
    if (!s.frequency_minutes) return 0;
    return Math.floor(mins / s.frequency_minutes);
  };

  return (
    <Card className="bg-slate-800/60 border-slate-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white flex items-center gap-2 text-base">
            <Shield className="w-4 h-4 text-sky-400" /> Patrol Configuration
          </CardTitle>
          <Switch checked={!!cfg.enabled} onCheckedChange={v => update({ enabled: v })} />
        </div>
      </CardHeader>
      {cfg.enabled && (
        <CardContent className="space-y-5">
          {/* Schedules */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-300 text-sm font-semibold">Patrol Schedules</p>
              <Button size="sm" onClick={addSchedule} className="bg-sky-700 hover:bg-sky-800 h-7 text-xs">
                <Plus className="w-3 h-3 mr-1" /> Add Schedule
              </Button>
            </div>
            {cfg.schedules.length === 0 && (
              <p className="text-slate-500 text-xs">No schedules yet. Add one above.</p>
            )}
            {cfg.schedules.map((s, i) => {
              const isCustomFrequency = s.frequency_custom || s.frequency_minutes === 0;
              const customDraft = customDrafts[i] ?? (isCustomFrequency && s.frequency_minutes > 0 ? String(s.frequency_minutes) : "");
              const customValid = /^\d+$/.test(customDraft.trim()) && parseInt(customDraft) > 0;
              return (
              <div key={i} className="bg-slate-900/60 rounded-lg p-3 mb-2 border border-slate-700">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
                  <div>
                    <p className="text-slate-400 text-xs mb-1">Start Time</p>
                    <Input type="time" value={s.start_time}
                      onChange={e => updateSchedule(i, { start_time: e.target.value })}
                      className="bg-slate-800 border-slate-600 text-white h-8 text-sm" />
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs mb-1">End Time</p>
                    <Input type="time" value={s.end_time}
                      onChange={e => updateSchedule(i, { end_time: e.target.value })}
                      className="bg-slate-800 border-slate-600 text-white h-8 text-sm" />
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs mb-1">Frequency</p>
                    <Select value={isCustomFrequency ? "0" : String(s.frequency_minutes)}
                      onValueChange={v => {
                        const n = parseInt(v);
                        setCustomDrafts(d => ({ ...d, [i]: "" }));
                        if (n === 0) updateSchedule(i, { frequency_minutes: 0, frequency_custom: true });
                        else updateSchedule(i, { frequency_minutes: n, frequency_custom: false });
                      }}>
                      <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FREQUENCY_OPTIONS.map(o => (
                          <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {isCustomFrequency && (
                      <div className="mt-1">
                        <Input type="number" inputMode="numeric" min="1" placeholder="Minutes (e.g. 15)"
                          value={customDraft}
                          onChange={e => {
                            const v = e.target.value;
                            // Draft only — no parent remount on keystrokes. The
                            // schedule commits ONLY a valid positive integer.
                            setCustomDrafts(d => ({ ...d, [i]: v }));
                            if (/^\d+$/.test(v.trim()) && parseInt(v) > 0) {
                              updateSchedule(i, { frequency_minutes: parseInt(v) });
                            }
                          }}
                          className={`mt-1 bg-slate-800 border-slate-600 text-white h-8 text-sm ${customDraft !== "" && !customValid ? "border-rose-500" : ""}`} />
                        {customDraft !== "" && !customValid && (
                          <p className="text-rose-400 text-xs mt-1">Enter a positive whole number of minutes (e.g. 15).</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-sky-400" />
                      <Badge className="bg-sky-800 text-xs">{calcPatrols(s)} patrols/day</Badge>
                    </div>
                    <button onClick={() => removeSchedule(i)} className="text-rose-400 hover:text-rose-300 p-1">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Random patrol timing — unpredictable (deterministic/idempotent)
                    patrol times inside the window with a minimum spacing. */}
                <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-slate-700/60 pt-2">
                  <label className="flex items-center gap-1.5">
                    <Switch checked={!!s.random_timing}
                      onCheckedChange={v => updateSchedule(i, { random_timing: v, ...(v && !s.patrol_count ? { patrol_count: 4 } : {}) })} />
                    <span className="text-slate-300 text-xs">Random Patrol Timing</span>
                  </label>
                  {s.random_timing && (
                    <>
                      <label className="flex items-center gap-1">
                        <span className="text-slate-400 text-xs">Patrols</span>
                        <Input type="number" min="1" value={s.patrol_count || ""}
                          placeholder={String(calcPatrols(s) || 4)}
                          onChange={e => updateSchedule(i, { patrol_count: parseInt(e.target.value) || undefined })}
                          className="bg-slate-800 border-slate-600 text-white h-8 text-sm w-16" />
                      </label>
                      <label className="flex items-center gap-1">
                        <span className="text-slate-400 text-xs">Min spacing (min)</span>
                        <Input type="number" min="1" value={s.min_spacing_minutes ?? 45}
                          onChange={e => updateSchedule(i, { min_spacing_minutes: parseInt(e.target.value) || 45 })}
                          className="bg-slate-800 border-slate-600 text-white h-8 text-sm w-20" />
                      </label>
                    </>
                  )}
                </div>
              </div>
              );
            })}
          </div>

          {/* Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-slate-400 text-xs mb-1">Duration Target (min)</p>
              <Input type="number" value={cfg.duration_target_minutes}
                onChange={e => update({ duration_target_minutes: parseInt(e.target.value) })}
                className="bg-slate-900 border-slate-700 text-white h-8 text-sm" />
            </div>
            <div>
              <p className="text-slate-400 text-xs mb-1">Alert Before (min)</p>
              <Input type="number" value={cfg.alert_before_minutes}
                onChange={e => update({ alert_before_minutes: parseInt(e.target.value) })}
                className="bg-slate-900 border-slate-700 text-white h-8 text-sm" />
            </div>
            <div>
              <p className="text-slate-400 text-xs mb-1">Escalate After (min)</p>
              <Input type="number" value={cfg.escalation_after_minutes}
                onChange={e => update({ escalation_after_minutes: parseInt(e.target.value) })}
                className="bg-slate-900 border-slate-700 text-white h-8 text-sm" />
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-2">
            {[
              { key: "random_route",          label: "Random Route Generation" },
              { key: "ai_route_optimization", label: "AI Route Optimization" },
              { key: "supervisor_escalation", label: "Supervisor Escalation" },
            ].map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-sky-400" />
                  <p className="text-slate-300 text-sm">{label}</p>
                </div>
                <Switch checked={!!cfg[key]} onCheckedChange={v => update({ [key]: v })} />
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}