import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Building2, Briefcase, Plus, Trash2, Shield, Phone, Mail } from "lucide-react";
import AddDestinationModal from "@/components/access/AddDestinationModal";

const DEFAULT_WORK_TYPES = [
  "Contractor", "Delivery", "Maintenance", "Gardener", "Cleaning",
  "Electrician", "Plumber", "Construction", "Security", "Municipality", "Other",
];

export default function AccessSettings() {
  const qc = useQueryClient();
  const [newWorkType, setNewWorkType] = useState("");
  const [addingDefaults, setAddingDefaults] = useState(false);

  const { data: destinations = [] } = useQuery({
    queryKey: ["destinations"],
    queryFn: () => base44.entities.Destination.list(),
  });
  const { data: workTypes = [] } = useQuery({
    queryKey: ["work_types"],
    queryFn: () => base44.entities.WorkType.list(),
  });

  const refresh = () => {
    qc.invalidateQueries(["destinations"]);
    qc.invalidateQueries(["work_types"]);
  };

  const addWorkType = async () => {
    const name = newWorkType.trim();
    if (!name) return;
    try {
      await base44.entities.WorkType.create({ name, active: true });
      setNewWorkType("");
      refresh();
    } catch (e) { console.warn(e); }
  };

  const seedDefaults = async () => {
    setAddingDefaults(true);
    const existing = new Set(workTypes.map((w) => w.name.toLowerCase()));
    const toAdd = DEFAULT_WORK_TYPES.filter((n) => !existing.has(n.toLowerCase()));
    try {
      if (toAdd.length) await base44.entities.WorkType.bulkCreate(toAdd.map((name) => ({ name, active: true })));
      refresh();
    } catch (e) { console.warn(e); }
    finally { setAddingDefaults(false); }
  };

  const deleteDestination = async (id) => {
    try { await base44.entities.Destination.delete(id); refresh(); } catch (e) { console.warn(e); }
  };
  const deleteWorkType = async (id) => {
    try { await base44.entities.WorkType.delete(id); refresh(); } catch (e) { console.warn(e); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pb-10">
      <div className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-xl border-b border-slate-700/50 px-4 py-3">
        <div className="flex items-center gap-3 max-w-3xl mx-auto">
          <div className="w-10 h-10 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg leading-tight">Access Settings</h1>
            <p className="text-slate-400 text-xs">Destinations & work types</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 space-y-6">
        {/* Destinations */}
        <section className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-sky-400" />
              <h2 className="text-white font-semibold">Destinations</h2>
              <Badge className="bg-slate-700">{destinations.length}</Badge>
            </div>
            <AddDestinationModalTrigger onCreated={refresh} />
          </div>
          <div className="space-y-2">
            {destinations.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-xl bg-slate-900/60 border border-slate-800 p-3">
                <div className="min-w-0">
                  <p className="text-white text-sm font-medium">{d.name}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400 mt-0.5">
                    {d.contact_person && <span>{d.contact_person}</span>}
                    {d.telephone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{d.telephone}</span>}
                    {d.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{d.email}</span>}
                    {d.unit && <span>Unit {d.unit}</span>}
                  </div>
                </div>
                <button onClick={() => deleteDestination(d.id)} className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-rose-400 shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            {destinations.length === 0 && (
              <p className="text-slate-500 text-sm text-center py-6">No destinations yet. Add one to start logging visits.</p>
            )}
          </div>
        </section>

        {/* Work Types */}
        <section className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Briefcase className="w-5 h-5 text-amber-400" />
            <h2 className="text-white font-semibold">Work Types</h2>
            <Badge className="bg-slate-700">{workTypes.length}</Badge>
          </div>
          <div className="flex gap-2 mb-3">
            <Input
              placeholder="Add work type (e.g. Electrician)"
              value={newWorkType}
              onChange={(e) => setNewWorkType(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addWorkType()}
              className="bg-slate-900 border-slate-700 text-white"
            />
            <Button onClick={addWorkType} className="bg-amber-500 hover:bg-amber-600 shrink-0">
              <Plus className="w-4 h-4 mr-1" /> Add
            </Button>
          </div>
          {workTypes.length === 0 && (
            <Button variant="outline" onClick={seedDefaults} disabled={addingDefaults} className="w-full border-slate-600 text-slate-300 mb-3">
              {addingDefaults ? "Adding…" : "Add default work types (Contractor, Plumber, etc.)"}
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            {workTypes.map((w) => (
              <div key={w.id} className="flex items-center gap-2 rounded-full bg-slate-900/70 border border-slate-800 pl-3 pr-1 py-1.5">
                <span className="text-slate-200 text-sm">{w.name}</span>
                <button onClick={() => deleteWorkType(w.id)} className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {workTypes.length === 0 && <p className="text-slate-500 text-sm">No work types yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

function AddDestinationModalTrigger({ onCreated }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} className="bg-sky-500 hover:bg-sky-600">
        <Plus className="w-4 h-4 mr-1" /> Add
      </Button>
      <AddDestinationModal open={open} onClose={() => setOpen(false)} onCreated={onCreated} />
    </>
  );
}