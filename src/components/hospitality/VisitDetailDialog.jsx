import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import EvidencePanel from "./EvidencePanel";
import {
  HOSP_CATEGORY_LABELS, PRESENCE_LABELS, ADMISSION_LABELS, presenceOf, fmtDT, yesNo,
  confirmationText, evidenceCount,
} from "@/lib/hospitalityMeta";

const Row = ({ label, value }) => (
  <div className="flex justify-between gap-3 py-1 border-b border-slate-800 text-sm">
    <span className="text-slate-400">{label}</span>
    <span className="text-slate-100 text-right break-words">{value ?? "—"}</span>
  </div>
);
const Section = ({ title, children }) => (
  <div className="space-y-0.5"><p className="text-slate-300 text-xs font-semibold uppercase tracking-wide pt-2">{title}</p>{children}</div>
);

export default function VisitDetailDialog({ visit, onClose, onCancel }) {
  if (!visit) return null;
  const e = visit.entry;
  const canCancel = visit.status === "pending" || visit.status === "confirming";
  return (
    <Dialog open={!!visit} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{visit.person_name} — {HOSP_CATEGORY_LABELS[visit.category]}</DialogTitle></DialogHeader>
        <Section title="Decision & presence">
          <Row label="Admission decision" value={ADMISSION_LABELS[visit.status]} />
          <Row label="Current presence" value={PRESENCE_LABELS[presenceOf(visit)]} />
          <Row label="Visit created" value={fmtDT(visit.created_date)} />
          <Row label="Confirmed at" value={fmtDT(visit.confirmed_at)} />
          {visit.status === "cancelled" && <Row label="Cancelled" value={`${fmtDT(visit.cancelled_at)} by ${visit.cancelled_by_name || "—"}`} />}
          {visit.cancel_reason && <Row label="Cancel reason" value={visit.cancel_reason} />}
        </Section>
        <Section title="Answers">
          <Row label="Site" value={visit.site_name} />
          <Row label="Mobile" value={visit.person_phone} />
          <Row label="Confirmation" value={confirmationText(visit)} />
          {(visit.guest_name || visit.guest_surname) && <Row label="Guest" value={[visit.guest_name, visit.guest_surname].filter(Boolean).join(" ")} />}
          {visit.room_number && <Row label="Room number" value={visit.room_number} />}
          <Row label="Occupants" value={visit.occupant_count} />
          {visit.firearm_declared !== null && visit.firearm_declared !== undefined && <Row label="Firearm declared" value={yesNo(visit.firearm_declared)} />}
          {visit.po_invoice_available !== null && visit.po_invoice_available !== undefined && <Row label="PO / Invoice available" value={yesNo(visit.po_invoice_available)} />}
          {visit.staff_declared !== null && visit.staff_declared !== undefined && <Row label="Staff declaration" value={yesNo(visit.staff_declared)} />}
          {visit.pedestrian_only && <Row label="Pedestrian only" value="Yes — vehicle remained outside" />}
          {visit.identity_document_type && <Row label="Identity document" value={visit.identity_document_type.replace(/_/g, " ")} />}
          {visit.driver_licence_number && <Row label="Licence number" value={visit.driver_licence_number} />}
        </Section>
        <Section title="Entry / exit attribution">
          <Row label="Entry" value={e ? `${fmtDT(e.entry_time)} · ${e.gate_name || "—"}` : "—"} />
          <Row label="Entry processed by" value={e ? `${e.guard_name || "—"}${e.entry_device_name ? ` on ${e.entry_device_name}` : ""}` : visit.created_by_guard_name} />
          <Row label="Exit" value={e?.exit_time ? `${fmtDT(e.exit_time)} · ${e.exit_gate || "—"}` : "—"} />
          <Row label="Exit processed by" value={e?.exit_guard_name ? `${e.exit_guard_name}${e.exit_device_name ? ` on ${e.exit_device_name}` : ""}` : "—"} />
          {e?.time_on_site_minutes !== null && e?.time_on_site_minutes !== undefined && <Row label="Time on site" value={`${e.time_on_site_minutes} min`} />}
          {e?.flag_reason && <Row label="Flag" value={e.flag_reason} />}
        </Section>
        <Section title="Evidence">
          <div className="pt-1"><EvidencePanel visitId={visit.id} count={evidenceCount(visit)} /></div>
        </Section>
        {canCancel && (
          <Button onClick={() => onCancel(visit)} variant="outline" className="mt-3 h-11 border-rose-500/40 text-rose-400 hover:bg-rose-500/10 active:scale-95 transition-transform">
            Cancel abandoned visit
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}