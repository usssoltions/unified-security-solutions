import React, { useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Upload, Trash2, ImageIcon } from "lucide-react";

const MAX_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED = ["image/png", "image/jpeg", "image/webp"];

/**
 * Logo upload control. Replaces the old "Logo URL" text field so a reseller
 * never has to host an image or paste a URL. Uploads via Base44 Core.UploadFile
 * and stores the resulting file URL against the reseller branding. The raw
 * URL is kept internally but never exposed as the primary UI — the user only
 * sees the preview plus Replace / Remove actions.
 *
 * Logo persists across logout/login and devices because it is stored on the
 * Reseller record server-side, not in local client state.
 */
export default function LogoUpload({ value, onChange, disabled, label = "Logo" }) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    if (!ALLOWED.includes(file.type)) {
      toast({ title: "Unsupported format", description: "Use PNG, JPG or WebP.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_SIZE) {
      toast({ title: "File too large", description: "Maximum size is 2 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const res = await base44.integrations.Core.UploadFile({ file });
      const url = res?.file_url || res?.data?.file_url;
      if (!url) throw new Error("Upload failed — no file URL returned.");
      onChange(url);
      toast({ title: `${label} uploaded` });
    } catch (e) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      <Label className="text-slate-300 text-xs">{label}</Label>
      <div className="flex items-center gap-3 mt-1">
        {value ? (
          <div className="w-20 h-20 rounded-lg bg-white border border-slate-700 flex items-center justify-center p-1.5 shrink-0">
            <img src={value} alt={label} className="max-w-full max-h-full object-contain" />
          </div>
        ) : (
          <div className="w-20 h-20 rounded-lg bg-slate-950 border border-dashed border-slate-600 flex items-center justify-center shrink-0">
            <ImageIcon className="w-7 h-7 text-slate-600" />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={disabled || uploading}
            className="bg-slate-950 border-slate-700 text-slate-200 hover:bg-slate-800"
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 mr-2" />
            )}
            {uploading ? "Uploading…" : value ? `Replace ${label}` : `Upload ${label}`}
          </Button>
          {value && !disabled && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => onChange("")}
              className="text-rose-400 hover:bg-rose-500/10 justify-start"
            >
              <Trash2 className="w-4 h-4 mr-2" /> Remove {label}
            </Button>
          )}
        </div>
      </div>
      <p className="text-slate-500 text-xs mt-1.5">PNG, JPG or WebP. Max 2 MB.</p>
    </div>
  );
}