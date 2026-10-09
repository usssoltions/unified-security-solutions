import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Building2, RefreshCw, Search, BadgeCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { vl360Invoke, getVl360Customer } from "@/lib/vl360Api";

/**
 * VL360CustomerSelect — the authorised pre-data gate for platform and
 * reseller administrators whose own account has no customer scope. Lists ONLY
 * customers the gateway authorises for the caller (the whole platform for a
 * platform admin; strictly their own reseller's customers for a reseller
 * admin — enforced server-side). Selecting one re-bootstraps VoiceLink 360
 * against that customer; nothing is activated and no tenant check is bypassed.
 */
export default function VL360CustomerSelect({ ctx }) {
  const [term, setTerm] = useState("");
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["vl360_customer_choices"],
    queryFn: async () => vl360Invoke({ action: "list_customers" }),
    staleTime: 60 * 1000,
  });

  const all = data?.customers || [];
  const termLower = term.trim().toLowerCase();
  const customers = termLower
    ? all.filter((c) => String(c.name || "").toLowerCase().includes(termLower))
    : all;
  const current = getVl360Customer();

  const pick = (id) => ctx?.selectCustomer?.(id);

  return (
    <div className="space-y-3">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-sky-400" />
          <p className="text-sm font-semibold text-white">Choose an organisation</p>
        </div>
        <p className="text-xs text-slate-500">
          Your administrator account is not linked to a customer. Select the customer
          you want to operate VoiceLink 360 for. Nothing is activated for the
          customer by selecting it.
        </p>
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search customers…"
            className="pl-9 bg-slate-950 border-slate-700 text-white"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-6 h-6 text-sky-400 animate-spin" />
          </div>
        ) : isError ? (
          <div className="text-center space-y-2 py-4">
            <p className="text-rose-400 text-sm">Could not load the customer list.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="border-slate-600 text-slate-200">
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          </div>
        ) : customers.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-4">
            {all.length === 0
              ? "No customers are available for your administrator scope."
              : "No customers match that search."}
          </p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {customers.map((c) => (
              <button
                key={c.id}
                onClick={() => pick(c.id)}
                disabled={isFetching}
                className={`w-full flex items-center justify-between gap-3 px-3 py-3 rounded-xl border text-left active:scale-[0.98] transition-transform touch-manipulation ${
                  current === c.id
                    ? "bg-sky-500/15 border-sky-500/50"
                    : "bg-slate-950 border-slate-800 hover:border-slate-600"
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{c.name}</p>
                  <p className="text-xs text-slate-500 capitalize">{c.status}</p>
                </div>
                {c.vl360_licensed ? (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-400 shrink-0">
                    <BadgeCheck className="w-4 h-4" /> Licensed
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] text-slate-500 shrink-0">
                    <ShieldOff className="w-4 h-4" /> Not licensed
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}