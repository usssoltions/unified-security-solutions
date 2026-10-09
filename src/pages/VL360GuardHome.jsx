import React, { useState } from "react";
import { useVL360 } from "@/hooks/useVL360";
import VL360Shell from "@/components/vl360/VL360Shell";
import DutyControls from "@/components/vl360/DutyControls";
import DestinationOutcome from "@/components/vl360/DestinationOutcome";
import MessagesSheet from "@/components/vl360/MessagesSheet";
import { Button } from "@/components/ui/button";
import { Loader2, Radio, Users, MessagesSquare, Siren, MoreHorizontal, PhoneCall } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { openDestination } from "@/lib/vl360Api";

/**
 * VL360GuardHome — VoiceLink 360 guard home screen (mobile-first, large
 * controls). Every Call/Message button opens the EXACT configured Telegram
 * conversation; the user completes the action inside Telegram. USS never
 * simulates ringing/connected states and never claims emergency delivery.
 * "Dial Telephone Number" appears only for users with the per-user External
 * Calling permission.
 */
export default function VL360GuardHome() {
  const ctx = useVL360();
  const navigate = useNavigate();
  const [outcome, setOutcome] = useState(null);
  const [busy, setBusy] = useState(null);
  const [messagesOpen, setMessagesOpen] = useState(false);

  const data = ctx.data || {};
  const profile = data.profile || {};
  const duty = data.duty || null;
  const currentSiteId = duty?.site_id || null;
  const noSite = !currentSiteId;
  const externalCalling = !!profile.external_calling_enabled;

  const open = async (type, key) => {
    setBusy(key); setOutcome(null);
    try {
      const d = await openDestination({ type, site_id: currentSiteId });
      if (d?.code) setOutcome(d);
    } catch (e) {
      setOutcome({ code: "missing_configuration", error: e?.message || "Could not open the conversation." });
    } finally { setBusy(null); }
  };

  const callControlRoom = () => open("control_room", "control_room");

  return (
    <VL360Shell ctx={ctx} title="VoiceLink 360" subtitle={data.role_label || "Communications"}>
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
        <p className="text-white font-semibold text-base">{ctx.user?.full_name || ctx.user?.email}</p>
        <p className="text-sm text-slate-400">
          Personnel ID: <span className="text-slate-300">{profile.personnel_id || "Not recorded"}</span>
        </p>
        <p className="text-sm text-slate-400">Role: <span className="text-slate-300">{data.role_label}</span></p>
        <p className="text-sm text-slate-400">Current site: <span className="text-slate-300">{duty?.site_name || "Not on duty"}</span></p>
        <p className="text-sm text-slate-400">Duty status: <span className={duty ? "text-emerald-400" : "text-slate-300"}>{duty ? "On Duty" : "Off Duty"}</span></p>
      </div>

      <DutyControls ctx={ctx} />

      {outcome && <DestinationOutcome outcome={outcome} onCallControlRoom={callControlRoom} onDismiss={() => setOutcome(null)} />}

      <p className="text-xs text-slate-500 text-center">Opens the conversation. Tap Call to connect.</p>

      <div className="space-y-3">
        {[
          { key: "control_room", label: "Call Control Room", icon: Radio, disabled: noSite },
          { key: "site_group", label: "Call Site Group", icon: Users, disabled: noSite },
          { key: "emergency_group", label: "Call Emergency Team", icon: Siren, disabled: noSite },
        ].map(({ key, label, icon: Icon, disabled }) => (
          <Button key={key} onClick={() => open(key, key)} disabled={disabled || !!busy}
            className="w-full h-14 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-base font-semibold active:scale-[0.98] transition-transform">
            {busy === key ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Icon className="w-5 h-5 mr-2 text-sky-400" />}
            {label}
          </Button>
        ))}

        <Button onClick={() => navigate("/VL360Colleagues")}
          className="w-full h-14 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-base font-semibold active:scale-[0.98] transition-transform">
          <Users className="w-5 h-5 mr-2 text-sky-400" /> Call a Colleague
        </Button>

        <Button onClick={() => setMessagesOpen(true)}
          className="w-full h-14 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-base font-semibold active:scale-[0.98] transition-transform">
          <MessagesSquare className="w-5 h-5 mr-2 text-sky-400" /> Messages
        </Button>

        {externalCalling && (
          <Button onClick={() => navigate("/VL360Dialler")}
            className="w-full h-14 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-base font-semibold active:scale-[0.98] transition-transform">
            <PhoneCall className="w-5 h-5 mr-2 text-sky-400" /> Dial Telephone Number
          </Button>
        )}

        <Button onClick={() => navigate("/VL360More")} variant="outline"
          className="w-full h-12 border-slate-700 text-slate-300 active:scale-[0.98]">
          <MoreHorizontal className="w-5 h-5 mr-2" /> More
        </Button>
      </div>

      <MessagesSheet open={messagesOpen} onClose={() => setMessagesOpen(false)} currentSiteId={currentSiteId} />
    </VL360Shell>
  );
}