/**
 * AUTHORITATIVE SENDER PANIC STATE — module store shared by every
 * sender-side Panic UI (the guard-page big button and the global header
 * button). The sender's current panic state is derived from the
 * AUTHORITATIVE PanicAlert record, never from temporary component state:
 *
 *  - On app load the authenticated user's own newest operationally
 *    active/unresolved panic is restored from the server (RLS user_id scope
 *    — another user's panic can never load).
 *  - While a panic is open, ONE realtime subscription plus a foreground
 *    refetch keep the state current. NO polling of any kind.
 *  - Acknowledged/cancelled/resolved states survive refresh, navigation and
 *    app restart until the panic reaches a terminal state, which displays
 *    briefly and then dismisses. Records are NEVER deleted here — history
 *    stays server-side.
 */
import { base44 } from "@/api/base44Client";
import { hapticFeedback } from "@/lib/panicService";

const OPEN_STATUSES = ["active", "acknowledged", "assigned", "accepted"];
const TERMINAL_DISMISS_MS = 5000;
const CANCEL_WINDOW_MS = 5000;

let current = {
  restored: false,
  // idle | activating | activated | no_recipients | acknowledged | resolved | cancelled | failed
  phase: "idle",
  record: null, // authoritative PanicAlert record (or a minimal seed right after activation)
  overlayOpen: false,
  showCancel: false,
};
let userId = null;
let restoreInFlight = false;
let realtimeUnsub = null;
let dismissTimer = null;
let cancelTimer = null;
const listeners = new Set();

function snapshot() {
  return { ...current, record: current.record ? { ...current.record } : null };
}
function emit() {
  const snap = snapshot();
  listeners.forEach((fn) => { try { fn(snap); } catch (_) {} });
}
function set(patch) {
  current = { ...current, ...patch };
  emit();
}

/** Derive the sender phase from the authoritative record's lifecycle state. */
function phaseForRecord(rec) {
  if (!rec) return "idle";
  if (rec.status === "resolved") return "resolved";
  if (rec.status === "cancelled") return "cancelled";
  if (rec.acknowledged_at || ["acknowledged", "assigned", "accepted"].includes(rec.status)) {
    return "acknowledged";
  }
  if (OPEN_STATUSES.includes(rec.status)) {
    // Zero-recipient safe state: an active panic whose initial notification
    // reached NOBODY must never claim "Control Room has been notified" after
    // a restore — the record's durable delivery marker is authoritative.
    return rec.status === "active" && rec.notification_sent === false
      ? "no_recipients"
      : "activated";
  }
  return "idle";
}

function startTracking() {
  if (realtimeUnsub) return;
  realtimeUnsub = base44.entities.PanicAlert.subscribe(handleRealtimeEvent);
  document.addEventListener("visibilitychange", handleForeground);
}
function stopTracking() {
  if (realtimeUnsub) { try { realtimeUnsub(); } catch (_) {} realtimeUnsub = null; }
  document.removeEventListener("visibilitychange", handleForeground);
}

function handleRealtimeEvent(event) {
  if (!event?.data || !current.record || event.data.id !== current.record.id) return;
  if (event.type === "update") {
    applyRecord({ ...current.record, ...event.data });
  } else if (event.type === "delete") {
    set({ phase: "idle", overlayOpen: false, record: null, showCancel: false });
    stopTracking();
  }
}

// Foreground refetch — catches any status change the realtime channel missed
// while the app was backgrounded (PWA reopen / native app reopen). Runs ONLY
// while the sender's own panic is still open; no background polling.
async function handleForeground() {
  if (document.visibilityState !== "visible" || !current.record) return;
  if (["resolved", "cancelled"].includes(current.record.status)) return;
  const recId = current.record.id;
  try {
    const fresh = await base44.entities.PanicAlert.get(recId);
    if (fresh && current.record && fresh.id === current.record.id) applyRecord(fresh);
  } catch (_) {}
}

