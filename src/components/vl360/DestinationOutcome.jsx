import React from "react";
import { AlertTriangle, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * DestinationOutcome — honest failure/explanation banners for a destination
 * resolution that could NOT be handed off. Never substitutes another group
 * silently: a missing emergency group is explained and the guard is offered
 * Call Control Room explicitly.
 */
export default function DestinationOutcome({ outcome, onCallControlRoom, onDismiss }) {
  if (!outcome) return null;
  if (outcome.code === "missing_emergency") {
    return (
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-2">
        <div className="flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-200">
            No emergency-response group is configured for this site yet. Your administrator must map it in Site Communication Setup.
          </p>
        </div>
        {outcome.control_room_available && onCallControlRoom && (
          <Button size="sm" onClick={onCallControlRoom} className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold active:scale-95">
            <PhoneCall className="w-4 h-4 mr-2" /> Call Control Room
          </Button>
        )}
        {onDismiss && (
          <button onClick={onDismiss} className="text-xs text-amber-300/70 underline">Dismiss</button>
        )}
      </div>
    );
  }
  if (outcome.code === "missing_configuration" || outcome.code === "malformed_destination") {
    return (
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-200">
          {outcome.error || "This destination is not configured yet. Ask your administrator to complete the Site Communication Setup."}
        </p>
        {onDismiss && (
          <button onClick={onDismiss} className="text-xs text-amber-300/70 underline shrink-0 self-start">Dismiss</button>
        )}
      </div>
    );
  }
  return null;
}