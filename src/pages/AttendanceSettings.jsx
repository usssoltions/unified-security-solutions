import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Settings, Plus, Pencil, Archive, RotateCcw, Loader2, Check, X, Building2, ClipboardList
} from "lucide-react";
import { Link } from "react-router-dom";
import { seedDefaultOptions } from "@/lib/attendanceDropdowns";

function OptionSection({ title, optionType, customerId, options, onRefresh }) {
  const queryClient = useQueryClient();
  const [newLabel, setNewLabel] = useState("");
  const [editId, setEditId] = useState(null);
  const [editLabel, setEditLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const typeOptions = options.filter(o => o.option_type === optionType)
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));

  const addOption = async () => {
    if (!newLabel.trim()) return;
    setSaving(true);
    try {
      await base44.entities.AttendanceDropdownOption.create({
        customer_id: customerId, option_type: optionType,
        label: newLabel.trim(), active: true, sort_order: typeOptions.length,
      });
      setNewLabel(""); onRefresh();
    } finally { setSaving(false); }
  };

  const saveEdit = async () => {
    if (!editLabel.trim()) return;
    setSaving(true);
    try {
      await base44.entities.AttendanceDropdownOption.update(editId, { label: editLabel.trim() });
      setEditId(null); setEditLabel(""); onRefresh();
    } finally { setSaving(false); }
  };

  const toggleActive = async (opt) => {
    setSaving(true);
    try {
      await base44.entities.AttendanceDropdownOption.update(opt.id, { active: !opt.active });
      onRefresh();
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-slate-800/60 rounded-2xl border border-slate-700 overflow-hidden">
      <div className="px-4 py-3 bg-slate-800/80 flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">{title}</h3>
        <span className="text-slate-400 text-xs">{typeOptions.filter(o => o.active).length} active</span>
      </div>
      <div className="divide-y divide-slate-700/50">
        {typeOptions.map(opt => (
          <div key={opt.id} className="px-4 py-3 flex items-center gap-3">
            {editId === opt.id ? (
              <>
                <Input value={editLabel} onChange={e => setEditLabel(e.target.value)} autoFocus
                  className="bg-slate-900 border-slate-700 text-white text-sm h-8 flex-1" />
                <Button size="icon" onClick={saveEdit} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 h-8 w-8">
                  <Check className="w-3.5 h-3.5" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => { setEditId(null); setEditLabel(""); }} className="h-8 w-8 text-slate-400">
                  <X className="w-3.5 h-3.5" />
                </Button>
              </>
            ) : (
              <>
                <span className={`flex-1 text-sm ${opt.active ? "text-white" : "text-slate-500 line-through"}`}>{opt.label}</span>
                <Badge variant={opt.active ? "default" : "secondary"} className="text-[10px]">{opt.active ? "Active" : "Inactive"}</Badge>
                <Button size="icon" variant="ghost" onClick={() => { setEditId(opt.id); setEditLabel(opt.label); }} className="h-7 w-7 text-slate-400">
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => toggleActive(opt)} className={`h-7 w-7 ${opt.active ? "text-amber-400" : "text-emerald-400"}`}>
                  {opt.active ? <Archive className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="px-4 py-3 border-t border-slate-700 flex gap-2">
        <Input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="New option label…"
          className="bg-slate-900 border-slate-700 text-white text-sm h-9"
          onKeyDown={e => e.key === "Enter" && addOption()} />
        <Button onClick={addOption} disabled={!newLabel.trim() || saving} size="sm" className="bg-sky-600 hover:bg-sky-700 h-9">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        </Button>
      </div>
    </div>
  );
}

export default function AttendanceSettings() {
  const [user, setUser] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser).catch(() => {}); }, []);

  // Only admins/practice_admins/platform admins should access settings
  const canAdmin = user && ["admin", "practice_admin", "dispatcher"].includes(user.role_type) || user?.role === "admin" || user?.admin_level === "platform";

  const { data: options = [], refetch } = useQuery({
    queryKey: ["att_options", user?.customer_id],
    queryFn: () => base44.entities.AttendanceDropdownOption.filter({ customer_id: user.customer_id }),
    enabled: !!user?.customer_id, staleTime: 15000,
  });

  const handleSeedDefaults = async () => {
    if (!user?.customer_id) return;
    await seedDefaultOptions(user.customer_id);
    refetch();
  };

  if (!canAdmin) {
    return (
      <div className="p-4 max-w-xl mx-auto text-center py-16">
        <Settings className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400">Administrator access required for Attendance Settings.</p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-3 mb-2">
        <Link to="/AttendanceDashboard" className="text-slate-400 text-sm hover:text-white">← Dashboard</Link>
        <h1 className="text-white text-xl font-bold flex-1">Attendance Settings</h1>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleSeedDefaults} className="border-slate-600 text-slate-400 text-xs">
          Reset to Default Options
        </Button>
      </div>

      <OptionSection
        title="Medical Centres"
        optionType="medical_centre"
        customerId={user?.customer_id}
        options={options}
        onRefresh={refetch}
      />
      <OptionSection
        title="Assessment Types"
        optionType="assessment_type"
        customerId={user?.customer_id}
        options={options}
        onRefresh={refetch}
      />

      <div className="bg-slate-800/40 rounded-xl border border-slate-700 p-4">
        <p className="text-slate-400 text-xs">
          <strong className="text-slate-300">Deactivating</strong> an option hides it from new attendance registrations.
          Historical records continue to display the value correctly.
        </p>
      </div>
    </div>
  );
}