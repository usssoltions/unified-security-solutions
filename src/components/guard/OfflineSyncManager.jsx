import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { getAllPending, deletePending, updatePending, countPending } from "@/lib/offlineDB";
import { Wifi, WifiOff, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const STORES = [
  { name: "pending_location", entity: "LocationTracking" },
  { name: "pending_patrol",   entity: "PatrolLog" }, // submitted through the checkpointSubmission gateway (idempotent)
  { name: "pending_incident", entity: "Incident" },
  { name: "pending_maintenance", entity: "MaintenanceRequest" },
  { name: "pending_handover", entity: "ShiftHandover" },
];

const MAX_ATTEMPTS = 5;

export default function OfflineSyncManager() {
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [justSynced, setJustSynced] = useState(false);
  const syncInProgress = useRef(false);

  // Count pending + permanently-failed records
  const refreshCount = async () => {
    let total = 0;
    let failed = 0;
    for (const s of STORES) {
      const records = await getAllPending(s.name);
      total += records.length;
      failed += records.filter((r) => r.status === "failed").length;
    }
    setPendingCount(total);
    setFailedCount(failed);
  };

  // Sync all pending records to server
  const syncAll = async () => {
    if (syncInProgress.current || !navigator.onLine) return;
    syncInProgress.current = true;
    setSyncing(true);
    let anySynced = false;

    for (const { name, entity } of STORES) {
      const records = await getAllPending(name);
      for (const record of records) {
        if (record.status === "failed") continue; // needs a manual retry
        try {
          if (name === "pending_patrol" && record.submission_key && record.patrol) {
            // Checkpoint submissions go through the server-side gateway, which
            // is IDEMPOTENT via submission_key — a retry can never duplicate.
            const res = await base44.functions.invoke("checkpointSubmission", {
              action: "submit",
              submission_key: record.submission_key,
              patrol: record.patrol,
              completion: record.completion || null,
            });
            const d = res?.data || res;
            if (!d?.ok) throw new Error(d?.error || "Submission failed");
          } else {
            const { offline_id, saved_at, _savedAt, attempts, last_error, status, ...data } = record;
            await base44.entities[entity].create(data);
          }
          await deletePending(name, record.offline_id);
          anySynced = true;
        } catch (e) {
          // Retry on the next sync; after MAX_ATTEMPTS mark it Sync Failed
          // so the guard sees it needs attention (never silently dropped).
          const attempts = (record.attempts || 0) + 1;
          const patch = { attempts, last_error: e?.response?.data?.error || e?.message || "Unknown error" };
          if (attempts >= MAX_ATTEMPTS) patch.status = "failed";
          try { await updatePending(name, record.offline_id, patch); } catch (_) {}
          if (e?.status === 429 || e?.response?.status === 429) break;
        }
      }
    }

    await refreshCount();
    setSyncing(false);
    syncInProgress.current = false;
    if (anySynced) {
      setJustSynced(true);
      setTimeout(() => setJustSynced(false), 3000);
    }
  };

  // Manual retry of permanently-failed records
  const retryFailed = async () => {
    for (const { name } of STORES) {
      const records = await getAllPending(name);
      for (const record of records) {
        if (record.status === "failed") {
          try { await updatePending(name, record.offline_id, { status: "pending", attempts: 0 }); } catch (_) {}
        }
      }
    }
    await refreshCount();
    syncAll();
  };

  useEffect(() => {
    refreshCount();

    const handleOnline = () => {
      setOnline(true);
      // Small delay to let connection stabilise
      setTimeout(syncAll, 2000);
    };
    const handleOffline = () => {
      setOnline(false);
      setJustSynced(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Also sync on mount if online and there's pending data
    if (navigator.onLine) {
      setTimeout(async () => {
        const count = await countPending("pending_location") +
                       await countPending("pending_patrol") +
                       await countPending("pending_incident") +
                       await countPending("pending_maintenance") +
                       await countPending("pending_handover");
        if (count > 0) syncAll();
      }, 5000);
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Only show banner when offline OR when there's pending data OR just synced
  const show = !online || pendingCount > 0 || justSynced;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -40 }}
          className={`fixed top-16 left-0 right-0 z-50 flex items-center justify-between px-4 py-2 text-xs font-medium shadow-lg ${
            justSynced
              ? "bg-emerald-600"
              : failedCount > 0
              ? "bg-red-600"
              : online
              ? "bg-amber-600"
              : "bg-slate-800 border-b border-slate-700"
          }`}
        >
          <div className="flex items-center gap-2">
            {justSynced ? (
              <CheckCircle2 className="w-4 h-4 text-white" />
            ) : failedCount > 0 ? (
              <AlertTriangle className="w-4 h-4 text-white" />
            ) : online ? (
              <RefreshCw className="w-4 h-4 text-white animate-spin" />
            ) : (
              <WifiOff className="w-4 h-4 text-slate-300" />
            )}
            <span className="text-white">
              {justSynced
                ? "Offline data synced!"
                : failedCount > 0
                ? `Sync failed for ${failedCount} record${failedCount !== 1 ? "s" : ""}`
                : online
                ? `Syncing ${pendingCount} offline record${pendingCount !== 1 ? "s" : ""}…`
                : `Offline — ${pendingCount > 0 ? `${pendingCount} record${pendingCount !== 1 ? "s" : ""} pending sync` : "data saved locally"}`}
            </span>
          </div>

          {online && failedCount > 0 && !syncing && (
            <button onClick={retryFailed} className="text-white underline text-xs">
              Retry
            </button>
          )}
          {online && pendingCount > 0 && failedCount === 0 && !syncing && (
            <button onClick={syncAll} className="text-white underline text-xs">
              Sync now
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}