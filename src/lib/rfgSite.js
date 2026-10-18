// RFG FOODS PTY LTD (Tulbagh) — SITE-SCOPED configuration only.
// Nothing here changes any global setting, other site, or shared schema.
// The lists below apply ONLY when the active shift's site is the RFG site
// (matched by its authoritative Site id).
export const RFG_SITE_ID = "6ad3938650435823774797a8";

// Category values are the existing Incident.category enum — RFG type labels
// are stored in the report title/description; category stays enum-valid.
export const RFG_INCIDENT_TYPES = [
  { label: "Unauthorised entry or access breach", category: "trespassing" },
  { label: "Theft or attempted theft", category: "theft" },
  { label: "Vandalism, damage, or tampering", category: "vandalism" },
  { label: "Suspicious person, vehicle, or activity", category: "suspicious_activity" },
  { label: "Fire, smoke, or burning smell", category: "fire" },
  { label: "Injury or medical emergency", category: "medical" },
  { label: "Chemical spill or unknown substance", category: "safety_hazard" },
  { label: "Gas, fumes, or unusual odour", category: "safety_hazard" },
  { label: "Water leak, flooding, or drainage overflow", category: "safety_hazard" },
  { label: "Effluent or environmental discharge concern", category: "safety_hazard" },
  { label: "Electrical hazard or power outage", category: "equipment_failure" },
  { label: "Machinery or equipment incident", category: "equipment_failure" },
  { label: "Vehicle, truck, or forklift incident", category: "other" },
  { label: "Blocked exit or other safety hazard", category: "safety_hazard" },
  { label: "Waste, scrap, or perimeter concern", category: "other" },
  { label: "Other", category: "other" }
];

// Category values are the existing MaintenanceRequest.category enum.
export const RFG_MAINTENANCE_TYPES = [
  { label: "Gate, barrier, or access-control fault", category: "gate" },
  { label: "Door, lock, or key fault", category: "locks" },
  { label: "Fence or perimeter damage", category: "fencing" },
  { label: "CCTV, alarm, or security-lighting fault", category: "alarm_system" },
  { label: "General lighting fault", category: "lighting" },
  { label: "Fire-safety equipment or signage issue", category: "other" },
  { label: "Walkway, floor, stairs, or handrail damage", category: "structural" },
  { label: "Roof, building, or structural damage", category: "structural" },
  { label: "Water leak, plumbing, or drainage fault", category: "plumbing" },
  { label: "Effluent-area infrastructure issue", category: "plumbing" },
  { label: "Pump or visible utility-equipment issue", category: "other" },
  { label: "Boiler or steam-area infrastructure issue", category: "other" },
  { label: "Coldroom door or visible external fault", category: "other" },
  { label: "Production-area equipment damage (report only)", category: "other" },
  { label: "Chemical-room door, ventilation, or containment concern", category: "other" },
  { label: "Waste or scrap-area infrastructure issue", category: "other" },
  { label: "Emergency-exit obstruction or fault", category: "other" },
  { label: "Other", category: "other" }
];