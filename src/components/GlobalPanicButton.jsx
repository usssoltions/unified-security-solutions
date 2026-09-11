import React, { useRef } from "react";
import { AlertTriangle } from "lucide-react";
import {
  activatePanic, updatePanicLocation, requestFreshLocation,
  hapticFeedback, managePanic
} from "@/lib/panicService";
import {
  setActivating, setActivationFailed, adoptNewPanic, localCancel, retryReady
} from "@/lib/senderPanicState";
import { useSenderPanicState } from "@/hooks/useSenderPanicState";
import SenderPanicStatusOverlay from "@/components/panic/SenderPanicStatusOverlay";

/**
 * Global Panic button for the Layout header — visible to ALL authenticated
 * users regardless of role. Same activation logic as the big GuardShift
 * PanicButton but in a compact header form. Available from every page.
 *
 * The sender STATUS (sent / waiting / acknowledged / cancelled / resolved)
 * lives in the shared AUTHORITATIVE sender panic store and renders through
 * SenderPanicStatusOverlay — it is restored from the PanicAlert record on
 * load and survives refresh, navigation and app restart. This component
 * keeps ONLY the activation flow (immediate feedback, no GPS wait,
 * duplicate-tap lock).
 */
export default function GlobalPanicButton({ user }) {
  const panic = useSenderPanicState(user);
  const lockRef = useRef(false);

  const openPanic = panic.record
    && ["active", "acknowledged", "assigned", "accepted"].includes(panic.record.status);
  // The trigger is locked while an open panic is being tracked — a second
  // panic record must never be created while one is already live. The
  // zero-recipient safe state keeps the trigger available for a retry
  // attempt (existing behaviour).
  const busy = ["activating", "activated", "acknowledged"].includes(panic.phase)
    || (panic.phase === "no_recipients" && panic.overlayOpen);

  const handlePanicPress = async () => {
    if (lockRef.current) return;
    if (busy) return;
    lockRef.current = true;

    setActivating();
    hapticFeedback([300, 100, 300, 100, 300]);

    try {
      const result = await activatePanic({
        siteId: user?.site_id || "",
        siteName: user?.site_name || ""
      });
      adoptNewPanic(result);
      // Zero authorised recipients → SAFE CRITICAL state. The UI must NEVER
      // claim the Control Room was notified when nobody could be reached.
      if (result.recipientConfigurationMissing || result.recipientCount === 0) {
        hapticFeedback([500, 200, 500]);
      } else {
        hapticFeedback([200, 50, 200]);
      }

      requestFreshLocation().then((freshLoc) => {
        if (freshLoc) updatePanicLocation(result.panicId, freshLoc);
      });
    } catch (error) {
      console.error("Panic activation failed:", error);
      setActivationFailed();
      hapticFeedback([500]);
    } finally {
      setTimeout(() => { lockRef.current = false; }, 2000);
    }
  };

  const handleCancel = async () => {
    if (!panic.record?.id) return;
    try {
      await managePanic(panic.record.id, "cancel");
      localCancel();
    } catch (e) {
      console.error("Cancel failed:", e);
    }
  };

  return (
    <>
      {/* Header button — always visible to all authenticated users */}
      <button
        onClick={handlePanicPress}
        disabled={lockRef.current || busy}
        title={openPanic ? "PANIC ACTIVE — your status is showing on screen" : "PANIC — Emergency Alert"}
        className={`relative w-11 h-11 rounded-xl flex items-center justify-center text-white shadow-lg shadow-red-500/40 active:scale-95 transition touch-manipulation shrink-0 ${openPanic ? "bg-gradient-to-br from-red-800 to-red-900" : "bg-gradient-to-br from-red-600 to-red-800"}`}
      >
        <AlertTriangle className={`w-5 h-5 ${openPanic ? "animate-pulse" : ""}`} />
        {!openPanic && (
          <span className="absolute inset-0 rounded-xl border-2 border-red-400/50 animate-ping pointer-events-none" />
        )}
      </button>

      {/* Unified sender emergency status overlay (authoritative state) */}
      <SenderPanicStatusOverlay panic={panic} onCancel={handleCancel} onRetry={retryReady} />
    </>
  );
}