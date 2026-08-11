/**
 * StartOfShiftHistory
 * Lists every completed Start-of-Shift report (ShiftHandover records created
 * by StartOfShift.jsx). Guards see their own reports; admins/dispatchers see all.
 * Each report can be viewed in full (text + photos + videos + signature),
 * printed/saved to PDF, and shared via WhatsApp or email.
 */
import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  FileText, ChevronRight, Download, Mail, MessageCircle, X,
  MapPin, Clock, Shield, Search, Loader2
} from "lucide-react";

const fmtDateTime = (t) => (t ? new Date(t).toLocaleString("en-ZA") : "—");

export default function StartOfShiftHistory() {
  const [user, setUser] = useState(null);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["startOfShiftHistory", user?.id, user?.role_type],
    queryFn: async () => {
      if (!user) return [];
      const isGuard = user.role_type === "guard";
      const list = isGuard
        ? await base44.entities.ShiftHandover.filter({ outgoing_guard_id: user.id }, "-handover_time", 200)
        : await base44.entities.ShiftHandover.list("-handover_time", 200);
      return list || [];
    },
    enabled: !!user,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter(
      (r) =>
        (r.site_name || "").toLowerCase().includes(q) ||
        (r.outgoing_guard_name || "").toLowerCase().includes(q) ||
        (r.special_instructions || "").toLowerCase().includes(q)
    );
  }, [reports, search]);

  const buildSummary = (r) =>
    `*START OF SHIFT REPORT*\nOfficer: ${r.outgoing_guard_name || "—"}\nSite: ${r.site_name || "—"}\nDate: ${fmtDateTime(r.handover_time)}\n\n${r.special_instructions || ""}\n\nKey Activities:\n${(r.key_activities || []).map((a) => `• ${a}`).join("\n") || "None"}\n\nMedia: ${(r.media_attachments || []).length} attachment(s)`;

  const shareWhatsApp = (r) => {
    window.open(`https://wa.me/?text=${encodeURIComponent(buildSummary(r))}`, "_blank");
  };

  const shareEmail = (r) => {
    const subject = encodeURIComponent(`Start of Shift Report - ${r.outgoing_guard_name} @ ${r.site_name}`);
    const body = encodeURIComponent(buildSummary(r));
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const downloadPrint = (r) => {
    const photos = (r.media_attachments || []).filter((m) => m.type === "photo");
    const videos = (r.media_attachments || []).filter((m) => m.type === "video");
    const esc = (s) => (s || "").replace(/</g, "&lt;");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Start of Shift Report</title>
      <style>
        body{font-family:Arial,sans-serif;max-width:700px;margin:24px auto;color:#1e293b;padding:0 16px;}
        h1{color:#C41E3A;} h2{color:#0c4a6e;border-bottom:2px solid #C41E3A;padding-bottom:6px;margin-top:24px;}
        .meta{background:#f8f9fa;padding:16px;border-radius:8px;margin-bottom:16px;}
        .meta p{margin:4px 0;} pre{white-space:pre-wrap;background:#f8fafc;padding:12px;border-radius:8px;}
        img{max-width:100%;border-radius:8px;margin:8px 0;border:1px solid #e2e8f0;}
        .sig{max-width:300px;border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#fff;}
        .foot{margin-top:24px;color:#94a3b8;font-size:12px;text-align:center;}
      </style></head><body>
      <h1>START OF SHIFT REPORT</h1>
      <div class="meta">
        <p><strong>Officer:</strong> ${esc(r.outgoing_guard_name)}</p>
        <p><strong>Site:</strong> ${esc(r.site_name)}</p>
        <p><strong>Date:</strong> ${fmtDateTime(r.handover_time)}</p>
        <p><strong>Signed:</strong> ${r.signed_at ? fmtDateTime(r.signed_at) : "—"}</p>
      </div>
      <h2>Shift Information</h2>
      <pre>${esc(r.special_instructions)}</pre>
      <h2>Key Activities / Observations</h2>
      <ul>${(r.key_activities || []).map((a) => `<li>${esc(a)}</li>`).join("") || "<li>None</li>"}</ul>
      ${photos.length ? `<h2>Photos</h2>${photos.map((m) => `<img src="${m.url}"/>`).join("")}` : ""}
      ${videos.length ? `<h2>Videos</h2>${videos.map((m) => `<p><a href="${m.url}">${m.url}</a></p>`).join("")}` : ""}
      ${r.outgoing_guard_signature ? `<h2>Signature</h2><img class="sig" src="${r.outgoing_guard_signature}"/>` : ""}
      <div class="foot">Unified Security Solutions — Start of Shift Report</div>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) {
      alert("Allow pop-ups to download the report.");
      return;
    }
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 600);
  };

  if (!user || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-3xl mx-auto pb-20">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-12 h-12 bg-sky-500 rounded-xl flex items-center justify-center">
          <FileText className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Start of Shift History</h1>
          <p className="text-slate-400 text-sm">{filtered.length} report(s)</p>
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search site, officer, or notes..."
          className="pl-9 bg-slate-800 border-slate-700 text-white"
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="py-12 text-center">
            <FileText className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">No start-of-shift reports yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <Card
              key={r.id}
              className="bg-slate-800/50 border-slate-700 cursor-pointer hover:border-sky-500/40"
              onClick={() => setSelected(r)}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-700 rounded-lg flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-sky-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold truncate">{r.site_name || "Unknown site"}</p>
                  <p className="text-slate-400 text-xs truncate">
                    {r.outgoing_guard_name} • {fmtDateTime(r.handover_time)}
                  </p>
                  <div className="flex gap-2 mt-1">
                    {(r.media_attachments || []).length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {(r.media_attachments || []).length} media
                      </Badge>
                    )}
                    {r.outgoing_guard_signature && <Badge variant="secondary" className="text-xs">Signed</Badge>}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-slate-900 border-b border-slate-700 p-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-white font-bold text-lg">{selected.site_name || "Report"}</h2>
                <p className="text-slate-400 text-xs">
                  {selected.outgoing_guard_name} • {fmtDateTime(selected.handover_time)}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="w-9 h-9 bg-slate-800 rounded-lg flex items-center justify-center text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="bg-slate-800/50 rounded-lg p-3 space-y-1 text-sm">
                <div className="flex items-center gap-2 text-slate-300">
                  <Shield className="w-4 h-4 text-sky-400" /> Officer: <span className="text-white">{selected.outgoing_guard_name}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-300">
                  <MapPin className="w-4 h-4 text-emerald-400" /> Site: <span className="text-white">{selected.site_name}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-300">
                  <Clock className="w-4 h-4 text-amber-400" /> Signed: <span className="text-white">{selected.signed_at ? fmtDateTime(selected.signed_at) : "Not signed"}</span>
                </div>
              </div>

              <div>
                <h3 className="text-white font-semibold text-sm mb-2">Shift Information</h3>
                <pre className="text-slate-300 text-sm whitespace-pre-wrap bg-slate-800/50 p-3 rounded-lg">
                  {selected.special_instructions || "N/A"}
                </pre>
              </div>

              {(selected.key_activities || []).length > 0 && (
                <div>
                  <h3 className="text-white font-semibold text-sm mb-2">Key Activities / Observations</h3>
                  <ul className="space-y-1">
                    {selected.key_activities.map((a, i) => (
                      <li key={i} className="text-slate-300 text-sm flex gap-2">
                        <span className="text-sky-400">•</span>
                        {a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(selected.media_attachments || []).length > 0 && (
                <div>
                  <h3 className="text-white font-semibold text-sm mb-2">
                    Attachments ({(selected.media_attachments || []).length})
                  </h3>
                  <div className="space-y-3">
                    {(selected.media_attachments || []).filter((m) => m.type === "photo").map((m, i) => (
                      <img key={`p${i}`} src={m.url} alt="Photo" className="w-full rounded-lg border border-slate-700" />
                    ))}
                    {(selected.media_attachments || []).filter((m) => m.type === "video").map((m, i) => (
                      <video key={`v${i}`} src={m.url} controls className="w-full rounded-lg border border-slate-700" />
                    ))}
                  </div>
                </div>
              )}

              {selected.outgoing_guard_signature && (
                <div>
                  <h3 className="text-white font-semibold text-sm mb-2">Signature</h3>
                  <img src={selected.outgoing_guard_signature} alt="Signature" className="h-24 bg-white rounded-lg" />
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 pt-2">
                <Button onClick={() => downloadPrint(selected)} className="bg-sky-600 hover:bg-sky-700">
                  <Download className="w-4 h-4 mr-1" />Print
                </Button>
                <Button onClick={() => shareWhatsApp(selected)} className="bg-emerald-600 hover:bg-emerald-700">
                  <MessageCircle className="w-4 h-4 mr-1" />WhatsApp
                </Button>
                <Button onClick={() => shareEmail(selected)} variant="outline" className="border-slate-600 text-slate-200">
                  <Mail className="w-4 h-4 mr-1" />Email
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}