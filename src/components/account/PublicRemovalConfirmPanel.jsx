import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ShieldCheck, UserMinus } from "lucide-react";

/**
 * STEP 5 of the PUBLIC account-removal flow — the secure confirmation page
 * shown ONLY after the emailed single-use verification link has been
 * validated server-side (publicVerifyRemovalToken). This page NEVER creates
 * anything by itself: the AccountDeletionRequest is created server-side only
 * when the verified user deliberately presses REQUEST ACCOUNT REMOVAL.
 * CANCEL creates nothing.
 */
export default function PublicRemovalConfirmPanel({
  maskedEmail, reason, onReasonChange, onConfirm, onCancel, submitting, disclosure,
}) {
  return (
    <div className="bg-slate-800/50 border border-amber-500/30 rounded-2xl p-6 space-y-5">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <UserMinus className="w-5 h-5 text-amber-400" /> Account Removal Request
        </h2>
        {maskedEmail && (
          <p className="text-sm text-emerald-300 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 shrink-0" /> Verified account:{" "}
            <span className="font-mono">{maskedEmail}</span>
          </p>
        )}
        <p className="text-sm text-slate-400">
          You are requesting removal of your user account and associated personal information.
        </p>
        <p className="text-sm text-slate-400">
          Security, attendance and operational records may be retained where required for
          security, contractual, legal, regulatory or audit purposes.
        </p>
        <p className="text-sm text-slate-400">
          Your request will be sent to your organisation's authorised administrator for review.
          Removal is administrative and is never instant.
        </p>
      </div>

      {disclosure}

      <div className="space-y-1.5">
        <Label className="text-slate-300">Reason (optional)</Label>
        <Textarea
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="Tell your administrator why you want your account removed…"
          className="bg-slate-900 border-slate-700 text-white min-h-20"
          disabled={submitting}
        />
      </div>

      <div className="space-y-3">
        <Button
          onClick={onConfirm}
          disabled={submitting}
          className="w-full h-12 bg-amber-600 hover:bg-amber-700 text-white font-bold tracking-wide active:scale-95 transition-transform touch-manipulation"
        >
          {submitting ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting…</>
          ) : (
            <><UserMinus className="w-4 h-4 mr-2" /> REQUEST ACCOUNT REMOVAL</>
          )}
        </Button>
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={submitting}
          className="w-full h-12 border-slate-600 text-slate-300 active:scale-95 transition-transform touch-manipulation"
        >
          CANCEL
        </Button>
      </div>
    </div>
  );
}