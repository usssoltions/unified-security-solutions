import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// In-memory storage for signaling messages (in production, use a proper database)
const signalingMessages = new Map();
const activeConnections = new Map();

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { action, targetUserId, offer, answer, candidate, callId } = await req.json();

        switch (action) {
            case 'initiate_call':
                // Store the call initiation
                const newCallId = `call_${Date.now()}_${user.id}`;
                activeConnections.set(newCallId, {
                    initiator: user.id,
                    target: targetUserId,
                    status: 'initiated',
                    timestamp: new Date().toISOString()
                });

                // Create notification for target user
                await base44.asServiceRole.entities.Notification.create({
                    recipient_id: targetUserId,
                    type: 'system',
                    priority: 'high',
                    title: 'Incoming Voice Call',
                    message: `${user.full_name} is calling you`,
                    related_entity: 'voice_call',
                    related_id: newCallId,
                    action_url: `/voice-call/${newCallId}`
                });

                return Response.json({ 
                    success: true, 
                    callId: newCallId 
                });

            case 'send_offer':
                // Store the offer for the target user
                if (!signalingMessages.has(targetUserId)) {
                    signalingMessages.set(targetUserId, []);
                }
                signalingMessages.get(targetUserId).push({
                    type: 'offer',
                    from: user.id,
                    offer,
                    callId,
                    timestamp: Date.now()
                });

                return Response.json({ success: true });

            case 'send_answer':
                // Store the answer for the initiator
                if (!signalingMessages.has(targetUserId)) {
                    signalingMessages.set(targetUserId, []);
                }
                signalingMessages.get(targetUserId).push({
                    type: 'answer',
                    from: user.id,
                    answer,
                    callId,
                    timestamp: Date.now()
                });

                return Response.json({ success: true });

            case 'send_candidate':
                // Store ICE candidate
                if (!signalingMessages.has(targetUserId)) {
                    signalingMessages.set(targetUserId, []);
                }
                signalingMessages.get(targetUserId).push({
                    type: 'candidate',
                    from: user.id,
                    candidate,
                    callId,
                    timestamp: Date.now()
                });

                return Response.json({ success: true });

            case 'poll_messages':
                // Retrieve and clear messages for this user
                const messages = signalingMessages.get(user.id) || [];
                signalingMessages.set(user.id, []);
                
                return Response.json({ 
                    success: true, 
                    messages 
                });

            case 'end_call':
                // Clean up call data
                if (callId) {
                    activeConnections.delete(callId);
                    
                    // Notify the other party
                    const callData = activeConnections.get(callId);
                    if (callData) {
                        const otherUserId = callData.initiator === user.id ? callData.target : callData.initiator;
                        if (!signalingMessages.has(otherUserId)) {
                            signalingMessages.set(otherUserId, []);
                        }
                        signalingMessages.get(otherUserId).push({
                            type: 'call_ended',
                            from: user.id,
                            callId,
                            timestamp: Date.now()
                        });
                    }
                }

                return Response.json({ success: true });

            default:
                return Response.json({ error: 'Invalid action' }, { status: 400 });
        }
    } catch (error) {
        console.error('RTC Signaling error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});