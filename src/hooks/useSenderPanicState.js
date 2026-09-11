import { useEffect, useState } from "react";
import {
  getSenderPanic, subscribeSenderPanic, restoreSenderPanic, ensurePanicVisible,
} from "@/lib/senderPanicState";

/**
 * Sender panic state hook — subscribes to the shared AUTHORITATIVE panic
 * store (survives refresh/navigation/app restart), restores the user's
 * open panic once per load, and reopens the status overlay on remount
 * while a panic is still open.
 */
export function useSenderPanicState(user = null) {
  const [snap, setSnap] = useState(getSenderPanic);

  useEffect(() => {
    const unsub = subscribeSenderPanic(setSnap);
    ensurePanicVisible();
    return unsub;
  }, []);

  useEffect(() => {
    if (user?.id) restoreSenderPanic(user);
  }, [user?.id]);

  return snap;
}