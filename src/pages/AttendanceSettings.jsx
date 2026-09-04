import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Settings, Plus, Pencil, Archive, RotateCcw, Loader2, Check, X, ShieldAlert,
  ChevronDown, ChevronUp
} from "lucide-react";
import { Link } from "react-router-dom";
import { attendanceCall } from "@/lib/attendanceApi";

/**
 * Attendance Settings — dropdown option management.
 *
 * Ordinary attendance staff get a READ-ONLY view; option management is
 * restricted to authorized admins (practice/customer admins, reseller admins,
 * platform admins) and is enforced SERVER-SIDE by the attendanceAccess
 * gateway — this UI gate is presentation only.
 */
function OptionSection({ title, optionType, options, onRefresh, readOnly }) {
  const [newLabel, setNewLabel] = useState("");
  const [editId, setEditId] = useState(null);
  const [editLabel, setEditLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const typeOptions = options.filter(o => o.option_type === optionType)
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
  // Active and archived/inactive options are NEVER mixed into one list.
  const activeOptions = typeOptions.filter(o => o.active);
  const inactiveOptions = typeOptions.filter(o => !o.active);

  const addOption = async () => {
    if (!newLabel.trim()) return;
    setSaving(true);
    try {
      await attendanceCall("save_option", { option_type: optionType, label: newLabel.trim() });
      setNewLabel(""); onRefresh();
    } finally { setSaving(false); }
  };

  const saveEdit = async () => {
    if (!editLabel.trim()) return;
    setSaving(true);
    try {
      await attendanceCall("update_option", { id: editId, label: editLabel.trim() });
      setEditId(null); setEditLabel(""); onRefresh();
    } finally { setSaving(false); }
  };

  // Deactivate (soft-archive): hidden from new attendance dropdowns, never
  // deleted — historical records keep the original value. Restore reverses it.
  const deactivateOption = async (opt) => {
    setSaving(true);
    try {
      await attendanceCall("update_option", { id: opt.id, active: false });
      onRefresh();
    } finally { setSaving(false); }
  };

  const restoreOption = async (opt) => {
    setSaving(true);
    try {
      await attendanceCall("update_option", { id: opt.id, active: true });
      onRefresh();
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] overflow-hidden">
      <div className="px-4 py-3 bg-[var(--surface-raised)] flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">{title}</h3>
        <span className="text-slate-400 text-xs">{typeOptions.filter(o => o.active).length} active</span>
      </div>
      {/* Active Options — the only list new attendance registrations draw from */}
      <div className="px-4 pt-3 pb-1 text-slate-500 text-[11px] font-semibold uppercase tracking-wide">
        Active Options
      </div>
      <div className="divide-y divide-slate-700/50">
        {activeOptions.length === 0 && (
          <p className="px-4 py-3 text-slate-500 text-xs italic">No active options configured.</p>
        )}
        {activeOptions.map(opt => (
          <div key={opt.id} className="px-4 py-3 flex items-center gap-3">
            {editId === opt.id ? (
              <>
                <Input value={editLabel} onChange={e => setEditLabel(e.target.value)} autoFocus
                  className="bg-slate-900 border-slate-700 text-white text-sm h-10 flex-1" />
                <Button size="icon" variant="brand" onClick={saveEdit} disabled={saving} className="h-10 w-10 shrink-0">
                  <Check className="w-4 h-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => { setEditId(null); setEditLabel(""); }} className="h-10 w-10 shrink-0 text-slate-400">
                  <X className="w-4 h-4" />
                </Button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm text-white">{opt.label}</span>
                {!readOnly && (
                  <>
                    <Button size="icon" variant="ghost" title="Rename" onClick={() => { setEditId(opt.id); setEditLabel(opt.label); }} className="h-10 w-10 shrink-0 text-slate-400">
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost" title="Deactivate — hides this option from new attendance registrations; historical records keep the value" onClick={() => deactivateOption(opt)} disabled={saving} className="h-10 w-10 shrink-0 text-amber-400">
                      <Archive className="w-4 h-4" />
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {/* Archived / Inactive — collapsed, never mixed into the active list */}
      {inactiveOptions.length > 0 && (
        <div className="border-t border-slate-700/50">
          <button onClick={() => setShowArchived(!showArchived)}
            className="w-full px-4 py-2.5 flex items-center gap-2 text-slate-400 hover:text-white text-xs font-medium transition-colors">
            {showArchived ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            Archived / Inactive ({inactiveOptions.length})
          </button>
          {showArchived && (
            <div className="divide-y divide-slate-700/50 border-t border-slate-700/30">
              {inactiveOptions.map(opt => (
                <div key={opt.id} className="px-4 py-3 flex items-center gap-3 bg-slate-900/40">
                  <span className="flex-1 text-sm text-slate-500">{opt.label}</span>
                  <Badge variant="secondary" className="text-[10px]">Inactive</Badge>
                  {!readOnly && (
                    <Button size="icon" variant="ghost" title="Restore — return this option to active use" onClick={() => restoreOption(opt)} disabled={saving} className="h-10 w-10 shrink-0 text-emerald-400">
                      <RotateCcw className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {!readOnly && (
        <div className="px-4 py-3 border-t border-slate-700 flex gap-2">
          <Input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="New option label…"
            className="bg-slate-900 border-slate-700 text-white text-sm h-11"
            onKeyDown={e => e.key === "Enter" && addOption()} />
          <Button onClick={addOption} disabled={!newLabel.trim() || saving} variant="brand" className="h-11 w-11 shrink-0">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function AttendanceSettings() {
  const { data: ctx } = useQuery({
    queryKey: ["att_context"],
    queryFn: () => attendanceCall("get_context"),
    staleTime: 60000,
  });

  const { data: options = [], refetch, isLoading } = useQuery({
    queryKey: ["att_options_full"],
    queryFn: () => attendanceCall("list_options").then(r => r.options || []),
    enabled: !!ctx?.authorized, staleTime: 15000,
  });

  const handleResetDefaults = async () => {
    try {
      await attendanceCall("reset_defaults");
      refetch();
    } catch (_) { /* gateway enforces authorization; failures surface as no-op */ }
  };

  if (!ctx) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
      </div>
    );
  }

  if (!ctx.authorized) {
    return (
      <div className="p-4 max-w-md mx-auto text-center py-16">
        <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <ShieldAlert className="w-8 h-8 text-slate-500" />
        </div>
        <h2 className="text-white text-lg font-semibold mb-2">Attendance Register unavailable</h2>
        <p className="text-slate-400 text-sm">{ctx.reason}</p>
      </div>
    );
  }

  const canManage = !!ctx.can_manage_options;

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-3 mb-2">
        <Link to="/AttendanceDashboard" className="text-slate-400 text-sm hover:text-white">← Dashboard</Link>
        <h1 className="text-white text-xl font-bold flex-1">Attendance Settings</h1>
      </div>

      {!canManage && (
        <div className="bg-[var(--surface-raised)] border border-[var(--border-default)] rounded-xl p-3">
          <p className="text-slate-300 text-sm">Read-only view — option management requires an administrator role.</p>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
        </div>
      )}

      {canManage && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={handleResetDefaults} className="border-slate-600 text-slate-400 text-xs">
            Reset to Default Options
          </Button>
        </div>
      )}

      <OptionSection
        title="Medical Centres"
        optionType="medical_centre"
        options={options}
        onRefresh={refetch}
        readOnly={!canManage}
      />
      <OptionSection
        title="Assessment Types"
        optionType="assessment_type"
        options={options}
        onRefresh={refetch}
        readOnly={!canManage}
      />

      <div className="bg-[var(--surface-raised)] rounded-xl border border-[var(--border-default)] p-4">
        <p className="text-slate-400 text-xs">
          <strong className="text-slate-300">Deactivating</strong> an option archives it — it disappears from new attendance
          registrations, stays under Archived / Inactive, and can be restored at any time. Historical attendance records,
          PDF and Excel exports always keep their original values.
        </p>
      </div>
    </div>
  );
}