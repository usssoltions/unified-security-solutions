import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Building2, Plus, Pencil, Trash2, MapPin, Users } from "lucide-react";

/**
 * Control Room configuration (Customer Administrators and operational
 * supervisors). A customer may run MULTIPLE control rooms — each with its own
 * address, operators, supervisors, service areas (linked sites, OPTIONAL)
 * and task queue. All writes go through the tenant gateway; operator,
 * supervisor and site ids are validated server-side against the caller's
 * customer — foreign-tenant ids are rejected.
 */
const OPERATOR_ROLES = ["control_room_operator", "dispatcher", "admin", "customer_admin"];
const SUPERVISOR_ROLES = ["dispatcher", "admin", "customer_admin"];

function CheckList({ items, selected, onToggle, emptyText }) {
  if (!items.length) {
    return <div className="text-xs text-slate-500 px-1 py-1.5">{emptyText}</div>;
  }
  return (
    <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800/40 divide-y divide-slate-700/50">
      {items.map((u) => (
        <label key={u.id} className="flex items-center gap-2 px-3 py-2.5 text-sm text-slate-200 cursor-pointer">
          <Checkbox checked={selected.includes(u.id)} onCheckedChange={() => onToggle(u.id)} />
          <span className="truncate">{u.name}</span>
          <span className="text-xs text-slate-500">({u.role_type})</span>
        </label>
      ))}
    </div>
  );
}

const EMPTY = { name: "", physical_address: "", status: "active", linked_site_ids: [], operator_user_ids: [], supervisor_user_ids: [] };

export default function ControlRoomManager({ open, onClose, data, act }) {
  const [rooms, setRooms] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (open) { setRooms(null); setEditing(null); setForm({ ...EMPTY }); }
  }, [open]);

  React.useEffect(() => {
    if (open && rooms === null) {
      // Fresh list from the shared page query data
      setRooms(data?.control_rooms || []);
    }
  }, [open, rooms, data]);

  const staff = data?.staff || [];
  const sites = data?.sites || [];
  const operatorCandidates = staff.filter((u) => OPERATOR_ROLES.includes(u.role_type));
  const supervisorCandidates = staff.filter((u) => SUPERVISOR_ROLES.includes(u.role_type));

  const toggle = (key, id) => setForm((f) => ({
    ...f,
    [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id],
  }));

  const openEdit = (room) => {
    setEditing(room);
    setForm({
      name: room.name || "",
      physical_address: room.physical_address || "",
      status: room.status || "active",
      linked_site_ids: room.linked_site_ids || [],
      operator_user_ids: room.operator_user_ids || [],
      supervisor_user_ids: room.supervisor_user_ids || [],
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await act(editing
        ? { action: "controlRoomSave", id: editing.id, ...form }
        : { action: "controlRoomSave", ...form },
        editing ? "Control room updated" : "Control room created");
      setRooms(null);
      setEditing(null);
      setForm({ ...EMPTY });
    } catch (_) {} finally { setSaving(false); }
  };

  const remove = async (room) => {
    if (!window.confirm(`Delete "${room.name}"? This is only possible when it has no open tasks.`)) return;
    try {
      await act({ action: "controlRoomDelete", id: room.id }, "Control room deleted");
      setRooms(null);
    } catch (_) {}
  };

  const nameOf = (ids) => {
    const map = new Map(staff.map((u) => [u.id, u.name]));
    return (ids || []).map((id) => map.get(id) || "—").join(", ") || "—";
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 max-h-[90vh] overflow-y-auto max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Building2 className="w-5 h-5 text-sky-400" />
            {editing ? "Edit Control Room" : "Control Rooms"}
          </DialogTitle>
        </DialogHeader>

        {editing ? (
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label className="text-slate-300">Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Dogs and All Control Room 1"
                className="bg-slate-800 border-slate-700 text-white h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Physical address</Label>
              <Input value={form.physical_address} onChange={(e) => setForm({ ...form, physical_address: e.target.value })}
                placeholder="Street address of this control room"
                className="bg-slate-800 border-slate-700 text-white h-11" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300">Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-11"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 z-[60]">
                    <SelectItem value="active" className="text-white">Active</SelectItem>
                    <SelectItem value="inactive" className="text-white">Inactive (deactivated — no new task lists)</SelectItem>
                    <SelectItem value="archived" className="text-white">Archived (hidden from active views)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-slate-500" /> Service areas — linked sites (optional)
              </Label>
              <CheckList
                items={sites.map((s) => ({ id: s.id, name: s.name, role_type: "site" }))}
                selected={form.linked_site_ids}
                onToggle={(id) => toggle("linked_site_ids", id)}
                emptyText="No active sites — this control room can run on address/service area alone" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-slate-500" /> Control Room Operators
              </Label>
              <CheckList items={operatorCandidates} selected={form.operator_user_ids}
                onToggle={(id) => toggle("operator_user_ids", id)}
                emptyText="Invite Control Room Operators first (User Management)" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Supervisors</Label>
              <CheckList items={supervisorCandidates} selected={form.supervisor_user_ids}
                onToggle={(id) => toggle("supervisor_user_ids", id)}
                emptyText="No supervisors available" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setEditing(null); setForm({ ...EMPTY }); }}
                className="bg-slate-800 border-slate-700 text-slate-200">Back</Button>
              <Button onClick={save} disabled={!form.name.trim() || saving}
                className="bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white">
                {saving ? "Saving..." : "Save Control Room"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 py-1">
            {(rooms || []).length === 0 && (
              <div className="text-center py-8">
                <Building2 className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">No control rooms yet — create the first one</p>
              </div>
            )}
            {(rooms || []).map((room) => (
              <div key={room.id} className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-white truncate">{room.name}</p>
                    <p className="text-xs text-slate-400">{room.physical_address || "No address"}</p>
                    <p className="text-xs text-slate-500 mt-1.5">
                      Operators: {nameOf(room.operator_user_ids)} · Supervisors: {nameOf(room.supervisor_user_ids)}
                    </p>
                    <p className="text-xs text-slate-500">
                      Service areas: {(room.linked_site_ids || []).length || 0} site(s) · Status: {room.status}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => openEdit(room)}
                      className="bg-slate-800 border-slate-700 text-slate-200 h-10">
                      <Pencil className="w-4 h-4" /> Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => remove(room)}
                      className="bg-slate-800 border-slate-700 text-rose-400 hover:bg-rose-500/10 h-10">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            <Button onClick={() => setEditing({})} className="w-full h-11">
              <Plus className="w-4 h-4" /> New Control Room
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}