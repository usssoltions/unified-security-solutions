import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { secrets } from 'base44:runtime';
import { sendNativePush } from '../../shared/nativePush.ts';
import { resolveCommunicationBrand, buildBrandedEmail, buildBrandedTelegram } from '../../shared/brandedCommunication.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';
import { resolveTenantCaller } from '../../shared/tenantCaller.ts';

/**
 * estateNotify — ESTATE MANAGEMENT module communication gateway.
 *
 * ARCHITECTURE (modular independence):
 *   Estate business logic stays in the estate pages/entities (records are
 *   created/updated client-side as before). This gateway ONLY emits the
 *   communication event for an existing estate record, resolving EVERYTHING
 *   server-side:
 *     - the caller (resolveTenantCaller — authoritative User record, never
 *       stale session claims)
 *     - the record's content (re-read from the database; frontend-supplied
 *       titles/bodies are never trusted)
 *     - the tenant scope (record customer_id, falling back to the caller's
 *       authoritative customer — never request input)
 *     - the recipients (tenant audience resolution by role; NO client-supplied
 *       user ids, emails, chat ids or tenant ids are ever trusted)
 *     - the BrandContext (resolveCommunicationBrand: customer → reseller →
 *       USS platform) rendered through the ONE shared email/Telegram
 *       renderers
 *
 * SHARED PLATFORM SERVICES reused (no second notification system):
 *   resolveCommunicationBrand / buildBrandedEmail / buildBrandedTelegram,
 *   sendNativePush (Base44 native push), the shared Notification entity for
 *   in-app records, and the NotificationDelivery audit/idempotency ledger.
 *
 * CHANNEL POLICY:
 *   - critical/security/emergency announcements: in-app + email + telegram + push
 *   - normal actionable events (booking/vote/ticket requests + decisions):
 *     in-app + email + telegram + push (respecting the announcement record's
 *     send_email / send_push flags for non-critical announcements)
 *   - informational (resident cancels own pending booking, ticket assigned):
 *     in-app only
 *
 * FAILURE ISOLATION: every channel attempt per recipient is isolated — a
 * failure never blocks other channels/recipients and never rolls back the
 * business action (which already succeeded before this gateway is invoked).
 *
 * IDEMPOTENCY: deterministic event keys + NotificationDelivery
 * (event + recipient per channel) mean refreshes and API retries can never
 * duplicate a delivery.
 */

