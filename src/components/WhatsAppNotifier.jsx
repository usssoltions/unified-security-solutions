/**
 * WhatsAppNotifier
 *
 * Shows a modal after form submission.
 * - "Send All at Once": builds ONE combined wa.me link opening a group chat
 *   or the first contact with all numbers listed in the message body.
 *   Uses a sequential approach: opens contacts one-by-one with a small
 *   delay, respecting browser popup policy (user-gesture chain).
 * - Individual send buttons for each contact.
 *
 * Props:
 *  message  – pre-composed string (use composers from lib/whatsapp.js)
 *  onDone   – callback when user dismisses
 *  title    – optional header text
 */
import React, { useState, useEffect, useRef } from "react";
import { buildAdminLinks } from "@/lib/whatsapp";
import { Button } from "@/components/ui/button";
import { CheckCircle2, MessageCircle, X, Send } from "lucide-react";

export default function WhatsAppNotifier({ message, onDone, title = "Send WhatsApp Alerts" }) {
  const [links, setLinks] = useState([]);
  const [sent, setSent] = useState({});
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const sendIndexRef = useRef(0);

  // Load contacts from DB on mount
  useEffect(() => {
    // Start with cached contacts immediately
    const cached = buildAdminLinks(message);
    if (cached.length > 0) setLinks(cached);

    // Then refresh from DB
    import("@/lib/whatsapp").then(({ loadWhatsAppContacts, buildWhatsAppLink }) => {
      loadWhatsAppContacts().then(contacts => {
        const fresh = contacts
          .filter(c => c.number)
          .map(c => ({
            name: c.name,
            number: c.number,
            link: buildWhatsAppLink(c.number, message),
          }));
        if (fresh.length > 0) setLinks(fresh);
      });
    });
  }, [message]);

  const handleSendOne = (link, number) => {
    window.open(link, "_blank");
    setSent(prev => ({ ...prev, [number]: true }));
  };

  /**
   * Sequential send — opens each WhatsApp link one at a time.
   * The first open happens inside the click handler (trusted gesture).
   * Subsequent opens use window.open with a small delay to stay
   * within the browser's popup allowance and give the user time to
   * send before the next one opens.
   */
  const handleSendAll = async () => {
    if (links.length === 0 || sending) return;
    setSending(true);
    sendIndexRef.current = 0;

    const openNext = () => {
      const idx = sendIndexRef.current;
      if (idx >= links.length) {
        setSending(false);
        setSendProgress(0);
        return;
      }
      const l = links[idx];
      window.open(l.link, "_blank");
      setSent(prev => ({ ...prev, [l.number]: true }));
      sendIndexRef.current = idx + 1;
      setSendProgress(idx + 1);

      // Open next after 1.5s — gives user time to switch to WA and send
      if (idx + 1 < links.length) {
        setTimeout(openNext, 1500);
      } else {
        setSending(false);
        setSendProgress(0);
      }
    };

    openNext();
  };

  if (links.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-[200] p-4">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-bold text-lg">{title}</h2>
            <button onClick={onDone} className="text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-slate-400 text-sm mb-4">
            No WhatsApp contacts configured. Add admin numbers in{" "}
            <strong className="text-sky-400">Configuration → WhatsApp Contacts</strong>.
          </p>
          <Button onClick={onDone} className="w-full bg-slate-700 hover:bg-slate-600">
            Close
          </Button>
        </div>
      </div>
    );
  }

  const allSent = links.every(l => sent[l.number]);
  const sentCount = Object.values(sent).filter(Boolean).length;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-[200] p-4">
      <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-5 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center">
              <MessageCircle className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-white font-bold">{title}</h2>
          </div>
          <button onClick={onDone} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {sending ? (
          <div className="mb-3 px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
            <p className="text-emerald-300 text-sm font-medium">
              Opening WhatsApp for contact {sendProgress} of {links.length}…
            </p>
            <p className="text-slate-400 text-xs mt-0.5">Send the message in WhatsApp, then the next will open automatically.</p>
          </div>
        ) : (
          <p className="text-slate-400 text-xs mb-3">
            Tap <strong className="text-white">Send All</strong> to open each contact in WhatsApp one by one, or tap individually.
          </p>
        )}

        <div className="space-y-2 mb-4 max-h-56 overflow-y-auto">
          {links.map(l => (
            <button
              key={l.number}
              onClick={() => handleSendOne(l.link, l.number)}
              disabled={sending}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all text-left ${
                sent[l.number]
                  ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
                  : "bg-slate-800 border-slate-700 text-white hover:border-emerald-500/50"
              } disabled:opacity-60`}
            >
              <div>
                <p className="font-semibold text-sm">{l.name}</p>
                <p className="text-xs text-slate-400">{l.number}</p>
              </div>
              {sent[l.number] ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              ) : (
                <MessageCircle className="w-5 h-5 text-emerald-400 shrink-0" />
              )}
            </button>
          ))}
        </div>

        {sentCount > 0 && sentCount < links.length && !sending && (
          <p className="text-xs text-slate-400 mb-3 text-center">
            {sentCount} of {links.length} sent
          </p>
        )}

        <div className="flex gap-3">
          <Button
            onClick={handleSendAll}
            disabled={sending || allSent}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-sm disabled:opacity-60"
          >
            <Send className="w-4 h-4 mr-1" />
            {sending ? `Sending ${sendProgress}/${links.length}…` : allSent ? "All Sent ✓" : "Send All"}
          </Button>
          <Button
            onClick={onDone}
            variant="outline"
            className={`flex-1 border-slate-600 text-sm ${allSent ? "text-emerald-400 border-emerald-500/40" : "text-slate-300"}`}
          >
            {allSent ? "✓ Done" : "Skip"}
          </Button>
        </div>
      </div>
    </div>
  );
}