import React, { useState } from "react";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { base44 } from "@/api/base44Client";
import { lightenHex } from "@/lib/branding";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * BrandedLoginForm — reusable, customer-branded email/password sign-in for
 * the pre-login shell. All authentication is delegated 100% to the OFFICIAL
 * Base44 auth SDK (loginViaEmailPassword / resetPasswordRequest /
 * loginWithProvider). This form never stores, logs or proxies credentials
 * and never implements its own auth, tokens or reset mechanism.
 *
 * The ?brand slug is COSMETIC ONLY — it styles this form; after login the
 * app reloads and the deterministic tenant-scoped login sequence runs, so
 * the authenticated user's OWN tenant scope and branding always win.
 *
 * No public sign-up is offered: accounts are created by Customer Admin
 * invitations (PendingTenantScope + server-side scoping) only.
 */
export default function BrandedLoginForm({ brand, onPlatformSignIn }) {
  const branded = !!brand?.branded;
  // Public-safe branding only: the PWA manifest carries the primary colour.
  // Accent is derived as a lighter tint of the primary for pre-login use;
  // the full customer branding (incl. stored accent) applies post-login.
  const primary = branded && brand.theme ? brand.theme : "";
  const accent = primary ? lightenHex(primary, 0.45) : "";

  const [mode, setMode] = useState("signin"); // 'signin' | 'forgot'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showFallback, setShowFallback] = useState(false);

  const resetFeedback = () => {
    setError("");
    setNotice("");
    setShowFallback(false);
  };

  const handleSignIn = async (e) => {
    e.preventDefault();
    resetFeedback();
    if (!EMAIL_RE.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }
    if (typeof base44.auth?.loginViaEmailPassword !== "function") {
      setError("Direct sign-in is unavailable — use platform sign-in below.");
      setShowFallback(true);
      return;
    }
    setBusy(true);
    try {
      // Official Base44 authentication — credentials go directly to the
      // platform, which stores the session token itself.
      await base44.auth.loginViaEmailPassword(email.trim(), password);
      // Full reload re-enters the app's deterministic login sequence
      // (session → pending tenant scope → fail-closed scope check →
      // tenant-correct home), keeping the branded URL intact.
      window.location.reload();
    } catch (err) {
      const status = err?.status || err?.response?.status;
      if (status === 400 || status === 401) {
        setError("Incorrect email or password. Please try again.");
      } else if (status === 403) {
        setError("This account cannot sign in yet. Please complete your invitation email first, or contact your administrator.");
      } else {
        // Platform-level restriction — offer the hosted platform sign-in.
        setError("Sign-in is temporarily unavailable in this view.");
        setShowFallback(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    resetFeedback();
    if (!EMAIL_RE.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (typeof base44.auth?.resetPasswordRequest !== "function") {
      setError("Password reset is unavailable — use platform sign-in below.");
      setShowFallback(true);
      return;
    }
    setBusy(true);
    try {
      // Official Base44 reset flow — the emailed link and the reset process
      // remain entirely platform-owned and authoritative.
      await base44.auth.resetPasswordRequest(email.trim());
      setNotice("If an account exists for this email, a password reset link has been sent. Check your email.");
    } catch (err) {
      const status = err?.status || err?.response?.status;
      if (status === 400 || status === 404) {
        // Neutral response — never reveal whether the account exists.
        setNotice("If an account exists for this email, a password reset link has been sent. Check your email.");
      } else {
        setError("Password reset is temporarily unavailable in this view.");
        setShowFallback(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = () => {
    resetFeedback();
    try {
      // Official OAuth redirect (Google-owned screen is unavoidable and
      // acceptable). Returns to the full branded URL after authentication.
      base44.auth.loginWithProvider("google", window.location.href);
    } catch {
      setError("Google sign-in is unavailable right now.");
    }
  };

  const inputClass =
    "h-11 bg-slate-800/70 border-slate-600 text-slate-100 placeholder:text-slate-500 focus-visible:ring-slate-500";

  const fallbackLink = showFallback && onPlatformSignIn && (
    <button
      type="button"
      onClick={onPlatformSignIn}
      className="w-full text-xs text-slate-500 hover:text-slate-300 underline"
    >
      Use secure platform sign-in
    </button>
  );

  if (mode === "forgot") {
    return (
      <div className="text-left">
        <form onSubmit={handleForgot} className="space-y-4">
          <div>
            <Label htmlFor="login-email" className="text-slate-300">Email</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="you@company.com"
              disabled={busy}
            />
          </div>
          {error && <p className="text-rose-400 text-sm">{error}</p>}
          {notice && <p className="text-emerald-400 text-sm">{notice}</p>}
          <Button
            type="submit"
            disabled={busy}
            className="w-full h-12 text-base"
            style={primary ? { backgroundColor: primary } : undefined}
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : "Send reset link"}
          </Button>
          <button
            type="button"
            onClick={() => { setMode("signin"); resetFeedback(); }}
            className="w-full flex items-center justify-center gap-1 text-xs text-slate-500 hover:text-slate-300"
          >
            <ArrowLeft className="w-3 h-3" /> Back to sign in
          </button>
          {fallbackLink}
        </form>
      </div>
    );
  }

  return (
    <div className="text-left">
      <form onSubmit={handleSignIn} className="space-y-4">
        <div>
          <Label htmlFor="login-email" className="text-slate-300">Email</Label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@company.com"
            disabled={busy}
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="login-password" className="text-slate-300">Password</Label>
            <button
              type="button"
              onClick={() => { setMode("forgot"); resetFeedback(); }}
              className="text-xs hover:underline text-sky-400"
              style={accent ? { color: accent } : undefined}
            >
              Forgot password?
            </button>
          </div>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            placeholder="••••••••"
            disabled={busy}
          />
        </div>
        {error && <p className="text-rose-400 text-sm">{error}</p>}
        {notice && <p className="text-emerald-400 text-sm">{notice}</p>}
        <Button
          type="submit"
          disabled={busy}
          className="w-full h-12 text-base"
          style={primary ? { backgroundColor: primary } : undefined}
        >
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sign In"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleGoogle}
          disabled={busy}
          className="w-full h-11 border-slate-600 bg-slate-800/70 text-slate-100 hover:bg-slate-700"
        >
          Continue with Google
        </Button>
        {fallbackLink}
        <p className="text-center text-xs text-slate-600">
          Accounts are created by invitation only. Contact your administrator for access.
        </p>
      </form>
    </div>
  );
}