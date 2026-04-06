import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Verify user authentication
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Only admins and dispatchers can send push notifications
        if (user.role_type !== 'admin' && user.role_type !== 'dispatcher') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { user_ids, title, body, priority, data } = await req.json();

        if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
            return Response.json({ error: 'user_ids array is required' }, { status: 400 });
        }

        if (!title || !body) {
            return Response.json({ error: 'title and body are required' }, { status: 400 });
        }

        // Get user details
        const users = await base44.asServiceRole.entities.User.filter({
            id: { $in: user_ids }
        });

        // Create alert records for each user (visible in app)
        const alertPromises = users.map(targetUser => {
            return base44.asServiceRole.entities.Alert.create({
                type: data?.type || 'system',
                priority: priority || 'medium',
                title: title,
                message: body,
                guard_id: targetUser.id,
                guard_name: targetUser.full_name,
                status: 'active',
                metadata: data
            });
        });

        await Promise.all(alertPromises);

        // In a production environment, you would:
        // 1. Retrieve push notification tokens/subscriptions for each user from database
        // 2. Use a service like Firebase Cloud Messaging (FCM) or Web Push API
        // 3. Send actual push notifications to devices

        // For now, we'll return success and let the frontend handle notifications
        return Response.json({
            success: true,
            message: `Notifications sent to ${users.length} user(s)`,
            recipients: users.map(u => ({
                id: u.id,
                name: u.full_name,
                email: u.email
            }))
        });

    } catch (error) {
        console.error('Push notification error:', error);
        return Response.json({ 
            error: error.message || 'Failed to send push notifications' 
        }, { status: 500 });
    }
});