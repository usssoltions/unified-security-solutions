import React, { useState, useEffect } from "react";
import { Shield, MailCheck, Loader2, AlertTriangle, CheckCircle2, ArrowLeft, LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { base44 } from "@/api/base44Client";
import PublicRemovalConfirmPanel from "@/components/account/PublicRemovalConfirmPanel";

/**
 * PUBLIC ACCOUNT-REMOVAL REQUEST PAGE — Google Play external account-deletion
 * resource (Data Safety → Account Deletion URL). Rendered OUTSIDE the
 * authenticated app: no login required, no app reinstall/open needed.
 *
 * SECURITY-CRITICAL two-phase verification (opening the emailed link can
 * NEVER create a removal request — email security scanners, accidental opens
 * and forwarded links are inert):
 *   1. publicInitiateRemoval — anti-enumeration email step.
 *   2. publicVerifyRemovalToken — opening the link only VALIDATES the token
 *      and establishes the verified account context. Nothing is created.
 *   3. publicConfirmRemoval — the AccountDeletionRequest is created through
 *      the SAME central accountLifecycle service ONLY when the verified user
 *      deliberately presses REQUEST ACCOUNT REMOVAL; the single-use token is
 *      consumed at that moment so the link can never be replayed.
 *
 * This page produces the SAME AccountDeletionRequest record as the in-app
 * Profile flow — no duplicate deletion framework, no instant destructive
 * deletion; the existing organisation approval hierarchy, last-admin and
 * dependency validation apply unchanged.
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
    <li>Organisation-managed accounts are reviewed and processed by your organisation's authorised administrator — removal is administrative and not instant.</li>
    <li>You will be informed of the outcome of your request by email (and in-app while your account remains active).</li>
    <li>You can cancel a pending request at any time from the app (Profile → Request Account Removal) or by contacting your administrator.</li>
  </ul>
);

export default function PublicAccountRemoval() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = (urlParams.get("token") || "").trim();

  // form | sent | verifying | confirm | invalid | done
  const [mode, setMode] = useState(token ? "verifying" : "form");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  // Opening the emailed link ONLY verifies the token — it can NEVER create a
  // removal request. No request exists until the verified user deliberately
  // presses REQUEST ACCOUNT REMOVAL on the confirmation page.
  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const d = await invoke({ action: "publicVerifyRemovalToken", token });
        if (!cancelled) {
          setMaskedEmail(d?.email || "");
          setMode("confirm");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || "This verification link could not be used.");
          setMode("invalid");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

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

  // Deliberate final confirmation — the ONLY path that creates a request.
  const confirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const d = await invoke({ action: "publicConfirmRemoval", token, reason: reason.trim() });
      setResult(d);
      setMode("done");
    } catch (e) {
      setError(e?.message || "This verification link could not be used. Please start again.");
      setMode("invalid");
    } finally {
      setSubmitting(false);
    }
  };

  // Cancellation never creates a request and consumes nothing.
  const backToForm = () => {
    setError(null);
    setReason("");
    setMaskedEmail("");
    setMode("form");
    try { window.history.replaceState({}, "", "/account-removal"); } catch (_) {}
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
                This page lets you request deletion of your Unified Security Solutions (USS) user account
                without opening or reinstalling the app. Enter the email address of the account you want
                removed — we will email a single-use verification link to that address. Only the owner of
                the email inbox can continue.
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
              For your security, we cannot confirm whether an email address is registered. Opening the link
              does not create a request — you will be asked to confirm explicitly before anything is submitted.
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

        {/* STEP 3/4 — the link is being verified (creates nothing) */}
        {mode === "verifying" && (
          <div className="bg-slate-800/50 border border-slate-700/60 rounded-2xl p-8 text-center space-y-4">
            <Loader2 className="w-10 h-10 text-sky-400 mx-auto animate-spin" />
            <p className="text-sm text-slate-400">Verifying your link…</p>
          </div>
        )}

        {/* Expired / used / invalid link — safe message + fresh start */}
        {mode === "invalid" && (
          <div className="bg-slate-800/50 border border-rose-500/30 rounded-2xl p-6 space-y-4 text-center">
            <LinkIcon className="w-12 h-12 text-rose-400 mx-auto" />
            <h2 className="text-lg font-semibold text-white">This link cannot be used</h2>
            <p className="text-sm text-slate-400">
              The verification link is invalid, already used or has expired. No account removal request was
              created. You can request a new verification link below.
            </p>
            <Button
              onClick={backToForm}
              className="w-full h-12 bg-amber-600 hover:bg-amber-700 text-white active:scale-95 transition-transform touch-manipulation"
            >
              <MailCheck className="w-4 h-4 mr-2" /> Request a new verification link
            </Button>
          </div>
        )}

        {/* STEP 5 — verified confirmation page (creates nothing on its own) */}
        {mode === "confirm" && (
          <PublicRemovalConfirmPanel
            maskedEmail={maskedEmail}
            reason={reason}
            onReasonChange={setReason}
            submitting={submitting}
            onConfirm={confirm}
            onCancel={backToForm}
            disclosure={
              <div className="bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-4 space-y-2">
                <p className="text-sm font-medium text-slate-200">What happens next</p>
                {DISCLOSURE}
              </div>
            }
          />
        )}

        {/* STEP 6 — done */}
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
                ) : null}. You will be informed of the outcome by email.</>
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