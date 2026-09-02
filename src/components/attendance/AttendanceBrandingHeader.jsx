/**
 * Branded header bar for the Attendance module.
 * Uses the customer's primary_color, logo_url and app_name from branding.
 */
import React from "react";
import { ClipboardList } from "lucide-react";

export default function AttendanceBrandingHeader({ branding, subtitle }) {
  const primary = branding?.primary_color || "#334155";
  const name = branding?.app_name || branding?.name || "Attendance Register";

  return (
    <div
      className="rounded-2xl p-4 mb-5 flex items-center gap-4"
      style={{ background: `linear-gradient(135deg, ${primary}dd, ${primary}99)` }}
    >
      {branding?.logo_url ? (
        <img
          src={branding.logo_url}
          alt={name}
          className="h-10 w-auto max-w-[80px] object-contain rounded-lg bg-white/10 p-1"
          onError={(e) => { e.target.style.display = "none"; }}
        />
      ) : (
        <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
          <ClipboardList className="w-5 h-5 text-white" />
        </div>
      )}
      <div>
        <p className="text-white font-bold text-base leading-tight">{name}</p>
        {subtitle && <p className="text-white/70 text-xs mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}