import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, CheckCircle2, XCircle, Loader2, MapPin, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import {
  activatePanic, updatePanicLocation, requestFreshLocation,
  hapticFeedback, managePanic
} from "@/lib/panicService";

/**
 * Big emergency Panic button for the Guard Shift screen.
 *
 * One press → IMMEDIATE local UI feedback (vibration + visual flash +
 * "🚨 PANIC ACTIVATED") → backend call fires WITHOUT waiting for GPS →
 * fresh GPS requested in parallel and updates the record when available.
 *
 * An activation lock (useRef) prevents repeated taps from creating multiple
 * Panic records. The button stays disabled/locked until the current
 * activation completes or fails.
 */
export default function PanicButton({ shiftId, siteId, siteName }) {
  const [panicState, setPanicState] = useState("idle"); // idle | activating | activated | acknowledged | failed
  const [panicId, setPanicId] = useState(null);
  const [panicNumber, setPanicNumber] = useState(null);
  const [acknowledgedBy, setAcknowledgedBy] = useState(null);
  const [location, setLocation] = useState(null);
  const [showCancel, setShowCancel] = useState(false);

  const lockRef = useRef(false);

  // Realtime subscription: listen for acknowledgement / status changes
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
          setPanicState("idle");
          setPanicId(null);
          setAcknowledgedBy(null);
        }
        if (event.data.location && event.data.location_updated) {
          setLocation(event.data.location);
        }
      }
    });
    return unsub;
  }, [panicId]);

  // Show cancel option for 5 seconds after activation
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
    // Activation lock — prevents duplicate panics from rapid tapping
    if (lockRef.current) return;
    if (panicState === "activating" || panicState === "activated") return;
    lockRef.current = true;

    // IMMEDIATE local UI feedback — before any network call
    setPanicState("activating");
    hapticFeedback([300, 100, 300, 100, 300]);

    // Fire backend call immediately (no GPS wait)
    try {
      const result = await activatePanic({ shiftId, siteId, siteName });
      setPanicId(result.panicId);
      setPanicNumber(result.panicNumber);
      setPanicState("activated");
      hapticFeedback([200, 50, 200]);

      // Request fresh GPS in parallel — update the record when available
      requestFreshLocation().then((freshLoc) => {
        if (freshLoc) {
          setLocation(freshLoc);
          updatePanicLocation(result.panicId, freshLoc);
        }
      });
    } catch (error) {
      console.error("Panic activation failed:", error);
      setPanicState("failed");
      hapticFeedback([500]);
    } finally {
      // Release lock after a short delay so the UI settles
      setTimeout(() => { lockRef.current = false; }, 2000);
    }
  };

  const handleCancel = async () => {
    if (!panicId) return;
    try {
      await managePanic(panicId, "cancel");
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

  // ── Active states (after press) ──────────────────────────────────────
  if (panicState !== "idle") {
    return (
      <div className="w-full">
        <AnimatePresence mode="wait">
          {panicState === "activating" && (
            <motion.div
              key="activating"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full bg-gradient-to-r from-red-600 to-red-800 rounded-2xl p-6 text-center shadow-2xl shadow-red-500/50"
            >
              <Loader2 className="w-10 h-10 text-white mx-auto mb-2 animate-spin" />
              <p className="text-white text-xl font-bold">🚨 PANIC ACTIVATED</p>
              <p className="text-red-100 text-sm mt-1">Emergency alert is being sent...</p>
            </motion.div>
          )}

          {panicState === "activated" && (
            <motion.div
              key="activated"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full bg-gradient-to-r from-red-600 to-red-800 rounded-2xl p-6 text-center shadow-2xl shadow-red-500/50 border-2 border-red-400 animate-pulse"
            >
              <AlertTriangle className="w-10 h-10 text-white mx-auto mb-2" />
              <p className="text-white text-xl font-bold">🚨 PANIC SENT</p>
              <p className="text-red-100 text-sm mt-1">Control Room has been notified.</p>
              {panicNumber && (
                <p className="text-red-200 text-xs mt-1 font-mono">Ref: {panicNumber}</p>
              )}
              {location && (
                <a
                  href={`https://www.google.com/maps?q=${location.lat},${location.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-xs text-white underline"
                >
                  <MapPin className="w-3 h-3" /> View Location
                </a>
              )}
              {showCancel && (
                <button
                  onClick={handleCancel}
                  className="mt-3 inline-flex items-center gap-1 bg-white/20 hover:bg-white/30 text-white text-sm font-medium px-4 py-2 rounded-lg transition active:scale-95"
                >
                  <X className="w-4 h-4" /> Cancel (accidental?)
                </button>
              )}
              <p className="text-red-200 text-xs mt-2">Waiting for acknowledgement...</p>
            </motion.div>
          )}

          {panicState === "acknowledged" && (
            <motion.div
              key="acknowledged"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full bg-gradient-to-r from-emerald-600 to-emerald-800 rounded-2xl p-6 text-center shadow-2xl shadow-emerald-500/50"
            >
              <CheckCircle2 className="w-10 h-10 text-white mx-auto mb-2" />
              <p className="text-white text-xl font-bold">✓ ACKNOWLEDGED</p>
              <p className="text-emerald-100 text-sm mt-1">
                Your Panic has been acknowledged by {acknowledgedBy || "Control Room"}.
              </p>
              <p className="text-emerald-200 text-xs mt-2">Help is on the way. Stay safe.</p>
            </motion.div>
          )}

          {panicState === "failed" && (
            <motion.div
              key="failed"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full bg-gradient-to-r from-orange-600 to-red-800 rounded-2xl p-6 text-center shadow-2xl"
            >
              <XCircle className="w-10 h-10 text-white mx-auto mb-2" />
              <p className="text-white text-xl font-bold">⚠️ ALERT NOT SENT</p>
              <p className="text-orange-100 text-sm mt-1">
                Network error. Tap retry or call emergency services directly.
              </p>
              <button
                onClick={handleRetry}
                className="mt-3 bg-white text-red-700 font-bold px-6 py-3 rounded-lg active:scale-95 transition"
              >
                RETRY PANIC
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ── Idle state — the big button ──────────────────────────────────────
  return (
    <button
      onClick={handlePanicPress}
      disabled={lockRef.current}
      className="w-full bg-gradient-to-r from-red-600 to-red-800 hover:from-red-700 hover:to-red-900 text-white rounded-2xl shadow-2xl shadow-red-500/40 active:scale-95 transition-all touch-manipulation select-none"
      style={{ minHeight: "96px" }}
    >
      <div className="flex flex-col items-center justify-center gap-1 py-5">
        <AlertTriangle className="w-10 h-10 mb-1" />
        <span className="text-2xl font-bold tracking-wide">🚨 PANIC</span>
        <span className="text-xs text-red-100 font-medium">Press for emergency</span>
      </div>
    </button>
  );
}