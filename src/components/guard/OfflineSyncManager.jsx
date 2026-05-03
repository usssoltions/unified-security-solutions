import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { getAllPending, deletePending, countPending } from "@/lib/offlineDB";
import { Wifi, WifiOff, RefreshCw, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const STORES = [
  { name: "pending_location", entity: "LocationTracking" },
  { name: "pending_patrol",   entity: "PatrolLog" },
  { name: "pending_incident", entity: "Incident" },
  { name: "pending_maintenance", entity: "MaintenanceRequest" },
  { name: "pending_handover", entity: "ShiftHandover" },
];

export default function OfflineSyncManager() {
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [justSynced, setJustSynced] = useState(false);
  const syncInProgress = useRef(false);

  // Count pending records
  const refreshCount = async () => {
    let total = 0;
    for (const s of STORES) {
      total += await countPending(s.name);
    }
    setPendingCount(total);
  };

  // Sync all pending records to server
  const syncAll = async () => {
    if (syncInProgress.current || !navigator.onLine) return;
    syncInProgress.current = true;
    setSyncing(true);

    for (const { name, entity } of STORES) {
      const records = await getAllPending(name);
      for (const record of records) {
        try {
          const { offline_id, saved_at, _savedAt, ...data } = record;
          await base44.entities[entity].create(data);
          await deletePending(name, offline_id);
        } catch (e) {
          // If still failing (rate limit etc), leave it for next sync
          if (e?.status === 429) break;
        }
      }
    }

    await refreshCount();
    setSyncing(false);
    syncInProgress.current = false;
    setJustSynced(true);
    setTimeout(() => setJustSynced(false), 3000);
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
              : online
              ? "bg-amber-600"
              : "bg-slate-800 border-b border-slate-700"
          }`}
        >
          <div className="flex items-center gap-2">
            {justSynced ? (
              <CheckCircle2 className="w-4 h-4 text-white" />
            ) : online ? (
              <RefreshCw className="w-4 h-4 text-white animate-spin" />
            ) : (
              <WifiOff className="w-4 h-4 text-slate-300" />
            )}
            <span className="text-white">
              {justSynced
                ? "Offline data synced!"
                : online
                ? `Syncing ${pendingCount} offline record${pendingCount !== 1 ? "s" : ""}…`
                : `Offline — ${pendingCount > 0 ? `${pendingCount} record${pendingCount !== 1 ? "s" : ""} queued` : "data saved locally"}`}
            </span>
          </div>

          {online && pendingCount > 0 && !syncing && (
            <button onClick={syncAll} className="text-white underline text-xs">
              Sync now
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}