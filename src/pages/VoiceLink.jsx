import React, { useEffect, useState } from "react";
import { Phone, PhoneCall, Radio, Users, ShieldCheck, ShieldX, RefreshCw } from "lucide-react";
import { voiceLinkApi, voicelinkDeviceId } from "@/lib/voiceLinkApi";
import VoiceLinkCallScreen from "@/components/voicelink/VoiceLinkCallScreen";
import VoiceLinkIncomingOverlay from "@/components/voicelink/VoiceLinkIncomingOverlay";

/**
 * USS VOICE LINK (pilot) — Phase 1 module page: reliable individual calling.
 * Contact list resolved server-side by the voiceLink gateway (on-duty
 * personnel at the caller's site + operators of the site's assigned control
 * rooms). The legacy calling implementation is untouched.
 */
export default function VoiceLink() {
  const [contacts, setContacts] = useState(null);
  const [pilotState, setPilotState] = useState("loading"); // loading | ok | not_pilot | not_entitled | not_available | error
  const [errorMessage, setErrorMessage] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [startingId, setStartingId] = useState(null);
  const [toast, setToast] = useState(null);

  const loadContacts = async () => {
    setContacts(null);
    try {
      const res = await voiceLinkApi.contacts();
      if (res && res.release_enabled === false) { setPilotState("not_available"); return; }
      if (res && res.pilot_ok === false) { setPilotState("not_pilot"); return; }
      if (res && res.entitled === false) { setPilotState("not_entitled"); return; }
      if (res && res.error === "no_site") {
        setPilotState("error");
        setErrorMessage("No site assignment resolved for your account — contact your administrator.");
        return;
      }
      setContacts(res);
      setPilotState("ok");
    } catch (e) {
      setPilotState("error");
      setErrorMessage(e?.message || "Could not load contacts");
    }
  };

  useEffect(() => { loadContacts(); }, []);

  const startCall = async (targetUserId) => {
    if (activeCall || startingId) return;
    setStartingId(targetUserId);
    try {
      const res = await voiceLinkApi.initiate(targetUserId);
      if (res?.error) { setToast(res.error); setTimeout(() => setToast(null), 4000); }
      else if (res?.call) {
        setActiveCall({ callId: res.call.call_id, role: "caller", peerName: res.call.callee_name, iceServers: res.ice_servers || [] });
      }
    } catch (e) {
      setToast(e?.response?.data?.error || e?.message || "Could not start the call");
      setTimeout(() => setToast(null), 4000);
    } finally {
      setStartingId(null);
    }
  };

  if (pilotState === "loading") {
    return (
      <div className="p-6 flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (pilotState === "not_available") {
    return (
      <div className="p-6 min-h-screen flex items-center justify-center">
        <div className="text-center max-w-sm bg-slate-900/60 border border-slate-700 rounded-2xl p-6">
          <ShieldX className="w-10 h-10 text-slate-500 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-white mb-2">USS Voice Link</h1>
          <p className="text-sm text-slate-400">USS Voice Link is not released yet. This module stays switched off until it is formally released by the platform.</p>
        </div>
      </div>
    );
  }

  if (pilotState === "not_pilot") {
    return (
      <div className="p-6 min-h-screen flex items-center justify-center">
        <div className="text-center max-w-sm bg-slate-900/60 border border-slate-700 rounded-2xl p-6">
          <ShieldX className="w-10 h-10 text-slate-500 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-white mb-2">USS Voice Link</h1>
          <p className="text-sm text-slate-400">The Voice Link pilot is not enabled for this account. A platform administrator can enrol selected test accounts.</p>
        </div>
      </div>
    );
  }

  if (pilotState === "not_entitled") {
    return (
      <div className="p-6 min-h-screen flex items-center justify-center">
        <div className="text-center max-w-sm bg-slate-900/60 border border-slate-700 rounded-2xl p-6">
          <ShieldX className="w-10 h-10 text-rose-400 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-white mb-2">USS Voice Link</h1>
          <p className="text-sm text-slate-400">The Calling module is not licensed for this account's organisation.</p>
        </div>
      </div>
    );
  }

  if (pilotState === "error") {
    return (
      <div className="p-6 min-h-screen flex items-center justify-center">
        <div className="text-center max-w-sm bg-slate-900/60 border border-slate-700 rounded-2xl p-6">
          <ShieldX className="w-10 h-10 text-amber-400 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-white mb-2">USS Voice Link</h1>
          <p className="text-sm text-slate-400 mb-4">{errorMessage || "Could not load your contacts."}</p>
          <button onClick={loadContacts} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-sm active:scale-95 transition inline-flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      </div>
    );
  }

  const availabilityBadge = (a) => a === "on_duty"
    ? <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-semibold">On duty</span>
    : <span className="px-2 py-0.5 rounded-full bg-slate-700/50 border border-slate-600 text-slate-400 text-[10px] font-semibold">Scheduled</span>;

  const PersonRow = ({ p }) => (
    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-900/60 border border-slate-700/60 rounded-2xl">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white truncate">{p.name}</p>
        <div className="flex items-center gap-2 mt-1">
          {availabilityBadge(p.availability)}
        </div>
      </div>
      <button
        onClick={() => startCall(p.user_id)}
        disabled={!!(activeCall || startingId)}
        className="shrink-0 h-10 px-4 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 text-sm font-semibold flex items-center gap-2 active:scale-95 transition disabled:opacity-40"
      >
        {startingId === p.user_id ? <PhoneCall className="w-4 h-4 animate-pulse" /> : <Phone className="w-4 h-4" />}
        Call
      </button>
    </div>
  );

  return (
    <div className="p-4 pb-24 md:p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
          <Phone className="w-5 h-5 text-emerald-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-white leading-tight">USS Voice Link</h1>
          <p className="text-xs text-slate-400 truncate">
            Pilot · {contacts?.site_name || "Assigned sites"}{contacts?.multiple_rooms ? " · multiple control rooms" : ""}
          </p>
        </div>
      </div>

      {toast && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-sm">{toast}</div>
      )}

      {/* GUARD VIEW — on-duty personnel at my site */}
      {contacts?.view === "guard" && (
        <>
          <div className="flex items-center gap-2 mb-2 px-1">
            <Users className="w-4 h-4 text-slate-500" />
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">On-duty personnel · {contacts.site_name}</h2>
          </div>
          <div className="space-y-2 mb-6">
            {(contacts.colleagues || []).filter((c) => c.user_id !== undefined).map((p) => <PersonRow key={p.user_id} p={p} />)}
            {!(contacts.colleagues || []).length && (
              <p className="text-sm text-slate-500 px-1">No personnel currently signed in at this site.</p>
            )}
          </div>

          <div className="flex items-center gap-2 mb-2 px-1">
            <Radio className="w-4 h-4 text-slate-500" />
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Control room operators</h2>
          </div>
          <div className="space-y-4">
            {(contacts.operators || []).length ? (
              Object.entries(
                (contacts.operators || []).reduce((acc, op) => {
                  (acc[op.control_room_name || "Control Room"] = acc[op.control_room_name || "Control Room"] || []).push(op);
                  return acc;
                }, {})
              ).map(([roomName, ops]) => (
                <div key={roomName}>
                  <p className="text-xs text-slate-500 mb-2 px-1">{roomName}{contacts.multiple_rooms ? " (explicit destination)" : ""}</p>
                  <div className="space-y-2">
                    {ops.map((op) => <PersonRow key={op.user_id} p={op} />)}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500 px-1">No control room is assigned to this site.</p>
            )}
          </div>
        </>
      )}

      {/* OPERATOR VIEW — assigned sites grouped */}
      {contacts?.view === "operator" && (
        <>
          {contacts.sites.map((s) => (
            <div key={s.site_id} className="mb-6">
              <div className="flex items-center gap-2 mb-2 px-1">
                <Users className="w-4 h-4 text-slate-500" />
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider truncate">
                  {s.site_name || "Site"} <span className="text-slate-600 normal-case">· {s.control_room_name}</span>
                </h2>
              </div>
              <div className="space-y-2">
                {(s.colleagues || []).map((p) => <PersonRow key={p.user_id} p={p} />)}
                {!(s.colleagues || []).length && <p className="text-sm text-slate-500 px-1">No personnel currently signed in at this site.</p>}
              </div>
            </div>
          ))}
          {!(contacts.sites || []).length && (
            <div className="text-center py-10">
              <ShieldCheck className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-sm text-slate-400">No control rooms are assigned to you yet.</p>
            </div>
          )}
        </>
      )}

      {/* Incoming (web pilot devices) — Android uses the native incoming screen */}
      <VoiceLinkIncomingOverlay
        onAccepted={(call) => setActiveCall(call)}
      />

      {activeCall && (
        <VoiceLinkCallScreen
          callId={activeCall.callId}
          role={activeCall.role}
          peerName={activeCall.peerName}
          iceServers={activeCall.iceServers}
          onCancel={() => voiceLinkApi.cancel(activeCall.callId).catch(() => {}).finally(() => setActiveCall(null))}
          onEnded={() => setActiveCall(null)}
        />
      )}
    </div>
  );
}