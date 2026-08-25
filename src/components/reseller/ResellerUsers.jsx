import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, UserPlus, Mail, Phone, ShieldCheck } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import ResellerAdminInvite from "@/components/reseller/ResellerAdminInvite";

const ROLE_LABEL = {
  reseller_admin: "Reseller Admin", customer_admin: "Customer Admin", admin: "Admin",
  estate_manager: "Estate Manager", practice_admin: "Practice Admin", dispatcher: "Dispatcher",
  guard: "Guard", reception: "Reception", therapist: "Therapist", platform_admin: "Platform Admin",
};

/**
 * ResellerUsers — list users belonging to the reseller (via getTenantUsers,
 * since the built-in User entity restricts listing to platform admins) and
 * invite new Reseller Admins / Customer Admins / users.
 */
export default function ResellerUsers({ resellerId, resellerName, users, onRefresh, canCreateResellerAdmin, canInvite, readOnly }) {
  const { toast } = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busy, setBusy] = useState(null);

  const deactivate = async (u) => {
    if (!window.confirm(`Deactivate ${u.email}? They will lose access.`)) return;
    setBusy(u.id);
    try {
      const res = await base44.functions.invoke("manageUser", { action: "deactivate", target_user_id: u.id });
      const d = res?.data || res;
      if (!d?.success && d?.error) throw new Error(d.error);
      toast({ title: "User deactivated" });
      onRefresh?.();
    } catch (e) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-slate-400 text-sm">{users.length} user(s) in this reseller.</p>
        {canInvite && (
          <Button size="sm" onClick={() => setInviteOpen(true)} className="bg-sky-500 hover:bg-sky-600">
            <UserPlus className="w-4 h-4 mr-1" /> {canCreateResellerAdmin ? "Add Reseller Admin" : "Add User"}
          </Button>
        )}
      </div>

      {users.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-8">No users yet. {canCreateResellerAdmin ? "Add the first Reseller Administrator." : "Invite a user."}</p>
      ) : users.map((u) => (
        <div key={u.id} className="flex items-center justify-between bg-slate-800/40 p-3 rounded-lg">
          <div className="min-w-0">
            <p className="text-white text-sm font-medium flex items-center gap-2">
              <ShieldCheck className={`w-4 h-4 ${u.role_type === "reseller_admin" ? "text-sky-400" : "text-slate-500"}`} />
              {u.display_name || u.full_name || u.email}
            </p>
            <p className="text-slate-500 text-xs flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {u.email}</span>
              {u.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {u.phone}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className="bg-slate-700/60 text-slate-200">{ROLE_LABEL[u.role_type] || u.role_type || "—"}</Badge>
            {!readOnly && u.role_type !== "reseller_admin" && u.role_type !== "platform_admin" && (
              <Button size="sm" variant="ghost" className="text-rose-400 hover:text-rose-300" disabled={busy === u.id} onClick={() => deactivate(u)}>
                {busy === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Deactivate"}
              </Button>
            )}
          </div>
        </div>
      ))}

      {inviteOpen && (
        <ResellerAdminInvite open={inviteOpen} onClose={() => setInviteOpen(false)} onDone={onRefresh}
          resellerId={resellerId} resellerName={resellerName}
          customers={[]} allowResellerAdmin={canCreateResellerAdmin} />
      )}
    </div>
  );
}