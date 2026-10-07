import React, { useState } from "react";
import { Phone, PhoneCall, AlertTriangle, CheckCircle2, XCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Linkus Handoff Test — TEMPORARY, PLATFORM-ADMIN-ONLY diagnostic page.
 *
 * PURPOSE: establish how a tel: link routes on the test Android phones:
 *   1. Does pressing the button open Linkus rather than the SIM dialler?
 *   2. Is the exact extension number passed through unchanged?
 *   3. Does the call start immediately or require another tap?
 *   4. Can the two phones speak to each other?
 *
 * IMPORTANT (documented limitation, NOT speculative code):
 *   Yeastar's official documentation provides NO deep-link / URI scheme for
 *   opening Linkus Mobile Client with a number. The only documented third-party
 *   integration path is the Linkus SDK for Android (PBX Ultimate plan + SDK
 *   embedding + push certificates + OpenAPI login signatures) — deliberately
 *   NOT enabled here. Therefore this test uses `tel:<extension>` — an
 *   UNVERIFIED DIALLER-ROUTING TEST: Android routes tel: via the device's
 *   default calling app, which MAY be Linkus if Linkus is set as the default
 *   phone/calling app, otherwise the SIM dialler opens.
 *
 *   No silent cellular fallback: if the SIM dialler opens, CANCEL the call.
 */

const TEST_EXTENSIONS = [
  { ext: "104", label: "Call 104 via Linkus" },
  { ext: "105", label: "Call 105 via Linkus" },
];

export default function LinkusHandoffTest() {
  const [lastFired, setLastFired] = useState(null);

  const dial = (ext) => {
    const uri = `tel:${ext}`;
    setLastFired({ ext, uri, at: new Date().toLocaleTimeString() });
    // Exact extension, no prefix, no transformation. Handoff to Android's
    // calling-app resolution happens in the WebView client (ACTION_VIEW) or
    // the browser — this page never routes to a cellular dialler itself.
    window.location.href = uri;
  };

  return (
    <div className="min-h-screen bg-slate-950 p-4 md:p-6">
      <div className="max-w-xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center shrink-0">
            <Phone className="w-5 h-5 text-sky-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Linkus Handoff Test</h1>
            <p className="text-xs text-slate-400">
              Temporary diagnostic — platform administrators only
            </p>
          </div>
        </div>

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-200/90 space-y-1">
            <p className="font-semibold text-amber-300">Unverified dialler-routing test</p>
            <p>
              No official Linkus deep-link scheme exists in Yeastar's documentation, so
              this test fires a plain <span className="font-mono">tel:</span> link. Android
              routes it to the device's <span className="font-semibold">default calling app</span> —
              which is Linkus only if Linkus is set as the default phone app.
            </p>
            <p className="text-amber-300/80">
              If the SIM dialler opens: <span className="font-semibold">cancel the call</span> —
              this must never become a cellular call.
            </p>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-white">Test buttons</p>
          {TEST_EXTENSIONS.map(({ ext, label }) => (
            <Button
              key={ext}
              onClick={() => dial(ext)}
              className="w-full h-12 bg-sky-500 hover:bg-sky-600 text-slate-950 font-semibold active:scale-95 transition-transform"
            >
              <PhoneCall className="w-5 h-5 mr-2" />
              {label}
            </Button>
          ))}
          {lastFired && (
            <div className="text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono">
              Fired {lastFired.at}: <span className="text-sky-400">{lastFired.uri}</span>
              <br />
              <span className="text-slate-500">
                No prefix added, number unchanged: {lastFired.ext}
              </span>
            </div>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-white flex items-center gap-2">
            <Info className="w-4 h-4 text-sky-400" /> Record these observations
          </p>
          <ol className="text-sm text-slate-300 space-y-2 list-decimal list-inside">
            <li>Which app opened: Linkus or the SIM dialler?</li>
            <li>Does the number shown read exactly <span className="font-mono text-sky-400">104</span> / <span className="font-mono text-sky-400">105</span> (no prefix)?</li>
            <li>Did the call start immediately, or need another tap?</li>
            <li>Once both phones are up: can 104 and 105 speak to each other?</li>
          </ol>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2 text-sm">
          <p className="text-sm font-semibold text-white">How to run the test</p>
          <p className="text-slate-400 flex gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            On phone A (extension 104): open this app logged in as platform admin, tap
            "Call 105 via Linkus". Linkus on phone B should ring.
          </p>
          <p className="text-slate-400 flex gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            On phone B (extension 105): do the same with "Call 104 via Linkus".
          </p>
          <p className="text-slate-400 flex gap-2">
            <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            If the SIM dialler opens instead, cancel — record the result as "SIM
            dialler" (routing failed, not a Linkus handoff).
          </p>
        </div>
      </div>
    </div>
  );
}