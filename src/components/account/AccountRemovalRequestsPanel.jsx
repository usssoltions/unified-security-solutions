import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ClipboardList, Check, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/use-toast";
import { base44 } from "@/api/base44Client";

/**
 * Account Removal Requests — administrative review area.
 *
 * Scope is resolved SERVER-SIDE by the accountLifecycle gateway:
 *  - Customer Administrator sees only requests belonging to their customer.
 *  - Reseller Administrator sees only authorised reseller/customer scope.
 *  - Platform Administrator sees platform-wide oversight.
 * Approve performs the full validated removal (hierarchy, last-admin and
 * operational dependency checks); Reject notifies the requesting user.
 */
export default function AccountRemovalRequestsPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => base44.auth.me(),
    retry: false,
  });

  const isAdmin = !!me && (
    me.role === "admin" || me.admin_level ||
    ["platform_admin", "reseller_admin", "customer_admin", "practice_admin", "estate_manager"].includes(me.role_type)
  );

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["accountRemovalRequests"],
    queryFn: async () => {
      const res = await base44.functions.invoke("accountLifecycle", { action: "listRequests" });
      const d = res?.data !== undefined ? res.data : res;
      if (d?.error) throw new Error(d.error);
      return d?.requests || [];
    },
    enabled: !!isAdmin,
  });

  const approveMutation = useMutation({
    mutationFn: async (request) => {
      const res = await base44.functions.invoke("accountLifecycle", {
        action: "approveAccountRemoval", request_id: request.id,
      });
      const d = res?.data !== undefined ? res.data : res;
      if (d?.error) throw new Error(d.error);
      return d;
    },
    onSuccess: (_, request) => {
      queryClient.invalidateQueries({ queryKey: ["accountRemovalRequests"] });
      queryClient.invalidateQueries({ queryKey: ["allUsers"] });
      toast({
        title: "Account removed",
        description: `${request.user_name || request.user_email}'s account was removed. Operational history is preserved.`,
      });
    },
    onError: (e) => {
      toast({
        title: "Removal not performed",
        description: e?.message || "The account was NOT removed.",
        variant: "destructive",
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ request, notes }) => {
      const res = await base44.functions.invoke("accountLifecycle", {
        action: "rejectAccountRemoval", request_id: request.id, review_notes: notes,
      });
      const d = res?.data !== undefined ? res.data : res;
      if (d?.error) throw new Error(d.error);
      return d;
    },
    onSuccess: (_, { request }) => {
      queryClient.invalidateQueries({ queryKey: ["accountRemovalRequests"] });
      toast({
        title: "Request rejected",
        description: `${request.user_name || request.user_email} has been notified.`,
      });
    },
    onError: (e) => {
      toast({ title: "Could not reject", description: e?.message || "Please try again.", variant: "destructive" });
    },
  });

  if (!isAdmin) return null;

  const handleApprove = (request) => {
    const ok = window.confirm(
      `Approve account removal?\n\n${request.user_name || request.user_email}\n${request.user_email}\n\n` +
      `The user's login and personal account information will be removed. Operational history is preserved. ` +
      `Future memberships and schedule will be resolved safely.`
    );
    if (!ok) return;
    approveMutation.mutate(request);
  };

  const handleReject = (request) => {
    const notes = window.prompt(
      `Reject the account removal request for ${request.user_name || request.user_email}?\n\nOptional note for the user:`,
      ""
    );
    if (notes === null) return;
    rejectMutation.mutate({ request, notes });
  };

  const statusBadge = (status) => ({
    pending: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
    completed: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
    rejected: "bg-rose-500/20 text-rose-300 border border-rose-500/40",
    cancelled: "bg-slate-700/60 text-slate-300",
  }[status] || "bg-slate-700/60 text-slate-300");

  const pending = requests.filter(r => r.status === "pending");
  const reviewed = requests.filter(r => r.status !== "pending").slice(0, 10);

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2 text-lg">
          <ClipboardList className="w-5 h-5 text-amber-400" />
          Account Removal Requests
          {pending.length > 0 && (
            <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/40">{pending.length} pending</Badge>
          )}
        </CardTitle>
        <CardDescription className="text-slate-400">
          Users can request removal of their account. Approving removes their login and personal
          information — security and operational records are retained. Approval validates
          administrator authority and operational dependencies server-side.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-slate-400 py-2 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading requests…
          </p>
        ) : pending.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">No pending account removal requests.</p>
        ) : pending.map((request) => (
          <div key={request.id} className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-white text-sm font-medium">
                  {request.user_name || request.user_email}
                  <span className="text-slate-500 font-normal"> · {request.user_email}</span>
                </p>
                <p className="text-slate-400 text-xs flex items-center gap-2 flex-wrap">
                  <span>{request.user_role || "—"}</span>
                  {request.organisation_name && <span>· {request.organisation_name}</span>}
                  <span>· requested {request.requested_at ? new Date(request.requested_at).toLocaleString() : "—"}</span>
                </p>
              </div>
              <Badge className={statusBadge("pending")}>Pending Review</Badge>
            </div>
            {request.reason && (
              <p className="text-sm text-slate-300 bg-slate-800/60 rounded-md px-2.5 py-1.5">
                <span className="text-slate-500">Reason:</span> {request.reason}
              </p>
            )}
            {request.dependency_summary && (
              <p className="text-xs text-slate-400 bg-slate-800/40 rounded-md px-2.5 py-1.5">
                <span className="text-slate-500">Operational dependencies:</span> {request.dependency_summary}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleApprove(request)}
                disabled={approveMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white h-11 px-4 active:scale-95 transition-transform touch-manipulation"
              >
                {approveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4 mr-1" /> Approve</>}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleReject(request)}
                disabled={rejectMutation.isPending}
                className="border-rose-500/40 text-rose-300 hover:bg-rose-500/10 h-11 px-4 active:scale-95 transition-transform touch-manipulation"
              >
                {rejectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><X className="w-4 h-4 mr-1" /> Reject</>}
              </Button>
            </div>
          </div>
        ))}

        {reviewed.length > 0 && (
          <div className="pt-1 space-y-1.5">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Recently reviewed</p>
            {reviewed.map((request) => (
              <div key={request.id} className="flex items-center justify-between gap-3 text-sm bg-slate-900/40 rounded-md px-2.5 py-1.5">
                <span className="text-slate-300 truncate">
                  {request.user_name || request.user_email}
                  {request.reviewed_at && (
                    <span className="text-slate-500"> · {new Date(request.reviewed_at).toLocaleDateString()}</span>
                  )}
                </span>
                <Badge className={statusBadge(request.status)}>{request.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}