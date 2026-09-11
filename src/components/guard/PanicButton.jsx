import React, { useRef } from "react";
import { AlertTriangle } from "lucide-react";
import {
  activatePanic, updatePanicLocation, requestFreshLocation,
  hapticFeedback
} from "@/lib/panicService";
import {
  setActivating, setActivationFailed, adoptNewPanic
} from "@/lib/senderPanicState";
import { useSenderPanicState } from "@/hooks/useSenderPanicState";

/**
 * Big emergency Panic button for the Guard Shift screen.
 *
 * One press → IMMEDIATE local UI feedback (vibration + visual flash +
 * "🚨 PANIC ACTIVATED") → backend call fires WITHOUT waiting for GPS →
 * fresh GPS requested in parallel and updates the record when available.
 * An activation lock (useRef) prevents repeated taps from creating multiple
 * Panic records.
 *
 * The sender STATUS (sent / waiting / acknowledged / cancelled / resolved)
 * lives in the shared AUTHORITATIVE sender panic store and renders through
 * the global SenderPanicStatusOverlay — restored from the PanicAlert record
 * on load, it survives refresh, navigation and app restart. While an open
 * panic is tracked the big button is LOCKED so a second panic record can
 * never be created while one is already live.
 */
export default function PanicButton({ shiftId, siteId, siteName }) {
  const panic = useSenderPanicState();
  const lockRef = useRef(false);

  const openPanic = panic.record
    && ["active", "acknowledged", "assigned", "accepted"].includes(panic.record.status);
  // A zero-recipient panic keeps the trigger available for a retry attempt
  // (existing behaviour); a normal open panic locks it.
  const triggerBlocked = openPanic && panic.phase !== "no_recipients";

  const handlePanicPress = async () => {
    // Activation lock — prevents duplicate panics from rapid tapping
    if (lockRef.current) return;
    if (["activating", "activated", "acknowledged"].includes(panic.phase)) return;
    if (triggerBlocked) return;
    lockRef.current = true;

    // IMMEDIATE local UI feedback — before any network call
    setActivating();
    hapticFeedback([300, 100, 300, 100, 300]);

    // Fire backend call immediately (no GPS wait)
    try {
      const result = await activatePanic({ shiftId, siteId, siteName });
      adoptNewPanic(result);
      // Zero authorised recipients → SAFE CRITICAL state.
      if (result.recipientConfigurationMissing || result.recipientCount === 0) {
        hapticFeedback([500, 200, 500]);
      } else {
        hapticFeedback([200, 50, 200]);
      }

      // Request fresh GPS in parallel — update the record when available
      requestFreshLocation().then((freshLoc) => {
        if (freshLoc) updatePanicLocation(result.panicId, freshLoc);
      });
    } catch (error) {
      console.error("Panic activation failed:", error);
      setActivationFailed();
      hapticFeedback([500]);
    } finally {
      // Release lock after a short delay so the UI settles
      setTimeout(() => { lockRef.current = false; }, 2000);
    }
  };

  return (
    <button
      onClick={handlePanicPress}
      disabled={lockRef.current || triggerBlocked}
      className="w-full bg-gradient-to-r from-red-600 to-red-800 hover:from-red-700 hover:to-red-900 text-white rounded-2xl shadow-2xl shadow-red-500/40 active:scale-95 transition-all touch-manipulation select-none"
      style={{ minHeight: "96px" }}
    >
      {triggerBlocked ? (
        <div className="flex flex-col items-center justify-center gap-1 py-5">
          <AlertTriangle className="w-10 h-10 mb-1 animate-pulse" />
          <span className="text-2xl font-bold tracking-wide">🚨 PANIC ACTIVE</span>
          <span className="text-xs text-red-100 font-medium">Your emergency status is showing on screen</span>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-1 py-5">
          <AlertTriangle className="w-10 h-10 mb-1" />
          <span className="text-2xl font-bold tracking-wide">🚨 PANIC</span>
          <span className="text-xs text-red-100 font-medium">Press for emergency</span>
        </div>
      )}
    </button>
  );
}