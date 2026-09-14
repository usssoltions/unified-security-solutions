import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { resolveCommunicationBrand, buildBrandedEmail } from '../../shared/brandedCommunication.ts';

/**
 * notifyAdminsLaundry
 *
 * Sends a fully tenant-branded laundry-pickup request alert (email + in-app
 * notification) to all admin / estate_manager users whenever a resident
 * schedules a laundry pickup, so the request is actioned and not lost.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate the caller — only a logged-in user may trigger admin alerts.
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      requestId, residentName, unitNumber, pickupDate, pickupSlot,
      vendorName, itemCount, instructions,
    } = await req.json();

    // Tenant-scoped recipients — a laundry request never alerts the wrong estate.
    const isPlatformSender =
      user.role_type === 'platform_admin' || user.admin_level === 'platform';
    const userQuery = isPlatformSender
      ? {}
      : (user.customer_id
          ? { customer_id: user.customer_id }
          : (user.reseller_id ? { reseller_id: user.reseller_id } : { id: user.id }));
    const allUsers = await base44.asServiceRole.entities.User.filter(userQuery);
    const recipients = allUsers.filter((u) =>
      u.role_type === 'admin' || u.role_type === 'estate_manager' || u.role_type === 'dispatcher'
    );
    if (recipients.length === 0) {
      return Response.json({ success: false, message: 'No admin/estate manager found' });
    }

    // TENANT BRANDING — resolved from the requesting user's authoritative
    // tenant record (customer → reseller → USS platform default). The ENTIRE
    // visible email renders through the ONE shared branded renderer.
    const brand = await resolveCommunicationBrand(base44.asServiceRole, {
      customer_id: user?.customer_id || null, reseller_id: user?.reseller_id || null });
    const brandDetails = [
      { label: 'Resident', value: `${residentName || 'N/A'}${unitNumber ? ` (Unit ${unitNumber})` : ''}` },
      { label: 'Pickup Date', value: pickupDate || 'N/A' },
      { label: 'Pickup Slot', value: pickupSlot || 'N/A' },
      { label: 'Vendor', value: vendorName || 'Unassigned — please assign' },
      { label: 'Items', value: `${itemCount || 0} item(s)` },
    ].filter(Boolean);
    const brandTpl = buildBrandedEmail({
      brand,
      heading: 'New Laundry Request',
      greeting: 'Hello,',
      intro: 'A resident scheduled a laundry pickup. Action required.',
      details: brandDetails,
      closing: `Special instructions: ${instructions || 'None provided.'}`,
    });

    const notificationPromises = recipients.map((admin) =>
      base44.asServiceRole.entities.Notification.create({
        recipient_id: admin.id,
        recipient_name: admin.full_name,
        type: 'laundry_request',
        priority: 'normal',
        title: `👕 Laundry Request — ${residentName}`,
        message: `${residentName} (Unit ${unitNumber || '—'}) scheduled a laundry pickup for ${pickupDate} ${pickupSlot}.`,
        read: false,
        related_entity: 'laundry_request',
        related_id: requestId,
        customer_id: user?.customer_id || undefined,
        reseller_id: user?.reseller_id || undefined,
        sent_via: ['in_app', 'email'],
      }).catch(() => {})
    );

    const emailPromises = recipients
      .filter((a) => a.email)
      .map((admin) =>
        base44.asServiceRole.integrations.Core.SendEmail({
          from_name: brand.brand_name + ' — Laundry',
          to: admin.email,
          subject: `👕 New Laundry Request — ${residentName} (Unit ${unitNumber || '—'})`,
          body: brandTpl.html,
        }).catch(() => {})
      );

    await Promise.all([...notificationPromises, ...emailPromises]);

    return Response.json({ success: true, notificationsSent: recipients.length });
  } catch (error) {
    console.error('Error in notifyAdminsLaundry:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});