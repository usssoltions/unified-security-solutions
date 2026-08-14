import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Briefcase, Plus, CheckCircle2, RefreshCw, MapPin } from "lucide-react";
import AddDestinationModal from "@/components/access/AddDestinationModal";

export default function PurposeStep({ destinations = [], workTypes = [], onApprove, busy, eventType, canAddDestination = false }) {
  const [purpose, setPurpose] = useState(null);
  const [destination, setDestination] = useState("");
  const [workType, setWorkType] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const activeDestinations = destinations.filter((d) => d.active !== false);

  // A destination is ALWAYS required to approve entry — for both visits and
  // work (contractors/couriers). For work, the work type is also required so
  // we know exactly who they are and where they are going.
  const canApprove = purpose === "visit"
    ? !!destination
    : purpose === "work"
      ? !!workType && !!destination
      : false;

  const destinationSelect = (extra = null) => (
    <div className="space-y-1.5">
      <label className="text-slate-400 text-xs font-medium flex items-center gap-1">
        <MapPin className="w-3 h-3" /> Destination *
      </label>
      <div className="flex gap-2">
        <Select value={destination} onValueChange={setDestination}>
          <SelectTrigger className="bg-slate-900 border-slate-700 text-white h-11 flex-1">
            <SelectValue placeholder="Select destination" />
          </SelectTrigger>
          <SelectContent>
            {activeDestinations.map((d) => (
              <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
            ))}
            {activeDestinations.length === 0 && <SelectItem value="_none" disabled>No destinations available</SelectItem>}
          </SelectContent>
        </Select>
        {canAddDestination && (
          <Button variant="outline" onClick={() => setAddOpen(true)} className="border-slate-600 text-sky-300 h-11 px-3 shrink-0">
            <Plus className="w-4 h-4" />
          </Button>
        )}
      </div>
      {extra}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setPurpose("visit")}
          className={`flex flex-col items-center gap-1.5 py-4 rounded-xl border-2 transition-all ${
            purpose === "visit"
              ? "border-sky-400 bg-sky-500/15 text-sky-300"
              : "border-slate-700 bg-slate-800/50 text-slate-400"
          }`}
        >
          <Building2 className="w-6 h-6" />
          <span className="text-sm font-semibold">Visit</span>
        </button>
        <button
          onClick={() => setPurpose("work")}
          className={`flex flex-col items-center gap-1.5 py-4 rounded-xl border-2 transition-all ${
            purpose === "work"
              ? "border-amber-400 bg-amber-500/15 text-amber-300"
              : "border-slate-700 bg-slate-800/50 text-slate-400"
          }`}
        >
          <Briefcase className="w-6 h-6" />
          <span className="text-sm font-semibold">Work</span>
        </button>
      </div>

      {purpose === "visit" && destinationSelect()}

      {purpose === "work" && (
        <>
          <div className="space-y-1.5">
            <label className="text-slate-400 text-xs font-medium">Work Type *</label>
            <Select value={workType} onValueChange={setWorkType}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white h-11">
                <SelectValue placeholder="Select work type" />
              </SelectTrigger>
              <SelectContent>
                {workTypes.filter((w) => w.active !== false).map((w) => (
                  <SelectItem key={w.id} value={w.name}>{w.name}</SelectItem>
                ))}
                {workTypes.length === 0 && <SelectItem value="_none" disabled>No work types — add in Access Settings</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          {destinationSelect(
            <p className="text-xs text-amber-300/80">Required — we need to know exactly where this contractor / courier is going.</p>
          )}
        </>
      )}

      {canApprove && (
        <Button
          onClick={() => onApprove(purpose, { destination, workType })}
          disabled={busy}
          className="w-full bg-emerald-500 hover:bg-emerald-600 h-12 text-base"
        >
          {busy ? <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> : <CheckCircle2 className="w-5 h-5 mr-2" />}
          Approve {eventType === "exit" ? "Exit" : "Entry"}
        </Button>
      )}

      <AddDestinationModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}