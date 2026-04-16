import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X, UserPlus, Lock, Mail } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function UserForm({ user, onClose, onSuccess }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    full_name: user?.full_name || "",
    email: user?.email || "",
    role_type: user?.role_type || "guard",
    badge_number: user?.badge_number || "",
    phone_number: user?.phone_number || "",
    security_pin: user?.security_pin || "",
    new_password: ""
  });

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("guard");
  const [inviteStatus, setInviteStatus] = useState(null);

  const updateUserMutation = useMutation({
    mutationFn: async (data) => {
      const updateData = {
        full_name: data.full_name,
        role_type: data.role_type,
        badge_number: data.badge_number,
        phone_number: data.phone_number,
        security_pin: data.security_pin
      };
      return await base44.entities.User.update(user.id, updateData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["allUsers"]);
      onSuccess();
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (user) {
      updateUserMutation.mutate(formData);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) {
      setInviteStatus({ error: "Please enter an email address." });
      return;
    }
    setInviteStatus({ loading: true });
    try {
      // Base44 invite — role must be "admin" or "user"; we set role_type via update after
      const baseRole = ["admin"].includes(inviteRole) ? "admin" : "user";
      await base44.users.inviteUser(inviteEmail.trim(), baseRole);
      setInviteStatus({ success: `Invitation sent to ${inviteEmail}. Once they log in, edit their profile to set their specific role (${inviteRole}).` });
      setInviteEmail("");
    } catch (err) {
      setInviteStatus({ error: err?.message || "Failed to send invitation. The user may already exist." });
    }
  };

  if (!user) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
        <Card className="w-full max-w-2xl bg-slate-800 border-slate-700 my-8">
          <CardHeader className="border-b border-slate-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <UserPlus className="w-6 h-6 text-sky-400" />
                <CardTitle className="text-white">Invite New User</CardTitle>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400">
                <X className="w-5 h-5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300">Email Address *</Label>
              <Input
                type="email"
                placeholder="user@example.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">Role *</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="dispatcher">Dispatcher / Supervisor</SelectItem>
                  <SelectItem value="guard">Security Guard</SelectItem>
                  <SelectItem value="client">Client</SelectItem>
                  <SelectItem value="estate_manager">Estate Manager</SelectItem>
                  <SelectItem value="resident">Resident</SelectItem>
                  <SelectItem value="vendor">Vendor</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {inviteStatus?.success && (
              <Alert className="bg-emerald-500/10 border-emerald-500/20">
                <AlertDescription className="text-emerald-300 text-sm">{inviteStatus.success}</AlertDescription>
              </Alert>
            )}
            {inviteStatus?.error && (
              <Alert className="bg-rose-500/10 border-rose-500/20">
                <AlertDescription className="text-rose-300 text-sm">{inviteStatus.error}</AlertDescription>
              </Alert>
            )}

            <Alert className="bg-amber-500/10 border-amber-500/20">
              <AlertDescription className="text-slate-300 text-sm">
                The user will receive an email invitation. After they log in for the first time, you can edit their profile to confirm their role and add additional details like badge number and phone.
              </AlertDescription>
            </Alert>

            <div className="flex gap-3 pt-2">
              <Button onClick={onClose} variant="outline" className="flex-1 border-slate-600 text-slate-300">Cancel</Button>
              <Button onClick={handleInvite} disabled={inviteStatus?.loading} className="flex-1 bg-sky-600 hover:bg-sky-700">
                <Mail className="w-4 h-4 mr-2" />
                {inviteStatus?.loading ? "Sending..." : "Send Invitation"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <Card className="w-full max-w-2xl bg-slate-800 border-slate-700 my-8">
        <CardHeader className="border-b border-slate-700">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white">Edit User</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400">
              <X className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-slate-300">Full Name *</Label>
                <Input
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">Email *</Label>
                <Input
                  type="email"
                  value={formData.email}
                  disabled
                  className="bg-slate-900/50 border-slate-700 text-slate-500"
                  title="Email cannot be changed"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">Role Type *</Label>
                <Select
                  value={formData.role_type}
                  onValueChange={(value) => setFormData({ ...formData, role_type: value })}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="dispatcher">Dispatcher / Supervisor</SelectItem>
                    <SelectItem value="guard">Security Guard</SelectItem>
                    <SelectItem value="client">Client</SelectItem>
                    <SelectItem value="estate_manager">Estate Manager</SelectItem>
                    <SelectItem value="resident">Resident</SelectItem>
                    <SelectItem value="vendor">Vendor</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">Badge / Employee Number</Label>
                <Input
                  value={formData.badge_number}
                  onChange={(e) => setFormData({ ...formData, badge_number: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                  placeholder="e.g. GRD-001"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">Phone Number</Label>
                <Input
                  type="tel"
                  value={formData.phone_number}
                  onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                  placeholder="+27 12 345 6789"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300 flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  Security PIN (for clock-in)
                </Label>
                <Input
                  type="password"
                  value={formData.security_pin}
                  onChange={(e) => setFormData({ ...formData, security_pin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                  className="bg-slate-900 border-slate-700 text-white"
                  placeholder="4-digit PIN"
                  maxLength={4}
                />
                <p className="text-xs text-slate-500">Default: 1234</p>
              </div>
            </div>

            <Alert className="bg-amber-500/10 border-amber-500/20">
              <AlertDescription className="text-slate-300 text-sm">
                <p className="font-semibold mb-1">Password Management:</p>
                <p>Users can reset their password via the login page using the "Forgot Password" link. Passwords cannot be changed from the admin panel for security reasons.</p>
              </AlertDescription>
            </Alert>

            <div className="p-4 bg-slate-900/50 rounded-lg">
              <p className="text-sm font-semibold text-slate-300 mb-2">Role Descriptions:</p>
              <ul className="text-xs text-slate-400 space-y-1">
                <li><strong className="text-sky-400">Admin:</strong> Full system access</li>
                <li><strong className="text-purple-400">Dispatcher/Supervisor:</strong> Control room, shifts, operations</li>
                <li><strong className="text-emerald-400">Security Guard:</strong> Field operations, clock in/out, incidents</li>
                <li><strong className="text-amber-400">Client:</strong> View reports and incidents for their sites</li>
                <li><strong className="text-teal-400">Estate Manager:</strong> Manage residents, venues, vendors, levies</li>
                <li><strong className="text-indigo-400">Resident:</strong> Visitors, bookings, orders, payments</li>
                <li><strong className="text-orange-400">Vendor:</strong> Manage menu items and orders</li>
              </ul>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="flex-1 border-slate-600 text-slate-300"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updateUserMutation.isPending}
                className="flex-1 bg-sky-600 hover:bg-sky-700"
              >
                {updateUserMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}