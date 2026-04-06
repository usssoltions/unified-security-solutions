import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const COMPANY_LOGO = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690fd37d10984f1f26cedab8/e4c38b0ba_ubsnew.png';
const BRAND_COLOR = '#C41E3A'; // Red from logo
const BRAND_SECONDARY = '#1a1a1a'; // Black from logo

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { reportData, location, media = [] } = await req.json();

    // Get all admin users
    const allUsers = await base44.asServiceRole.entities.User.list();
    const adminUsers = allUsers.filter(u => 
      ['admin', 'dispatcher', 'supervisor', 'management'].includes(u.role_type)
    );

    if (adminUsers.length === 0) {
      return Response.json({ 
        error: 'No admin users found to notify' 
      }, { status: 404 });
    }

    const googleMapsUrl = location ? `https://www.google.com/maps?q=${location.lat},${location.lng}` : null;

    // Build media sections for email
    const photosHtml = media.filter(m => m.type === 'photo').map(m => `
      <div style="margin: 10px 0;">
        <img src="${m.url}" alt="Photo" style="max-width: 100%; height: auto; border-radius: 8px; border: 2px solid #e2e8f0;" />
      </div>
    `).join('');

    const videosHtml = media.filter(m => m.type === 'video').map(m => `
      <div style="margin: 10px 0;">
        <video controls style="max-width: 100%; border-radius: 8px; border: 2px solid #e2e8f0;">
          <source src="${m.url}" type="video/mp4">
        </video>
        <p style="text-align: center; margin: 5px 0;"><a href="${m.url}" target="_blank" style="color: #0ea5e9;">📹 Open Video</a></p>
      </div>
    `).join('');

    const audiosHtml = media.filter(m => m.type === 'audio').map(m => `
      <div style="margin: 10px 0; background: #f1f5f9; padding: 15px; border-radius: 8px;">
        <p style="margin: 0 0 10px 0; font-weight: bold;">🎤 Voice Note:</p>
        <audio controls style="width: 100%;">
          <source src="${m.url}" type="audio/webm">
        </audio>
        <p style="text-align: center; margin: 10px 0 0 0;"><a href="${m.url}" target="_blank" style="color: #0ea5e9;">Download Audio</a></p>
      </div>
    `).join('');

    // Send notifications to all admins
    const notificationPromises = adminUsers.map(async (admin) => {
      try {
        // Create in-app notification
        await base44.asServiceRole.entities.Notification.create({
          recipient_id: admin.id,
          recipient_name: admin.full_name,
          type: 'shift_reminder',
          priority: 'high',
          title: `📊 Start of Shift Report - ${user.full_name}`,
          message: `${user.full_name} has submitted their start of shift report for ${reportData.site_name}.`,
          read: false,
          related_entity: 'incident',
          related_id: reportData.incidentId,
          action_url: googleMapsUrl,
          sent_via: ['in_app', 'email']
        });

        // Send comprehensive email
        if (admin.email) {
          await base44.asServiceRole.integrations.Core.SendEmail({
            from_name: 'Unified Security Solutions',
            to: admin.email,
            subject: `📊 Start of Shift Report - ${user.full_name} @ ${reportData.site_name}`,
            body: `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
              </head>
              <body style="margin: 0; padding: 0; font-family: 'Arial', sans-serif; background-color: #f8fafc;">
                <div style="max-width: 650px; margin: 0 auto; background: white;">
                  <!-- Header with Logo -->
                  <div style="background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${BRAND_SECONDARY} 100%); padding: 40px 30px; text-align: center;">
                    <img src="${COMPANY_LOGO}" alt="Unified Security Solutions" style="max-width: 200px; height: auto; margin-bottom: 20px; border-radius: 10px;" />
                    <h1 style="color: white; margin: 0; font-size: 28px; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);">📊 START OF SHIFT REPORT</h1>
                    <p style="color: rgba(255,255,255,0.95); margin: 10px 0 0 0; font-size: 16px;">Professional Security Services</p>
                  </div>

                  <!-- Guard Info Section -->
                  <div style="padding: 30px; background: #f8f9fa; border-bottom: 3px solid ${BRAND_COLOR};">
                    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;">
                      <div>
                        <h2 style="color: #0c4a6e; margin: 0 0 10px 0; font-size: 22px;">Officer: ${user.full_name}</h2>
                        <p style="color: #64748b; margin: 5px 0; font-size: 14px;">🏢 <strong>Site:</strong> ${reportData.site_name}</p>
                        <p style="color: #64748b; margin: 5px 0; font-size: 14px;">👤 <strong>Client:</strong> ${reportData.client_name}</p>
                        <p style="color: #64748b; margin: 5px 0; font-size: 14px;">📅 <strong>Date:</strong> ${new Date().toLocaleString()}</p>
                        ${user.badge_number ? `<p style="color: #64748b; margin: 5px 0; font-size: 14px;">🪪 <strong>Badge:</strong> ${user.badge_number}</p>` : ''}
                      </div>
                    </div>
                  </div>

                  <!-- Report Details -->
                  <div style="padding: 30px;">
                    <div style="background: #ffffff; border: 2px solid #e2e8f0; border-radius: 12px; padding: 25px; margin-bottom: 20px;">
                      <h3 style="color: ${BRAND_SECONDARY}; margin: 0 0 20px 0; font-size: 18px; border-bottom: 2px solid ${BRAND_COLOR}; padding-bottom: 10px;">📋 Shift Information</h3>
                      
                      <div style="margin-bottom: 15px;">
                        <p style="color: #64748b; margin: 0 0 5px 0; font-size: 13px; font-weight: bold;">SHIFT/POST:</p>
                        <p style="color: #1e293b; margin: 0; font-size: 15px;">${reportData.shift_post || 'N/A'}</p>
                      </div>

                      <div style="margin-bottom: 15px;">
                        <p style="color: #64748b; margin: 0 0 5px 0; font-size: 13px; font-weight: bold;">SPECIAL INSTRUCTIONS:</p>
                        <p style="color: #1e293b; margin: 0; font-size: 15px;">${reportData.special_instructions || 'None'}</p>
                      </div>

                      <div style="margin-bottom: 15px;">
                        <p style="color: #64748b; margin: 0 0 5px 0; font-size: 13px; font-weight: bold;">POST ITEMS RECEIVED:</p>
                        <p style="color: #1e293b; margin: 0; font-size: 15px;">${reportData.post_items_received || 'N/A'}</p>
                      </div>

                      ${reportData.relieving_officer ? `
                      <div style="margin-bottom: 15px;">
                        <p style="color: #64748b; margin: 0 0 5px 0; font-size: 13px; font-weight: bold;">RELIEVING OFFICER:</p>
                        <p style="color: #1e293b; margin: 0; font-size: 15px;">${reportData.relieving_officer}</p>
                      </div>
                      ` : ''}

                      ${reportData.additional_notes ? `
                      <div style="margin-bottom: 15px;">
                        <p style="color: #64748b; margin: 0 0 5px 0; font-size: 13px; font-weight: bold;">ADDITIONAL NOTES:</p>
                        <p style="color: #1e293b; margin: 0; font-size: 15px; white-space: pre-wrap;">${reportData.additional_notes}</p>
                      </div>
                      ` : ''}
                    </div>

                    ${reportData.observations && reportData.observations.length > 0 ? `
                    <div style="background: #ffffff; border: 2px solid #e2e8f0; border-radius: 12px; padding: 25px; margin-bottom: 20px;">
                      <h3 style="color: #0c4a6e; margin: 0 0 20px 0; font-size: 18px; border-bottom: 2px solid #0ea5e9; padding-bottom: 10px;">👁️ Observations</h3>
                      ${reportData.observations.map((obs, i) => `
                        <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 10px; border-left: 4px solid #0ea5e9;">
                          <p style="color: #0c4a6e; margin: 0 0 10px 0; font-weight: bold;">Observation #${i + 1}</p>
                          <p style="margin: 5px 0;"><strong>Type:</strong> ${obs.type || 'N/A'}</p>
                          <p style="margin: 5px 0;"><strong>Time:</strong> ${obs.time || 'N/A'}</p>
                          <p style="margin: 5px 0;"><strong>Comments:</strong> ${obs.comments || 'None'}</p>
                        </div>
                      `).join('')}
                    </div>
                    ` : ''}

                    ${location ? `
                    <div style="background: linear-gradient(135deg, #fff5f5 0%, #ffe0e0 100%); border: 2px solid ${BRAND_COLOR}; border-radius: 12px; padding: 25px; margin-bottom: 20px;">
                      <h3 style="color: ${BRAND_SECONDARY}; margin: 0 0 15px 0; font-size: 18px;">📍 Live Location</h3>
                      <p style="color: #475569; margin: 0 0 15px 0;">Guard location at time of submission:</p>
                      <p style="margin: 5px 0; color: #1e293b;"><strong>Latitude:</strong> ${location.lat}</p>
                      <p style="margin: 5px 0 15px 0; color: #1e293b;"><strong>Longitude:</strong> ${location.lng}</p>
                      <div style="text-align: center;">
                        <a href="${googleMapsUrl}" style="display: inline-block; background: ${BRAND_COLOR}; color: white; padding: 12px 25px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px; box-shadow: 0 4px 6px rgba(196, 30, 58, 0.3);">📍 View on Google Maps</a>
                      </div>
                    </div>
                    ` : ''}

                    ${media.length > 0 ? `
                    <div style="background: #ffffff; border: 2px solid #e2e8f0; border-radius: 12px; padding: 25px; margin-bottom: 20px;">
                      <h3 style="color: #0c4a6e; margin: 0 0 20px 0; font-size: 18px; border-bottom: 2px solid #0ea5e9; padding-bottom: 10px;">📎 Attachments (${media.length})</h3>
                      ${photosHtml}
                      ${videosHtml}
                      ${audiosHtml}
                    </div>
                    ` : ''}

                    ${reportData.signature ? `
                    <div style="background: #ffffff; border: 2px solid #e2e8f0; border-radius: 12px; padding: 25px; margin-bottom: 20px;">
                      <h3 style="color: #0c4a6e; margin: 0 0 15px 0; font-size: 18px; border-bottom: 2px solid #0ea5e9; padding-bottom: 10px;">✍️ Digital Signature</h3>
                      <div style="background: white; padding: 15px; border: 2px solid #e2e8f0; border-radius: 8px; text-align: center;">
                        <img src="${reportData.signature}" alt="Signature" style="max-width: 300px; height: auto;" />
                      </div>
                    </div>
                    ` : ''}
                  </div>

                  <!-- Footer -->
                  <div style="background: ${BRAND_SECONDARY}; padding: 25px; text-align: center;">
                    <img src="${COMPANY_LOGO}" alt="Logo" style="max-width: 120px; height: auto; margin-bottom: 15px; opacity: 0.8;" />
                    <p style="color: #94a3b8; margin: 0 0 10px 0; font-size: 13px;">This is an automated notification from Unified Security Solutions</p>
                    <p style="color: #64748b; margin: 0; font-size: 12px;">© ${new Date().getFullYear()} Unified Security Solutions. All rights reserved.</p>
                    <p style="color: ${BRAND_COLOR}; margin: 10px 0 0 0; font-size: 11px; font-weight: bold;">PROFESSIONAL • RELIABLE • TRUSTED</p>
                  </div>
                </div>
              </body>
              </html>
            `
          });
        }

        return { adminId: admin.id, status: 'success' };
      } catch (error) {
        console.error(`Failed to notify admin ${admin.id}:`, error);
        return { adminId: admin.id, status: 'failed', error: error.message };
      }
    });

    const results = await Promise.all(notificationPromises);

    return Response.json({ 
      success: true,
      notificationsSent: results.filter(r => r.status === 'success').length,
      adminCount: adminUsers.length,
      location: googleMapsUrl,
      results
    });

  } catch (error) {
    console.error('Notification error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});