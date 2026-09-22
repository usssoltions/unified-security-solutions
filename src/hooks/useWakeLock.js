import { useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

/**
 * useWakeLock — OPERATION-SCOPED screen wake lock (never session-wide).
 *
 * Acquires only while `active` is true, releases on deactivate, timeout,
 * route change or component unmount, reacquires on visibility return ONLY if
 * the operation is still active, never holds duplicate locks, and no-ops
 * (with instrumentation) where the Wake Lock API is unavailable.
 *
 * Instrumentation records acquire/release/failure/unavailable as anonymous
 * analytics events — only the operation category, never user, site,
 * customer or challenge identifiers.
 */
export default function useWakeLock(active, reason) {
  const lockRef = useRef(null);
  const activeRef = useRef(false);
  const reasonRef = useRef(reason);
  reasonRef.current = reason;

  useEffect(() => {
    activeRef.current = active;

    const track = (action, detail = {}) => {
      try {
        base44.analytics.track({
          eventName: "wake_lock_event",
          properties: { action, reason: reasonRef.current, ...detail },
        });
      } catch (_) {}
    };

    const acquire = async () => {
      if (!activeRef.current || lockRef.current) return; // no duplicate acquisitions
      if (!("wakeLock" in navigator)) {
        track("unavailable");
        return;
      }
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (!activeRef.current) {
          // Operation ended while the request was in flight — release immediately.
          try { await lock.release(); } catch (_) {}
          return;
        }
        lockRef.current = lock;
        lock.addEventListener?.("release", () => { lockRef.current = null; });
        track("acquire");
      } catch (e) {
        lockRef.current = null;
        track("failure", { code: String(e?.name || "error").slice(0, 60) });
      }
    };

    const release = async () => {
      const lock = lockRef.current;
      lockRef.current = null;
      if (lock) {
        try {
          await lock.release();
          track("release");
        } catch (_) {
          lockRef.current = null;
        }
      }
    };

    const onVisibility = () => {
      // The browser releases wake locks automatically while hidden; reacquire
      // safely on return ONLY if the operation is still active.
      if (document.visibilityState === "visible") acquire();
    };

    if (active) acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      activeRef.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [active, reason]);
}