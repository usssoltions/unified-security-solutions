/**
 * Shared CONTROL ROOM narrowing for operational notification recipients.
 *
 * Mirrors the site-aware panic narrowing (activatePanic): a
 * control_room_operator receives an operational alert for a site ONLY when
 * they are explicitly assigned (operator_user_ids / supervisor_user_ids) to an
 * ACTIVE Control Room whose linked_site_ids cover that site. Role membership
 * alone is NEVER sufficient.
 *
 * Narrowing is deliberately conservative (fail-open to the existing
 * customer-level recipient set, never to a WIDER set):
 *   - no customer scope, no active rooms, or no site context → unchanged
 *   - site given but NO active room is linked to it → unchanged
 *     (panic parity: no linkage = customer-level membership)
 *   - site given and active rooms ARE linked to it → operators/supervisors
 *     NOT in those rooms' user lists are dropped. customer_admin and platform
 *     users are never dropped (tenant administration / oversight).
 */
export async function narrowControlRoomOperators(
  svc: any,
  recipients: any[],
  opts: { customer_id?: string | null; site_id?: string | null } = {},
): Promise<any[]> {
  const list: any[] = Array.isArray(recipients) ? recipients : [];
  const customerId = opts.customer_id || null;
  const siteId = opts.site_id ? String(opts.site_id) : null;
  if (!customerId || !siteId || !list.length) return list;
  if (!list.some((u) => u && u.role_type === 'control_room_operator')) return list;

  const rooms = (await svc.entities.ControlRoom
    .filter({ customer_id: String(customerId), status: 'active' }).catch(() => [])) || [];
  if (!rooms.length) return list;

  const linked = rooms.filter((r) => (r.linked_site_ids || []).includes(siteId));
  if (!linked.length) return list;

  const roomUserIds = new Set<string>();
  for (const room of linked) {
    (room.operator_user_ids || []).forEach((id: string) => roomUserIds.add(String(id)));
    (room.supervisor_user_ids || []).forEach((id: string) => roomUserIds.add(String(id)));
  }
  return list.filter((u) =>
    u.role_type !== 'control_room_operator' ||
    roomUserIds.has(String(u.id)));
}