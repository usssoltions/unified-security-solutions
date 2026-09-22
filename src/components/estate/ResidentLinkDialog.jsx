import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Search, Link2 } from "lucide-react";
import { linkResidentUser } from "@/lib/estateApi";

/**
 * Resident profile ↔ User account linking dialog (controlled onboarding).
 * The account list comes from the tenant-scoped getTenantUsers gateway and
 * the actual link is validated server-side by estateAccess (same tenant,
 * resident role only, one profile per user) — the UI never trusts the
 * selection beyond passing it to the gateway.
 */
export default function ResidentLinkDialog({ resident, onClose }) {
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const qc = useQueryClient();

  // Tenant-scoped user discovery — never a direct User.list().
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["estate_linkable_users"],
    queryFn: async () => {
      const res = await base44.functions.invoke("getTenantUsers", {});
      const d = res?.data !== undefined ? res.data : res;
      return (d?.users || []).filter((u) => u.role_type === "resident");
    },
    staleTime: 60_000,
  });

  const linkMutation = useMutation({
    mutationFn: (user_id) => linkResidentUser(resident.id, user_id),
    onSuccess: () => {
      qc.invalidateQueries(["all_residents"]);
      onClose();
    },
    onError: (e) => setError(e?.message || "Could not link this account."),
  });

  const linkedUserIds = new Set([resident.user_id].filter(Boolean));
  const filtered = users.filter((u) => {
    const name = (u.full_name || u.email || "").toLowerCase();
    return !linkedUserIds.has(u.id) && name.includes(search.toLowerCase());
  });

  return (
    <Card className="bg-slate-800 border-slate-700">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-white text-base">Link account — {resident.full_name}</CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}><X /></Button>
        </div>
        <p className="text-xs text-slate-400">
          Only resident accounts of this estate can be linked; each account links to one profile.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search resident accounts by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-slate-900 border-slate-700 text-white"
          />
        </div>
        {error && <p className="text-xs text-rose-400">{error}</p>}
        {isLoading ? (
          <p className="text-sm text-slate-400 py-4 text-center">Loading accounts…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">
            No unlinked resident accounts found. Invite the resident first (User Management).
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
            {filtered.map((u) => (
              <div key={u.id} className="flex items-center justify-between bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{u.full_name || u.email}</p>
                  <p className="text-xs text-slate-400 truncate">{u.email}</p>
                </div>
                <Button
                  size="sm"
                  className="bg-sky-500 hover:bg-sky-600 shrink-0"
                  disabled={linkMutation.isPending}
                  onClick={() => linkMutation.mutate(u.id)}
                >
                  <Link2 className="w-3 h-3 mr-1" />
                  {linkMutation.isPending && linkMutation.variables === u.id ? "Linking…" : "Link"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}