import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X, Loader2, UserPlus } from "lucide-react";

export default function UserForm({ user, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    full_name: user?.full_name || "",
    email: user?.email || "",
    role_type: user?.role_type || "guard",
    badge_number: user?.badge_number || "",
    phone: user?.phone || "",
    ...user
  });
  const [loading, setLoading] = useState(false);

  const updateUserMutation = useMutation({
    mutationFn: async (data) => {
      if (user) {
        // Update existing user
        await base44.entities.User.update(user.id, data);
      } else {
        // For new users, we can't actually create them via the SDK
        // They need to be invited through the Base44 dashboard
        throw new Error("New users must be invited through the Base44 dashboard. Use the 'Invite User' feature in the dashboard settings.");
      }
    },
    onSuccess: () => {
      onSuccess();
    }
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validation
      if (!formData.full_name || !formData.email) {
        alert("Please fill in all required fields");
        setLoading(false);
        return;
      }

      if (!user) {
        // Cannot create new users programmatically
        alert("New users must be invited through the Base44 dashboard.\n\nGo to: Dashboard → Settings → Invite User\n\nThen come back here to assign their role and details.");
        setLoading(false);
        return;
      }

      // Update user details
      await updateUserMutation.mutateAsync({
        role_type: formData.role_type,
        badge_number: formData.badge_number,
        phone: formData.phone
      });

    } catch (error) {
      alert("Error: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <Card className="bg-slate-800 border-slate-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="border-b border-slate-700">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              {user ? "Edit User" : "Add New User"}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400">
              <X className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-6">
          {!user && (
            <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <p className="text-sm text-amber-400 mb-2">
                <strong>Note:</strong> New users must be invited through the Base44 dashboard first.
              </p>
              <p className="text-xs text-slate-400">
                Go to Dashboard → Settings → Invite User, then return here to assign roles and details.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="full_name" className="text-slate-300">
                  Full Name *
                </Label>
                <Input
                  id="full_name"
                  value={formData.full_name}
                  onChange={(e) => setFormData({...formData, full_name: e.target.value})}
                  className="bg-slate-900 border-slate-700 text-white"
                  placeholder="John Doe"
                  disabled={!!user}
                  required
                />
              </div>

              <div>
                <Label htmlFor="email" className="text-slate-300">
                  Email *
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  className="bg-slate-900 border-slate-700 text-white"
                  placeholder="john@example.com"
                  disabled={!!user}
                  required
                />
              </div>

              <div>
                <Label htmlFor="role_type" className="text-slate-300">
                  Role Type *
                </Label>
                <Select
                  value={formData.role_type}
                  onValueChange={(value) => setFormData({...formData, role_type: value})}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">
                      <div className="flex items-center gap-2">
                        <span className="text-purple-400">●</span>
                        Admin
                      </div>
                    </SelectItem>
                    <SelectItem value="dispatcher">
                      <div className="flex items-center gap-2">
                        <span className="text-sky-400">●</span>
                        Dispatcher / Supervisor
                      </div>
                    </SelectItem>
                    <SelectItem value="guard">
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400">●</span>
                        Security Guard
                      </div>
                    </SelectItem>
                    <SelectItem value="client">
                      <div className="flex items-center gap-2">
                        <span className="text-amber-400">●</span>
                        Client / Site Manager
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="badge_number" className="text-slate-300">
                  Badge / Employee Number
                </Label>
                <Input
                  id="badge_number"
                  value={formData.badge_number}
                  onChange={(e) => setFormData({...formData, badge_number: e.target.value})}
                  className="bg-slate-900 border-slate-700 text-white"
                  placeholder="GRD-001"
                />
              </div>

              <div className="md:col-span-2">
                <Label htmlFor="phone" className="text-slate-300">
                  Phone Number
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({...formData, phone: e.target.value})}
                  className="bg-slate-900 border-slate-700 text-white"
                  placeholder="+27 12 345 6789"
                />
              </div>
            </div>

            <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
              <h4 className="text-sm font-semibold text-white mb-2">Role Descriptions:</h4>
              <ul className="text-xs text-slate-400 space-y-1">
                <li><strong className="text-purple-400">Admin:</strong> Full system access, can manage all users and settings</li>
                <li><strong className="text-sky-400">Dispatcher/Supervisor:</strong> Control room access, can assign shifts and manage operations</li>
                <li><strong className="text-emerald-400">Security Guard:</strong> Field operations, can report incidents and complete shifts</li>
                <li><strong className="text-amber-400">Client:</strong> View-only access to reports and site activities</li>
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
                disabled={loading || !user}
                className="flex-1 bg-sky-600 hover:bg-sky-700"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  user ? "Update User" : "Invite via Dashboard"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}