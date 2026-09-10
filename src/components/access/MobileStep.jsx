import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, CheckCircle2, RefreshCw, Phone, AlertCircle } from "lucide-react";
import { validateMobileNumber } from "@/lib/visitorPhone";

/**
 * FINAL REQUIRED STEP before any visitor entry is completed (Submit Entry /
 * Approve Entry / final access record creation) — compulsory for ALL visitor
 * entry workflows (vehicle, pedestrian, expected/QR, unexpected, contractor,
 * delivery, manual). The number pre-fills from the visitor's stored profile
 * (pre-registration / resident invitation / existing record) so the guard
 * only confirms or corrects it. The value is NOT re-asked on exit.
 *
 * Client validation is live feedback only — the central finalizeAccessEntry
 * gateway enforces and normalises the number server-side before the entry
 * record is created.
 */
export default function MobileStep({ initialPhone = "", onConfirm, onBack, busy = false, serverError = null }) {
  const [phone, setPhone] = useState(initialPhone);
  const [touched, setTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const check = validateMobileNumber(phone);
  const showError = (touched || attempted) && !check.ok;
  const canConfirm = check.ok && !busy;

  const confirm = () => {
    setAttempted(true);
    if (!canConfirm) return;
    onConfirm(phone.trim());
  };

  return (
    <div className="space-y-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="space-y-1.5">
        <Label htmlFor="visitor-mobile" className="text-slate-200 flex items-center gap-1.5">
          <Phone className="w-3.5 h-3.5 text-amber-400" /> Mobile Number *
        </Label>
        <Input
          id="visitor-mobile"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => { setPhone(e.target.value); setTouched(true); }}
          onKeyDown={(e) => e.key === "Enter" && confirm()}
          placeholder="0821234567"
          disabled={busy}
          className="bg-slate-900 border-slate-700 text-white h-12 text-base tracking-wide"
        />
        <p className="text-xs text-slate-400">Required for all visitors</p>
        {showError && (
          <p className="text-xs text-rose-400 flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {check.message}
          </p>
        )}
        {serverError && (
          <p className="text-xs text-rose-400 flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {serverError}
          </p>
        )}
      </div>

      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={() => { if (!busy) onBack(); }}
          disabled={busy}
          className="flex-1 border-slate-600 text-slate-300 h-12 active:scale-95 transition-transform touch-manipulation"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <Button
          onClick={confirm}
          disabled={!canConfirm}
          className="flex-1 h-12 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold active:scale-95 transition-transform touch-manipulation"
        >
          {busy ? <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> : <CheckCircle2 className="w-5 h-5 mr-2" />}
          Approve Entry
        </Button>
      </div>
    </div>
  );
}