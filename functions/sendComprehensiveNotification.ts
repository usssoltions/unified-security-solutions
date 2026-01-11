import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      recipientIds, 
      type, 
      title, 
      message, 
      priority = 'medium',
      relatedEntity,
      relatedId,
      actionUrl,
      metadata,
      sendEmail = true
    } = await req.json();

    if (!recipientIds || !Array.isArray(recipientIds) || !title || !message) {
      return Response.json({ 
        error: 'Missing required fields: recipientIds (array), title, message' 
      }, { status: 400 });
    }

    const results = [];

    // Create in-app notifications for each recipient
    for (const recipientId of recipientIds) {
      try {
        // Get recipient details
        const recipient = await base44.asServiceRole.entities.User.filter({ id: recipientId });
        const recipientUser = recipient[0];

        if (!recipientUser) {
          results.push({ recipientId, status: 'failed', reason: 'User not found' });
          continue;
        }

        // Create in-app notification
        const notification = await base44.asServiceRole.entities.Notification.create({
          recipient_id: recipientId,
          recipient_name: recipientUser.full_name,
          type: type || 'system',
          priority,
          title,
          message,
          read: false,
          related_entity: relatedEntity,
          related_id: relatedId,
          action_url: actionUrl,
          sent_via: ['in_app']
        });

        // Send email if requested and user has email
        if (sendEmail && recipientUser.email) {
          try {
            await base44.asServiceRole.integrations.Core.SendEmail({
              to: recipientUser.email,
              subject: `🔔 ${title}`,
              body: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="color: white; margin: 0; font-size: 24px;">SecureGuard Notification</h1>
                  </div>
                  <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 10px 10px;">
                    <div style="background: white; padding: 25px; border-radius: 8px; border-left: 4px solid #667eea;">
                      <h2 style="color: #1e293b; margin-top: 0; font-size: 20px;">${title}</h2>
                      <p style="color: #475569; font-size: 16px; line-height: 1.6; margin: 15px 0;">${message}</p>
                      ${metadata ? `<div style="background: #f1f5f9; padding: 15px; border-radius: 6px; margin: 15px 0;">
                        <p style="color: #64748b; font-size: 14px; margin: 0;"><strong>Additional Details:</strong></p>
                        <p style="color: #475569; font-size: 14px; margin: 10px 0 0 0;">${JSON.stringify(metadata, null, 2).replace(/[{}",]/g, '').replace(/\n/g, '<br>')}</p>
                      </div>` : ''}
                      <p style="color: #64748b; font-size: 14px; margin-top: 20px;">Priority: <span style="color: ${priority === 'critical' ? '#dc2626' : priority === 'high' ? '#ea580c' : priority === 'medium' ? '#ca8a04' : '#0284c7'}; font-weight: bold;">${priority.toUpperCase()}</span></p>
                    </div>
                    <div style="text-align: center; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                      <p style="color: #94a3b8; font-size: 12px; margin: 0;">SecureGuard Security Management System</p>
                      <p style="color: #cbd5e1; font-size: 11px; margin: 5px 0 0 0;">This is an automated notification</p>
                    </div>
                  </div>
                </div>
              `
            });
          } catch (emailError) {
            console.error('Email send failed:', emailError);
          }
        }

        results.push({ 
          recipientId, 
          recipientEmail: recipientUser.email,
          status: 'success',
          notificationId: notification.id
        });
      } catch (error) {
        results.push({ 
          recipientId, 
          status: 'failed', 
          reason: error.message 
        });
      }
    }

    return Response.json({ 
      success: true,
      results,
      totalSent: results.filter(r => r.status === 'success').length,
      totalFailed: results.filter(r => r.status === 'failed').length
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});