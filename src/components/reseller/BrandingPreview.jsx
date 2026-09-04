import React from "react";
import { Shield, Bell } from "lucide-react";
import { resolveBrand, hexToRgba } from "@/lib/branding";
import BrandLogo from "@/components/branding/BrandLogo";

/**
 * Live preview of the white-labelled application. Reflects the current
 * (unsaved) editor values so an administrator can verify branding before
 * saving. Shows: logo, app/business name, header, a selected nav item
 * (primary colour), a primary action button (accent colour), a link/accent
 * example and an active-tab example.
 *
 * The preview never depicts semantic safety colours — those are not part of
 * branding and remain unchanged in the real app.
 */
export default function BrandingPreview({ branding }) {
  const brand = resolveBrand(branding);
  const appName = brand.appName || "SecureGuard";
  // Logo background mode for the preview. Editors that don't configure a
  // logo_background (e.g. the reseller editor) keep the legacy white preview
  // container; the customer editor passes auto/white/transparent so the
  // preview shows the logo exactly as it will appear in the customer-facing app.
  const logoBg = ["white", "transparent", "auto"].includes(branding?.logo_background)
    ? branding.logo_background
    : "white";

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-950 overflow-hidden shadow-lg">
      {/* Header */}
      <div className="px-3 py-2.5 bg-slate-900/80 border-b border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {brand.logoUrl ? (
            <BrandLogo
              logoUrl={brand.logoUrl}
              logoBackground={logoBg}
              alt={appName}
              containerClassName="w-7 h-7 rounded-lg"
              whitePaddingClass="p-0.5"
            />
          ) : (
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundImage: `linear-gradient(135deg, ${brand.primary}, ${brand.accent})` }}
            >
              <Shield className="w-4 h-4 text-white" />
            </div>
          )}
          <span className="text-white font-semibold text-sm truncate">{appName}</span>
        </div>
        <Bell className="w-4 h-4 text-slate-400 shrink-0" />
      </div>

      <div className="flex">
        {/* Sidebar / nav */}
        <div className="w-24 bg-slate-900/60 border-r border-slate-800 p-2 space-y-1.5">
          {["Dashboard", "Incidents", "Reports"].map((n, i) => {
            const active = i === 0;
            return (
              <div
                key={n}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium border border-transparent"
                style={
                  active
                    ? { color: brand.primary, backgroundColor: hexToRgba(brand.primary, 0.18), borderColor: hexToRgba(brand.primary, 0.35) }
                    : { color: "#94a3b8" }
                }
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: active ? brand.primary : "#475569" }}
                />
                {n}
              </div>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 p-3 space-y-2.5 min-w-0">
          <div className="h-2.5 w-2/3 rounded-full" style={{ backgroundColor: brand.primary }} />
          <div className="h-2 w-1/2 rounded-full bg-slate-700" />
          <div className="h-2 w-3/5 rounded-full bg-slate-700" />
          <div className="flex flex-wrap gap-2 pt-1.5">
            <span
              className="px-3 py-1.5 rounded-lg text-white text-[11px] font-medium"
              style={{ backgroundColor: brand.accent }}
            >
              Primary Action
            </span>
            <span
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium border"
              style={{ color: brand.primary, borderColor: brand.primary }}
            >
              Link
            </span>
          </div>
          <div className="flex gap-1.5 pt-1">
            <span className="px-2 py-0.5 rounded text-[10px] text-white" style={{ backgroundColor: brand.primary }}>
              Active Tab
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400">Tab</span>
          </div>
        </div>
      </div>
    </div>
  );
}