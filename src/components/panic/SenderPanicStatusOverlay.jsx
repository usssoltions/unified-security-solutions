import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, CheckCircle2, XCircle, Loader2, X, MapPin } from "lucide-react";
import { closeOverlay } from "@/lib/senderPanicState";

function fmtSast(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
  } catch (_) {
    return iso;
  }
}

// Friendly role labels — never expose raw role keys on sender-facing screens.
const ROLE_LABELS = {
  control_room_operator: "Control Room Operator",
  customer_admin: "Customer Administrator",
  reseller_admin: "Reseller Administrator",
  guard: "Security Guard",
  dispatcher: "Dispatcher",
  supervisor: "Supervisor",
  admin: "Platform Administrator",
  platform_admin: "Platform Administrator",
  practice_admin: "Practice Administrator",
  estate_manager: "Estate Manager",
  management: "Management",
};

/**
 * ONE consistent responsive emergency status container for every sender
 * panic phase: ACTIVATED / SENT + WAITING / NO RECIPIENTS / ACKNOWLEDGED /
 * CANCELLED / RESOLVED / FAILED.
 *
 * POSITIONING — fully visible, centre/upper-middle of the viewport:
 *  - the fixed container pads BELOW env(safe-area-inset-top) (Android
 *    status bar / iOS notch) so the card can never clip under it or under
 *    the USS header;
 *  - bottom safe-area padding keeps it clear of the home indicator /
 *    bottom nav;
 *  - the card is capped at the padded viewport and its body scrolls when
 *    content exceeds the height — nothing is ever clipped.
 */
