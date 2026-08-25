import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, UserPlus, ShieldCheck } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

/**
 * ResellerAdminInvite — modal to invite a tenant-scoped user.
 *  - Platform Admin (allowResellerAdmin=true): can create a Reseller Admin
 *    (scoped to the fixed reseller) or a Customer Admin / user under a customer.
 *  - Reseller Admin (allowResellerAdmin=false): can only create Customer Admins
 *    / users under customers belonging to their reseller.
 *
 * Always invites with platform role "user" — never "admin". Scoping is applied
 * server-side by inviteTenantUser.
 */
export default function ResellerAdminInvite({
  open, onClose, resellerId, resellerName, customers, allowResellerAdmin, onDone,
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "", phone: "",
    role_type: allowResellerAdmin ? "reseller_admin" : "customer_admin",
    customer_id: "", status: "active",
  });

  const reset = () => setForm({
    first_name: "", last_name: "", email: "", phone: "",
    role_type: allowResellerAdmin ? "reseller_admin" : "customer_admin",
    customer_id: "", status: "active",
  });

  const display_name = [form.first_name, form.last_name].filter(Boolean).join(" ").trim();
  const isResellerAdminRole = form.role_type === "reseller_admin";
  const needsCustomer = ["customer_admin", "admin", "user", "guard", "dispatcher", "estate_manager", "practice_admin", "reception", "therapist"].includes(form.role_type);

  const submit = async () => {
    if (!form.email) { toast({ title: "Email is required", variant: "destructive" }); return; }
    if (isResellerAdminRole && !allowResellerAdmin) { toast({ title: "Not permitted", variant: "destructive" }); return; }
    if (needsCustomer && !form.customer_id) { toast({ title: "Select a customer", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await base44.functions.invoke("inviteTenantUser", {
        action: "invite",
        email: form.email,
        role_type: form.role_type,
        reseller_id: resellerId,
        customer_id: needsCustomer ? form.customer_id : null,
        display_name: display_name || undefined,
        phone: form.phone || undefined,
        status: form.status,
      });
      const d = res?.data || res;
      if (!d?.success && d?.error) throw new Error(d.error);
      toast({ title: "Invitation sent", description: `${form.email} invited as ${form.role_type}` });
      reset();
      onDone?.();
      onClose?.();
    } catch (e) {
      toast({ title: "Failed to invite", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose?.(); } }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-sky-400" />
            {isResellerAdminRole ? "Add Reseller Administrator" : "Add User"}
            {resellerName && <span className="text-slate-400 text-sm font-normal">· {resellerName}</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <div><Label className="text-slate-300 text-xs">First Name</Label>
            <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} className="bg-slate-950 border-slate-700 mt-1" />
          </div>
          <div><Label className="text-slate-300 text-xs">Last Name</Label>
            <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} className="bg-slate-950 border-slate-700 mt-1" />
          </div>
          <div><Label className="text-slate-300 text-xs">Email *</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-slate-950 border-slate-700 mt-1" />
          </div>
          <div><Label className="text-slate-300 text-xs">Mobile Number</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="bg-slate-950 border-slate-700 mt-1" />
          </div>
          <div><Label className="text-slate-300 text-xs">Role *</Label>
            <Select value={form.role_type} onValueChange={(v) => setForm({ ...form, role_type: v })}>
              <SelectTrigger className="bg-slate-950 border-slate-700 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {allowResellerAdmin && <SelectItem value="reseller_admin">Reseller Administrator</SelectItem>}
                <SelectItem value="customer_admin">Customer Administrator</SelectItem>
                <SelectItem value="admin">Customer Admin (operations)</SelectItem>
                <SelectItem value="estate_manager">Estate Manager</SelectItem>
                <SelectItem value="practice_admin">Practice Admin (Medical)</SelectItem>
                <SelectItem value="dispatcher">Dispatcher</SelectItem>
                <SelectItem value="guard">Security Guard</SelectItem>
                <SelectItem value="reception">Reception</SelectItem>
                <SelectItem value="therapist">Therapist</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-slate-300 text-xs">Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-slate-950 border-slate-700 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {!isResellerAdminRole && (
            <div className="sm:col-span-2">
              <Label className="text-slate-300 text-xs">Customer {needsCustomer ? "*" : "(optional)"}</Label>
              <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })}>
                <SelectTrigger className="bg-slate-950 border-slate-700 mt-1"><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {(customers || []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="sm:col-span-2 flex items-start gap-2 bg-sky-500/10 border border-sky-500/20 rounded-lg p-2.5">
            <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-300">
              Reseller assignment is fixed to <span className="text-white font-medium">{resellerName || "this reseller"}</span>.
              The invitee receives a non-platform role and is scoped to this reseller{needsCustomer ? " and the selected customer" : ""}. The USS Platform Admin role is never granted.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => { reset(); onClose?.(); }} className="text-slate-300">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-sky-500 hover:bg-sky-600">
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1" />}
            Send Invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}