import React from "react";
import { Input } from "@/components/ui/input";
import { HOSP_CATEGORY_LABELS } from "@/lib/hospitalityMeta";

const sel = "h-10 w-full rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-sm px-2";

export default function VisitFilters({ filters, onChange, sites }) {
  const set = (k, v) => onChange({ ...filters, [k]: v });
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      <div>
        <p className="text-slate-400 text-xs mb-1">From</p>
        <Input type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} className="h-10 bg-slate-900 border-slate-700 text-slate-200" />
      </div>
      <div>
        <p className="text-slate-400 text-xs mb-1">To</p>
        <Input type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} className="h-10 bg-slate-900 border-slate-700 text-slate-200" />
      </div>
      <div>
        <p className="text-slate-400 text-xs mb-1">Site</p>
        <select value={filters.site_id} onChange={(e) => set("site_id", e.target.value)} className={sel}>
          <option value="">All hospitality sites</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div>
        <p className="text-slate-400 text-xs mb-1">Category</p>
        <select value={filters.category} onChange={(e) => set("category", e.target.value)} className={sel}>
          <option value="">All categories</option>
          {Object.entries(HOSP_CATEGORY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
    </div>
  );
}