export default function SenderPanicStatusOverlay({ panic, onCancel, onRetry }) {
  const { phase, record, overlayOpen, showCancel } = panic;
  const visible = overlayOpen && phase !== "idle";

  const mapsUrl = record?.location?.lat && record?.location?.lng
    ? `https://www.google.com/maps?q=${record.location.lat},${record.location.lng}`
    : null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          style={{
            paddingTop: "calc(env(safe-area-inset-top, 0px) + 1rem)",
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)",
            paddingLeft: "calc(env(safe-area-inset-left, 0px) + 1rem)",
            paddingRight: "calc(env(safe-area-inset-right, 0px) + 1rem)",
          }}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-sm my-auto max-h-full overflow-y-auto overscroll-contain bg-slate-900 rounded-3xl border-2 border-red-500/50 shadow-2xl"
          >
            {/* ACTIVATING — record being created */}
            {phase === "activating" && (
              <div className="p-8 text-center">
                <Loader2 className="w-12 h-12 text-red-500 mx-auto mb-4 animate-spin" />
                <h2 className="text-white text-2xl font-bold">🚨 PANIC ACTIVATED</h2>
                <p className="text-slate-400 text-sm mt-2">Emergency alert is being sent...</p>
              </div>
            )}

            {/* SENT — active, not acknowledged */}
            {phase === "activated" && (
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                  <AlertTriangle className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-white text-2xl font-bold">🚨 PANIC SENT</h2>
                <p className="text-slate-400 text-sm mt-2">Control Room has been notified.</p>
                {record?.panic_number && (
                  <p className="text-slate-500 text-xs mt-1 font-mono">Ref: {record.panic_number}</p>
                )}
                {mapsUrl && (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-xs text-sky-400 underline"
                  >
                    <MapPin className="w-3 h-3" /> View Location
                  </a>
                )}
                {showCancel && (
                  <button
                    onClick={onCancel}
                    className="mt-4 inline-flex items-center gap-1 bg-white/10 hover:bg-white/20 text-white text-sm font-medium px-4 py-2 rounded-lg transition active:scale-95"
                  >
                    <X className="w-4 h-4" /> Cancel (accidental?)
                  </button>
                )}
                <p className="text-slate-500 text-xs mt-4">Waiting for acknowledgement...</p>
                {!showCancel && (
                  <button onClick={closeOverlay} className="mt-4 text-slate-500 text-xs underline">
                    Close
                  </button>
                )}
              </div>
            )}

            {/* ZERO-RECIPIENT safe critical state — protected copy */}
            {phase === "no_recipients" && (
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                  <AlertTriangle className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-white text-2xl font-bold">🚨 PANIC ACTIVATED</h2>
                <p className="text-orange-300 text-sm mt-2 font-semibold">
                  No configured responder could be reached.
                </p>
                {record?.panic_number && (
                  <p className="text-slate-500 text-xs mt-1 font-mono">Ref: {record.panic_number}</p>
                )}
                <p className="text-slate-400 text-xs mt-3">
                  If you are in immediate danger, please call emergency services directly.
                </p>
                {showCancel && (
                  <button
                    onClick={onCancel}
                    className="mt-4 inline-flex items-center gap-1 bg-white/10 hover:bg-white/20 text-white text-sm font-medium px-4 py-2 rounded-lg transition active:scale-95"
                  >
                    <X className="w-4 h-4" /> Cancel (accidental?)
                  </button>
                )}
                {!showCancel && (
                  <button onClick={closeOverlay} className="mt-4 text-slate-500 text-xs underline">
                    Close
                  </button>
                )}
              </div>
            )}

            {/* ACKNOWLEDGED — derived from acknowledged_at on the record */}
            {phase === "acknowledged" && (
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-white text-2xl font-bold">✓ PANIC ACKNOWLEDGED</h2>
                <p className="text-slate-400 text-sm mt-1">Your emergency alert has been acknowledged.</p>
                <div className="text-left mt-4 space-y-1 bg-slate-800/60 rounded-xl p-3">
                  <p className="text-sm text-slate-400">
                    Acknowledged by: <span className="text-white font-semibold">{record?.acknowledged_by_name || "Control Room"}</span>
                  </p>
                  {record?.acknowledged_by_role && (
                    <p className="text-sm text-slate-400">
                      Role: <span className="text-white font-semibold">{ROLE_LABELS[record.acknowledged_by_role] || record.acknowledged_by_role}</span>
                    </p>
                  )}
                  <p className="text-sm text-slate-400">
                    Acknowledged: <span className="text-white font-semibold">{fmtSast(record?.acknowledged_at)}</span>
                  </p>
                  {record?.panic_number && (
                    <p className="text-xs text-slate-500 font-mono pt-1">Ref: {record.panic_number}</p>
                  )}
                </div>
                <p className="text-emerald-400 text-sm mt-3 font-medium">Help is responding. Stay safe.</p>
                <button onClick={closeOverlay} className="mt-4 text-slate-400 text-xs underline">
                  Close
                </button>
              </div>
            )}

            {/* CANCELLED */}
            {phase === "cancelled" && (
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-slate-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <XCircle className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-white text-2xl font-bold">PANIC CANCELLED</h2>
                <p className="text-slate-400 text-sm mt-1">This emergency alert was cancelled by you.</p>
                <div className="text-left mt-4 space-y-1 bg-slate-800/60 rounded-xl p-3">
                  <p className="text-sm text-slate-400">
                    Cancelled at: <span className="text-white font-semibold">{fmtSast(record?.resolved_at)}</span>
                  </p>
                  {record?.panic_number && (
                    <p className="text-xs text-slate-500 font-mono pt-1">Ref: {record.panic_number}</p>
                  )}
                </div>
                <button onClick={closeOverlay} className="mt-4 text-slate-400 text-xs underline">
                  Close
                </button>
              </div>
            )}

            {/* RESOLVED */}
            {phase === "resolved" && (
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-white text-2xl font-bold">✓ PANIC RESOLVED</h2>
                <p className="text-slate-400 text-sm mt-1">Your emergency alert has been resolved.</p>
                <div className="text-left mt-4 space-y-1 bg-slate-800/60 rounded-xl p-3">
                  <p className="text-sm text-slate-400">
                    Resolved by: <span className="text-white font-semibold">{record?.resolved_by_name || "Responder"}</span>
                  </p>
                  <p className="text-sm text-slate-400">
                    Resolved: <span className="text-white font-semibold">{fmtSast(record?.resolved_at)}</span>
                  </p>
                  {record?.resolution_notes && (
                    <p className="text-xs text-slate-400 pt-1">{record.resolution_notes}</p>
                  )}
                  {record?.panic_number && (
                    <p className="text-xs text-slate-500 font-mono pt-1">Ref: {record.panic_number}</p>
                  )}
                </div>
                <button onClick={closeOverlay} className="mt-4 text-slate-400 text-xs underline">
                  Close
                </button>
              </div>
            )}

            {/* FAILED — network error */}
            {phase === "failed" && (
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-orange-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <XCircle className="w-8 h-8 text-white" />
                </div>
                <h2 className="text-white text-2xl font-bold">⚠️ ALERT NOT SENT</h2>
                <p className="text-slate-400 text-sm mt-2">
                  Network error. Tap retry or call emergency services.
                </p>
                <button
                  onClick={onRetry}
                  className="mt-4 bg-red-600 hover:bg-red-700 text-white font-bold px-6 py-3 rounded-lg active:scale-95 transition"
                >
                  RETRY PANIC
                </button>
                <button
                  onClick={closeOverlay}
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
  );
}