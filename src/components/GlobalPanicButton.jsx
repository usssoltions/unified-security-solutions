import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, CheckCircle2, XCircle, Loader2, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import {
  activatePanic, updatePanicLocation, requestFreshLocation,
  hapticFeedback, managePanic
} from "@/lib/panicService";

/**
 * Global Panic button for the Layout header — visible to ALL authenticated
 * users regardless of role. Same activation logic as the big GuardShift
 * PanicButton but in a compact header form. Opens a full-screen overlay on
 * press with immediate feedback. Available from every page.
 */
export default function GlobalPanicButton({ user }) {
  const [showOverlay, setShowOverlay] = useState(false);
  const [panicState, setPanicState] = useState("idle");
  const [panicId, setPanicId] = useState(null);
  const [panicNumber, setPanicNumber] = useState(null);
  const [acknowledgedBy, setAcknowledgedBy] = useState(null);
  const [showCancel, setShowCancel] = useState(false);

  const lockRef = useRef(false);

  // Realtime subscription for status updates
  useEffect(() => {
    if (!panicId) return;
    const unsub = base44.entities.PanicAlert.subscribe((event) => {
      if (!event.data || event.data.id !== panicId) return;
      if (event.type === "update") {
        if (event.data.status === "acknowledged" && event.data.acknowledged_by_name) {
          setAcknowledgedBy(event.data.acknowledged_by_name);
          setPanicState("acknowledged");
          hapticFeedback([100, 50, 100]);
        } else if (event.data.status === "resolved" || event.data.status === "cancelled") {
          setTimeout(() => {
            setShowOverlay(false);
            setPanicState("idle");
            setPanicId(null);
            setAcknowledgedBy(null);
          }, 3000);
        }
      }
    });
    return unsub;
  }, [panicId]);

  useEffect(() => {
    if (panicState === "activated") {
      setShowCancel(true);
      const timer = setTimeout(() => setShowCancel(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [panicState]);

  // NOTE: Automatic client-side escalation was removed. A panic is submitted
  // ONCE; the Control Room Panic Queue provides the visual urgency. No
  // setTimeout re-sends the panic notification after any delay.

  const handlePanicPress = async () => {
    if (lockRef.current) return;
    if (panicState === "activating" || panicState === "activated") return;
    lockRef.current = true;

    setShowOverlay(true);
    setPanicState("activating");
    hapticFeedback([300, 100, 300, 100, 300]);

    try {
      const result = await activatePanic({
        siteId: user?.site_id || "",
        siteName: user?.site_name || ""
      });
      setPanicId(result.panicId);
      setPanicNumber(result.panicNumber);
      setPanicState("activated");
      hapticFeedback([200, 50, 200]);

      requestFreshLocation().then((freshLoc) => {
        if (freshLoc) updatePanicLocation(result.panicId, freshLoc);
      });
    } catch (error) {
      console.error("Panic activation failed:", error);
      setPanicState("failed");
      hapticFeedback([500]);
    } finally {
      setTimeout(() => { lockRef.current = false; }, 2000);
    }
  };

  const handleCancel = async () => {
    if (!panicId) return;
    try {
      await managePanic(panicId, "cancel");
      setShowOverlay(false);
      setPanicState("idle");
      setPanicId(null);
      setPanicNumber(null);
      setAcknowledgedBy(null);
    } catch (e) {
      console.error("Cancel failed:", e);
    }
  };

  const handleRetry = () => {
    setPanicState("idle");
    lockRef.current = false;
  };

  const handleClose = () => {
    if (panicState === "activating") return; // Can't close while activating
    setShowOverlay(false);
    if (panicState === "failed") {
      setPanicState("idle");
      lockRef.current = false;
    }
  };

  return (
    <>
      {/* Header button — always visible to all authenticated users */}
      <button
        onClick={handlePanicPress}
        disabled={lockRef.current}
        title="PANIC — Emergency Alert"
        className="relative w-11 h-11 bg-gradient-to-br from-red-600 to-red-800 rounded-xl flex items-center justify-center text-white shadow-lg shadow-red-500/40 active:scale-95 transition touch-manipulation shrink-0"
      >
        <AlertTriangle className="w-5 h-5" />
        <span className="absolute inset-0 rounded-xl border-2 border-red-400/50 animate-ping pointer-events-none" />
      </button>

      {/* Full-screen overlay for activation feedback */}
      <AnimatePresence>
        {showOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-full max-w-sm bg-slate-900 rounded-3xl border-2 border-red-500/50 shadow-2xl overflow-hidden"
            >
              {panicState === "activating" && (
                <div className="p-8 text-center">
                  <Loader2 className="w-12 h-12 text-red-500 mx-auto mb-4 animate-spin" />
                  <h2 className="text-white text-2xl font-bold">🚨 PANIC ACTIVATED</h2>
                  <p className="text-slate-400 text-sm mt-2">Emergency alert is being sent...</p>
                </div>
              )}

              {panicState === "activated" && (
                <div className="p-8 text-center">
                  <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                    <AlertTriangle className="w-8 h-8 text-white" />
                  </div>
                  <h2 className="text-white text-2xl font-bold">🚨 PANIC SENT</h2>
                  <p className="text-slate-400 text-sm mt-2">Control Room has been notified.</p>
                  {panicNumber && (
                    <p className="text-slate-500 text-xs mt-1 font-mono">Ref: {panicNumber}</p>
                  )}
                  {showCancel && (
                    <button
                      onClick={handleCancel}
                      className="mt-4 inline-flex items-center gap-1 bg-white/10 hover:bg-white/20 text-white text-sm font-medium px-4 py-2 rounded-lg transition active:scale-95"
                    >
                      <X className="w-4 h-4" /> Cancel (accidental?)
                    </button>
                  )}
                  <p className="text-slate-500 text-xs mt-4">Waiting for acknowledgement...</p>
                  {!showCancel && (
                    <button
                      onClick={handleClose}
                      className="mt-4 text-slate-500 text-xs underline"
                    >
                      Close
                    </button>
                  )}
                </div>
              )}

              {panicState === "acknowledged" && (
                <div className="p-8 text-center">
                  <div className="w-16 h-16 bg-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8 text-white" />
                  </div>
                  <h2 className="text-white text-2xl font-bold">✓ ACKNOWLEDGED</h2>
                  <p className="text-slate-400 text-sm mt-2">
                    Your Panic has been acknowledged by {acknowledgedBy || "Control Room"}.
                  </p>
                  <p className="text-emerald-400 text-xs mt-3">Help is on the way. Stay safe.</p>
                </div>
              )}

              {panicState === "failed" && (
                <div className="p-8 text-center">
                  <div className="w-16 h-16 bg-orange-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <XCircle className="w-8 h-8 text-white" />
                  </div>
                  <h2 className="text-white text-2xl font-bold">⚠️ ALERT NOT SENT</h2>
                  <p className="text-slate-400 text-sm mt-2">
                    Network error. Tap retry or call emergency services.
                  </p>
                  <button
                    onClick={handleRetry}
                    className="mt-4 bg-red-600 hover:bg-red-700 text-white font-bold px-6 py-3 rounded-lg active:scale-95 transition"
                  >
                    RETRY PANIC
                  </button>
                  <button
                    onClick={handleClose}
                    className="mt-2 text-slate-500 text-xs underline block w-full"
                  >
                    Close
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}