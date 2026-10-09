import React, { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AssignmentsEditor from "./AssignmentsEditor";

/**
 * ControllerAssignments — allocate controllers (control room operators) to
 * sites. Controllers then see only these allocated sites server-side.
 */
export default function ControllerAssignments({ data, onChanged }) {
  const users = (data?.users || []).filter((u) => u.vl_profile && ["control_room_operator", "customer_admin"].includes(u.vl_profile.vl_role));
  const sites = data?.sites || [];
  const [userId, setUserId] = useState(null);
  const selected = users.find((u) => u.user_id === userId) || null;

  useEffect(() => { if (!userId && users.length) setUserId(users[0].user_id); }, [users]);

  if (!users.length) {
    return <p className="text-xs text-slate-500">No Control Room Operators yet — invite one in User Management (role: Control Room Operator), then configure their VoiceLink profile under Personnel Setup.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-slate-300 text-xs">Controller</Label>
        <Select value={userId || ""} onValueChange={setUserId}>
          <SelectTrigger className="bg-slate-950 border-slate-700 text-white"><SelectValue /></SelectTrigger>
          <SelectContent>{users.map((u) => <SelectItem key={u.user_id} value={u.user_id}>{u.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {selected && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">Currently allocated: {selected.assignments?.filter((a) => a.kind === "controller").map((a) => a.site_name).join(", ") || "none"}.</p>
          <AssignmentsEditor targetUser={selected} kind="controller" sites={sites}
            current={(selected.assignments || []).filter((a) => a.kind === "controller")} onSaved={onChanged} />
        </div>
      )}
    </div>
  );
}