const MANAGER_ROLES = ['estate_manager', 'customer_admin', 'dispatcher', 'admin', 'platform_admin'];
const ESTATE_MANAGERS = ['estate_manager', 'customer_admin'];
const AUDIENCE_ROLES: Record<string, string[]> = {
  all: ['resident', 'guard', 'vendor', 'estate_manager', 'customer_admin', 'dispatcher', 'supervisor'],
  residents: ['resident'],
  guards: ['guard'],
  vendors: ['vendor'],
  specific: ['resident', 'estate_manager', 'customer_admin'],
};
const PRIORITY_MAP: Record<string, string> = { low: 'low', normal: 'medium', medium: 'medium', high: 'high', urgent: 'critical' };

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await resolveTenantCaller(base44);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    const isPlatform = caller.role_type === 'admin' || caller.role_type === 'platform_admin' || caller.admin_level === 'platform';
    const isManager = isPlatform || MANAGER_ROLES.includes(caller.role_type);
    const callerCustomer: string | null = caller.customer_id || null;
    const callerReseller: string | null = caller.reseller_id || null;

    switch (action) {
      case 'publish_announcement': {
        if (!isManager) return Response.json({ error: 'Forbidden' }, { status: 403 });
        const rows = await svc.entities.Announcement.filter({ id: String(body.announcement_id || '') }).catch(() => []);
        const ann = (rows && rows[0]) || null;
        if (!ann) return Response.json({ error: 'Announcement not found' }, { status: 404 });
        const tenantId: string | null = ann.customer_id || callerCustomer;
        if (!isPlatform && (!tenantId || (ann.customer_id && ann.customer_id !== callerCustomer))) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
        const brand = await resolveCommunicationBrand(svc, {
          customer_id: tenantId, reseller_id: ann.reseller_id || callerReseller,
        });
        // Audience resolved server-side from the record's target_audience.
        const roles = AUDIENCE_ROLES[String(ann.target_audience || 'all')] || AUDIENCE_ROLES.all;
        const recipients = await tenantUsers(svc, tenantId, roles);
        // Channel policy: urgent / security / emergency announcements push all
        // channels regardless of flags; normal announcements respect the
        // record's send_email / send_push controls (telegram mirrors email —
        // there is no separate telegram UI control).
        const critical = ann.priority === 'urgent' || ['security', 'emergency'].includes(String(ann.category));
        const priority = PRIORITY_MAP[String(ann.priority || 'normal')] || 'medium';
        const channels = {
          inApp: true,
          email: critical || ann.send_email === true,
          telegram: critical || ann.send_email === true,
          push: critical || ann.send_push !== false,
        };
        const email = buildBrandedEmail({
          brand, heading: 'New Announcement',
          greeting: `Hi there,`,
          intro: `A new announcement has been published${ann.category ? ` (${ann.category})` : ''}.`,
          details: [
            { label: 'Title', value: String(ann.title || '') },
            { label: 'Message', value: String(ann.body || '') },
            { label: 'Priority', value: String(ann.priority || 'normal') },
            { label: 'Published by', value: String(ann.created_by_name || 'Estate Management') },
          ],
          closing: 'Open the app for the full announcement.',
        });
        const telegram = buildBrandedTelegram({
          brand, heading: '📢 New Announcement',
          greeting: String(ann.title || ''),
          details: [{ label: 'Message', value: String(ann.body || '') }],
          closing: ann.priority === 'urgent' ? '⚠️ This announcement is marked URGENT.' : undefined,
        });
        const counts = await deliver(svc, recipients, {
          eventKey: `estate:announce:${ann.id}`,
          tenantId, resellerId: ann.reseller_id || callerReseller,
          channels, priority,
          type: 'system', relatedEntity: 'Announcement', relatedId: ann.id,
          title: `📢 ${ann.title || 'New Announcement'}`,
          message: String(ann.body || '').slice(0, 500),
          emailSubject: `📢 Announcement: ${String(ann.title || '')}`,
          emailHtml: email.html, emailText: email.text, telegramText: telegram,
        });
        return Response.json({ success: true, event: `estate:announce:${ann.id}`, recipients: recipients.length, ...counts });
      }

      case 'booking_request': {
        // Resident submitted one or more venue booking requests → notify the
        // estate's managers. The bookings are re-read server-side; each must
        // belong to the caller (self-service) and the caller's tenant.
        if (!callerCustomer && !isPlatform) return Response.json({ error: 'Forbidden' }, { status: 403 });
        const ids = (Array.isArray(body.booking_ids) ? body.booking_ids : []).map(String).filter(Boolean);
        if (!ids.length) return Response.json({ error: 'booking_ids required' }, { status: 400 });
        const bookings = await svc.entities.VenueBooking.filter({ id: { $in: ids } }).catch(() => []);
        const mine = (bookings || []).filter((b: any) =>
          isPlatform || (b.resident_id === caller.id && (!b.customer_id || !callerCustomer || b.customer_id === callerCustomer)));
        if (!mine.length) return Response.json({ error: 'No valid bookings for this caller' }, { status: 403 });
        const tenantId: string | null = mine[0].customer_id || callerCustomer;
        const brand = await resolveCommunicationBrand(svc, { customer_id: tenantId, reseller_id: callerReseller });
        const managers = await tenantUsers(svc, tenantId, ESTATE_MANAGERS);
        const summary = mine.map((b: any) =>
          `${b.venue_name} on ${b.booking_date || ''} ${b.start_time || ''}${b.end_time ? `–${b.end_time}` : ''}`).join('; ');
        const residentName = mine[0].resident_name || caller.display_name || 'A resident';
        const email = buildBrandedEmail({
          brand, heading: 'New Booking Request',
          greeting: 'Hello,',
          intro: `${residentName} submitted ${mine.length > 1 ? mine.length + ' booking requests' : 'a booking request'} awaiting your approval.`,
          details: mine.map((b: any) => ({
            label: String(b.venue_name || 'Venue'),
            value: `${b.booking_date || ''} ${b.start_time || ''}${b.end_time ? `–${b.end_time}` : ''} · ${b.guest_count || 1} guests · ${b.purpose || ''}`,
          })),
          closing: 'Approve or reject the request in the Venues → Pending bookings view.',
        });
        const telegram = buildBrandedTelegram({
          brand, heading: '📅 New Booking Request',
          greeting: `${residentName} requested a booking awaiting approval.`,
          details: [{ label: 'Details', value: summary }],
        });
        const counts = await deliver(svc, managers, {
          eventKey: 'estate:booking_request:' + ids.slice().sort().join(','),
          tenantId, resellerId: callerReseller,
          channels: { inApp: true, email: true, telegram: true, push: true },
          priority: 'high', type: 'system', relatedEntity: 'VenueBooking', relatedId: mine[0].id,
          title: '📅 New Booking Request',
          message: `${residentName}: ${summary}`,
          emailSubject: '📅 New Booking Request',
          emailHtml: email.html, emailText: email.text, telegramText: telegram,
        });
        return Response.json({ success: true, recipients: managers.length, ...counts });
      }

      case 'booking_decision': {
        // Manager approved/rejected a booking → notify the resident (full
        // channels). Resident cancelled their own pending booking → notify the
        // managers (in-app, informational).
        const rows = await svc.entities.VenueBooking.filter({ id: String(body.booking_id || '') }).catch(() => []);
        const booking = (rows && rows[0]) || null;
        if (!booking) return Response.json({ error: 'Booking not found' }, { status: 404 });
        const decision = String(body.decision || '');
        const tenantId: string | null = booking.customer_id || callerCustomer;
        if (decision === 'cancelled') {
          const selfOrManager = booking.resident_id === caller.id || (isManager && (!callerCustomer || !tenantId || callerCustomer === tenantId));
          if (!selfOrManager && !isPlatform) return Response.json({ error: 'Forbidden' }, { status: 403 });
          const managers = await tenantUsers(svc, tenantId, ESTATE_MANAGERS);
          const counts = await deliver(svc, managers, {
            eventKey: `estate:booking:${booking.id}:cancelled`,
            tenantId, resellerId: booking.reseller_id || callerReseller,
            channels: { inApp: true, email: false, telegram: false, push: false },
            priority: 'low', type: 'status_change', relatedEntity: 'VenueBooking', relatedId: booking.id,
            title: 'Booking cancelled',
            message: `${booking.resident_name || 'A resident'} cancelled their pending booking for ${booking.venue_name} (${booking.booking_date || ''}).`,
          });
          return Response.json({ success: true, recipients: managers.length, ...counts });
        }
        if (!['approved', 'rejected'].includes(decision)) {
          return Response.json({ error: 'decision must be approved|rejected|cancelled' }, { status: 400 });
        }
        if (!isManager || (!isPlatform && (!tenantId || callerCustomer !== tenantId))) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
        const residentRows = await svc.entities.User.filter({ id: String(booking.resident_id || '') }).catch(() => []);
        const resident = (residentRows && residentRows[0]) || null;
        if (!resident || (resident.customer_id && tenantId && resident.customer_id !== tenantId)) {
          return Response.json({ success: true, recipients: 0, note: 'resident unavailable' });
        }
        const brand = await resolveCommunicationBrand(svc, { customer_id: tenantId, reseller_id: booking.reseller_id || callerReseller });
        const approved = decision === 'approved';
        const email = buildBrandedEmail({
          brand, heading: approved ? 'Booking Approved' : 'Booking Rejected',
          greeting: `Hi ${booking.resident_name || resident.display_name || 'there'},`,
          intro: approved
            ? `Your booking for ${booking.venue_name} has been approved.`
            : `Your booking request for ${booking.venue_name} was not approved.`,
          details: [
            { label: 'Venue', value: String(booking.venue_name || '') },
            { label: 'Date', value: `${booking.booking_date || ''} ${booking.start_time || ''}${booking.end_time ? `–${booking.end_time}` : ''}` },
            (!approved && booking.rejection_reason) ? { label: 'Reason', value: String(booking.rejection_reason) } : null,
          ],
          closing: approved ? 'See you there!' : 'Please contact estate management if you have questions.',
        });
        const telegram = buildBrandedTelegram({
          brand, heading: approved ? '✅ Booking Approved' : '❌ Booking Rejected',
          greeting: `${booking.venue_name} — ${booking.booking_date || ''}`,
          details: [
            { label: 'Venue', value: String(booking.venue_name || '') },
            { label: 'Date', value: `${booking.booking_date || ''} ${booking.start_time || ''}` },
            (!approved && booking.rejection_reason) ? { label: 'Reason', value: String(booking.rejection_reason) } : null,
          ],
        });
        const counts = await deliver(svc, [resident], {
          eventKey: `estate:booking:${booking.id}:${decision}`,
          tenantId, resellerId: booking.reseller_id || callerReseller,
          channels: { inApp: true, email: true, telegram: true, push: true },
          priority: approved ? 'high' : 'medium', type: 'status_change',
          relatedEntity: 'VenueBooking', relatedId: booking.id,
          title: approved ? `✅ Booking approved: ${booking.venue_name}` : `❌ Booking rejected: ${booking.venue_name}`,
          message: approved
            ? `Your booking for ${booking.venue_name} on ${booking.booking_date || ''} was approved.`
            : `Your booking request for ${booking.venue_name} on ${booking.booking_date || ''} was not approved.${booking.rejection_reason ? ` Reason: ${booking.rejection_reason}` : ''}`,
          emailSubject: approved ? '✅ Booking Approved' : '❌ Booking Rejected',
          emailHtml: email.html, emailText: email.text, telegramText: telegram,
        });
        return Response.json({ success: true, recipients: 1, ...counts });
      }

      case 'vote_opened': {
        if (!isManager) return Response.json({ error: 'Forbidden' }, { status: 403 });
        const rows = await svc.entities.VotingQuestion.filter({ id: String(body.question_id || '') }).catch(() => []);
        const q = (rows && rows[0]) || null;
        if (!q) return Response.json({ error: 'Voting question not found' }, { status: 404 });
        const tenantId: string | null = q.customer_id || callerCustomer;
        if (!isPlatform && (!tenantId || q.customer_id !== callerCustomer)) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
        const brand = await resolveCommunicationBrand(svc, { customer_id: tenantId, reseller_id: q.reseller_id || callerReseller });
        const residents = await tenantUsers(svc, tenantId, ['resident']);
        const closesNote = q.close_date ? ` Closes ${new Date(q.close_date).toLocaleDateString('en-ZA')}.` : '';
        const email = buildBrandedEmail({
          brand, heading: 'New Vote Open',
          greeting: 'Hi there,',
          intro: 'A new vote has been opened for your community.',
          details: [
            { label: 'Question', value: String(q.title || '') },
            ...(q.description ? [{ label: 'Description', value: String(q.description) }] : []),
            ...(q.close_date ? [{ label: 'Closes', value: new Date(q.close_date).toLocaleString('en-ZA') }] : []),
          ],
          closing: 'Open the app to cast your vote.',
        });
        const telegram = buildBrandedTelegram({
          brand, heading: '🗳️ New Vote Open',
          greeting: String(q.title || ''),
          details: [{ label: 'Closes', value: q.close_date ? new Date(q.close_date).toLocaleString('en-ZA') : 'No closing date' }],
          closing: 'Open the app to cast your vote.',
        });
        const counts = await deliver(svc, residents, {
          eventKey: `estate:vote_opened:${q.id}`,
          tenantId, resellerId: q.reseller_id || callerReseller,
          channels: { inApp: true, email: true, telegram: true, push: true },
          priority: 'medium', type: 'system', relatedEntity: 'VotingQuestion', relatedId: q.id,
          title: `🗳️ New vote: ${q.title || ''}`,
          message: `A new vote is open: "${q.title || ''}".${closesNote} Cast your vote in the app.`,
          emailSubject: `🗳️ New Vote: ${String(q.title || '')}`,
          emailHtml: email.html, emailText: email.text, telegramText: telegram,
        });
        return Response.json({ success: true, recipients: residents.length, ...counts });
      }

      case 'ticket_created': {
        // Resident logged a service ticket → notify the estate managers.
        const rows = await svc.entities.ServiceTicket.filter({ id: String(body.ticket_id || '') }).catch(() => []);
        const ticket = (rows && rows[0]) || null;
        if (!ticket) return Response.json({ error: 'Ticket not found' }, { status: 404 });
        if (!isPlatform && ticket.resident_id !== caller.id && !isManager) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
        const tenantId: string | null = ticket.customer_id || callerCustomer;
        if (!tenantId) return Response.json({ error: 'Forbidden' }, { status: 403 });
        const brand = await resolveCommunicationBrand(svc, { customer_id: tenantId, reseller_id: ticket.reseller_id || callerReseller });
        const managers = await tenantUsers(svc, tenantId, ESTATE_MANAGERS);
        const email = buildBrandedEmail({
          brand, heading: 'New Service Ticket',
          greeting: 'Hello,',
          intro: `${ticket.resident_name || 'A resident'} (Unit ${ticket.unit_number || '—'}) logged a service ticket.`,
          details: [
            { label: 'Ticket', value: String(ticket.ticket_number || ticket.id) },
            { label: 'Title', value: String(ticket.title || '') },
            { label: 'Category', value: String(ticket.category || 'general') },
            { label: 'Priority', value: String(ticket.priority || 'medium') },
          ],
          closing: 'Open the Estate Manager dashboard to action this ticket.',
        });
        const telegram = buildBrandedTelegram({
          brand, heading: '🎫 New Service Ticket',
          greeting: String(ticket.title || ''),
          details: [
            { label: 'Resident', value: `${ticket.resident_name || 'Resident'} (Unit ${ticket.unit_number || '—'})` },
            { label: 'Category', value: String(ticket.category || 'general') },
            { label: 'Priority', value: String(ticket.priority || 'medium') },
          ],
        });
        const counts = await deliver(svc, managers, {
          eventKey: `estate:ticket:${ticket.id}:created`,
          tenantId, resellerId: ticket.reseller_id || callerReseller,
          channels: { inApp: true, email: true, telegram: true, push: true },
          priority: PRIORITY_MAP[String(ticket.priority || 'medium')] || 'medium',
          type: 'system', relatedEntity: 'ServiceTicket', relatedId: ticket.id,
          title: `🎫 New ticket: ${ticket.title || ''}`,
          message: `${ticket.resident_name || 'A resident'} (Unit ${ticket.unit_number || '—'}) logged "${ticket.title || 'a service ticket'}" [${ticket.category || 'general'}, ${ticket.priority || 'medium'}].`,
          emailSubject: `🎫 New Ticket: ${String(ticket.title || '')}`,
          emailHtml: email.html, emailText: email.text, telegramText: telegram,
        });
        return Response.json({ success: true, recipients: managers.length, ...counts });
      }

      case 'ticket_status': {
        // Manager assigned / resolved a ticket → inform the resident.
        if (!isManager) return Response.json({ error: 'Forbidden' }, { status: 403 });
        const rows = await svc.entities.ServiceTicket.filter({ id: String(body.ticket_id || '') }).catch(() => []);
        const ticket = (rows && rows[0]) || null;
        if (!ticket) return Response.json({ error: 'Ticket not found' }, { status: 404 });
        const tenantId: string | null = ticket.customer_id || callerCustomer;
        if (!isPlatform && (!tenantId || callerCustomer !== tenantId)) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
        const residentRows = await svc.entities.User.filter({ id: String(ticket.resident_id || '') }).catch(() => []);
        const resident = (residentRows && residentRows[0]) || null;
        if (!resident) return Response.json({ success: true, recipients: 0, note: 'resident unavailable' });
        const status = String(body.status || ticket.status || '');
        if (['resolved', 'closed'].includes(status)) {
          const brand = await resolveCommunicationBrand(svc, { customer_id: tenantId, reseller_id: ticket.reseller_id || callerReseller });
          const email = buildBrandedEmail({
            brand, heading: 'Ticket Resolved',
            greeting: `Hi ${ticket.resident_name || resident.display_name || 'there'},`,
            intro: `Your service ticket "${ticket.title || ''}" has been marked resolved.`,
            details: [
              { label: 'Ticket', value: String(ticket.ticket_number || ticket.id) },
              ...(ticket.resolution_notes ? [{ label: 'Resolution', value: String(ticket.resolution_notes) }] : []),
            ],
            closing: 'Please rate the service in the app.',
          });
          const telegram = buildBrandedTelegram({
            brand, heading: '✅ Ticket Resolved',
            greeting: `"${ticket.title || ''}" has been resolved.`,
            closing: 'Please rate the service in the app.',
          });
          const counts = await deliver(svc, [resident], {
            eventKey: `estate:ticket:${ticket.id}:${status}`,
            tenantId, resellerId: ticket.reseller_id || callerReseller,
            channels: { inApp: true, email: true, telegram: true, push: true },
            priority: 'medium', type: 'status_change', relatedEntity: 'ServiceTicket', relatedId: ticket.id,
            title: `✅ Ticket resolved: ${ticket.title || ''}`,
            message: `Your ticket "${ticket.title || ''}" (${ticket.ticket_number || ''}) was resolved.${ticket.resolution_notes ? ` ${ticket.resolution_notes}` : ''} Please rate the service in the app.`,
            emailSubject: '✅ Service Ticket Resolved',
            emailHtml: email.html, emailText: email.text, telegramText: telegram,
          });
          return Response.json({ success: true, recipients: 1, ...counts });
        }
        // Assignment / in-progress: informational — in-app only.
        const counts = await deliver(svc, [resident], {
          eventKey: `estate:ticket:${ticket.id}:${status}`,
          tenantId, resellerId: ticket.reseller_id || callerReseller,
          channels: { inApp: true, email: false, telegram: false, push: false },
          priority: 'low', type: 'status_change', relatedEntity: 'ServiceTicket', relatedId: ticket.id,
          title: `🎫 Ticket update: ${ticket.title || ''}`,
          message: `Your ticket "${ticket.title || ''}" is now ${String(status || 'in progress').replace('_', ' ')}${ticket.assigned_to_name ? ` (handled by ${ticket.assigned_to_name})` : ''}.`,
        });
        return Response.json({ success: true, recipients: 1, ...counts });
      }

      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error: any) {
    return Response.json({ error: error?.message || 'estateNotify failed' }, { status: 500 });
  }
}

