import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import RealtimeVoiceCall from "@/components/voice/RealtimeVoiceCall";

/**
 * Global incoming-call handler — mounted ONCE in App.jsx OUTSIDE <Routes>,
 * active on EVERY page after login. Persists across navigation.
 *
 * Listens via:
 *   1. URL params (push notification click-through)
 *   2. Window events (from OneSignal SDK / service worker)
 *   3. Service worker messages
 *   4. Realtime subscription for voice_call notifications
 *
 * Only unmounts when the user logs out (AuthContext sets user=null).
 */
let activeInstanceId = null;

export default function IncomingCallHandler({ user }) {
  const [incomingCall, setIncomingCall] = useState(null);
  const incomingCallRef = useRef(null);
  const processedCallIds = useRef(new Set());
  const instanceId = useRef(null);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  useEffect(() => {
    if (!user) return;

    // Singleton guard — ensure only ONE listener exists app-wide
    const myId = Date.now() + Math.random();
    if (activeInstanceId !== null) {
      console.warn("[IncomingCallHandler] ⚠ Another instance already active — skipping mount");
      return;
    }
    activeInstanceId = myId;
    instanceId.current = myId;
    console.log("[IncomingCallHandler] ✅ Mounted — global call listener active for user:", user.id, "at", new Date().toISOString());

    const triggerIncomingCall = (callData) => {
      if (incomingCallRef.current) {
        console.log("[IncomingCallHandler] Call already active, ignoring:", callData.callId);
        return;
      }
      if (processedCallIds.current.has(callData.callId)) {
        console.log("[IncomingCallHandler] Call already processed, skipping:", callData.callId);
        return;
      }
      processedCallIds.current.add(callData.callId);
      console.log("[IncomingCallHandler] 📞 TRIGGERING incoming call:", callData.callId, "from:", callData.caller?.full_name);
      setIncomingCall(callData);
    };

    // ── 1. URL params (push notification click-through) ──────────
    const checkUrlParams = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const callId = urlParams.get("call_id") || urlParams.get("incoming_call");
      const callerName = urlParams.get("caller_name");

      if (callId) {
        console.log("[IncomingCallHandler] 📡 URL param call detected — callId:", callId);
        triggerIncomingCall({
          callId,
          caller: { full_name: callerName ? decodeURIComponent(callerName) : "Incoming", badge_number: "Incoming" },
        });
        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    };

    checkUrlParams();
    window.addEventListener("popstate", checkUrlParams);

    // ── 2. Window events (from OneSignal SDK / service worker) ───
    const handleWindowEvent = (event) => {
      const { callId, callerName, autoAnswer } = event.detail || {};
      if (callId) {
        console.log("[IncomingCallHandler] 📡 Window event call — callId:", callId);
        triggerIncomingCall({
          callId,
          caller: { full_name: callerName || "Incoming", badge_number: "Incoming" },
          autoAnswer,
        });
      }
    };
    window.addEventListener("incoming-call", handleWindowEvent);

    // ── 3. Service worker messages ───────────────────────────────
    const handleSWMessage = (event) => {
      const d = event.data;
      if (!d) return;
      if (d.type === "incoming-call") {
        console.log("[IncomingCallHandler] 📡 SW message call — callId:", d.callId);
        triggerIncomingCall({
          callId: d.callId,
          caller: { full_name: d.callerName || "Incoming", badge_number: "Incoming" },
          autoAnswer: d.autoAnswer,
        });
      } else if (d.type === "NOTIFICATION_CLICK" && d.url) {
        const params = new URLSearchParams(d.url.split("?")[1] || "");
        const callId = params.get("call_id") || params.get("incoming_call");
        const callerName = params.get("caller_name");
        if (callId) {
          console.log("[IncomingCallHandler] 📡 SW notification click — callId:", callId);
          triggerIncomingCall({
            callId,
            caller: { full_name: callerName || "Incoming", badge_number: "Incoming" },
          });
        }
      }
    };
    navigator.serviceWorker?.addEventListener("message", handleSWMessage);

    // ── 4. Realtime subscription for voice_call notifications (replaces 2s polling) ──
    const processCallNotification = async (n) => {
      if (incomingCallRef.current || n.read) return;
      if (n.related_entity !== "voice_call") return;
      const cid = n.related_id;
      if (!cid || processedCallIds.current.has(cid)) return;
      processedCallIds.current.add(cid);
      const callerName = (n.message || "")
        .replace(" is calling you", "")
        .replace(" is calling (Group Call)", "")
        .replace(". Tap to answer.", "");
      console.log("[IncomingCallHandler] 📞 Triggering from subscription — callId:", cid, "caller:", callerName);
      triggerIncomingCall({
        callId: cid,
        caller: { full_name: callerName || "Incoming", badge_number: "Incoming" },
      });
      await base44.entities.Notification.update(n.id, { read: true }).catch(() => {});
    };
    const unsubNotifications = base44.entities.Notification.subscribe((event) => {
      if (event.type === "create" && event.data?.recipient_id === user.id) {
        processCallNotification(event.data);
      }
    });

    // ── 5. Realtime subscription for call-ended signals (replaces 2s polling) ──
    const unsubSignaling = base44.entities.SignalingMessage.subscribe((event) => {
      if (!incomingCallRef.current) return;
      if (event.type === "create" &&
          event.data?.callId === incomingCallRef.current.callId &&
          event.data?.type === "call_ended") {
        console.log("[IncomingCallHandler] 📵 Call ended signal received for:", incomingCallRef.current.callId);
        setIncomingCall(null);
      }
    });

    // Cleanup — only runs when user changes (login/logout) or component unmounts
    return () => {
      if (activeInstanceId === myId) {
        activeInstanceId = null;
        console.log("[IncomingCallHandler] ❌ Unmounting — global call listener STOPPED at", new Date().toISOString());
      }
      unsubNotifications();
      unsubSignaling();
      window.removeEventListener("popstate", checkUrlParams);
      window.removeEventListener("incoming-call", handleWindowEvent);
      navigator.serviceWorker?.removeEventListener("message", handleSWMessage);
    };
  }, [user]);

  if (!incomingCall) return null;

  return (
    <RealtimeVoiceCall
      targetUser={incomingCall.caller}
      incomingCallId={incomingCall.callId}
      onClose={() => {
        console.log("[IncomingCallHandler] Call modal closed by user");
        setIncomingCall(null);
      }}
    />
  );
}