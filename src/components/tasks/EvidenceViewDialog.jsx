import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExternalLink, FileText, ImageIcon } from "lucide-react";

/**
 * SIGN-OFF 1 EVIDENCE VIEWER — renders the stored evidence file INSIDE the
 * app document. Opening the raw file URL in a new browser tab renders blank
 * on the guard's Android WebView/app, so the image is displayed in-app and
 * the external link is kept only as a desktop fallback. Tenant scoping is
 * upstream: the evidence link is only ever rendered on a task card the
 * server-scoped gateway returned for the caller's own tenant.
 */
export default function EvidenceViewDialog({ open, url, onClose }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (open) setFailed(false);
  }, [open, url]);

  const isPdf = /\.pdf($|\?)/i.test(url || "");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">Sign-off evidence</DialogTitle>
        </DialogHeader>
        {url && !isPdf && !failed ? (
          <img src={url} alt="Task evidence"
            onError={() => setFailed(true)}
            className="w-full max-h-[70vh] object-contain rounded-lg bg-slate-950 border border-slate-700" />
        ) : (
          <div className="flex items-center gap-3 rounded-lg bg-slate-800/60 border border-slate-700 px-4 py-3 text-sm text-slate-300">
            {isPdf ? <FileText className="w-5 h-5 text-sky-400 shrink-0" /> : <ImageIcon className="w-5 h-5 text-sky-400 shrink-0" />}
            {failed ? "The image could not be previewed — open the original file below." : "PDF evidence — open the original file below."}
          </div>
        )}
        {url && (
          <a href={url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sky-400 text-sm underline">
            <ExternalLink className="w-4 h-4" /> Open original file
          </a>
        )}
      </DialogContent>
    </Dialog>
  );
}