/* ── Server-side audience resolution (never trusts client ids) ────────── */

async function tenantUsers(svc: any, customerId: string | null, roleTypes: string[]) {
  if (!customerId || !roleTypes.length) return [];
  const rows = await svc.entities.User.filter({ customer_id: String(customerId) }).catch(() => []);
  return (rows || []).filter((u: any) => roleTypes.includes(u.role_type));
}

/* ── Multi-channel delivery (shared services, per-channel isolation) ──── */

async function deliver(svc: any, recipients: any[], opts: {
  eventKey: string; tenantId: string | null; resellerId: string | null;
  channels: { inApp: boolean; email: boolean; telegram: boolean; push: boolean };
  priority: string; type: string; relatedEntity?: string; relatedId?: string;
  title: string; message: string;
  emailSubject?: string; emailHtml?: string; emailText?: string; telegramText?: string;
}): Promise<Record<string, number>> {
  const counts: Record<string, number> = { in_app: 0, email: 0, telegram: 0, push: 0, skipped: 0, deduped: 0, failed: 0 };
  const TG_TOKEN = secrets.get('TELEGRAM_BOT_TOKEN');

  for (const u of recipients) {
    /* IN-APP — shared Notification record */
    if (opts.channels.inApp) {
      const key = `${opts.eventKey}:user:${u.id}:in_app`;
      try {
        if (await alreadySent(svc, key)) { counts.deduped++; }
        else {
          await svc.entities.Notification.create({
            recipient_id: u.id, recipient_name: u.display_name || u.full_name || 'User',
            type: opts.type, priority: opts.priority,
            title: opts.title, message: opts.message, read: false,
            related_entity: opts.relatedEntity, related_id: opts.relatedId,
            sent_via: ['in_app'],
            customer_id: opts.tenantId || undefined, reseller_id: opts.resellerId || undefined,
          });
          await logDelivery(svc, opts.eventKey, u.id, 'in_app', 'sent', opts, key);
          counts.in_app++;
        }
      } catch { counts.failed++; }
    }

    /* EMAIL — shared branded renderer, brand from the authoritative tenant */
    if (opts.channels.email && u.email && opts.emailHtml) {
      const key = `${opts.eventKey}:user:${u.id}:email`;
      try {
        if (await alreadySent(svc, key)) { counts.deduped++; }
        else {
          const brand = await resolveCommunicationBrand(svc, { customer_id: opts.tenantId, reseller_id: opts.resellerId });
          // GUARDED AUDITED DELIVERY — sendAuditedEmail records the
          // NotificationDelivery audit row itself (mode, intended/effective
          // recipient, template, branding source), replacing logDelivery here.
          const res = await sendAuditedEmail(svc, {
            to: u.email, subject: opts.emailSubject || opts.title,
            html: opts.emailHtml, text: opts.emailText,
            brand,
            customer_id: opts.tenantId || null, reseller_id: opts.resellerId || null,
            recipient_id: u.id || undefined,
            recipient_name: u.display_name || u.full_name || undefined,
            event_type: String(opts.eventKey || 'estate_notification').split(':')[0],
            template_name: 'estate_notification',
          });
          if (res.ok) counts.email++; else counts.failed++;
        }
      } catch { counts.failed++; }
    }

    /* TELEGRAM — verified per-user mapping; same-chat dedupe by event+chat */
    if (opts.channels.telegram && TG_TOKEN && opts.telegramText &&
        u.telegram_connected && u.telegram_notifications_enabled !== false && u.telegram_chat_id) {
      try {
        const ok = await sendTelegram(svc, TG_TOKEN, opts.eventKey, u.telegram_chat_id, opts.telegramText);
        if (ok) counts.telegram++; else counts.failed++;
      } catch { counts.failed++; }
    } else if (opts.channels.telegram) {
      counts.skipped++;
    }

    /* PUSH — shared native push service (idempotent per event+user) */
    if (opts.channels.push) {
      try {
        const pr = await sendNativePush(svc, {
          user_id: u.id, title: opts.title, body: opts.message, priority: opts.priority,
          action_label: 'Open', action_url: undefined,
          event_key: opts.eventKey,
          customer_id: opts.tenantId || undefined, reseller_id: opts.resellerId || undefined,
        });
        if (pr?.status === 'sent') counts.push++;
        else if (pr?.status === 'deduped') counts.deduped++;
        else counts.skipped++; // no registration / permission / preference — logged
      } catch { counts.failed++; }
    }
  }
  return counts;
}

