import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isValidHex } from "@/lib/branding";

/**
 * Visual colour picker with an optional hex override for advanced users.
 * The native `<input type="color">` gives a touch-friendly picker on mobile;
 * the text field allows direct hex entry. Invalid hex is preserved in the
 * text field (so the user can finish typing) but the swatch shows a safe
 * fallback and sanitisation happens on save.
 */
export default function ColorPicker({ label, value, onChange, disabled }) {
  const swatch = isValidHex(value) ? value : "#0ea5e9";
  return (
    <div>
      <Label className="text-slate-300 text-xs">{label}</Label>
      <div className="flex items-center gap-2 mt-1">
        <input
          type="color"
          value={swatch}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={label}
          className="w-10 h-10 shrink-0 rounded-lg cursor-pointer bg-slate-950 border border-slate-700 p-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
        />
        <Input
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#0ea5e9"
          disabled={disabled}
          className="bg-slate-950 border-slate-700 text-white disabled:opacity-60 font-mono text-sm uppercase"
        />
      </div>
    </div>
  );
}