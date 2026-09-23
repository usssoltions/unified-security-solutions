import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, Clock, HelpCircle, WifiOff, XCircle } from "lucide-react";

/**
 * StayAwakeChallengeState — SAFE FINAL STATE overlay for a deep-linked
 * Stay Awake challenge that is NOT active. The gateway (resolve_challenge)
 * has already validated guard ownership, status and deadline server-side;
 * this overlay renders only the returned state and can never open another
 * guard's prompt. Expiry and outcomes are governed by the server — no local
 * decision exists here.
 */
const STATE_CONTENT = {
  acknowledged: {
    icon: CheckCircle2, iconColor: "text-emerald-400", title: "Check Already Recorded",
    message: "This stay awake check was already acknowledged. No further action is needed.",
  },
  missed: {
    icon: XCircle, iconColor: "text-rose-400", title: "Check Missed",
    message: "This check expired without a response and has been recorded as missed. Your supervisor has been notified — contact your control room if this was unexpected.",
  },
  expired: {
    icon: Clock, iconColor: "text-rose-400", title: "Check Expired",
    message: "This check expired before it was answered — it has been recorded as missed and cannot be acknowledged. The cycle resets with the next scheduled check.",
  },
  cancelled: {
    icon: AlertCircle, iconColor: "text-amber-400", title: "Check Cancelled",
    message: "This check was cancelled because the shift ended, was clocked out or monitoring was disabled. No response is needed.",
  },
  not_found: {
    icon: HelpCircle, iconColor: "text-slate-300", title: "Check Not Available",
    message: "This check does not exist, was completed or does not belong to you. No response was recorded.",
  },
  connection_error: {
    icon: WifiOff, iconColor: "text-slate-300", title: "Couldn't Reach the Server",
    message: "The check could not be verified — no response was recorded. Reconnect and check My Shift; an active check will appear there.",
  },
};

export default function StayAwakeChallengeState({ resolution, onClose }) {
  const content = STATE_CONTENT[resolution?.state] || STATE_CONTENT.not_found;
  const Icon = content.icon;
  return (
    <div className="fixed inset-0 bg-slate-950/98 z-[9999] flex items-center justify-center p-4">
      <Card className="max-w-md w-full bg-slate-900 border-slate-700 border-2 shadow-2xl">
        <CardHeader className="text-center border-b border-slate-700/60">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-slate-800 flex items-center justify-center">
            <Icon className={`w-8 h-8 ${content.iconColor}`} />
          </div>
          <CardTitle className="text-xl text-white">{content.title}</CardTitle>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          <p className="text-slate-300 text-sm leading-relaxed text-center">{content.message}</p>
          <Button variant="outline" className="w-full h-12 font-semibold border-slate-600 text-slate-200" onClick={onClose}>
            Close
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}