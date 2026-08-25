import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, User, Mail, Shield, Headphones, Phone, Globe } from "lucide-react";
import TelegramConnection from "@/components/telegram/TelegramConnection";
import { getUserDisplayName } from "@/lib/userDisplayName";
import { useBranding } from "@/hooks/useBranding";
import { isPlatformAdminUser } from "@/lib/platformAdmin";

const ROLE_LABELS = {
  admin: "Administrator",
  dispatcher: "Dispatcher",
  guard: "Security Guard",
  resident: "Resident",
  estate_manager: "Estate Manager",
  vendor: "Vendor / Contractor",
  client: "Client",
  platform_admin: "Platform Administrator",
  reseller_admin: "Reseller Administrator",
  practice_admin: "Practice Administrator",
  therapist: "Therapist",
  reception: "Reception",
  employer_user: "Employer User",
};

export default function Profile() {
  const { data: user, isLoading } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });
  const { data: branding } = useBranding(user?.customer_id, user?.reseller_id);
  const isPlatformAdmin = isPlatformAdminUser(user);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <User className="w-8 h-8 text-sky-400" />
            Profile Settings
          </h1>
          <p className="text-slate-400 mt-1">Manage your account information</p>
        </div>

        {/* User Information */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">Account Information</CardTitle>
            <CardDescription className="text-slate-400">
              Your personal and account details
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-400">Full Name</Label>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-slate-500" />
                <span className="text-white">{getUserDisplayName(user)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-400">Email Address</Label>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-slate-500" />
                <span className="text-white">{user?.email}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-400">Role</Label>
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-slate-500" />
                <Badge className="bg-sky-600">
                  {ROLE_LABELS[user?.role_type] || user?.role_type || user?.role || "User"}
                </Badge>
              </div>
            </div>

            {user?.badge_number && (
              <div className="space-y-2">
                <Label className="text-slate-400">Badge Number</Label>
                <span className="text-white">{user.badge_number}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Telegram Notifications */}
        <TelegramConnection user={user} />

        {/* Support & Branding */}
        {(branding?.support_name || branding?.support_email || branding?.support_phone || branding?.website) && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Headphones className="w-5 h-5 text-sky-400" />
                Support
              </CardTitle>
              <CardDescription className="text-slate-400">
                Contact your service provider
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {branding.support_name && (
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="text-white">{branding.support_name}</span>
                </div>
              )}
              {branding.support_email && (
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-slate-500 shrink-0" />
                  <a href={`mailto:${branding.support_email}`} className="text-sky-400 hover:underline">
                    {branding.support_email}
                  </a>
                </div>
              )}
              {branding.support_phone && (
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-slate-500 shrink-0" />
                  <a href={`tel:${branding.support_phone}`} className="text-sky-400 hover:underline">
                    {branding.support_phone}
                  </a>
                </div>
              )}
              {branding.website && (
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-slate-500 shrink-0" />
                  <a href={branding.website} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">
                    {branding.website}
                  </a>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Account Deactivation Request */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-slate-400" />
              Account Management
            </CardTitle>
            <CardDescription className="text-slate-400">
              Request account deactivation or contact your administrator
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-slate-400 text-sm mb-4">
              To deactivate or remove your account, please contact your organisation administrator. Account deactivation is managed securely through the User Management module to maintain audit integrity.
            </p>
            {branding?.support_email ? (
              <a href={`mailto:${branding.support_email}`} className="text-sky-400 text-sm hover:underline">
                Contact {branding.support_name || "support"}
              </a>
            ) : isPlatformAdmin ? (
              <a href="mailto:support@base44.com" className="text-sky-400 text-sm hover:underline">
                Contact support
              </a>
            ) : (
              <span className="text-slate-500 text-sm">Contact your organisation administrator.</span>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}