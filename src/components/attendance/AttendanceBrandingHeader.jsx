/**
 * Branded header bar for the Attendance module.
 * Uses the customer's primary_color, logo_url and app_name from branding.
 */
import React from "react";
import { ClipboardList } from "lucide-react";
import BrandLogo from "@/components/branding/BrandLogo";

export default function AttendanceBrandingHeader({ branding, subtitle }) {
  const primary = branding?.primary_color || "#334155";
  const name = branding?.app_name || branding?.name || "Attendance Register";

  return (
    <div
      className="rounded-2xl p-4 mb-5 flex items-center gap-4"
      style={{ backgroundColor: primary }}
    >
      {branding?.logo_url ? (
        <BrandLogo
          logoUrl={branding.logo_url}
          logoBackground={branding?.logo_background}
          alt={name}
          containerClassName="h-10 max-w-[80px] rounded-lg p-1"
          imgClassName="h-full w-auto max-w-full object-contain"
          autoBackgroundClass="bg-white/10"
          whitePaddingClass=""
          onError={(e) => { e.target.style.display = "none"; }}
        />
      ) : (
        <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
          <ClipboardList className="w-5 h-5 text-white" />
        </div>
      )}
      <div>
        <p className="text-white font-bold text-base leading-tight">{name}</p>
        {subtitle && <p className="text-white/75 text-xs mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}