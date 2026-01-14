import React, { useEffect, useRef } from "react";
import { AlertTriangle, AlertCircle, Radio } from "lucide-react";

export default function PTTAlertHandler({ messages, user, selectedChannel }) {
  const audioRef = useRef(null);
  const lastAlertIdRef = useRef(null);

  useEffect(() => {
    if (!messages || !selectedChannel) return;

    // Find the latest unheard system alert
    const latestAlert = messages
      .filter(m => 
        m.is_system_alert && 
        !m.listened_by.includes(user.id) &&
        (m.priority === "urgent" || m.priority === "emergency")
      )
      .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0];

    if (latestAlert && latestAlert.id !== lastAlertIdRef.current) {
      lastAlertIdRef.current = latestAlert.id;
      playAlertSound(latestAlert.priority);
    }
  }, [messages, user.id, selectedChannel]);

  const playAlertSound = (priority) => {
    if (!audioRef.current) return;

    // Play different frequencies based on priority
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);

    if (priority === "emergency") {
      // Emergency: rapid high-pitched beeps
      oscillator.frequency.value = 1200;
      gainNode.gain.setValueAtTime(0.3, context.currentTime);
      
      for (let i = 0; i < 5; i++) {
        gainNode.gain.setValueAtTime(0.3, context.currentTime + i * 0.2);
        gainNode.gain.setValueAtTime(0, context.currentTime + i * 0.2 + 0.1);
      }
      
      oscillator.start(context.currentTime);
      oscillator.stop(context.currentTime + 1);
    } else if (priority === "urgent") {
      // Urgent: double beep
      oscillator.frequency.value = 800;
      gainNode.gain.setValueAtTime(0.3, context.currentTime);
      gainNode.gain.setValueAtTime(0, context.currentTime + 0.15);
      gainNode.gain.setValueAtTime(0.3, context.currentTime + 0.25);
      gainNode.gain.setValueAtTime(0, context.currentTime + 0.4);
      
      oscillator.start(context.currentTime);
      oscillator.stop(context.currentTime + 0.5);
    }
  };

  return <audio ref={audioRef} style={{ display: 'none' }} />;
}

export function SystemAlertBadge({ priority }) {
  if (priority === "emergency") {
    return (
      <div className="flex items-center gap-1 px-2 py-1 bg-rose-500 rounded text-white text-xs font-bold animate-pulse">
        <AlertTriangle className="w-3 h-3" />
        EMERGENCY
      </div>
    );
  }

  if (priority === "urgent") {
    return (
      <div className="flex items-center gap-1 px-2 py-1 bg-orange-500 rounded text-white text-xs font-semibold">
        <AlertCircle className="w-3 h-3" />
        URGENT
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-sky-500 rounded text-white text-xs">
      <Radio className="w-3 h-3" />
      ALERT
    </div>
  );
}