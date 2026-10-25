import React from "react";
import { Button } from "@/components/ui/button";
import { ShieldAlert, RefreshCw, LogOut, Mail, Phone } from "lucide-react";

/**
 * AccountBlockedScreen — full-screen block rendered INSTEAD of the app when
 * the caller's organisation is suspended (server-resolved from the
 * authoritative Customer record). No dismiss, no background navigation, no
 * spinner: only Check access again / Sign Out.
 */
const REASON_MESSAGES = {
  trial_expired: "Your demo/trial period has expired. Please contact us to activate your subscription.",
  non_payment: "Your account is suspended due to an outstanding payment. Please contact us to arrange reactivation.",
};

export default function AccountBlockedScreen({ info, onRecheck, onSignOut, checking }) {
  const message = REASON_MESSAGES[info?.reason]
    || "Your account has been suspended. Please contact us to restore access.";
  const support = info?.support || {};
  const hasSupport = !!(support.email || support.phone);
  return (
    <div className="fixed inset-0 z-50 bg-slate-950 overflow-y-auto" role="alertdialog" aria-modal="true">
      <div className="min-h-full flex items-center justify-center p-5">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 text-center space-y-5">
          <div className="mx-auto w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center">
            <ShieldAlert className="w-8 h-8 text-rose-400" />
          </div>
          <h1 className="text-white text-2xl sm:text-3xl font-bold">Account blocked</h1>
          <p className="text-slate-300 text-base leading-relaxed">{message}</p>
          {info?.customer_name && (
            <p className="text-slate-500 text-sm">Organisation: {info.customer_name}</p>
          )}
          <div className="pt-1 space-y-2 text-sm">
            {hasSupport ? (
              <>
                {support.email && (
                  <p className="text-slate-300 flex items-center justify-center gap-2">
                    <Mail className="w-4 h-4 text-slate-500 shrink-0" /> <span className="break-all">{support.email}</span>
                  </p>
                )}
                {support.phone && (
                  <p className="text-slate-300 flex items-center justify-center gap-2">
                    <Phone className="w-4 h-4 text-slate-500 shrink-0" /> {support.phone}
                  </p>
                )}
              </>
            ) : (
              <p className="text-slate-500">Please contact your service provider to reactivate your account.</p>
            )}
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <Button
              onClick={onRecheck}
              disabled={checking}
              className="bg-sky-500 hover:bg-sky-600 text-white active:scale-[0.98] transition-transform"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${checking ? "animate-spin" : ""}`} /> Check access again
            </Button>
            <Button
              onClick={onSignOut}
              variant="outline"
              className="border-slate-600 text-slate-200 active:scale-[0.98] transition-transform"
            >
              <LogOut className="w-4 h-4 mr-2" /> Sign Out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}