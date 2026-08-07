import { Button } from "@/components/ui/button";
import { ScanLine, RefreshCw } from "lucide-react";

export default function StepCard({ icon: Icon, title, subtitle, onScan, busy }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-sky-500/40 bg-sky-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-5 h-5 text-sky-400" />
        <p className="text-white font-semibold text-sm">{title}</p>
      </div>
      {subtitle && <p className="text-slate-400 text-xs">{subtitle}</p>}
      <Button onClick={onScan} disabled={busy} className="w-full bg-sky-500 hover:bg-sky-600 h-11">
        {busy ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <ScanLine className="w-4 h-4 mr-2" />}
        {busy ? "Processing…" : "Open Scanner"}
      </Button>
    </div>
  );
}