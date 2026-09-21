import React from "react";
import { useBranding } from "@/hooks/useBranding";
import { resolveBrand } from "@/lib/branding";
import BrandLogo from "@/components/branding/BrandLogo";
import { cn } from "@/lib/utils";

/**
 * Shared effective-brand page header — the single presentation pattern for
 * role landing pages.
 *
 * Branding source: the EXISTING server-side resolution only
 * (getWhiteLabelBranding via useBranding → resolveBrand) with the
 * field-by-field Customer → owning Reseller → Platform hierarchy.
 * No separate resolver, no client-selected state.
 *
 * Rendering:
 * - Tenant users (customer or reseller scope): effective logo when one is
 *   configured (in the customer-configured container, image never modified);
 *   otherwise the provided fallback icon. The subtitle is prefixed with the
 *   effective app/business name when one resolves.
 * - Platform-level users: render NOTHING unless renderForPlatform is set, so
 *   Platform Administrator pages keep their existing presentation unchanged.
 *   On pages whose existing title block this header REPLACES,
 *   renderForPlatform keeps the exact previous look for platform users
 *   (title + subtitle + original icon box, no logo, no brand name).
 */
export default function BrandHeader({ user, title, subtitle, icon: Icon, iconClassName, className, renderForPlatform = false }) {
  const { data: branding } = useBranding(user?.customer_id, user?.reseller_id);
  const isPlatform = !!user && !user?.customer_id && !user?.reseller_id;
  if (isPlatform && !renderForPlatform) return null;
  const brand = resolveBrand(branding);
  const effectiveLogo = isPlatform ? null : brand.logoUrl;
  const effectiveAppName = isPlatform ? null : brand.appName;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {effectiveLogo ? (
        <BrandLogo
          logoUrl={effectiveLogo}
          logoBackground={brand.logoBackground}
          alt={effectiveAppName || "Logo"}
          containerClassName="h-12 w-auto max-w-[180px] rounded-xl shrink-0"
          whitePaddingClass="p-1.5"
        />
      ) : Icon ? (
        <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shrink-0", iconClassName || "bg-sky-500")}>
          <Icon className="w-6 h-6 text-white" />
        </div>
      ) : null}
      {(title || subtitle) && (
        <div className="min-w-0">
          {title && <h1 className="text-2xl font-bold text-white truncate">{title}</h1>}
          <p className="text-slate-400 text-sm truncate">
            {effectiveAppName ? `${effectiveAppName} • ` : ""}{subtitle}
          </p>
        </div>
      )}
    </div>
  );
}