/**
 * WhatsAppNotifier
 * 
 * Drop this after any form submission to let the user fire WhatsApp deep-links
 * to all saved admin contacts in one tap (or individually).
 *
 * Props:
 *  message  – pre-composed string (use composers from lib/whatsapp.js)
 *  onDone   – callback when user dismisses
 *  title    – optional header text
 */
import React, { useState } from "react";
import { buildAdminLinks } from "@/lib/whatsapp";
import { Button } from "@/components/ui/button";
import { CheckCircle2, MessageCircle, X } from "lucide-react";

export default function WhatsAppNotifier({ message, onDone, title = "Send WhatsApp Alerts" }) {
  const links = buildAdminLinks(message);
  const [sent, setSent] = useState({});

  const handleSend = (link, number) => {
    window.open(link, "_blank");
    setSent((prev) => ({ ...prev, [number]: true }));
  };

  if (links.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-[100] p-4">
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

  const allSent = links.every((l) => sent[l.number]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-[100] p-4">
      <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-5 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-4">
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

        <p className="text-slate-400 text-xs mb-4">
          Tap each contact to open WhatsApp with the pre-filled message.
        </p>

        <div className="space-y-2 mb-5 max-h-60 overflow-y-auto">
          {links.map((l) => (
            <button
              key={l.number}
              onClick={() => handleSend(l.link, l.number)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all text-left ${
                sent[l.number]
                  ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
                  : "bg-slate-800 border-slate-700 text-white hover:border-emerald-500/50"
              }`}
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

        <div className="flex gap-3">
          <Button
            onClick={() => {
              links.forEach((l) => window.open(l.link, "_blank"));
              setSent(Object.fromEntries(links.map((l) => [l.number, true])));
            }}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-sm"
          >
            <MessageCircle className="w-4 h-4 mr-1" />
            Send All
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