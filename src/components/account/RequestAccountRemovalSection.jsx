import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { UserMinus, AlertTriangle, Loader2, ArrowLeft, Clock, XCircle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * GOOGLE PLAY ACCOUNT-DELETION CAPABILITY — organisation-managed lifecycle.
 *
 * Every account on this platform is organisation-managed, so the in-app
 * capability is a genuine ACCOUNT REMOVAL REQUEST (never instant
 * self-destruction): the user submits a deliberate, two-step request with an
 * optional reason; the server creates an AccountDeletionRequest and notifies
 * the authorised administrator(s); final removal is performed only through
 * the accountLifecycle gateway (hierarchy, last-admin and dependency
 * validated). Security, attendance and operational records may be retained
 * where required for audit, contractual, regulatory or security purposes.
 */
export default function RequestAccountRemovalSection({ user }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const invoke = async (payload) => {
    const res = await base44.functions.invoke("accountLifecycle", payload);
    const d = res?.data !== undefined ? res.data : res;
    if (d?.error) throw new Error(d.error);
    return d;
  };

  const { data: request, isLoading } = useQuery({
    queryKey: ["myRemovalRequest"],
    queryFn: async () => (await invoke({ action: "myRequest" }))?.request || null,
  });

  const pendingRequest = request && request.status === "pending";

  const submitRequest = async () => {
    if (submitting || confirmText.trim().toUpperCase() !== "REMOVE") return;
    setSubmitting(true);
    try {
      await invoke({ action: "requestAccountRemoval", reason: reason.trim() });
      await queryClient.invalidateQueries({ queryKey: ["myRemovalRequest"] });
      setStep(1);
      setReason("");
      setConfirmText("");
      toast({
        title: "Account removal requested",
        description: "Your request is now pending review by your organisation administrator.",
      });
    } catch (e) {
      toast({
        title: "Request failed",
        description: e?.message || "Your request was not submitted. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const cancelRequest = async () => {
    if (cancelling) return;
    if (!window.confirm("Cancel your account removal request? Your account will remain unchanged.")) return;
    setCancelling(true);
    try {
      await invoke({ action: "cancelAccountRemovalRequest" });
      await queryClient.invalidateQueries({ queryKey: ["myRemovalRequest"] });
      toast({ title: "Request cancelled", description: "Your account removal request has been withdrawn." });
    } catch (e) {
      toast({ title: "Could not cancel", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setCancelling(false);
    }
  };

  const statusBadge = (status) => ({
    pending: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
    completed: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
    rejected: "bg-rose-500/20 text-rose-300 border border-rose-500/40",
    cancelled: "bg-slate-700/60 text-slate-300",
  }[status] || "bg-slate-700/60 text-slate-300");

  return (
    <Card className="bg-slate-800/50 border-amber-500/30">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <UserMinus className="w-5 h-5 text-amber-400" />
          Request Account Removal
        </CardTitle>
        <CardDescription className="text-slate-400">
          Request removal of your user account and personal information
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-slate-400 py-2">Loading…</p>
        ) : pendingRequest ? (
          <>
            <div className="text-sm bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-3 space-y-2">
              <p className="flex items-center gap-2 font-medium text-amber-300">
                <Clock className="w-4 h-4 shrink-0" /> Your account removal request is pending review
              </p>
              <p className="text-slate-400">
                Submitted {request.requested_at ? new Date(request.requested_at).toLocaleString() : "recently"}.
                An authorised administrator of your organisation will review it.
              </p>
              {request.reason && (
                <p className="text-slate-400"><span className="text-slate-300">Your reason:</span> {request.reason}</p>
              )}
            </div>
            <Button
              variant="outline"
              onClick={cancelRequest}
              disabled={cancelling}
              className="border-slate-600 text-slate-300 w-full h-12 active:scale-95 transition-transform touch-manipulation"
            >
              {cancelling ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Cancelling…</>
              ) : (
                <><XCircle className="w-4 h-4 mr-2" /> Cancel request</>
              )}
            </Button>
          </>
        ) : (
          <>
            {request && !pendingRequest && (
              <div className="flex items-center gap-2 text-sm">
                <Badge className={statusBadge(request.status)}>
                  Previous request: {request.status}
                  {request.reviewed_at ? ` (${new Date(request.reviewed_at).toLocaleDateString()})` : ""}
                </Badge>
              </div>
            )}
            {step === 1 ? (
              <>
                <div className="text-sm text-slate-300 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-3 space-y-2">
                  <p className="font-medium text-slate-200">How account removal works</p>
                  <ul className="list-disc pl-5 space-y-1 text-slate-400">
                    <li>
                      Your login and personal account information can be removed.
                    </li>
                    <li>
                      Security, attendance and operational records may be retained where required for
                      audit, contractual, regulatory or security purposes.
                    </li>
                    <li>
                      Your organisation's administrator reviews and approves the request — your
                      account is <b>not</b> deleted immediately.
                    </li>
                    <li>
                      You can cancel this request at any time while it is pending review.
                    </li>
                  </ul>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setStep(2)}
                  className="border-amber-500/50 text-amber-300 hover:bg-amber-500/10 w-full h-12 active:scale-95 transition-transform touch-manipulation"
                >
                  I understand — continue
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-slate-300">Reason (optional)</Label>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Tell your administrator why you want your account removed…"
                    className="bg-slate-900 border-slate-700 text-white min-h-20"
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-slate-300">
                    Type <span className="font-bold text-amber-400">REMOVE</span> to submit your request
                  </Label>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="REMOVE"
                    className="bg-slate-900 border-slate-700 text-white h-12"
                    disabled={submitting}
                    autoComplete="off"
                  />
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => { if (!submitting) { setStep(1); setConfirmText(""); } }}
                    disabled={submitting}
                    className="flex-1 border-slate-600 text-slate-300 h-12 active:scale-95 transition-transform touch-manipulation"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back
                  </Button>
                  <Button
                    onClick={submitRequest}
                    disabled={submitting || confirmText.trim().toUpperCase() !== "REMOVE"}
                    className="flex-1 h-12 bg-amber-600 hover:bg-amber-700 text-white active:scale-95 transition-transform touch-manipulation"
                  >
                    {submitting ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting…</>
                    ) : (
                      <><UserMinus className="w-4 h-4 mr-2" /> Submit request</>
                    )}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}