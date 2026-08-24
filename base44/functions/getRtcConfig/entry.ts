import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * getRtcConfig — Returns WebRTC ICE server configuration including TURN servers.
 *
 * TURN servers are essential for establishing WebRTC connections through
 * restrictive networks (corporate firewalls, mobile carriers, NAT).
 * Credentials are stored as secrets and never exposed in client code.
 *
 * Falls back to STUN-only if TURN secrets are not configured.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
    ];

    // Add TURN servers if configured (enables relay through restrictive networks)
    const turnUrl = process.env.TURN_SERVER_URL;
    const turnUsername = process.env.TURN_SERVER_USERNAME;
    const turnCredential = process.env.TURN_SERVER_CREDENTIAL;

    if (turnUrl && turnUsername && turnCredential) {
      // Support multiple TURN URLs (comma-separated for failover)
      const turnUrls = turnUrl.split(',').map(u => u.trim()).filter(Boolean);
      iceServers.push({
        urls: turnUrls.length > 1 ? turnUrls : turnUrls[0],
        username: turnUsername,
        credential: turnCredential
      });
    }

    return Response.json({
      iceServers,
      iceCandidatePoolSize: 10
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}