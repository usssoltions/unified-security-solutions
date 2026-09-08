import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import MyTasksView from "@/components/tasks/MyTasksView";
import OperatorQueueView from "@/components/tasks/OperatorQueueView";
import SupervisorView from "@/components/tasks/SupervisorView";

/**
 * CONTROL ROOM TASK SCHEDULING — role-aware module shell. All data flows
 * through the scheduledTaskAccess gateway, which resolves the caller's tenant
 * server-side: guards see only their own tasks (MY TASKS), Control Room
 * Operators see only their authorised control rooms' queues, supervisors and
 * customer admins manage task lists, control rooms and all tasks. Cross-tenant
 * access fails closed (403), and the page is module-gated (TASK_SCHEDULING /
 * OPERATIONS / COMPLETE_SECURITY) by the route guard.
 */
export default function ScheduledTasks() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["scheduledTasks", user?.id],
    queryFn: async () => {
      const res = await base44.functions.invoke("scheduledTaskAccess", { action: "list" });
      return res?.data ?? res;
    },
    enabled: !!user,
    staleTime: 0,
  });

  const act = async (payload, successMsg) => {
    try {
      const res = await base44.functions.invoke("scheduledTaskAccess", payload);
      const d = res?.data ?? res;
      if (!d || d.error) throw new Error(d?.error || "The action failed. Please try again.");
      qc.invalidateQueries({ queryKey: ["scheduledTasks"] });
      if (successMsg) toast({ title: successMsg });
      return d;
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || "The action failed. Please try again.";
      toast({ title: msg, variant: "destructive" });
      throw e;
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-slate-600 border-t-sky-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto w-full">
      {data?.is_operator ? (
        <OperatorQueueView data={data} act={act} user={user} />
      ) : user?.role_type === "guard" ? (
        <MyTasksView data={data} act={act} user={user} />
      ) : (
        <SupervisorView data={data} act={act} user={user} />
      )}
    </div>
  );
}