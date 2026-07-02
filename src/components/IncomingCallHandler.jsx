import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import RealtimeVoiceCall from "@/components/voice/RealtimeVoiceCall";

/**
 * Global incoming-call handler — mounted once in Layout, active on EVERY page
 * after login. Polls for voice_call notifications, listens for window/SW events
 * from push notifications, and checks URL params from OneSignal click-throughs.
 * Cleans up only when the user logs out (Layout unmounts).
 */
export default function IncomingCallHandler({ user }) {
  const [incomingCall, setIncomingCall] = useState(null);
  const incomingCallRef = useRef(null);

  // Keep ref in sync so polling intervals can read latest without resetting
  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  useEffect(() => {
    if (!user) return;

    const triggerIncomingCall = (callData) => {
      if (incomingCallRef.current) return; // already showing a call
      setIncomingCall(callData);
    };

    // ── 1. URL params (push notification click-through) ──────────
    const checkUrlParams = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const callId = urlParams.get("call_id") || urlParams.get("incoming_call");
      const callerName = urlParams.get("caller_name");

      if (callId && callerName) {
        triggerIncomingCall({
          callId,
          caller: { full_name: decodeURIComponent(callerName), badge_number: "Incoming" },
        });
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (callId) {
        // call_id present but no name — look it up from notifications
        base44.entities.Notification
          .filter({ recipient_id: user.id, related_id: callId, related_entity: "voice_call", read: false })
          .then((notifs) => {
            if (notifs.length > 0) {
              const n = notifs[0];
              const name = n.message.replace(" is calling you", "").replace(" is calling (Group Call)", "").replace(". Tap to answer.", "");
              triggerIncomingCall({ callId, caller: { full_name: name, badge_number: "Incoming" } });
            }
          })
          .catch(() => {});
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    };

    checkUrlParams();
    window.addEventListener("popstate", checkUrlParams);

    // ── 2. Window events (from OneSignal SDK / service worker) ───
    const handleWindowEvent = (event) => {
      const { callId, callerName, autoAnswer } = event.detail || {};
      if (callId) {
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
          triggerIncomingCall({
            callId,
            caller: { full_name: callerName || "Incoming", badge_number: "Incoming" },
          });
        }
      }
    };
    navigator.serviceWorker?.addEventListener("message", handleSWMessage);

    // ── 4. Poll for voice_call notifications (foreground) ────────
    // This is the KEY fix: filter by related_entity='voice_call' to match
    // what rtcSignaling/sendCallNotification actually create.
    const pollInterval = setInterval(async () => {
      if (incomingCallRef.current) return; // skip while call active
      try {
        const notifications = await base44.entities.Notification.filter({
          recipient_id: user.id,
          related_entity: "voice_call",
          read: false,
        });

        if (notifications.length > 0) {
          const n = notifications[0];
          const callerName = n.message
            .replace(" is calling you", "")
            .replace(" is calling (Group Call)", "")
            .replace(". Tap to answer.", "");
          triggerIncomingCall({
            callId: n.related_id,
            caller: { full_name: callerName || "Incoming", badge_number: "Incoming" },
          });
          await base44.entities.Notification.update(n.id, { read: true }).catch(() => {});
        }
      } catch (_) {}
    }, 2000);

    // ── 5. Poll for call-ended signals while call is active ──────
    const callEndPoll = setInterval(async () => {
      if (!incomingCallRef.current) return;
      try {
        const { data } = await base44.functions.invoke("rtcSignaling", { action: "poll_messages" });
        if (data?.messages) {
          const endMsg = data.messages.find(
            (m) => m.callId === incomingCallRef.current.callId && m.type === "call_ended"
          );
          if (endMsg) {
            setIncomingCall(null);
          }
        }
      } catch (_) {}
    }, 2000);

    return () => {
      clearInterval(pollInterval);
      clearInterval(callEndPoll);
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
      onClose={() => setIncomingCall(null)}
    />
  );
}