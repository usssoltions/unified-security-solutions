import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import ColleagueActionsSheet from "./ColleagueActionsSheet";
import { vl360Invoke, vl360Key } from "@/lib/vl360Api";

/**
 * ColleagueListPanel — permitted personnel list shared by the guard's
 * "Call a Colleague" flow and the controller/supervisor workspace. Shows
 * name, personnel ID (where recorded), operational role, relevant site and
 * recorded duty status (never inferred from account existence or logins).
 */
export default function ColleagueListPanel({ siteId = null }) {
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: vl360Key(["personnel", siteId || "all"]),
    queryFn: async () => vl360Invoke({ action: "list_personnel", site_id: siteId || undefined }),
    staleTime: 30 * 1000,
  });
  const personnel = data?.personnel || [];
  const filtered = personnel.filter((p) =>
    !search || (p.name || "").toLowerCase().includes(search.toLowerCase())
    || (p.personnel_id || "").toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) {
    return <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 text-sky-400 animate-spin" /></div>;
  }
  if (isError) {
    return (
      <div className="text-center py-8 space-y-2">
        <p className="text-slate-400 text-sm">Could not load personnel.</p>
        <button onClick={() => refetch()} className="text-sky-400 text-sm underline">Retry</button>
      </div>
    );
  }
  if (!personnel.length) {
    return (
      <div className="text-center py-8">
        <p className="text-slate-400 text-sm">No personnel are assigned to your authorised sites yet.</p>
        <p className="text-slate-500 text-xs mt-1">Your administrator adds people under Personnel Setup.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search personnel…"
          className="pl-9 bg-slate-900 border-slate-700 text-white" />
      </div>
      {isFetching && <Loader2 className="w-4 h-4 text-slate-500 animate-spin mx-auto" />}
      <div className="space-y-2">
        {filtered.map((p, i) => (
          <button
            key={`${p.user_id}:${p.site_id}:${i}`}
            onClick={() => setSelected(p)}
            className="w-full text-left bg-slate-900 border border-slate-800 rounded-xl p-3.5 active:scale-[0.98] transition-transform"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-white font-semibold text-sm truncate">{p.name}</p>
                <p className="text-xs text-slate-400 truncate">
                  {p.vl_role_label}{p.personnel_id ? ` · ${p.personnel_id}` : ""}{p.site_name ? ` · ${p.site_name}` : ""}
                </p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${p.on_duty ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-slate-800 text-slate-400 border border-slate-700"}`}>
                {p.on_duty ? "On Duty" : "Off Duty"}
              </span>
            </div>
          </button>
        ))}
        {filtered.length === 0 && <p className="text-slate-500 text-sm text-center py-4">No matching personnel.</p>}
      </div>
      <ColleagueActionsSheet colleague={selected} onClose={() => setSelected(null)} />
    </div>
  );
}