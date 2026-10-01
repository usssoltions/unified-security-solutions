import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Paperclip, X, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { OB_OUTCOME_LABELS } from "./obMeta";

/**
 * OB submit dialog — records a SCHEDULED check (check present) or an
 * UNSCHEDULED entry (check null). Outcome is ALWAYS explicitly selected
 * (never pre-selected) — server-enforced. Evidence uploads go to PRIVATE
 * storage (UploadPrivateFile) and are submitted as file_uris.
 */
export default function OBSubmitDialog({ open, onClose, onSubmit, check, rooms, sites, saving }) {
  const isScheduled = !!check;
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [scope, setScope] = useState("overall");
  const [roomId, setRoomId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

  useEffect(() => {
    if (open) {
      setOutcome(""); setNotes(""); setAttachments([]); setUploadErr("");
      setTitle(""); setCategory(""); setScope("overall");
      setRoomId(rooms && rooms.length === 1 ? rooms[0].id : "");
      setSiteId("");
    }
  }, [open]);

  const evidenceRequired = isScheduled && (check.evidence_required === true);

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (attachments.length >= 5) { setUploadErr("Up to 5 attachments per entry"); return; }
    if (file.size > 10 * 1024 * 1024) { setUploadErr("Files up to 10 MB"); return; }
    setUploading(true); setUploadErr("");
    try {
      const res = await base44.integrations.Core.UploadPrivateFile({ file });
      if (res && res.file_uri) {
        setAttachments((a) => a.concat([{ name: file.name, file_uri: res.file_uri }]));
      } else throw new Error("Upload failed");
    } catch (err) {
      setUploadErr("Upload failed — please try again.");
    } finally { setUploading(false); }
  };

  const canSubmit = outcome !== "" && (!evidenceRequired || attachments.length > 0) &&
    (isScheduled || (title.trim().length > 0 && roomId));

  const submit = () => {
    const payload = isScheduled
      ? { action: "entry_submit", occurrence_id: check.id, outcome, notes, attachments }
      : { action: "entry_submit", outcome, notes, attachments, title: title.trim(),
          category: category.trim() || null, scope, control_room_id: roomId,
          site_id: scope === "site" ? siteId : null };
    onSubmit(payload);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isScheduled ? "Record Check" : "Unscheduled OB Entry"}</DialogTitle>
        </DialogHeader>

        {isScheduled && (
          <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-3 text-sm">
            <p className="font-semibold">{check.title}</p>
            <p className="text-slate-400 text-xs mt-0.5">
              {check.slot_label || ""} {check.site_name ? "· " + check.site_name : "· Overall"}
              {check.due_at ? " · due " + new Date(check.due_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }) : ""}
            </p>
            {check.instructions && <p className="text-slate-300 text-xs mt-2 whitespace-pre-wrap">{check.instructions}</p>}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <Label className="text-slate-300">Outcome</Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue placeholder="Select the outcome" /></SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700">
                {Object.entries(OB_OUTCOME_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!isScheduled && (
            <>
              <div>
                <Label className="text-slate-300">Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Perimeter fence walked and inspected"
                  className="bg-slate-800 border-slate-700" />
              </div>
              <div>
                <Label className="text-slate-300">Category (optional)</Label>
                <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Security, Fire"
                  className="bg-slate-800 border-slate-700" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-slate-300">Control room</Label>
                  <Select value={roomId} onValueChange={setRoomId}>
                    <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue placeholder="Select room" /></SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-700">
                      {(rooms || []).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-slate-300">Scope</Label>
                  <Select value={scope} onValueChange={setScope}>
                    <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-700">
                      <SelectItem value="overall">Overall (no site)</SelectItem>
                      <SelectItem value="site">Specific site</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {scope === "site" && (
                <div>
                  <Label className="text-slate-300">Site</Label>
                  <Select value={siteId} onValueChange={setSiteId}>
                    <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue placeholder="Select site" /></SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-700">
                      {(sites || []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}

          <div>
            <Label className="text-slate-300">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              placeholder={outcome === "issue_noted" || outcome === "action_taken" ? "Describe what was observed / done" : "Optional"}
              className="bg-slate-800 border-slate-700" />
          </div>

          <div>
            <Label className="text-slate-300">
              Evidence {evidenceRequired ? <span className="text-amber-400">(required for this check)</span> : <span className="text-slate-500">(optional)</span>}
            </Label>
            <div className="flex items-center gap-2 mt-1">
              <label className="flex items-center gap-2 px-3 h-9 rounded-lg bg-slate-800 border border-slate-700 text-sm cursor-pointer hover:bg-slate-700/60">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? "Uploading…" : "Add photo / document"}
                <input type="file" className="hidden" onChange={onFile}
                  accept="image/*,application/pdf,.csv,.txt,.xlsx,.docx" disabled={uploading} />
              </label>
            </div>
            {attachments.length > 0 && (
              <div className="mt-2 space-y-1">
                {attachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-slate-300 bg-slate-800/60 rounded-lg px-2 py-1.5">
                    <Paperclip className="w-3 h-3 shrink-0" />
                    <span className="truncate flex-1">{a.name}</span>
                    <button onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))} className="text-slate-500 hover:text-rose-400">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {uploadErr && <p className="text-xs text-rose-400 mt-1">{uploadErr}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-slate-600 text-slate-300">Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit || saving} className="min-w-[110px]">
            {saving ? "Saving…" : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}