/**
 * OB metadata + small helpers shared by the Occurrence Book views
 * (server-enforced values live in obAccess/obCore — these mirror labels only).
 */
export const OB_OUTCOME_LABELS = {
  all_in_order: "All in order",
  issue_noted: "Issue noted",
  action_taken: "Action taken",
  other: "Other",
};

export const OB_WEEKDAYS = [
  { value: 0, short: "Sun" },
  { value: 1, short: "Mon" },
  { value: 2, short: "Tue" },
  { value: 3, short: "Wed" },
  { value: 4, short: "Thu" },
  { value: 5, short: "Fri" },
  { value: 6, short: "Sat" },
];

export const OB_PERIODS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "Last 7 days" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom range" },
];

// "Every 30 minutes 06:00–18:00" / "Times 06:00, 12:00" cadence summary.
export function cadenceSummary(s) {
  if (!s) return "";
  if (s.cadence === "times") {
    const t = (s.specified_times || []).join(", ");
    return t ? "Times: " + t : "Specified times";
  }
  const mins = Number(s.every_n_minutes) || 0;
  const human = mins >= 60 && mins % 60 === 0 ? (mins / 60) + "h" : mins + " min";
  return "Every " + human + " (" + (s.window_start || "") + "–" + (s.window_end || "") + ")";
}

// "Electric fence patrol · Control Room 1 · Site: Main Gate"
export function scheduleScopeLabel(s, roomNameOf) {
  if (!s) return "";
  const room = (roomNameOf && roomNameOf(s.control_room_id)) || s.control_room_name || "Control room";
  const site = s.scope === "site" ? (s.site_name || "Site") : "Overall";
  return room + " · " + site;
}

export function statusLabel(s) {
  return { active: "Active", paused: "Paused", cancelled: "Cancelled" }[s] || s;
}

// ISO → readable "01 Oct 14:35" (browser-local display of server UTC stamps).
export function obTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch (_) { return iso; }
}