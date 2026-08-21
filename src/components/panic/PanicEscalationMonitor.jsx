import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { managePanic } from "@/lib/panicService";

/**
 * Client-side Panic escalation monitor — runs in the admin/dispatcher
 * browser (same pattern as IncidentEscalationMonitor). Checks every 60s
 * for active (unacknowledged) panics older than the escalation threshold
 * and escalates them via the managePanic backend function.
 *
 * No polling on guard devices — this only runs for operational roles in
 * the Control Room, and uses a 60s interval (not 5s/10s rapid polling).
 */
const ESCALATION_THRESHOLD_SECONDS = 120; // 2 minutes

export default function PanicEscalationMonitor({ user }) {
  const [lastCheck, setLastCheck] = useState(Date.now());

  useEffect(() => {
    if (!user || !["admin", "dispatcher", "supervisor", "management"].includes(user.role_type)) {
      return;
    }

    const checkEscalations = async () => {
      try {
        const panics = await base44.entities.PanicAlert.filter({
          status: "active"
        });

        if (!Array.isArray(panics) || panics.length === 0) return;

        const now = Date.now();
        for (const panic of panics) {
          if (panic.escalated) continue;

          const activatedAt = new Date(panic.activated_at).getTime();
          const secondsSinceActivation = (now - activatedAt) / 1000;

          if (secondsSinceActivation >= ESCALATION_THRESHOLD_SECONDS) {
            // Escalate via backend function (handles notifications + activity log)
            await managePanic(panic.id, "escalate").catch((e) =>
              console.error("Panic escalation failed:", e)
            );
          }
        }
      } catch (error) {
        console.error("Panic escalation check failed:", error);
      }
    };

    // Check immediately on mount, then every 60 seconds
    checkEscalations();
    const interval = setInterval(checkEscalations, 60000);
    return () => clearInterval(interval);
  }, [user]);

  return null; // Invisible monitor component
}