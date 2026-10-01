import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import MyTasksView from "@/components/tasks/MyTasksView";
import OperatorQueueView from "@/components/tasks/OperatorQueueView";
import SupervisorView from "@/components/tasks/SupervisorView";
import OBQueueView from "@/components/tasks/OBQueueView";
import OBSchedulesView from "@/components/tasks/OBSchedulesView";
import OBRegisterView from "@/components/tasks/OBRegisterView";
import BrandHeader from "@/components/branding/BrandHeader";

/**
 * CONTROL ROOM TASK SCHEDULING — role-aware module shell. All data flows
 * through the scheduledTaskAccess gateway, which resolves the caller's tenant
 * server-side: guards see only their own tasks (MY TASKS), Control Room
 * Operators see only their authorised control rooms' queues, supervisors and
 * customer admins manage task lists, control rooms and all tasks. Cross-tenant
 * access fails closed (403), and the page is module-gated (TASK_SCHEDULING /
 * OPERATIONS / COMPLETE_SECURITY) by the route guard.
 *
 * DIGITAL OCCURRENCE BOOK: when the customer's Digital OB setting is ON
 * (server-resolved by obAccess bootstrap), the page gains Occurrence Book
 * tabs — operators record checks and unscheduled entries, admins/supervisors
 * manage OB schedules and the register/report. When OFF (or the customer has
 * no OB entitlement) the page is exactly the ordinary task page.
 */
const OB_ELIGIBLE_ROLES = ["control_room_operator", "dispatcher", "admin", "customer_admin"];

export default function ScheduledTasks() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [obTab, setObTab] = useState("tasks");

  const { data, isLoading } = useQuery({
    queryKey: ["scheduledTasks", user?.id],
    queryFn: async () => {
      const res = await base44.functions.invoke("scheduledTaskAccess", { action: "list" });
      return res?.data ?? res;
    },
    enabled: !!user,
    staleTime: 0,
  });

  // Occurrence Book bootstrap (server-resolved entitlement + scoping). A 403
  // simply means this role/customer has no OB access — OB tabs stay hidden.
  const { data: ob, refetch: obRefetch } = useQuery({
    queryKey: ["obBootstrap", user?.id],
    queryFn: async () => {
      try {
        const res = await base44.functions.invoke("obAccess", { action: "bootstrap" });
        return res?.data ?? res;
      } catch (_) { return null; }
    },
    enabled: !!user && OB_ELIGIBLE_ROLES.indexOf(user.role_type) !== -1,
    staleTime: 60 * 1000,
  });
  const obOn = !!ob?.ob_enabled;
  const refreshOb = () => obRefetch();

  // OB gateway actions (obAccess) — same toast/error contract as tasks.
  const actOb = async (payload, successMsg) => {
    try {
      const res = await base44.functions.invoke("obAccess", payload);
      const d = res?.data ?? res;
      if (!d || d.error) throw new Error(d?.error || "The action failed. Please try again.");
      obRefetch();
      if (successMsg) toast({ title: successMsg });
      return d;
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || "The action failed. Please try again.";
      toast({ title: msg, variant: "destructive" });
      throw e;
    }
  };

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
      {/* Effective tenant brand header — shared resolver. Renders nothing for
          platform-level users so their view of this page is unchanged. */}
      <BrandHeader
        user={user}
        title="Scheduled Tasks"
        subtitle={user ? (user.display_name || user.full_name) : ""}
        className="mb-4"
      />
      {obOn && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-5">
          <button onClick={() => setObTab("tasks")}
            className={`px-4 h-9 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors ${obTab === "tasks" ? "bg-sky-500/20 border-sky-500/50 text-sky-300" : "bg-slate-800/60 border-slate-700 text-slate-400"}`}>
            Tasks
          </button>
          <button onClick={() => setObTab("ob")}
            className={`px-4 h-9 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors ${obTab === "ob" ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-300" : "bg-slate-800/60 border-slate-700 text-slate-400"}`}>
            Occurrence Book
          </button>
          {!data?.is_operator && (
            <>
              <button onClick={() => setObTab("ob_schedules")}
                className={`px-4 h-9 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors ${obTab === "ob_schedules" ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-300" : "bg-slate-800/60 border-slate-700 text-slate-400"}`}>
                OB Schedules
              </button>
              <button onClick={() => setObTab("ob_register")}
                className={`px-4 h-9 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors ${obTab === "ob_register" ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-300" : "bg-slate-800/60 border-slate-700 text-slate-400"}`}>
                OB Register
              </button>
            </>
          )}
        </div>
      )}
      {obOn && obTab === "ob" ? (
        <OBQueueView ob={ob} act={actOb} user={user} refresh={refreshOb} />
      ) : obOn && obTab === "ob_schedules" && !data?.is_operator ? (
        <OBSchedulesView ob={ob} act={actOb} refresh={refreshOb} />
      ) : obOn && obTab === "ob_register" && !data?.is_operator ? (
        <OBRegisterView ob={ob} user={user} />
      ) : data?.is_operator ? (
        <OperatorQueueView data={data} act={act} user={user} />
      ) : user?.role_type === "guard" ? (
        <MyTasksView data={data} act={act} user={user} />
      ) : (
        <SupervisorView data={data} act={act} user={user} />
      )}
    </div>
  );
}