/**
 * Compact Worker/Patient info card — used in lists and scan results.
 */
import React from "react";
import { Badge } from "@/components/ui/badge";
import { User, IdCard, Building2, Briefcase, Phone } from "lucide-react";
import { idTypeLabel, formatDisplayName } from "@/lib/attendanceDropdowns";

export default function WorkerCard({ worker, onClick, selected, compact = false }) {
  if (!worker) return null;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border-2 p-4 transition active:scale-[0.98]
        ${selected
          ? "border-emerald-500 bg-emerald-500/10"
          : "border-slate-700 bg-slate-800/60 hover:border-slate-500 hover:bg-slate-800"}`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
          <User className="w-5 h-5 text-slate-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm leading-tight">{formatDisplayName(worker)}</p>
          {worker.first_names && <p className="text-slate-400 text-xs mt-0.5">{worker.first_names}</p>}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
            <span className="text-slate-400 text-xs flex items-center gap-1">
              <IdCard className="w-3 h-3" /> {worker.id_number}
            </span>
            {worker.company && !compact && (
              <span className="text-slate-400 text-xs flex items-center gap-1">
                <Building2 className="w-3 h-3" /> {worker.company}
              </span>
            )}
            {worker.cellphone && !compact && (
              <span className="text-slate-400 text-xs flex items-center gap-1">
                <Phone className="w-3 h-3" /> {worker.cellphone}
              </span>
            )}
          </div>
        </div>
        <Badge className="text-xs shrink-0" variant={worker.status === "active" ? "default" : "secondary"}>
          {idTypeLabel(worker.id_type)}
        </Badge>
      </div>
    </button>
  );
}