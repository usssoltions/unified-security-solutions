import React from "react";
import { ChevronRight } from "lucide-react";
import { HOSP_CATEGORY_LABELS, PRESENCE_LABELS, PRESENCE_STYLES, ADMISSION_LABELS, presenceOf, fmtDT } from "@/lib/hospitalityMeta";

export default function VisitCard({ visit, onOpen }) {
  const p = presenceOf(visit);
  return (
    <button onClick={() => onOpen(visit)}
      className="w-full text-left rounded-xl bg-slate-900/60 border border-slate-700/50 p-3 flex items-center gap-3 hover:border-slate-500 active:scale-[0.99] transition-all">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-white font-semibold text-sm truncate">{visit.person_name || "Unnamed"}</p>
          <span className={`text-[11px] px-2 py-0.5 rounded-full border ${PRESENCE_STYLES[p]}`}>{PRESENCE_LABELS[p]}</span>
          {visit.status === "confirmed" && <span className="text-[11px] px-2 py-0.5 rounded-full border border-slate-600 text-slate-400">Admission: {ADMISSION_LABELS[visit.status]}</span>}
        </div>
        <p className="text-slate-400 text-xs mt-0.5 truncate">
          {HOSP_CATEGORY_LABELS[visit.category]}{visit.room_number ? ` · Room ${visit.room_number}` : ""}{visit.occupant_count ? ` · ${visit.occupant_count} pax` : ""} · {visit.site_name}
        </p>
        <p className="text-slate-500 text-xs">{fmtDT(visit.entry?.entry_time || visit.created_date)}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
    </button>
  );
}