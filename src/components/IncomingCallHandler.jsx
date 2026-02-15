import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import RealtimeVoiceCall from "@/components/voice/RealtimeVoiceCall";

export default function IncomingCallHandler({ user }) {
  const [incomingCall, setIncomingCall] = useState(null);

  useEffect(() => {
    if (!user) return;

    // Check URL parameters for incoming call from notification
    const checkUrlParams = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const callId = urlParams.get('call_id');
      const callerName = urlParams.get('caller_name');
      
      if (callId && callerName) {
        console.log('📞 Incoming call from notification:', callId, callerName);
        setIncomingCall({
          callId: callId,
          caller: {
            full_name: decodeURIComponent(callerName),
            badge_number: 'Incoming'
          }
        });
        
        // Clear URL parameters
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    };

    checkUrlParams();
    
    // Listen for URL changes (from notifications)
    window.addEventListener('popstate', checkUrlParams);

    // Poll for incoming call notifications every 1 second (faster for better responsiveness)
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
    }, 1000);

    // Poll for call end signals
    const callEndPollInterval = setInterval(async () => {
      if (incomingCall?.callId) {
        try {
          const { data } = await base44.functions.invoke('rtcSignaling', {
            action: 'poll_messages'
          });

          if (data?.messages) {
            const endMessage = data.messages.find(
              msg => msg.callId === incomingCall.callId && msg.type === 'call_ended'
            );
            
            if (endMessage) {
              console.log('Call ended by remote party');
              setIncomingCall(null);
            }
          }
        } catch (error) {
          // Silent fail
        }
      }
    }, 500);

    return () => {
      clearInterval(pollInterval);
      clearInterval(callEndPollInterval);
      window.removeEventListener('popstate', checkUrlParams);
    };
  }, [user, incomingCall]);

  if (!incomingCall) return null;

  return (
    <RealtimeVoiceCall
      targetUser={incomingCall.caller}
      incomingCallId={incomingCall.callId}
      onClose={() => setIncomingCall(null)}
    />
  );
}