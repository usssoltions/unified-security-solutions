import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import RealtimeVoiceCall from "@/components/voice/RealtimeVoiceCall";

export default function IncomingCallHandler({ user }) {
  const [incomingCall, setIncomingCall] = useState(null);

  useEffect(() => {
    if (!user) return;

    // Check URL parameters for incoming call from notification
    const urlParams = new URLSearchParams(window.location.search);
    const callId = urlParams.get('call_id');
    const callerName = urlParams.get('caller_name');
    
    if (callId && callerName) {
      console.log('📞 Incoming call from notification:', callId, callerName);
      setIncomingCall({
        callId: callId,
        caller: {
          full_name: callerName,
          badge_number: callerName
        }
      });
      
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Poll for incoming call notifications every 2 seconds
    const pollInterval = setInterval(async () => {
      try {
        const notifications = await base44.entities.Notification.filter({
          recipient_id: user.id,
          type: 'call_incoming',
          read: false
        });

        if (notifications.length > 0) {
          const callNotification = notifications[0];
          console.log('📞 Incoming call detected:', callNotification);
          
          setIncomingCall({
            callId: callNotification.related_id,
            caller: {
              full_name: callNotification.message.replace(' is calling you', '').replace(' is calling (Group Call)', ''),
              badge_number: 'Incoming'
            }
          });
          
          // Mark as read
          await base44.entities.Notification.update(callNotification.id, { read: true });
        }
      } catch (error) {
        // Silent fail - non-critical background polling
      }
    }, 2000);

    return () => clearInterval(pollInterval);
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