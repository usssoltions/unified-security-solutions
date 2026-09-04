import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Save, Palette, RotateCcw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import ColorPicker from "./ColorPicker";
import LogoUpload from "./LogoUpload";
import BrandingPreview from "./BrandingPreview";
import { sanitizeHex, PLATFORM_APP_NAME } from "@/lib/branding";

/**
 * CustomerBrandingTab — customer-level white-label branding OVERRIDES.
 *
 * The Customer record stores ONLY overrides; every blank field inherits the
 * reseller's branding per field (Customer → Reseller → Platform default —
 * resolved server-side by getWhiteLabelBranding, never by name matching).
 * The editor shows, for every field, exactly what a blank value will inherit
 * and whether the current effective value is a Customer override or inherited.
 *
 * Saves flow through the manageCustomerBranding backend function: an
 * allowlisted, audited server-side update (platform admin or reseller admin
 * only). The reseller record itself is never touched by this tab.
 *
 * Reuses the same visual components as the reseller Branding screen
 * (LogoUpload, ColorPicker, BrandingPreview).
 */

const OVERRIDE_FIELDS = [
  { key: "app_name", label: "App / business name", resellerKey: "app_name" },
  { key: "email", label: "Support email", resellerKey: "support_email" },
  { key: "phone", label: "Support phone", resellerKey: "support_phone" },
  { key: "website", label: "Website", resellerKey: "website" },
];

