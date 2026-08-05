import { Badge } from "@/components/ui/badge";
import { User, Clock } from "lucide-react";

export default function VisitorCard({ visitor, meta, photoUrl }) {
  if (!visitor) return null;
  const created = meta?.created;
  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex gap-3">
      <div className="w-20 h-24 rounded-lg overflow-hidden bg-slate-800 border border-slate-600 shrink-0 flex items-center justify-center">
        {photoUrl
          ? <img src={photoUrl} alt="visitor" className="w-full h-full object-cover" style={{ imageRendering: "pixelated" }} />
          : <User className="w-8 h-8 text-slate-500" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-white font-semibold text-base truncate">{visitor.visitor_name || "Unknown"}</p>
          <Badge className={created ? "bg-sky-600 text-[10px]" : "bg-emerald-600 text-[10px]"}>
            {created ? "NEW PROFILE" : "MATCHED"}
          </Badge>
        </div>
        {visitor.visitor_id_number && <p className="text-slate-300 text-xs font-mono">ID: {visitor.visitor_id_number}</p>}
        {visitor.driver_licence_number && <p className="text-slate-400 text-xs font-mono">DL: {visitor.driver_licence_number}</p>}
        <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {meta?.previous ?? 0} previous visit{meta?.previous === 1 ? "" : "s"}</span>
          {visitor.unit_number && <span>Unit {visitor.unit_number}</span>}
        </div>
      </div>
    </div>
  );
}