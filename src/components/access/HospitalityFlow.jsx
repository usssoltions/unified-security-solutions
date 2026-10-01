import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import HospitalityPhotoCapture from "./HospitalityPhotoCapture";
import HospDocCaptureCard from "./HospDocCaptureCard";
import { getInstallationId } from "@/lib/deviceRegistration";
import { getGPS } from "@/lib/accessVisitor";

// Question set per category — mirrors the server-side validator
// (base44/shared/gridGateWorkflow.ts). The SERVER remains authoritative:
// every answer is re-validated at hospitality_submit and a missing/negative
// required confirmation keeps the visit pending with access NOT granted.
const CATEGORY_LABELS = {
  check_in: "Check Ins", contractor: "Contractors", delivery: "Deliveries",
  event_visitor: "Event or Function Visitor", guest: "Guests",
  service_provider: "Service Provider", staff: "Staff",
  uber_eats_mrd: "Uber Eats / Mr D", uber: "Uber", visitor: "Visitors",
};
const CATEGORY_QUESTIONS = {
  check_in: ["guest_name", "guest_surname", "reception", "occupants", "firearm"],
  contractor: ["reception", "occupants", "vehicle_photos"],
  delivery: ["reception", "po_invoice", "occupants", "vehicle_photos"],
  event_visitor: ["occupants", "firearm"],
  guest: ["room_number", "occupants", "firearm"],
  service_provider: ["reception", "occupants", "vehicle_photos"],
  staff: ["occupants", "staff_declared"],
  uber_eats_mrd: ["reception", "food_photo", "delivery_person_photo", "identity_doc"],
  uber: ["reception", "occupants", "firearm", "identity_doc"],
  visitor: ["room_number", "room_source", "occupants", "firearm"],
};
const ID_DOC_OPTIONS = [
  { id: "sa_drivers_licence_disc", label: "SA driver's licence" },
  { id: "passport", label: "Passport" },
  { id: "foreign_drivers_licence", label: "Foreign licence" },
];
const RECEPTION_PROMPTS = {
  check_in: "Did you check the guest name & surname with Reception?",
  contractor: "Did you call the relevant department to confirm the Contractor?",
  delivery: "Did you call the relevant department to confirm the delivery?",
  service_provider: "Did you call the relevant department to confirm the Supplier?",
  uber_eats_mrd: "Did you call reception to confirm the delivery (guest name / room number)?",
  uber: "Did you call reception to confirm the pick up (guest name / room number)?",
};
// PDF sequence: these categories scan "Vehicle Disk" then "Licence Disk"
// (the driver's licence card). Uber / Uber Eats scan the disc + identity doc.
const SCAN_PAIR = ["check_in", "contractor", "delivery", "event_visitor", "guest", "service_provider", "staff", "visitor"];

function YesNo({ label, value, onChange, disabled }) {
  return (
    <div className="space-y-1.5">
      <p className="text-slate-300 text-sm font-medium">{label}</p>
      <div className="flex gap-2">
        <button type="button" disabled={disabled} onClick={() => onChange(true)}
          className={`flex-1 h-11 rounded-lg text-sm font-semibold transition-all active:scale-95 ${value === true ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30" : "bg-slate-800 text-slate-300 border border-slate-700"}`}>
          Yes
        </button>
        <button type="button" disabled={disabled} onClick={() => onChange(false)}
          className={`flex-1 h-11 rounded-lg text-sm font-semibold transition-all active:scale-95 ${value === false ? "bg-rose-500 text-white shadow-lg shadow-rose-500/30" : "bg-slate-800 text-slate-300 border border-slate-700"}`}>
          No
        </button>
      </div>
    </div>
  );
}

