import React, { useState } from "react";
import { Shield, MailCheck, Loader2, AlertTriangle, CheckCircle2, ArrowLeft, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { base44 } from "@/api/base44Client";

/**
 * PUBLIC ACCOUNT-REMOVAL REQUEST PAGE — Google Play external account-deletion
 * resource (Data Safety → Account Deletion URL).
 *
 * Rendered OUTSIDE the authenticated app: no login required, for users who
 * can no longer access the installed app. Identity verification: the user
 * enters their account email → the central accountLifecycle gateway emails a
 * single-use, 30-minute verification link → ONLY after opening that link can
 * a removal request be bound to the account. A requester who merely knows
 * someone's email address can never create a request on their behalf.
 *
 * This page creates the SAME AccountDeletionRequest record through the SAME
 * central accountLifecycle service as the in-app Profile flow — no duplicate
 * deletion framework, no instant destructive deletion, the existing
 * organisation approval hierarchy and last-admin/dependency validation apply
 * unchanged.
 */
const invoke = async (payload) => {
  const res = await base44.functions.invoke("accountLifecycle", payload);
  const d = res?.data !== undefined ? res.data : res;
  if (d?.error) throw new Error(d.error);
  return d;
};

const DISCLOSURE = (
  <ul className="list-disc pl-5 space-y-1.5 text-slate-400 text-sm">
    <li>Your login and personal account information can be removed once an authorised administrator approves the request.</li>
    <li>
      Security, attendance and operational records may be <b>retained</b> where required for audit, contractual,
      regulatory or security purposes.
    </li>
    <li>Your account is <b>not</b> deleted immediately — requests are reviewed by your organisation's authorised administrator.</li>
    <li>You can cancel a pending request at any time from the app (Profile → Request Account Removal) or by contacting your administrator.</li>
  </ul>
);

export default function PublicAccountRemoval() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = (urlParams.get("token") || "").trim();

  const [mode, setMode] = useState(token ? "confirm" : "form"); // form | sent | confirm | done
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const initiate = async () => {
    if (submitting || !email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await invoke({ action: "publicInitiateRemoval", email: email.trim() });
      setMode("sent");
    } catch (e) {
      setError(e?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const confirm = async () => {
    if (submitting || confirmText.trim().toUpperCase() !== "REMOVE") return;
    setSubmitting(true);
    setError(null);
    try {
      const d = await invoke({ action: "publicConfirmRemoval", token, reason: reason.trim() });
      setResult(d);
      setMode("done");
    } catch (e) {
      setError(e?.message || "This verification link could not be used. Please start again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4 py-10">
      <div className="max-w-lg mx-auto">
        {/* USS identity header */}
        <div className="text-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-lg"
            style={{ backgroundImage: "linear-gradient(135deg, #0ea5e9, #2563eb)" }}
          >
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Unified Security Solutions</h1>
          <p className="text-slate-400 text-sm mt-1">Account Removal Request</p>
        </div>

        {error && (
          <div className="mb-6 flex items-start gap-2 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <p className="text-sm text-rose-300">{error}</p>
          </div>
        )}

        {/* STEP 1 — enter the account email */}
        {mode === "form" && (
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-2xl p-6 space-y-5">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-white">Request removal of your account</h2>
              <p className="text-sm text-slate-400">
                Use this page if you can no longer access the Unified Security Solutions app. Enter the email
                address of the account you want removed — we will email a single-use verification link to that
                address. Only the owner of the email inbox can continue.
              </p>
            </div>
            <div className="bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-4 space-y-2">
              <p className="text-sm font-medium text-slate-200">Before you continue</p>
              {DISCLOSURE}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-email" className="text-slate-300">Account email address</Label>
              <Input
                id="account-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && initiate()}
                placeholder="you@example.com"
                disabled={submitting}
                className="bg-slate-900 border-slate-700 text-white h-12"
              />
            </div>
            <Button
              onClick={initiate}
              disabled={submitting || !email.trim()}
              className="w-full h-12 bg-amber-600 hover:bg-amber-700 text-white active:scale-95 transition-transform touch-manipulation"
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending verification link…</>
              ) : (
                <><MailCheck className="w-4 h-4 mr-2" /> Email me a verification link</>
              )}
            </Button>
          </div>
        )}

        {/* STEP 2 — link sent */}
        {mode === "sent" && (
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-2xl p-6 space-y-4 text-center">
            <MailCheck className="w-12 h-12 text-emerald-400 mx-auto" />
            <h2 className="text-lg font-semibold text-white">Check your inbox</h2>
            <p className="text-sm text-slate-400">
              If <span className="text-slate-200">{email.trim()}</span> belongs to a registered Unified Security
              Solutions account, a verification link has been sent to it. The link is single-use and expires in
              30 minutes.
            </p>
            <p className="text-xs text-slate-500">
              For your security, we cannot confirm whether an email address is registered. No request is created
              until the link is opened and confirmed.
            </p>
            <Button
              variant="outline"
              onClick={() => { setMode("form"); }}
              className="border-slate-600 text-slate-300 h-12 w-full active:scale-95 transition-transform touch-manipulation"
            >
              <ArrowLeft className="w-4 h-4 mr-2" /> Use a different email
            </Button>
          </div>
        )}

        {/* STEP 3 — verified link: confirm the request */}
        {mode === "confirm" && (
          <div className="bg-slate-800/50 border border-amber-500/30 rounded-2xl p-6 space-y-5">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <UserMinus className="w-5 h-5 text-amber-400" /> Confirm your account removal request
              </h2>
              <p className="text-sm text-slate-400">
                You followed a verification link sent to your account email. Submitting below creates an account
                removal request for <b>your own account only</b> — it is sent to your organisation's authorised
                administrator for review.
              </p>
            </div>
            <div className="bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-4 space-y-2">
              <p className="text-sm font-medium text-slate-200">What happens next</p>
              {DISCLOSURE}
            </div>
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
                disabled={submitting}
                autoComplete="off"
                className="bg-slate-900 border-slate-700 text-white h-12"
              />
            </div>
            <Button
              onClick={confirm}
              disabled={submitting || confirmText.trim().toUpperCase() !== "REMOVE"}
              className="w-full h-12 bg-amber-600 hover:bg-amber-700 text-white active:scale-95 transition-transform touch-manipulation"
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting…</>
              ) : (
                <><UserMinus className="w-4 h-4 mr-2" /> Submit removal request</>
              )}
            </Button>
          </div>
        )}

        {/* STEP 4 — done */}
        {mode === "done" && (
          <div className="bg-slate-800/50 border border-emerald-500/30 rounded-2xl p-6 space-y-4 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
            <h2 className="text-lg font-semibold text-white">
              {result?.alreadyPending ? "You already have a pending request" : "Your request has been submitted"}
            </h2>
            <p className="text-sm text-slate-400">
              {result?.alreadyPending ? (
                <>An account removal request for your account is already pending administrator review. No new
                request was created.</>
              ) : (
                <>Your account removal request is now pending review by your organisation's authorised
                administrator{result?.request?.id ? (
                  <> (reference <span className="text-slate-200 font-mono">{String(result.request.id).slice(0, 8).toUpperCase()}</span>)</>
                ) : null}.</>
              )}
            </p>
            <div className="bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-4 text-left space-y-2">
              <p className="text-sm font-medium text-slate-200">Important</p>
              {DISCLOSURE}
            </div>
            <p className="text-xs text-slate-500">
              Unified Security Solutions — unifiedsecuritysolutions.co.za
            </p>
          </div>
        )}
      </div>
    </div>
  );
}