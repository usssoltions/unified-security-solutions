import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, AlertTriangle, Loader2, ArrowLeft } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { base44 } from "@/api/base44Client";
import { queryClientInstance } from "@/lib/query-client";

/**
 * GOOGLE PLAY ACCOUNT DELETION — self-service deletion for the AUTHENTICATED
 * user only. Two deliberate confirmation steps (full explanation → type
 * DELETE) make accidental one-tap deletion impossible. The backend
 * (deleteMyAccount) operates exclusively on the caller's own account and
 * enforces all tenant/security validation server-side: personal account data
 * and channel mappings are removed, while the customer's operational and
 * audit records (incidents, attendance, patrols, panic events, tasks,
 * sign-offs, shift history, reports) are PRESERVED — they carry their own
 * historical snapshots and must remain part of the tenant's audit trail.
 */
export default function DeleteAccountSection({ user }) {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (deleting || confirmText.trim().toUpperCase() !== "DELETE") return;
    setDeleting(true);
    try {
      const res = await base44.functions.invoke("deleteMyAccount", {
        confirm: confirmText.trim(),
      });
      const data = res?.data ?? res;
      if (data?.error) throw new Error(data.error);
      // The account no longer exists — purge every session artefact of the
      // deleted account, terminate the session, and hard-reload to login.
      try { queryClientInstance.clear(); } catch (_) {}
      try { localStorage.clear(); } catch (_) {}
      try { sessionStorage.clear(); } catch (_) {}
      try { await base44.auth.logout(); } catch (_) {}
      window.location.assign("/");
    } catch (e) {
      // The server stays authoritative: on failure the account is INTACT —
      // restore the button so the user can retry or contact support.
      setDeleting(false);
      toast({
        title: "Account deletion failed",
        description: e?.message || "Your account was NOT deleted. Please try again or contact support.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="bg-slate-800/50 border-rose-500/30">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Trash2 className="w-5 h-5 text-rose-400" />
          Delete My Account
        </CardTitle>
        <CardDescription className="text-slate-400">
          Permanently delete your account and personal data
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 1 ? (
          <>
            <div className="text-sm text-slate-300 bg-rose-500/10 border border-rose-500/25 rounded-lg px-3 py-3 space-y-2">
              <p className="flex items-center gap-2 font-medium text-rose-300">
                <AlertTriangle className="w-4 h-4 shrink-0" /> This is permanent and cannot be undone
              </p>
              <ul className="list-disc pl-5 space-y-1 text-slate-400">
                <li>Your account ({user?.email}) and its personal data will be permanently deleted.</li>
                <li>You will immediately lose access to the app on all your devices.</li>
                <li>Your Telegram link, push registrations and notification inbox will be removed.</li>
                <li>
                  Security and operational records (incidents, attendance, patrols, panic events,
                  tasks, sign-offs, shift and audit history) are <b>retained</b> where required for
                  the customer's historical audit trail — your personal account details are removed
                  from the account itself.
                </li>
              </ul>
            </div>
            <Button
              variant="outline"
              onClick={() => setStep(2)}
              className="border-rose-500/50 text-rose-300 hover:bg-rose-500/10 w-full h-12 active:scale-95 transition-transform touch-manipulation"
            >
              I understand — continue to deletion
            </Button>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label className="text-slate-300">
                Type <span className="font-bold text-rose-400">DELETE</span> to confirm
              </Label>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                className="bg-slate-900 border-slate-700 text-white h-12"
                disabled={deleting}
                autoComplete="off"
              />
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => { if (!deleting) { setStep(1); setConfirmText(""); } }}
                disabled={deleting}
                className="flex-1 border-slate-600 text-slate-300 h-12 active:scale-95 transition-transform touch-manipulation"
              >
                <ArrowLeft className="w-4 h-4 mr-2" /> Back
              </Button>
              <Button
                onClick={handleDelete}
                disabled={deleting || confirmText.trim().toUpperCase() !== "DELETE"}
                className="flex-1 h-12 bg-rose-600 hover:bg-rose-700 text-white active:scale-95 transition-transform touch-manipulation"
              >
                {deleting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Deleting account…
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" /> Delete my account
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}