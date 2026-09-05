import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, Smartphone } from "lucide-react";
import LogoUpload from "./LogoUpload";
import ColorPicker from "./ColorPicker";
import { sanitizeHex } from "@/lib/branding";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

/**
 * CustomerPwaBrandingSection — clearly separated PWA INSTALL branding
 * (installed app name, short name, slug, icon, splash background) for this
 * customer. Independent from the in-app white-label fields above: the PWA
 * app name may differ from the in-app business name.
 *
 * Saves flow through the parent's manageCustomerBranding call: the server
 * validates the slug (lowercase URL-safe, globally unique, immutable once
 * assigned). The slug is a public, cosmetic identifier — it never grants
 * tenant access.
 */
export default function CustomerPwaBrandingSection({ customer, saving, onSave }) {
  const hasSlug = !!customer.pwa_slug;
  const [pwa, setPwa] = useState({
    pwa_slug: customer.pwa_slug || "",
    pwa_app_name: customer.pwa_app_name || "",
    pwa_short_name: customer.pwa_short_name || "",
    pwa_icon_192_url: customer.pwa_icon_192_url || "",
    pwa_icon_512_url: customer.pwa_icon_512_url || "",
    pwa_background_color: customer.pwa_background_color || "",
  });
  const setField = (k, v) => setPwa((p) => ({ ...p, [k]: v }));

  const slugValid = !pwa.pwa_slug || SLUG_RE.test(pwa.pwa_slug);
  const slug = hasSlug ? customer.pwa_slug : (pwa.pwa_slug || "").toLowerCase().trim();
  const installUrl = slug ? `/?brand=${slug}` : "";

  // Installed-PWA values with the standard fallback rules:
  //   App name: pwa_app_name → customer effective app/business name
  //   Short name: pwa_short_name → derived from the PWA app name (≤12 chars)
  //   Icon: dedicated PWA icon → customer logo (never distorted)
  //   Theme: customer effective primary · Background: platform neutral unless overridden
  const effAppName = customer.app_name || customer.name || "USS Platform";
  const appName = (pwa.pwa_app_name || "").trim() || effAppName;
  const shortName = (pwa.pwa_short_name || "").trim() ||
    ((appName.trim().split(/\s+/)[0] || "USS").slice(0, 12));
  const theme = customer.primary_color || "#0ea5e9";
  const background = (pwa.pwa_background_color || "").trim() || "#09111D";
  const icon = pwa.pwa_icon_512_url || customer.logo_url || "";

  const save = () => {
    if (!slugValid) return;
    const fields = {
      pwa_app_name: (pwa.pwa_app_name || "").trim(),
      pwa_short_name: (pwa.pwa_short_name || "").trim(),
      pwa_icon_192_url: pwa.pwa_icon_192_url || "",
      pwa_icon_512_url: pwa.pwa_icon_512_url || "",
      pwa_background_color: sanitizeHex(pwa.pwa_background_color) || "",
    };
    // The slug is only submitted while unassigned — once set it is immutable.
    if (!hasSlug) fields.pwa_slug = slug;
    onSave(fields);
  };

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white text-sm flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-emerald-400" /> PWA Install Branding
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Editor */}
        <div className="space-y-4">
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-xs text-emerald-100">
            Lets this customer install the SAME multi-tenant platform as their OWN branded
            home-screen app. These values only affect the installed app's name, icon and
            colours — never data access or tenant permissions.
          </div>

          <div>
            <Label className="text-slate-300 text-xs">PWA Slug</Label>
            {hasSlug ? (
              <div className="flex items-center gap-2 mt-1.5">
                <Input value={customer.pwa_slug} disabled
                  className="bg-slate-950 border-slate-700 text-slate-400 font-mono" />
                <Badge className="bg-slate-700/40 text-slate-400 border border-slate-600/40 shrink-0">Locked</Badge>
              </div>
            ) : (
              <Input
                value={pwa.pwa_slug}
                onChange={(e) => setField("pwa_slug", e.target.value.toLowerCase())}
                placeholder="e.g. sauerman"
                className="bg-slate-950 border-slate-700 text-white font-mono mt-1.5"
              />
            )}
            <p className="text-slate-500 text-xs mt-1">
              {hasSlug
                ? "The slug is immutable once assigned — it is baked into installed apps (install URL / id)."
                : "Unique, lowercase, URL-safe (letters, numbers, hyphens, no spaces). Becomes immutable once customers install. Never exposes the internal customer ID."}
            </p>
            {!slugValid && (
              <p className="text-rose-400 text-xs mt-1">
                Slug must be lowercase letters, numbers and hyphens (2–31 characters, no spaces).
              </p>
            )}
          </div>

          <div>
            <Label className="text-slate-300 text-xs">PWA App Name</Label>
            <Input
              value={pwa.pwa_app_name}
              onChange={(e) => setField("pwa_app_name", e.target.value)}
              placeholder={effAppName}
              className="bg-slate-950 border-slate-700 text-white mt-1.5"
            />
            <p className="text-slate-500 text-xs mt-1">
              Installed app name (under the launcher icon). Leave blank to use "{effAppName}".
              Can differ from the in-app business name above.
            </p>
          </div>

          <div>
            <Label className="text-slate-300 text-xs">PWA Short Name</Label>
            <Input
              value={pwa.pwa_short_name}
              onChange={(e) => setField("pwa_short_name", e.target.value)}
              placeholder={shortName}
              className="bg-slate-950 border-slate-700 text-white mt-1.5"
            />
            <p className="text-slate-500 text-xs mt-1">
              Launcher label where space is limited (keep ≤ 12 characters). Leave blank to derive
              automatically from the PWA app name.
            </p>
          </div>

          <div>
            <LogoUpload
              value={pwa.pwa_icon_512_url}
              onChange={(v) => { setField("pwa_icon_512_url", v); setField("pwa_icon_192_url", v); }}
              label="PWA Icon (square)"
            />
            <p className="text-slate-500 text-xs mt-1.5">
              Square 512×512 PNG recommended (maskable-compatible). Leave blank to use the customer
              logo — rendered on its configured background, never distorted.
            </p>
          </div>

          <ColorPicker
            label="PWA Background Colour (splash)"
            value={pwa.pwa_background_color}
            onChange={(v) => setField("pwa_background_color", v)}
          />

          <Button onClick={save} disabled={saving || !slugValid} className="bg-emerald-500 hover:bg-emerald-600 h-11">
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
            Save PWA Branding
          </Button>
        </div>

        {/* Installed PWA Preview */}
        <div className="space-y-3">
          <Label className="text-slate-300 text-xs">Installed PWA Preview</Label>
          <div className="rounded-xl border border-slate-700 bg-slate-950 p-4 space-y-4">
            <div className="flex items-center gap-3">
              {icon ? (
                <div className="w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "#ffffff" }}>
                  <img src={icon} alt="Installed PWA icon" className="max-w-full max-h-full object-contain p-1" />
                </div>
              ) : (
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center shrink-0" style={{ backgroundColor: theme }}>
                  <span className="text-white font-bold text-xl">{(shortName || "USS").slice(0, 1)}</span>
                </div>
              )}
              <div className="min-w-0">
                <p className="text-white text-sm font-medium truncate">{appName}</p>
                <p className="text-slate-500 text-xs truncate">{shortName}</p>
              </div>
            </div>

            <div>
              <p className="text-slate-500 text-xs mb-1.5">Splash screen (approximation)</p>
              <div className="rounded-lg border border-slate-700 p-8 flex flex-col items-center gap-3"
                style={{ backgroundColor: background }}>
                {icon ? (
                  <div className="w-20 h-20 rounded-2xl overflow-hidden flex items-center justify-center"
                    style={{ backgroundColor: "#ffffff" }}>
                    <img src={icon} alt="" className="max-w-full max-h-full object-contain p-1" />
                  </div>
                ) : (
                  <div className="w-20 h-20 rounded-2xl flex items-center justify-center" style={{ backgroundColor: theme }}>
                    <span className="text-white font-bold text-2xl">{(shortName || "USS").slice(0, 1)}</span>
                  </div>
                )}
                <p className="text-white text-sm font-medium">{appName}</p>
              </div>
              <p className="text-slate-500 text-xs mt-1.5">
                Chrome composes the installed app's splash from the manifest icon, background colour
                and theme colour only — fully custom splash artwork is not supported by Chrome.
                Theme colour: <span className="text-slate-300 font-mono">{theme}</span>
              </p>
            </div>

            {installUrl && (
              <div>
                <p className="text-slate-500 text-xs mb-1.5">Branded install URL (stable)</p>
                <p className="text-emerald-300 text-xs font-mono break-all bg-slate-900 rounded-lg px-3 py-2 border border-slate-700">
                  {installUrl}
                </p>
                <p className="text-slate-500 text-xs mt-1">
                  Never change the slug after customers install. Name, icon and colours may be
                  updated anytime — Android may cache the launcher icon for a while after a change.
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}