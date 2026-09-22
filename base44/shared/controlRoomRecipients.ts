/**
 * Shared CONTROL ROOM narrowing for operational notification recipients.
 *
 * SECURITY CONTRACT (fail-closed — 2026-09-22 security review): EXPLICIT
 * OPERATOR ASSIGNMENT IS AUTHORITATIVE. A control_room_operator receives an
 * operational alert for a site ONLY when the customer has an ACTIVE Control
 * Room that BOTH (a) explicitly lists them in operator_user_ids /
 * supervisor_user_ids AND (b) links that site via linked_site_ids.
 *
 * EVERY other configuration state EXCLUDES the operator entirely (they receive
 * NONE of the Control-Room-scoped operational alerts):
 *   - no active rooms configured for the customer,
 *   - the site not linked to any room,
 *   - no site context on the event,
 *   - the operator not explicitly assigned to a linked room.
 * Incomplete or missing configuration NEVER broadens an operator to
 * customer-wide notification scope — that fail-open behaviour was the exact
 * Control-Room scoping defect class this helper exists to prevent.
 *
 * This now matches the live-verified panic queue scope (panicScope): an
 * unassigned operator has an EMPTY site set, never customer-wide visibility.
 *
 * customer_admin / platform users are NEVER dropped here — customer
 * administration and platform oversight are a separate authority from the
 * operator contract and must not be restricted by operator logic.
 */
export async function narrowControlRoomOperators(
  svc: any,
  recipients: any[],
  opts: { customer_id?: string | null; site_id?: string | null } = {},
): Promise<any[]> {
  const list: any[] = Array.isArray(recipients) ? recipients.filter(Boolean) : [];
  const customerId = opts.customer_id || null;
  const siteId = opts.site_id ? String(opts.site_id) : null;
  if (!list.some((u) => u && u.role_type === 'control_room_operator')) return list;

  const roomUserIds = new Set<string>();
  if (customerId && siteId) {
    const rooms = (await svc.entities.ControlRoom
      .filter({ customer_id: String(customerId), status: 'active' }).catch(() => [])) || [];
    for (const room of rooms) {
      if (!(room.linked_site_ids || []).includes(siteId)) continue;
      (room.operator_user_ids || []).forEach((id: string) => roomUserIds.add(String(id)));
      (room.supervisor_user_ids || []).forEach((id: string) => roomUserIds.add(String(id)));
    }
  }
  return list.filter((u) =>
    u.role_type !== 'control_room_operator' || roomUserIds.has(String(u.id)));
}