import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVL360 } from "@/hooks/useVL360";
import VL360Shell from "@/components/vl360/VL360Shell";
import DestinationOutcome from "@/components/vl360/DestinationOutcome";
import ColleagueListPanel from "@/components/vl360/ColleagueListPanel";
import { Button } from "@/components/ui/button";
import { Loader2, Users, MessagesSquare, Siren, Megaphone, Video, User } from "lucide-react";
import { openDestination, vl360Invoke, vl360Key } from "@/lib/vl360Api";

/**
 * VL360Console — controller / supervisor workspace. Controllers see only
 * their allocated sites (server-enforced); supervisors and response officers
 * see their assigned operational scope. Site selection determines the
 * destination. One action opens ONE predefined Telegram group — nothing is
 * merged, assembled or auto-called, and opening a group is never presented
 * as everyone ringing.
 */
export default function VL360Console() {
  const ctx = useVL360();
  const data = ctx.data || {};
  const sites = data.sites || [];
  const [siteId, setSiteId] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [busy, setBusy] = useState(null);
  const wideAllowed = !!data.wide_group_allowed;

  const effectiveSiteId = siteId || (sites.length === 1 ? sites[0].id : null);
  const { data: onDutyData, isLoading: onDutyLoading } = useQuery({
    queryKey: vl360Key(["on_duty", effectiveSiteId || "all"]),
    queryFn: async () => vl360Invoke({ action: "list_on_duty", site_id: effectiveSiteId || undefined }),
    enabled: !!effectiveSiteId || sites.length > 0,
    staleTime: 30 * 1000,
  });
  const onDuty = onDutyData?.on_duty || [];

  const open = async (type, key) => {
    if (!effectiveSiteId) { setOutcome({ code: "missing_configuration", error: "Select a site first." }); return; }
    setBusy(key); setOutcome(null);
    try {
      const d = await openDestination({ type, site_id: effectiveSiteId });
      if (d?.code) setOutcome(d);
    } catch (e) {
      setOutcome({ code: "missing_configuration", error: e?.message || "Could not open the conversation." });
    } finally { setBusy(null); }
  };

  if (sites.length === 0) {
    return (
      <VL360Shell ctx={ctx} title="VL360 Workspace" subtitle={data.role_label}>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center space-y-2">
          <p className="text-slate-300 text-sm font-medium">No sites allocated to you yet.</p>
          <p className="text-slate-500 text-xs">Your administrator assigns sites under Controller Assignments (controllers) or Personnel Setup.</p>
        </div>
      </VL360Shell>
    );
  }

  const buttons = [
    { key: "site_group", label: "Call Site Group", icon: Users, show: true },
    { key: "site_group_msg", label: "Message Site Group", icon: MessagesSquare, show: true },
    { key: "emergency_group", label: "Call Emergency Team", icon: Siren, show: true },
    { key: "wide_group", label: "Call All Personnel", icon: Megaphone, show: wideAllowed },
    { key: "wide_group_msg", label: "Message All Personnel", icon: MessagesSquare, show: wideAllowed },
    { key: "video_briefing", label: "Video Briefing", icon: Video, show: wideAllowed },
  ].filter((b) => b.show);

  return (
    <VL360Shell ctx={ctx} title="VL360 Workspace" subtitle={data.role_label}>
      <div className="space-y-2">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Assigned Sites</p>
        {sites.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {sites.map((s) => (
              <button key={s.id} onClick={() => setSiteId(s.id)}
                className={`px-3 py-2 rounded-lg text-sm font-medium border active:scale-95 transition-transform ${effectiveSiteId === s.id ? "bg-sky-500/20 border-sky-500/50 text-sky-300" : "bg-slate-900 border-slate-700 text-slate-300"}`}>
                {s.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-white text-sm font-medium bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">{sites[0]?.name}</p>
        )}
      </div>

      {outcome && <DestinationOutcome outcome={outcome} onCallControlRoom={() => open("control_room", "control_room")} onDismiss={() => setOutcome(null)} />}

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
        <p className="text-sm font-semibold text-white flex items-center gap-2"><Users className="w-4 h-4 text-sky-400" /> Personnel on Duty</p>
        {onDutyLoading ? (
          <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
        ) : onDuty.length === 0 ? (
          <p className="text-slate-500 text-xs">No personnel on duty at {effectiveSiteId ? "this site" : "your sites"}.</p>
        ) : (
          <div className="space-y-1.5">
            {onDuty.map((d, i) => (
              <div key={`${d.user_id}:${i}`} className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
                <p className="text-sm text-slate-200 truncate">{d.user_name}</p>
                <p className="text-xs text-slate-500 shrink-0">{d.site_name} · since {new Date(d.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500 text-center">Opens the conversation. Tap Call or Video inside Telegram.</p>

      <div className="space-y-3">
        {buttons.map(({ key, label, icon: Icon }) => (
          <Button key={key} onClick={() => open(key.startsWith("wide_group_msg") ? "wide_group" : key.startsWith("site_group_msg") ? "site_group" : key, key)}
            disabled={!!busy}
            className="w-full h-13 py-3.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-sm font-semibold active:scale-[0.98] transition-transform">
            {busy === key ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Icon className={`w-5 h-5 mr-2 ${key.includes("emergency") ? "text-rose-400" : key.includes("wide") || key === "video_briefing" ? "text-amber-400" : "text-sky-400"}`} />}
            {label}
          </Button>
        ))}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-white flex items-center gap-2"><User className="w-4 h-4 text-sky-400" /> Individual Communication</p>
        <p className="text-xs text-slate-500">Voice Call, Video Call and Send Message open the person's configured conversation.</p>
        <ColleagueListPanel siteId={effectiveSiteId} />
      </div>

      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
        <p className="text-[11px] text-slate-500">
          One action opens one predefined Telegram group created and populated beforehand. Opening a group does not ring every member —
          group permissions and remaining call-start steps are covered during onboarding. Internet-dependent calling does not replace radio communications under all conditions.
        </p>
      </div>
    </VL360Shell>
  );
}