export default function CustomerBrandingTab({ customer, onSaved }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [edit, setEdit] = useState({
    app_name: customer.app_name || "",
    logo_url: customer.logo_url || "",
    primary_color: customer.primary_color || "",
    accent_color: customer.accent_color || "",
    email: customer.email || "",
    phone: customer.phone || "",
    website: customer.website || "",
    address: customer.address || "",
  });
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // Reseller branding = the inherited fallback for every blank field.
  const { data: reseller, isLoading: resellerLoading } = useQuery({
    queryKey: ["resellerBranding", customer?.reseller_id],
    queryFn: () => base44.entities.Reseller.get(customer.reseller_id),
    enabled: !!customer?.reseller_id,
    staleTime: 120000,
  });

  const setField = (k, v) => setEdit((e) => ({ ...e, [k]: v }));

  const saveBranding = async (fields) => {
    setSaving(true);
    try {
      const res = await base44.functions.invoke("manageCustomerBranding", {
        customer_id: customer.id,
        fields,
      });
      const d = res?.data || res || {};
      if (d?.error) throw new Error(d.error);
      // Branded surfaces (header, Profile, PDFs) re-read on next fetch.
      queryClient.invalidateQueries({ queryKey: ["branding"] });
      if (onSaved) onSaved();
      toast({ title: "Customer branding saved" });
    } catch (e) {
      toast({ title: "Save failed", description: e.message || "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
      setConfirmReset(false);
    }
  };

  const handleSave = () => {
    saveBranding({
      app_name: (edit.app_name || "").trim(),
      logo_url: edit.logo_url || "",
      primary_color: sanitizeHex(edit.primary_color),
      accent_color: sanitizeHex(edit.accent_color),
      email: (edit.email || "").trim(),
      phone: (edit.phone || "").trim(),
      website: (edit.website || "").trim(),
      address: (edit.address || "").trim(),
    });
  };

  const handleReset = () => {
    const cleared = {
      app_name: "", logo_url: "", primary_color: "", accent_color: "",
      email: "", phone: "", website: "", address: "",
    };
    setEdit(cleared);
    saveBranding(cleared);
  };

  // Effective preview values: customer override → reseller → platform default
  // (the preview component applies the platform fallback itself). PER FIELD.
  const eff = (own, inherited) => own || inherited || "";
  const effective = {
    app_name: eff(edit.app_name, reseller?.app_name),
    logo_url: eff(edit.logo_url, reseller?.logo_url),
    primary_color: eff(edit.primary_color, reseller?.primary_color),
    accent_color: eff(edit.accent_color, reseller?.accent_color),
  };

  const sourceKind = (own, inherited) =>
    own ? "override" : inherited ? "inherited" : "default";

  const SourceBadge = ({ kind }) =>
    kind === "override" ? (
      <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">Customer override</Badge>
    ) : kind === "inherited" ? (
      <Badge className="bg-sky-500/20 text-sky-300 border border-sky-500/30 shrink-0">Inherited from reseller</Badge>
    ) : (
      <Badge className="bg-slate-700/40 text-slate-400 border border-slate-600/40 shrink-0">Platform default</Badge>
    );

  const resellerAppName = reseller?.app_name || PLATFORM_APP_NAME;

  return (
    <div className="space-y-4">
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white text-sm flex items-center gap-2">
            <Palette className="w-4 h-4 text-sky-400" /> Customer Branding Overrides
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="bg-sky-500/10 border border-sky-500/20 rounded-lg p-3 text-xs text-sky-200">
            Every field below is an <strong>override</strong>. Leave a field blank to inherit the
            reseller's value for that field{reseller ? <> (reseller: <strong>{reseller.name}</strong> — {resellerAppName})</> : null}.
            Nothing is copied into this customer — inheritance stays live, so reseller branding
            changes continue to flow through for blank fields.
          </div>
          <div className="bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs text-slate-400">
            <p className="mb-1 font-semibold text-slate-300">Android APK readiness</p>
            This customer's resolved branding (effective app name, logo, colours, support contacts
            and canonical Customer ID {customer.id}) is served by the branding resolver, so a
            future dedicated Android build can consume exactly the same values — no duplication.
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-5 pt-5">
          {/* Editor */}
          <div className="space-y-4 order-2 lg:order-1">
            <div>
              <Label className="text-slate-300 text-xs">App / business name</Label>
              <Input
                value={edit.app_name}
                onChange={(e) => setField("app_name", e.target.value)}
                placeholder={resellerAppName}
                className="bg-slate-950 border-slate-700 text-white mt-1"
              />
              <p className="text-slate-500 text-xs mt-1">
                {reseller?.app_name
                  ? `Leave blank to inherit reseller branding: ${reseller.app_name}`
                  : "Leave blank for the default product name."}
              </p>
            </div>

            <div>
              <LogoUpload value={edit.logo_url} onChange={(v) => setField("logo_url", v)} />
              <p className="text-slate-500 text-xs mt-1.5">
                {edit.logo_url
                  ? "Customer logo active — overrides the reseller logo."
                  : reseller?.logo_url
                    ? "No customer logo — the reseller logo is currently inherited."
                    : "No customer logo — the platform mark is used."}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ColorPicker
                label="Primary colour"
                value={edit.primary_color}
                onChange={(v) => setField("primary_color", v)}
              />
              <ColorPicker
                label="Accent colour"
                value={edit.accent_color}
                onChange={(v) => setField("accent_color", v)}
              />
            </div>

            {OVERRIDE_FIELDS.slice(1).map((f) => (
              <div key={f.key}>
                <Label className="text-slate-300 text-xs">{f.label}</Label>
                <Input
                  value={edit[f.key]}
                  onChange={(e) => setField(f.key, e.target.value)}
                  className="bg-slate-950 border-slate-700 text-white mt-1"
                />
                <p className="text-slate-500 text-xs mt-1">
                  {reseller?.[f.resellerKey]
                    ? `Leave blank to inherit reseller ${f.label.toLowerCase()}: ${reseller[f.resellerKey]}`
                    : "Leave blank to use the platform default."}
                </p>
              </div>
            ))}

            <div>
              <Label className="text-slate-300 text-xs">Address</Label>
              <Textarea
                value={edit.address}
                onChange={(e) => setField("address", e.target.value)}
                rows={2}
                className="bg-slate-950 border-slate-700 text-white mt-1"
              />
              <p className="text-slate-500 text-xs mt-1">
                {reseller?.address
                  ? `Leave blank to inherit reseller address: ${reseller.address}`
                  : "Leave blank for no address."}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={handleSave} disabled={saving} className="bg-sky-500 hover:bg-sky-600 h-11">
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                Save Branding
              </Button>
              <Button
                onClick={() => setConfirmReset(true)}
                variant="outline"
                disabled={saving}
                className="bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-800 h-11"
              >
                <RotateCcw className="w-4 h-4 mr-1" /> Clear All Overrides
              </Button>
            </div>
          </div>

          {/* Live preview + effective sources */}
          <div className="space-y-2 order-1 lg:order-2">
            <Label className="text-slate-300 text-xs">
              Live Preview {resellerLoading ? "— loading reseller branding…" : "(unsaved values)"}
            </Label>
            <BrandingPreview branding={effective} />
            <div className="space-y-1.5">
              {[
                ["Effective app name", effective.app_name, sourceKind(edit.app_name, reseller?.app_name)],
                ["Effective logo", effective.logo_url ? "Configured" : "None", sourceKind(edit.logo_url, reseller?.logo_url)],
                ["Effective primary colour", effective.primary_color, sourceKind(edit.primary_color, reseller?.primary_color)],
                ["Effective accent colour", effective.accent_color, sourceKind(edit.accent_color, reseller?.accent_color)],
                ["Effective support email", edit.email || reseller?.support_email || "", sourceKind(edit.email, reseller?.support_email)],
                ["Effective support phone", edit.phone || reseller?.support_phone || "", sourceKind(edit.phone, reseller?.support_phone)],
                ["Effective website", edit.website || reseller?.website || "", sourceKind(edit.website, reseller?.website)],
              ].map(([label, value, kind]) => (
                <div key={label} className="flex items-center justify-between gap-3 bg-slate-800/40 rounded-lg px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-slate-400 text-xs">{label}</p>
                    <p className="text-white text-sm truncate">{value || "—"}</p>
                  </div>
                  <SourceBadge kind={kind} />
                </div>
              ))}
            </div>
            <p className="text-slate-500 text-xs">
              Emergency, warning and status colours are never overridden by branding.
            </p>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent className="bg-slate-900 border-slate-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Clear all customer branding overrides?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              This clears the app name, logo, colours and support details saved for this customer
              only. The customer immediately falls back to the reseller's branding for every
              field. The reseller's own branding is not changed, and no tenant or customer data
              is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-200">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset} className="bg-rose-500 hover:bg-rose-600 text-white">
              Clear Overrides
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}