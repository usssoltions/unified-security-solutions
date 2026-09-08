import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ClipboardList, Plus, Building2 } from "lucide-react";
import TaskBatchForm from "./TaskBatchForm";
import ControlRoomManager from "./ControlRoomManager";
import BatchListTab from "./BatchListTab";
import AllTasksTab from "./AllTasksTab";

/**
 * SUPERVISOR / CUSTOMER ADMIN VIEW — Task Scheduling shell. Task list
 * management (create, edit, cancel, archive, delete where safe) lives in
 * BatchListTab; the full task view (assign / verify / reason + archive /
 * restore / delete + bulk actions) lives in AllTasksTab. All writes go
 * through the tenant gateway (scheduledTaskAccess) which revalidates every
 * lifecycle rule server-side.
 */
export default function SupervisorView({ data, act, user }) {
  const [tab, setTab] = useState("batches");
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [showRooms, setShowRooms] = useState(false);
  const [saving, setSaving] = useState(false);

  const tasks = useMemo(
    () => [...(data?.tasks || []), ...(data?.archived_tasks || [])], [data]);
  const batches = useMemo(
    () => [...(data?.batches || []), ...(data?.archived_batches || [])], [data]);

  const submitBatch = async (payload) => {
    setSaving(true);
    try {
      await act({ action: "createBatch", ...payload }, "Task list created");
      setShowBatchForm(false);
    } catch (_) {} finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
            <ClipboardList className="w-6 h-6 text-sky-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Task Scheduling</h1>
            <p className="text-sm text-slate-400">Task lists → control rooms → operators → guards</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowBatchForm(true)}
            className="bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white h-11 px-5">
            <Plus className="w-4 h-4" /> New Task List
          </Button>
          <Button variant="outline" onClick={() => setShowRooms(true)}
            className="bg-slate-800 border-slate-700 text-slate-200 h-11 px-5">
            <Building2 className="w-4 h-4" /> Control Rooms
          </Button>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {[["batches", "Task Lists"], ["tasks", "All Tasks"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 h-9 rounded-lg text-sm font-medium border transition-colors ${tab === key ? "bg-sky-500/20 border-sky-500/50 text-sky-300" : "bg-slate-800/60 border-slate-700 text-slate-400"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "batches"
        ? <BatchListTab batches={batches} tasks={tasks} data={data} act={act} />
        : <AllTasksTab tasks={tasks} data={data} act={act} />}

      <TaskBatchForm open={showBatchForm} data={data} saving={saving}
        onClose={() => setShowBatchForm(false)} onSubmit={submitBatch} />
      <ControlRoomManager open={showRooms} data={data} act={act}
        onClose={() => setShowRooms(false)} />
    </div>
  );
}