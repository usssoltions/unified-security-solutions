import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const COMPANY_LOGO = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690fd37d10984f1f26cedab8/e4c38b0ba_ubsnew.png';
const BRAND_COLOR = '#C41E3A';
const BRAND_SECONDARY = '#1a1a1a';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Get yesterday's date range
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date(yesterday);
    endOfYesterday.setHours(23, 59, 59, 999);

    // Fetch all activity from yesterday
    const [incidents, maintenance, patrols, shifts, alerts] = await Promise.all([
      base44.asServiceRole.entities.Incident.filter({}),
      base44.asServiceRole.entities.MaintenanceRequest.filter({}),
      base44.asServiceRole.entities.PatrolLog.filter({}),
      base44.asServiceRole.entities.Shift.filter({}),
      base44.asServiceRole.entities.Alert.filter({})
    ]);

    // Filter by yesterday's date
    const yesterdayIncidents = incidents.filter(i => {
      const date = new Date(i.reported_at || i.created_date);
      return date >= yesterday && date <= endOfYesterday;
    });
    
    const yesterdayMaintenance = maintenance.filter(m => {
      const date = new Date(m.reported_at || m.created_date);
      return date >= yesterday && date <= endOfYesterday;
    });
    
    const yesterdayPatrols = patrols.filter(p => {
      const date = new Date(p.timestamp || p.created_date);
      return date >= yesterday && date <= endOfYesterday;
    });
    
    const yesterdayShifts = shifts.filter(s => {
      const date = new Date(s.start_time);
      return date >= yesterday && date <= endOfYesterday;
    });
    
    const yesterdayAlerts = alerts.filter(a => {
      const date = new Date(a.created_date);
      return date >= yesterday && date <= endOfYesterday;
    });

    // Build plain text summary without using LLM credits
    const criticalIncidents = yesterdayIncidents.filter(i => i.priority === 'critical' || i.priority === 'high');
    const openIncidents = yesterdayIncidents.filter(i => i.status !== 'resolved' && i.status !== 'closed');
    const pendingMaintenance = yesterdayMaintenance.filter(m => m.status !== 'completed');

    const aiSummary = [
      `Daily summary for ${yesterday.toLocaleDateString()}:`,
      `• ${yesterdayIncidents.length} incident(s) reported — ${criticalIncidents.length} critical/high priority, ${openIncidents.length} still open.`,
      `• ${yesterdayMaintenance.length} maintenance request(s) — ${pendingMaintenance.length} still pending.`,
      `• ${yesterdayPatrols.length} patrol stop(s) logged.`,
      `• ${yesterdayShifts.length} shift(s) active, ${yesterdayAlerts.length} alert(s) triggered.`,
      criticalIncidents.length > 0 ? `⚠️ Critical items require follow-up: ${criticalIncidents.map(i => i.title).join(', ')}.` : '✅ No critical incidents reported.',
    ].join('\n');

    // Get all admins/supervisors AND custom WhatsApp contacts with email
    const [allUsers, waContacts] = await Promise.all([
      base44.asServiceRole.entities.User.filter({}),
      base44.asServiceRole.entities.WhatsAppContact.filter({ active: true }),
    ]);

    const recipients = allUsers.filter(u =>
      u.role_type === 'admin' ||
      u.role_type === 'dispatcher' ||
      u.role_type === 'supervisor' ||
      u.role_type === 'management'
    );

    // Custom contacts with an email field get the report too
    const customEmailContacts = waContacts
      .filter(c => c.email && c.email.includes('@'))
      .map(c => ({ email: c.email, full_name: c.name }));

    // Merge, deduplicate by email
    const allEmailSet = new Set(recipients.map(r => r.email));
    const extraRecipients = customEmailContacts.filter(c => !allEmailSet.has(c.email));
    const allRecipients = [...recipients, ...extraRecipients];

    // Build WhatsApp summary text for custom WA contacts
    const waSummary = `📊 *DAILY ACTIVITY REPORT — ${yesterday.toLocaleDateString('en-ZA')}*\n\n${aiSummary}\n\n📱 Full report sent to your email.`;
    const waNumber = (raw) => {
      let d = String(raw).replace(/\D/g, '');
      if (d.startsWith('0')) d = '27' + d.slice(1);
      return d;
    };

    // Send WhatsApp deep-link via email to custom contacts who have a number
    // (Deep links are opened by guards/admins; we embed the link in an email notification)
    const waLinkContacts = waContacts.filter(c => c.number);

    // Send email report to each recipient
    const emailPromises = allRecipients.map(recipient =>
      base44.asServiceRole.integrations.Core.SendEmail({
        from_name: 'SecureGuard System',
        to: recipient.email,
        subject: `Daily Activity Report - ${yesterday.toLocaleDateString()}`,
        body: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Arial', sans-serif; background-color: #f8fafc;">
  <div style="max-width: 650px; margin: 0 auto; background: white;">
    <div style="background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${BRAND_SECONDARY} 100%); padding: 40px 30px; text-align: center;">
      <img src="${COMPANY_LOGO}" alt="Unified Security Solutions" style="max-width: 200px; height: auto; margin-bottom: 20px; border-radius: 10px;" />
      <h1 style="color: white; margin: 0; font-size: 28px; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);">📊 DAILY ACTIVITY REPORT</h1>
      <p style="color: rgba(255,255,255,0.95); margin: 10px 0 0 0; font-size: 16px;">${yesterday.toLocaleDateString()}</p>
    </div>

    <div style="padding: 30px;">
      <div style="background: #ffffff; border: 2px solid #e2e8f0; border-radius: 12px; padding: 25px; margin-bottom: 20px;">
        <h3 style="color: ${BRAND_SECONDARY}; margin: 0 0 20px 0; font-size: 18px; border-bottom: 2px solid ${BRAND_COLOR}; padding-bottom: 10px;">📈 Summary Statistics</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid ${BRAND_COLOR};">
            <p style="color: #64748b; margin: 0 0 5px 0; font-size: 13px;">Incidents</p>
            <p style="color: ${BRAND_SECONDARY}; margin: 0; font-size: 28px; font-weight: bold;">${yesterdayIncidents.length}</p>
          </div>
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #0ea5e9;">
            <p style="color: #64748b; margin: 0 0 5px 0; font-size: 13px;">Maintenance</p>
            <p style="color: ${BRAND_SECONDARY}; margin: 0; font-size: 28px; font-weight: bold;">${yesterdayMaintenance.length}</p>
          </div>
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #10b981;">
            <p style="color: #64748b; margin: 0 0 5px 0; font-size: 13px;">Patrol Stops</p>
            <p style="color: ${BRAND_SECONDARY}; margin: 0; font-size: 28px; font-weight: bold;">${yesterdayPatrols.length}</p>
          </div>
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #f59e0b;">
            <p style="color: #64748b; margin: 0 0 5px 0; font-size: 13px;">Shifts</p>
            <p style="color: ${BRAND_SECONDARY}; margin: 0; font-size: 28px; font-weight: bold;">${yesterdayShifts.length}</p>
          </div>
        </div>
      </div>

      <div style="background: #ffffff; border: 2px solid #e2e8f0; border-radius: 12px; padding: 25px; margin-bottom: 20px;">
        <h3 style="color: ${BRAND_SECONDARY}; margin: 0 0 15px 0; font-size: 18px; border-bottom: 2px solid ${BRAND_COLOR}; padding-bottom: 10px;">🤖 AI Summary & Insights</h3>
        <p style="color: #475569; line-height: 1.6;">${aiSummary.replace(/\n/g, '<br>')}</p>
      </div>

      ${yesterdayIncidents.filter(i => i.priority === 'critical' || i.priority === 'high').length > 0 ? `
      <div style="background: #fff5f5; border: 2px solid ${BRAND_COLOR}; border-radius: 12px; padding: 25px; margin-bottom: 20px;">
        <h3 style="color: ${BRAND_SECONDARY}; margin: 0 0 15px 0; font-size: 18px;">⚠️ Critical Incidents</h3>
        ${yesterdayIncidents.filter(i => i.priority === 'critical' || i.priority === 'high')
          .map(i => `
            <div style="background: white; padding: 15px; border-radius: 8px; margin-bottom: 10px; border-left: 4px solid ${BRAND_COLOR};">
              <p style="margin: 0 0 5px 0; font-weight: bold; color: ${BRAND_SECONDARY};">${i.title}</p>
              <p style="margin: 5px 0; color: #64748b; font-size: 14px;">Site: ${i.site_name}</p>
              <div style="display: inline-block; background: ${BRAND_COLOR}; color: white; padding: 4px 12px; border-radius: 4px; font-size: 12px; margin-right: 10px;">${i.priority}</div>
              <div style="display: inline-block; background: #e2e8f0; color: #475569; padding: 4px 12px; border-radius: 4px; font-size: 12px;">${i.status}</div>
            </div>
          `).join('')}
      </div>
      ` : ''}

      <div style="background: #f0f9ff; border: 2px solid #0ea5e9; border-radius: 12px; padding: 25px;">
        <h3 style="color: ${BRAND_SECONDARY}; margin: 0 0 15px 0; font-size: 18px;">📋 Pending Items</h3>
        <ul style="margin: 0; padding-left: 20px; color: #475569;">
          <li style="margin-bottom: 8px;">Open Incidents: <strong>${yesterdayIncidents.filter(i => i.status !== 'resolved' && i.status !== 'closed').length}</strong></li>
          <li>Pending Maintenance: <strong>${yesterdayMaintenance.filter(m => m.status !== 'completed').length}</strong></li>
        </ul>
      </div>
    </div>

    <div style="background: ${BRAND_SECONDARY}; padding: 25px; text-align: center;">
      <img src="${COMPANY_LOGO}" alt="Logo" style="max-width: 120px; height: auto; margin-bottom: 15px; opacity: 0.8;" />
      <p style="color: #94a3b8; margin: 0 0 10px 0; font-size: 13px;">Automated Daily Report from Unified Security Solutions</p>
      <p style="color: #64748b; margin: 0; font-size: 12px;">© ${new Date().getFullYear()} Unified Security Solutions. All rights reserved.</p>
      <p style="color: ${BRAND_COLOR}; margin: 10px 0 0 0; font-size: 11px; font-weight: bold;">PROFESSIONAL • RELIABLE • TRUSTED</p>
    </div>
  </div>
</body>
</html>
        `
      })
    );

    await Promise.all(emailPromises);

    // Also send a WhatsApp notification email to custom WA contact numbers
    // that don't have an email — embed the wa.me link so admins can forward/share
    const waOnlyContacts = waContacts.filter(c => c.number && (!c.email || !c.email.includes('@')));
    if (waOnlyContacts.length > 0 && recipients.length > 0) {
      const waLinks = waOnlyContacts.map(c =>
        `• ${c.name} (${c.number}): https://wa.me/${waNumber(c.number)}?text=${encodeURIComponent(waSummary)}`
      ).join('\n');
      // Notify first admin about WA-only contacts so they can tap & send
      const firstAdmin = recipients[0];
      if (firstAdmin?.email) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          from_name: 'SecureGuard System',
          to: firstAdmin.email,
          subject: `📲 WhatsApp Daily Report Links — ${yesterday.toLocaleDateString()}`,
          body: `Tap the links below to send the daily report to WhatsApp-only contacts:\n\n${waLinks}`,
        }).catch(() => {});
      }
    }

    return Response.json({
      success: true,
      reportsSent: allRecipients.length,
      waContactsNotified: waContacts.length,
      date: yesterday.toLocaleDateString()
    });
  } catch (error) {
    console.error('Error generating daily activity report:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});