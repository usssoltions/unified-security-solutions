import React from "react";
import { Button } from "@/components/ui/button";
import { CloudOff, RefreshCw, LogOut } from "lucide-react";

/**
 * AccessVerificationError — full-screen retryable verification error shown
 * when the server-side access-status check FAILS. Never silently allows
 * access and never claims a suspension reason on a failed check.
 */
export default function AccessVerificationError({ onRetry, onSignOut, checking }) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950 overflow-y-auto" role="alertdialog" aria-modal="true">
      <div className="min-h-full flex items-center justify-center p-5">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 text-center space-y-5">
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <CloudOff className="w-8 h-8 text-amber-400" />
          </div>
          <h1 className="text-white text-2xl sm:text-3xl font-bold">We could not verify your access</h1>
          <p className="text-slate-300 text-base leading-relaxed">
            Your account status could not be verified — this may be a temporary connection problem.
            Nothing is wrong with your account. Please try again.
          </p>
          <div className="flex flex-col gap-2 pt-2">
            <Button
              onClick={onRetry}
              disabled={checking}
              className="bg-sky-500 hover:bg-sky-600 text-white active:scale-[0.98] transition-transform"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${checking ? "animate-spin" : ""}`} /> Try again
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