async function alreadySent(svc: any, idempotencyKey: string): Promise<boolean> {
  try {
    const rows = await svc.entities.NotificationDelivery.filter({ idempotency_key: idempotencyKey }, '-created_date', 1);
    return !!(rows && rows.length && rows[0].status === 'sent');
  } catch { return false; }
}

async function sendTelegram(svc: any, token: string, eventKey: string, chatId: string, text: string): Promise<boolean> {
  const key = `${eventKey}:tg:${chatId}`; // dedupe by event + intended chat
  if (await alreadySent(svc, key)) return true;
  let ok = false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4000), disable_web_page_preview: true }),
    });
    ok = res.ok;
  } catch { ok = false; }
  await logDelivery(svc, eventKey, chatId, 'telegram', ok ? 'sent' : 'failed', null, key, chatId);
  return ok;
}

async function logDelivery(svc: any, eventKey: string, recipientId: string, channel: string, status: string,
  opts: any, idempKey?: string, address?: string) {
  try {
    await svc.entities.NotificationDelivery.create({
      event_key: eventKey,
      recipient_id: recipientId,
      recipient_address: address || recipientId,
      channel, status,
      customer_id: opts?.tenantId || undefined,
      reseller_id: opts?.resellerId || undefined,
      send_time: new Date().toISOString(),
      idempotency_key: idempKey || `${eventKey}:${recipientId}:${channel}`,
      retries: 0,
    });
  } catch { /* delivery logging must never break the notification */ }
}