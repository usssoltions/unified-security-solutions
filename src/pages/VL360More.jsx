import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVL360 } from "@/hooks/useVL360";
import VL360Shell from "@/components/vl360/VL360Shell";
import TelegramConnection from "@/components/telegram/TelegramConnection";
import DestinationOutcome from "@/components/vl360/DestinationOutcome";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, Users, Activity, HelpCircle, Smartphone } from "lucide-react";
import { openDestination, vl360Invoke } from "@/lib/vl360Api";

/**
 * VL360More — setup, help and communication records (kept under More on the
 * guard home). Statuses are kept SEPARATE and honest:
 *   - Notifications Connected  — saved bot enrollment (shared profile flow).
 *   - Contact Link Configured  — individual destination saved/confirmed.
 *   - Site Group Setup Confirmed — manually confirmed onboarding.
 * None of these is a live-availability, confirmed-call-access or
 * message-delivery claim. History screens inside Telegram/Wave Lite are NOT
 * openable by USS — truthful labels and guidance are used instead.
 */
export default function VL360More() {
  const ctx = useVL360();
  const [outcome, setOutcome] = useState(null);
  const data = ctx.data || {};
  const profile = data.profile || {};
  const dutySiteId = data.duty?.site_id || null;

  const { data: commsData } = useQuery({
    queryKey: ["vl360_site_comms", dutySiteId],
    queryFn: async () => vl360Invoke({ action: "get_site_comms", site_id: dutySiteId }),
    enabled: !!dutySiteId,
  });

  const { data: activityData } = useQuery({
    queryKey: ["vl360_activity", "self"],
    queryFn: async () => vl360Invoke({ action: "activity_list" }),
  });

  const notificationsConnected = !!ctx.user?.telegram_connected;
  const contactConfigured = profile.contact_status === "configured" || profile.contact_status === "confirmed";
  const siteConfirmed = !!commsData?.comms?.group_setup_confirmed;

  const statusRow = (label, ok, note) => (
    <div className="flex items-start gap-2 bg-slate-900 border border-slate-800 rounded-xl p-3.5">
      {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /> : <Circle className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />}
      <div className="min-w-0">
        <p className="text-sm text-white font-medium">{label}</p>
        <p className="text-xs text-slate-500">{note}</p>
      </div>
    </div>
  );

  const openTeamComms = async (setOutcome) => {
    if (!dutySiteId) { setOutcome({ code: "missing_configuration", error: "Go On Duty first — site conversations are per site." }); return; }
    try {
      const d = await openDestination({ type: "site_group", site_id: dutySiteId });
      if (d?.code) setOutcome(d);
    } catch (e) { setOutcome({ code: "missing_configuration", error: e?.message || "Could not open." }); }
  };

  return (
    <VL360Shell ctx={ctx} title="More" subtitle="Setup, help and communication records">
      <div className="space-y-2">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Setup Status</p>
        {statusRow("Notifications Connected", notificationsConnected, notificationsConnected ? "Bot enrollment saved." : "Not connected yet — connect below.")}
        {statusRow("Contact Link Configured", contactConfigured, contactConfigured ? `Individual destination ${profile.contact_status}.` : "No individual destination saved yet — your administrator configures this under Personnel Setup.")}
        {statusRow("Site Group Setup Confirmed", siteConfirmed, siteConfirmed ? "Administrator confirmed onboarding." : "Administrator has not confirmed group onboarding yet.")}
        <p className="text-[11px] text-slate-600">These statuses are not live availability, confirmed call access or message-delivery status.</p>
      </div>

      <TelegramConnection user={ctx.user} />

      <div className="space-y-2">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Communication Records</p>
        <Button onClick={() => openTeamComms(setOutcome)} variant="outline" className="w-full justify-start border-slate-700 text-slate-200">
          <Users className="w-4 h-4 mr-2 text-sky-400" /> Open Team Communications
        </Button>
        <p className="text-[11px] text-slate-600">
          Telegram and Wave Lite keep their own histories inside their apps — USS cannot open those history screens. Check the app's own History/Calls tabs.
        </p>
        {outcome && <DestinationOutcome outcome={outcome} onDismiss={() => setOutcome(null)} />}
      </div>

      <div className="space-y-2">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide flex items-center gap-2"><Activity className="w-4 h-4 text-sky-400" /> USS Activity</p>
        {(activityData?.activity || []).slice(0, 20).map((a) => (
          <div key={a.id} className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5">
            <p className="text-xs text-slate-300">
              {a.destination_label || a.action.replace(/_/g, " ")}
              {a.site_name ? ` · ${a.site_name}` : ""}
            </p>
            <p className="text-[10px] text-slate-600">
              {new Date(a.created_date).toLocaleString()} · action initiated from USS (no call/delivery outcome recorded)
            </p>
          </div>
        ))}
        {(activityData?.activity || []).length === 0 && <p className="text-slate-500 text-xs">No activity recorded yet.</p>}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
        <p className="text-sm font-semibold text-white flex items-center gap-2"><HelpCircle className="w-4 h-4 text-sky-400" /> Help</p>
        <ul className="text-xs text-slate-400 space-y-1.5 list-disc list-inside">
          <li>Tap a Call/Message button — the exact configured conversation opens in Telegram. Tap Call, Video or type inside Telegram to connect.</li>
          <li>External calls use the Grandstream Wave Lite app with your organisation's SIP service — Wave Lite is a separate app, not embedded in USS.</li>
          <li>Shared device? Changing the USS user does not change the signed-in Telegram or Wave Lite account — check the account in each app before use.</li>
          <li>Missing a destination or off duty? The button explains what's needed — nothing is substituted silently.</li>
          <li>Internet-dependent calling does not replace radio communications under all conditions.</li>
        </ul>
        <p className="text-[11px] text-slate-600 flex items-center gap-1.5"><Smartphone className="w-3.5 h-3.5" /> Android phones/tablets supported; laptop use is responsive.</p>
      </div>
    </VL360Shell>
  );
}