export default function HospitalityFlow({ category, site, gate, openScanner, hospScan, onDone, onCancelled, onClose }) {
  const questions = CATEGORY_QUESTIONS[category] || [];
  const [answers, setAnswers] = useState({
    person_name: "", person_phone: "", guest_name: "", guest_surname: "",
    room_number: "", occupant_count: "", reception_confirmed: null,
    firearm_declared: null, po_invoice_available: null, staff_declared: null,
    room_number_source: null, identity_document_type: null, identity_document_number: "",
  });
  const [idDocPhoto, setIdDocPhoto] = useState([]);
  const [vehiclePhotos, setVehiclePhotos] = useState([]);
  const [staffPhotos, setStaffPhotos] = useState([]);
  const [firearmPhoto, setFirearmPhoto] = useState([]);
  const [poPhoto, setPoPhoto] = useState([]);
  const [foodPhoto, setFoodPhoto] = useState([]);
  const [deliveryPersonPhoto, setDeliveryPersonPhoto] = useState([]);
  // Document captures: { method, identifier, payload, photoUri, fields }
  const [disc, setDisc] = useState(null);
  const [lic, setLic] = useState(null);
  const [discError, setDiscError] = useState(null);
  const [licError, setLicError] = useState(null);
  const [visitId, setVisitId] = useState(null);
  // Idempotency token for THIS open submission flow — generated once per
  // flow open and reused for every resubmission of the same visit, so a
  // retried, double-tapped or interrupted submission can never create a
  // second confirmed visit / AccessLog (the server deduplicates on it).
  const [submitToken] = useState(() => (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `st_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const setA = (k, v) => setAnswers((p) => ({ ...p, [k]: v }));

  const isUberEats = category === "uber_eats_mrd";
  const isUberCat = category === "uber" || isUberEats;
  const needsScanPair = SCAN_PAIR.includes(category);
  const needsDisc = needsScanPair || isUberCat;
  const uberSaLicence = isUberCat && answers.identity_document_type === "sa_drivers_licence_disc";
  const needsLic = needsScanPair || uberSaLicence;

  const processScan = (profileId, scan) => {
    const mapped = scan?.mappedFields || {};
    const textual = scan?.result?.textualData || scan?.textualData || "";
    if (profileId === "vehicle_disc") {
      if (mapped.registration_number) {
        setDisc({
          method: "scanned", identifier: mapped.registration_number, payload: textual,
          fields: {
            licence_number: mapped.licence_number || "", make: mapped.make || "",
            model: mapped.model || "", colour: mapped.colour || "", vin: mapped.vin || "",
          },
        });
        setDiscError(null);
      } else {
        setDiscError("The disc was read but no registration number was decoded — use the photo + manual route.");
      }
    } else if (profileId === "drivers_licence") {
      const holder = [mapped.first_names, mapped.surname].filter(Boolean).join(" ");
      if (mapped.driver_licence_number) {
        setLic({
          method: "scanned", identifier: mapped.driver_licence_number, payload: textual,
          fields: { holder_name: holder, id_number: mapped.visitor_id_number || "" },
        });
        setLicError(null);
        if (holder) setAnswers((p) => (p.person_name.trim() ? p : { ...p, person_name: holder }));
      } else {
        setLicError("The licence was read but no licence number was decoded — use the photo + manual route.");
      }
    }
  };

  // Scan results arrive from the shared DocumentScanner (opened by the parent
  // page, which owns the single scanner session).
  useEffect(() => {
    if (!hospScan) return;
    processScan(hospScan.profileId, hospScan.scan);
  }, [hospScan]);

  const startDiscScan = () => { setDiscError(null); openScanner?.("vehicle_disc"); };
  const startLicScan = () => { setLicError(null); openScanner?.("drivers_licence"); };

  const submit = async () => {
    setBusy(true);
    setServerError(null);
    try {
      const gps = await getGPS().catch(() => null);
      const toCapture = (c, idKey, extraFields) => c ? {
        method: c.method,
        [idKey]: c.identifier,
        ...(c.method === "scanned" ? { payload: c.payload || "" } : {}),
        ...Object.fromEntries(Object.entries(c.fields || extraFields || {}).map(([k, v]) => [k, v || ""])),
        photo_uri: c.photoUri || null,
      } : null;
      const payload = {
        site_id: site?.id,
        category,
        gate_name: gate,
        person_name: answers.person_name,
        person_phone: answers.person_phone || "",
        scan_method: "manual",
        installation_id: getInstallationId(),
        location: gps,
        guest_name: answers.guest_name || answers.person_name,
        guest_surname: answers.guest_surname || "",
        // Visitors who knew the room: reception is not applicable (null).
        reception_confirmed: category === "visitor" && answers.room_number_source !== "confirmed_by_reception" ? null : answers.reception_confirmed,
        room_number_source: category === "visitor" ? answers.room_number_source : null,
        identity_document_type: q("identity_doc") ? answers.identity_document_type : null,
        identity_document_photo_uri: q("identity_doc") && ["passport", "foreign_drivers_licence"].includes(answers.identity_document_type) ? (idDocPhoto[0] || null) : null,
        identity_document_number: q("identity_doc") && ["passport", "foreign_drivers_licence"].includes(answers.identity_document_type) ? (answers.identity_document_number.trim() || null) : null,
        vehicle_disc: needsDisc ? toCapture(disc, "registration_number") : null,
        driver_licence: needsLic ? toCapture(lic, "licence_number") : null,
        occupant_count: isUberEats ? 1 : (answers.occupant_count === "" ? null : Number(answers.occupant_count)),
        room_number: answers.room_number || "",
        firearm_declared: answers.firearm_declared,
        firearm_photo_uri: firearmPhoto[0] || null,
        po_invoice_available: answers.po_invoice_available,
        po_invoice_photo_uri: poPhoto[0] || null,
        vehicle_photo_uris: vehiclePhotos,
        staff_declared: answers.staff_declared,
        staff_declaration_photo_uris: staffPhotos,
        food_photo_uri: foodPhoto[0] || null,
        delivery_person_photo_uri: deliveryPersonPhoto[0] || null,
        pedestrian_only: isUberEats,
        hospitality_visit_id: visitId || undefined,
        submit_token: submitToken,
      };
      const res = await base44.functions.invoke("finalizeAccessEntry", { action: "hospitality_submit", access_data: payload });
      const d = res?.data !== undefined ? res.data : res;
      if (d?.pending) {
        setVisitId(d.hospitality_visit_id);
        setServerError(d.error || "Access not granted yet — complete the required information.");
        return;
      }
      if (d?.error) { setServerError(d.error); return; }
      onDone({
        person_name: answers.person_name,
        person_type: "visitor",
        event_type: d?.blacklist_match ? "denied" : "entry",
        status: d?.access_log?.status || "inside",
        flagged: !!d?.blacklist_match,
        flag_reason: d?.blacklist_match ? `Blacklisted: ${d.blacklist_match.reason}` : "",
        gate_name: gate,
        timestamp: d?.access_log?.timestamp || new Date().toISOString(),
        hospitality_category: CATEGORY_LABELS[category],
      });
    } catch (e) {
      setServerError(e?.message || "Submission failed — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const cancelVisit = async () => {
    if (!visitId) { onClose(); return; }
    if (!cancelReason.trim()) { setServerError("Please enter a cancellation reason."); return; }
    setBusy(true);
    try {
      const res = await base44.functions.invoke("finalizeAccessEntry", {
        action: "hospitality_cancel",
        access_data: { hospitality_visit_id: visitId, reason: cancelReason },
      });
      const d = res?.data !== undefined ? res.data : res;
      if (d?.error) { setServerError(d.error); return; }
      onCancelled?.(`${CATEGORY_LABELS[category]} entry cancelled — access was never granted.`);
    } catch (e) {
      setServerError(e?.message || "Cancellation failed — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const q = (key) => questions.includes(key);

  // Guest-facing greeting — the site's hospitality display name (falls back
  // to the site name), with the time-of-day welcome from the workflow PDF.
  const hour = new Date().getHours();
  const daypart = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const displayName = site?.hospitality_display_name || site?.name || "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-emerald-300 text-xs font-semibold uppercase tracking-wide">GRID GATE Hospitality</p>
          <p className="text-white font-bold text-lg leading-tight">{CATEGORY_LABELS[category]}</p>
        </div>
        <button onClick={onClose} disabled={busy} className={`w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 active:scale-95 transition-transform ${busy ? "opacity-40" : ""}`}>
          <X className="w-4 h-4" />
        </button>
      </div>
      {displayName && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
          <p className="text-emerald-200 text-sm font-semibold">Good {daypart} — welcome to {displayName}</p>
        </div>
      )}

      <div className="space-y-3">
        <div className="space-y-1.5">
          <p className="text-slate-300 text-sm font-medium">Person's full name</p>
          <Input value={answers.person_name} onChange={(e) => setA("person_name", e.target.value)}
            placeholder="Full name (filled from the licence scan)" className="bg-slate-900 border-slate-700 text-white h-11" />
        </div>
        <div className="space-y-1.5">
          <p className="text-slate-300 text-sm font-medium">Mobile number</p>
          <Input value={answers.person_phone} onChange={(e) => setA("person_phone", e.target.value)} type="tel"
            placeholder="e.g. 082 123 4567" className="bg-slate-900 border-slate-700 text-white h-11" />
        </div>

        {q("guest_name") && (
          <div className="space-y-1.5">
            <p className="text-slate-300 text-sm font-medium">Guest name (check with Reception)</p>
            <Input value={answers.guest_name} onChange={(e) => setA("guest_name", e.target.value)}
              placeholder="Guest name" className="bg-slate-900 border-slate-700 text-white h-11" />
          </div>
        )}
        {q("guest_surname") && (
          <div className="space-y-1.5">
            <p className="text-slate-300 text-sm font-medium">Guest surname</p>
            <Input value={answers.guest_surname} onChange={(e) => setA("guest_surname", e.target.value)}
              placeholder="Guest surname" className="bg-slate-900 border-slate-700 text-white h-11" />
          </div>
        )}
        {q("room_number") && (
          <div className="space-y-1.5">
            <p className="text-slate-300 text-sm font-medium">Room number {category === "visitor" && "(call reception if the visitor does not know it)"}</p>
            <Input value={answers.room_number} onChange={(e) => setA("room_number", e.target.value)}
              placeholder="Room number" className="bg-slate-900 border-slate-700 text-white h-11" />
          </div>
        )}
        {q("room_source") && (
          <div className="space-y-1.5">
            <p className="text-slate-300 text-sm font-medium">How was the room number obtained?</p>
            <div className="grid grid-cols-2 gap-2">
              {[["provided", "Visitor knew it"], ["confirmed_by_reception", "Called reception"]].map(([id, lbl]) => (
                <button key={id} type="button" disabled={busy} onClick={() => setA("room_number_source", id)}
                  className={`h-11 rounded-lg text-sm font-semibold transition-all active:scale-95 ${answers.room_number_source === id ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-300 border border-slate-700"}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        )}
        {(q("reception") || (category === "visitor" && answers.room_number_source === "confirmed_by_reception")) && (
          <YesNo label={RECEPTION_PROMPTS[category] || "Did reception confirm the room number?"} value={answers.reception_confirmed} onChange={(v) => setA("reception_confirmed", v)} disabled={busy} />
        )}
        {answers.reception_confirmed === false && (q("reception") || category === "visitor") && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-amber-200 text-xs">Access cannot be granted until {["contractor", "delivery", "service_provider"].includes(category) ? "the relevant department" : "reception"} confirms. Follow up, then select Yes — or cancel the entry.</p>
          </div>
        )}
        {q("occupants") && !isUberEats && (
          <div className="space-y-1.5">
            <p className="text-slate-300 text-sm font-medium">Number of people in the vehicle</p>
            <Input value={answers.occupant_count} onChange={(e) => setA("occupant_count", e.target.value)} type="number" min="1" inputMode="numeric"
              placeholder="e.g. 2" className="bg-slate-900 border-slate-700 text-white h-11" />
          </div>
        )}
        {isUberEats && (
          <div className="rounded-xl bg-sky-500/10 border border-sky-500/30 p-3">
            <p className="text-sky-200 text-xs font-semibold uppercase tracking-wide">Pedestrian only</p>
            <p className="text-slate-300 text-xs mt-1">Only the delivery person enters on foot — the bike/car remains outside. One entrant.</p>
          </div>
        )}
        {q("firearm") && (
          <YesNo label="Does the person have any firearms to declare?" value={answers.firearm_declared} onChange={(v) => setA("firearm_declared", v)} disabled={busy} />
        )}
        {answers.firearm_declared === true && q("firearm") && (
          <HospitalityPhotoCapture siteId={site?.id} submitToken={submitToken} label="Firearm licence card photo" photos={firearmPhoto} onChange={setFirearmPhoto} />
        )}
        {q("po_invoice") && (
          <YesNo label="Is a PO / Invoice available?" value={answers.po_invoice_available} onChange={(v) => setA("po_invoice_available", v)} disabled={busy} />
        )}
        {answers.po_invoice_available === true && q("po_invoice") && (
          <HospitalityPhotoCapture siteId={site?.id} submitToken={submitToken} label="PO / Invoice photo" photos={poPhoto} onChange={setPoPhoto} />
        )}
        {q("vehicle_photos") && (
          <HospitalityPhotoCapture siteId={site?.id} submitToken={submitToken} label="Vehicle photo(s)" photos={vehiclePhotos} onChange={setVehiclePhotos} multiple />
        )}
        {q("staff_declared") && (
          <YesNo label="Does the staff member have anything to declare?" value={answers.staff_declared} onChange={(v) => setA("staff_declared", v)} disabled={busy} />
        )}
        {answers.staff_declared === true && q("staff_declared") && (
          <HospitalityPhotoCapture siteId={site?.id} submitToken={submitToken} label="Declaration photo(s)" photos={staffPhotos} onChange={setStaffPhotos} multiple />
        )}
        {q("food_photo") && (
          <HospitalityPhotoCapture siteId={site?.id} submitToken={submitToken} label="Food photo" photos={foodPhoto} onChange={setFoodPhoto} />
        )}

        {/* Document captures — "Scan Vehicle Disk" then "Licence Disk"
            (driver's licence), validated server-side on submit. */}
        {needsDisc && (
          <HospDocCaptureCard
            label="Scan Vehicle Disk" subtitle="Registration number" capture={disc} error={discError}
            onScanRequest={startDiscScan} onCapture={(c) => { setDisc(c); setDiscError(null); }}
            siteId={site?.id} submitToken={submitToken} disabled={busy}
          />
        )}
        {(needsLic || (isUberCat && answers.identity_document_type === "sa_drivers_licence_disc")) && (
          <HospDocCaptureCard
            label={isUberCat ? "Driver's identity document" : "Licence Disk (driver's licence)"}
            subtitle={isUberCat ? "Licence number" : "Back of card, PDF417 barcode"}
            capture={lic} error={licError}
            onScanRequest={startLicScan} onCapture={(c) => { setLic(c); setLicError(null); }}
            siteId={site?.id} submitToken={submitToken} disabled={busy}
          />
        )}

        {q("identity_doc") && (
          <div className="space-y-1.5">
            <p className="text-slate-300 text-sm font-medium">Driver's identity document</p>
            <div className="grid grid-cols-3 gap-2">
              {ID_DOC_OPTIONS.map((o) => (
                <button key={o.id} type="button" disabled={busy} onClick={() => setA("identity_document_type", o.id)}
                  className={`h-11 rounded-lg text-xs font-semibold transition-all active:scale-95 ${answers.identity_document_type === o.id ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-300 border border-slate-700"}`}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {q("identity_doc") && ["passport", "foreign_drivers_licence"].includes(answers.identity_document_type) && (
          <>
            <HospitalityPhotoCapture siteId={site?.id} submitToken={submitToken} label="Identity document photo" photos={idDocPhoto} onChange={setIdDocPhoto} />
            <div className="space-y-1.5">
              <p className="text-slate-300 text-sm font-medium">Identity document number (optional)</p>
              <Input value={answers.identity_document_number} onChange={(e) => setA("identity_document_number", e.target.value)}
                placeholder="Passport / foreign licence number" className="bg-slate-900 border-slate-700 text-white h-11" />
            </div>
          </>
        )}
        {q("delivery_person_photo") && (
          <HospitalityPhotoCapture siteId={site?.id} submitToken={submitToken} label="Delivery person photo" photos={deliveryPersonPhoto} onChange={setDeliveryPersonPhoto} />
        )}
      </div>

      {serverError && (
        <div className={`rounded-xl border p-3 ${visitId ? "border-amber-500/40 bg-amber-500/10" : "border-rose-500/40 bg-rose-500/10"}`}>
          <div className="flex items-start gap-2">
            {visitId ? <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" /> : <X className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />}
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wide ${visitId ? "text-amber-300" : "text-rose-300"}`}>
                {visitId ? "Access NOT granted yet" : "Cannot proceed"}
              </p>
              <p className="text-slate-300 text-sm mt-0.5">{serverError}</p>
              {visitId && <p className="text-slate-500 text-xs mt-1">Complete the missing information and submit again — this visit is kept open.</p>}
            </div>
          </div>
        </div>
      )}

      {cancelling ? (
        <div className="space-y-2">
          <p className="text-slate-300 text-sm font-medium">Cancellation reason (required)</p>
          <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Why is this entry being cancelled?" className="bg-slate-900 border-slate-700 text-white h-11" />
          <div className="flex gap-2">
            <Button onClick={cancelVisit} disabled={busy} className="flex-1 h-12 bg-rose-600 hover:bg-rose-700 text-white font-semibold active:scale-95 transition-transform">
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <X className="w-5 h-5 mr-2" />} Confirm Cancel
            </Button>
            <Button onClick={() => { setCancelling(false); setCancelReason(""); }} disabled={busy} variant="outline"
              className="flex-1 h-12 border-slate-600 text-slate-300 active:scale-95 transition-transform">
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button onClick={submit} disabled={busy || !answers.person_name.trim()}
            className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold active:scale-95 transition-transform">
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5 mr-2" />} Grant Access
          </Button>
          <Button onClick={() => (visitId ? setCancelling(true) : onClose())} disabled={busy} variant="outline"
            className="h-12 border-rose-500/40 text-rose-400 hover:bg-rose-500/10 active:scale-95 transition-transform">
            {visitId ? "Cancel Visit" : "Cancel"}
          </Button>
        </div>
      )}
    </div>
  );
}