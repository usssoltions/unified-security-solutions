import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, User, Mail, Shield, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function Profile() {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const { data: user, isLoading } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "DELETE") return;

    try {
      // Delete user account
      await base44.entities.User.delete(user.id);
      
      // Logout
      await base44.auth.logout();
    } catch (error) {
      console.error("Failed to delete account:", error);
      alert("Failed to delete account. Please contact support.");
    }
  };

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
                <span className="text-white">{user?.full_name}</span>
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
                <Badge className="bg-sky-600 capitalize">
                  {user?.role_type || user?.role}
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

        {/* Delete Account */}
        <Card className="bg-rose-500/10 border-rose-500/20">
          <CardHeader>
            <CardTitle className="text-rose-400 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              Danger Zone
            </CardTitle>
            <CardDescription className="text-slate-400">
              Permanently delete your account and all associated data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => setShowDeleteDialog(true)}
              variant="destructive"
              className="bg-rose-600 hover:bg-rose-700"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Account
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="bg-slate-800 border-slate-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              Are you absolutely sure?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              This action cannot be undone. This will permanently delete your
              account and remove all your data from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Label className="text-slate-400 mb-2 block">
              Type <span className="text-rose-400 font-bold">DELETE</span> to confirm
            </Label>
            <Input
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              placeholder="Type DELETE"
              className="bg-slate-900 border-slate-700 text-white"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setShowDeleteDialog(false);
                setDeleteConfirmation("");
              }}
              className="bg-slate-700 text-white hover:bg-slate-600"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAccount}
              disabled={deleteConfirmation !== "DELETE"}
              className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Delete Account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}