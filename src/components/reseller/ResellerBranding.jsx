import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { sanitizeHex } from "@/lib/branding";

/**
 * Reseller white-label branding editor. Edits the branding fields that live
 * directly on the Reseller entity (app_name, logo_url, primary_color,
 * accent_color, support_*, website) and saves them via the parent
 * ResellerConsole `onSave` (which calls Reseller.update).
 *
 * Tenant isolation is unchanged: the Reseller is only writable by platform
 * admins (RLS) or, where intentionally authorised, the reseller's own admin
 * (membership RLS). A reseller can never edit another reseller's branding
 * because RLS gates the underlying Reseller.update. Customer admins inherit
 * branding but do not get edit rights here.
 *
 * Reset clears only visual branding (app_name, logo, colours). Support
 * contact details are retained and no tenant/customer data is deleted.
 */
export default function ResellerBranding({ edit, setEdit, onSave, saving, readOnly }) {
  const { toast } = useToast();
  const [confirmReset, setConfirmReset] = useState(false);

  const setField = (k, v) => setEdit({ ...edit, [k]: v });

  const handleSave = () => {
    const clean = {
      ...edit,
      app_name: (edit.app_name || "").trim(),
      logo_url: edit.logo_url || "",
      primary_color: sanitizeHex(edit.primary_color),
      accent_color: sanitizeHex(edit.accent_color),
    };
    setEdit(clean);
    onSave(clean);
  };

  const handleReset = () => {
    const cleared = {
      ...edit,
      app_name: "",
      logo_url: "",
      primary_color: "",
      accent_color: "",
    };
    setEdit(cleared);
    setConfirmReset(false);
    onSave(cleared);
    toast({ title: "Branding reset to platform defaults" });
  };

  return (
    <div className="space-y-4">
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white text-sm flex items-center gap-2">
            <Palette className="w-4 h-4 text-sky-400" /> White-label Branding
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Editor */}
          <div className="space-y-4 order-2 lg:order-1">
            <div>
              <Label className="text-slate-300 text-xs">App / business name</Label>
              <Input
                value={edit.app_name || ""}
                onChange={(e) => setField("app_name", e.target.value)}
                disabled={readOnly}
                placeholder="SecureGuard"
                className="bg-slate-950 border-slate-700 text-white mt-1 disabled:opacity-60"
              />
              <p className="text-slate-500 text-xs mt-1">
                Shown in the app header and branded surfaces. Leave blank for the default product name.
              </p>
            </div>

            <LogoUpload value={edit.logo_url} onChange={(v) => setField("logo_url", v)} disabled={readOnly} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ColorPicker
                label="Primary colour"
                value={edit.primary_color}
                onChange={(v) => setField("primary_color", v)}
                disabled={readOnly}
              />
              <ColorPicker
                label="Accent colour"
                value={edit.accent_color}
                onChange={(v) => setField("accent_color", v)}
                disabled={readOnly}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 text-xs">Support name</Label>
                <Input
                  value={edit.support_name || ""}
                  onChange={(e) => setField("support_name", e.target.value)}
                  disabled={readOnly}
                  className="bg-slate-950 border-slate-700 text-white mt-1 disabled:opacity-60"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-xs">Support email</Label>
                <Input
                  value={edit.support_email || ""}
                  onChange={(e) => setField("support_email", e.target.value)}
                  disabled={readOnly}
                  className="bg-slate-950 border-slate-700 text-white mt-1 disabled:opacity-60"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-xs">Support phone</Label>
                <Input
                  value={edit.support_phone || ""}
                  onChange={(e) => setField("support_phone", e.target.value)}
                  disabled={readOnly}
                  className="bg-slate-950 border-slate-700 text-white mt-1 disabled:opacity-60"
                />
              </div>
              <div>
                <Label className="text-slate-300 text-xs">Website</Label>
                <Input
                  value={edit.website || ""}
                  onChange={(e) => setField("website", e.target.value)}
                  disabled={readOnly}
                  className="bg-slate-950 border-slate-700 text-white mt-1 disabled:opacity-60"
                />
              </div>
            </div>

            {!readOnly && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button onClick={handleSave} disabled={saving} className="bg-sky-500 hover:bg-sky-600">
                  {saving ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-1" />
                  )}
                  Save Branding
                </Button>
                <Button
                  onClick={() => setConfirmReset(true)}
                  variant="outline"
                  disabled={saving}
                  className="bg-slate-950 border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  <RotateCcw className="w-4 h-4 mr-1" /> Reset to Default
                </Button>
              </div>
            )}
          </div>

          {/* Live preview */}
          <div className="space-y-2 order-1 lg:order-2">
            <Label className="text-slate-300 text-xs">Live Preview</Label>
            <BrandingPreview branding={edit} />
            <p className="text-slate-500 text-xs">
              Preview reflects the current unsaved values. Emergency, warning and status colours are
              never overridden by branding.
            </p>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent className="bg-slate-900 border-slate-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Reset branding to defaults?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              This clears the app name, logo and colours for this reseller. Its customers and users
              will fall back to the default platform theme. Support contact details are kept. No
              tenant or customer data is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-200">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReset}
              className="bg-rose-500 hover:bg-rose-600 text-white"
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}