/** Adopt an authoritative record and derive the sender phase from it. */
function applyRecord(rec) {
  if (!rec) return;
  const phase = phaseForRecord(rec);
  const prevPhase = current.phase;
  if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
  set({ record: rec, phase, overlayOpen: true });
  if (phase === "acknowledged" && prevPhase !== "acknowledged") {
    hapticFeedback([100, 50, 100]);
  }
  if (phase === "resolved" || phase === "cancelled") {
    stopTracking();
    dismissTimer = setTimeout(() => {
      dismissTimer = null;
      set({ phase: "idle", overlayOpen: false, record: null, showCancel: false });
    }, TERMINAL_DISMISS_MS);
  } else {
    startTracking();
  }
}

export function getSenderPanic() {
  return snapshot();
}

export function subscribeSenderPanic(fn) {
  listeners.add(fn);
  try { fn(snapshot()); } catch (_) {}
  return () => listeners.delete(fn);
}

/**
 * Restore the authenticated user's CURRENT panic from the server. Runs once
 * per page load (module singleton): resolves ONLY the user's own newest
 * operationally active/unresolved panic — terminal panics are never
 * resurrected from history. Server/RLS scoping is authoritative.
 */
export async function restoreSenderPanic(user) {
  if (!user?.id || restoreInFlight) return;
  if (userId && user.id !== userId) {
    // Different user on this device — reset any prior session state.
    stopTracking();
    if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
    current = { restored: false, phase: "idle", record: null, overlayOpen: false, showCancel: false };
  }
  userId = user.id;
  if (current.restored) return;
  restoreInFlight = true;
  try {
    const results = await Promise.all(OPEN_STATUSES.map((s) =>
      base44.entities.PanicAlert
        .filter({ user_id: user.id, status: s }, "-activated_at", 5)
        .catch(() => [])
    ));
    const open = results.flat().filter(Boolean)
      .sort((a, b) => new Date(b.activated_at || 0) - new Date(a.activated_at || 0))[0];
    current.restored = true;
    if (open) {
      set({ record: open, phase: phaseForRecord(open), overlayOpen: true, showCancel: false });
      startTracking();
    } else {
      set({ phase: "idle", overlayOpen: false, record: null });
    }
  } catch (_) {
    current.restored = true;
    emit();
  } finally {
    restoreInFlight = false;
  }
}

/** Reopen the status overlay for a still-open panic (e.g. page return). */
export function ensurePanicVisible() {
  if (!current.record) return;
  if (["resolved", "cancelled", "failed"].includes(current.phase)) return;
  set({ overlayOpen: true });
}

/** Transient activation states (record not created / creation failed). */
export function setActivating() {
  set({ phase: "activating", overlayOpen: true });
}
export function setActivationFailed() {
  stopTracking();
  set({ phase: "failed", overlayOpen: true, record: null, showCancel: false });
}
export function retryReady() {
  stopTracking();
  set({ phase: "idle", overlayOpen: false, record: null, showCancel: false });
}

/**
 * Adopt a freshly-activated panic (result of activatePanic). Seeds the
 * record from the activation result; realtime + foreground refetch keep it
 * authoritative afterwards. Opens the accidental-cancel window for the
 * existing 5-second policy.
 */
export function adoptNewPanic(result) {
  if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
  const zeroRecipients = result.recipientConfigurationMissing || result.recipientCount === 0;
  set({
    record: {
      id: result.panicId,
      panic_number: result.panicNumber,
      status: "active",
      activated_at: new Date().toISOString(),
      acknowledged_at: null,
    },
    phase: zeroRecipients ? "no_recipients" : "activated",
    overlayOpen: true,
    showCancel: true,
  });
  startTracking();
  if (cancelTimer) clearTimeout(cancelTimer);
  cancelTimer = setTimeout(() => {
    cancelTimer = null;
    set({ showCancel: false });
  }, CANCEL_WINDOW_MS);
}

/** Optimistic local cancel — applied after the server cancel write succeeded. */
export function localCancel() {
  if (!current.record) return;
  applyRecord({ ...current.record, status: "cancelled", resolved_at: new Date().toISOString() });
}

/** Dismiss the status overlay (never mutates or deletes the panic record). */
export function closeOverlay() {
  if (current.phase === "activating") return; // can't close mid-activation
  set({ overlayOpen: false });
  if (current.phase === "failed") {
    stopTracking();
    set({ phase: "idle", record: null, showCancel: false });
  }
}