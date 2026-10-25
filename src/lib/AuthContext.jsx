import React, { createContext, useState, useContext, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';
import { isPlatformAdminUser } from '@/lib/platformAdmin';
import AccountBlockedScreen from '@/components/AccountBlockedScreen';
import AccessVerificationError from '@/components/AccessVerificationError';
import { createAxiosClient } from '@base44/sdk/dist/utils/axios-client';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);

  // ── Customer suspension gate (SERVER-resolved, never client-trusted) ──────
  // accessBlocked: {customer_name, reason, support} when the caller's own
  // customer is suspended (authoritative Customer record via customerAccess
  // my_status — callable even while suspended; it IS the blocked user's check).
  const [accessBlocked, setAccessBlocked] = useState(null);
  const [accessVerifyFailed, setAccessVerifyFailed] = useState(false);
  const [accessChecking, setAccessChecking] = useState(false);
  const accessLastCheckRef = useRef(0);
  const accessInFlightRef = useRef(false);
  const pendingUserRef = useRef(null); // sign-in withheld while blocked/failed

  const [appPublicSettings, setAppPublicSettings] = useState(null); // Contains only { id, public_settings }

  useEffect(() => {
    checkAppState();
  }, []);

  const checkAppState = async () => {
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);
      
      // First, check app public settings (with token if available)
      // This will tell us if auth is required, user not registered, etc.
      const appClient = createAxiosClient({
        baseURL: `${appParams.serverUrl}/api/apps/public`,
        headers: {
          'X-App-Id': appParams.appId
        },
        token: appParams.token, // Include token if available
        interceptResponses: true
      });
      
      try {
        const publicSettings = await appClient.get(`/prod/public-settings/by-id/${appParams.appId}`);
        setAppPublicSettings(publicSettings);
        
        // If we got the app public settings successfully, check if user is authenticated
        if (appParams.token) {
          await checkUserAuth();
        } else {
          setIsLoadingAuth(false);
          setIsAuthenticated(false);
        }
        setIsLoadingPublicSettings(false);
      } catch (appError) {
        console.error('App state check failed:', appError);
        
        // Handle app-level errors
        if (appError.status === 403 && appError.data?.extra_data?.reason) {
          const reason = appError.data.extra_data.reason;
          if (reason === 'auth_required') {
            setAuthError({
              type: 'auth_required',
              message: 'Authentication required'
            });
          } else if (reason === 'user_not_registered') {
            setAuthError({
              type: 'user_not_registered',
              message: 'User not registered for this app'
            });
          } else {
            setAuthError({
              type: reason,
              message: appError.message
            });
          }
        } else {
          setAuthError({
            type: 'unknown',
            message: appError.message || 'Failed to load app'
          });
        }
        setIsLoadingPublicSettings(false);
        setIsLoadingAuth(false);
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      setAuthError({
        type: 'unknown',
        message: error.message || 'An unexpected error occurred'
      });
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
    }
  };

  const checkUserAuth = async () => {
    try {
      // Deterministic login sequence:
      //   authenticate → load user → apply pending tenant scope (server-side)
      //   → reload user if scoped → confirm scope → expose to app.
      // isLoadingAuth stays TRUE throughout, so role-based routing NEVER sees
      // an unscoped user (fixes the first-login "Reseller not found" race where
      // ResellerPortal mounted before the invitation scope was applied).
      setIsLoadingAuth(true);
      let currentUser = await base44.auth.me();

      // Non-platform users only: resolve any queued invitation scope BEFORE the
      // app routes. applyMyPendingScope is server-side and email-bound — the
      // caller can only consume a scope an admin already queued for THEIR email,
      // never accepts scope from the browser, and is idempotent.
      if (!isPlatformAdminUser(currentUser) && currentUser?.email) {
        const hasScope = currentUser?.reseller_id || currentUser?.customer_id || currentUser?.admin_level;
        const hasRole = !!currentUser?.role_type;
        // Only an unscoped, unroleed account (a fresh signup awaiting its
        // invitation scope) needs the apply step. Already-onboarded users skip
        // the extra call.
        if (!hasScope && !hasRole) {
          let applied = false;
          let lastReason = null;
          // BOUNDED retries (3 attempts): the server-side apply is idempotent
          // and only consumes the invitation after its write is verified, so
          // repeated requests can never duplicate a user, scope or profile,
          // and a transient first-login failure (timeout while the server was
          // still completing the apply) recovers without administrator help.
          // PERMANENT reasons stop the loop — retrying cannot conjure an
          // invitation that was never queued.
          const PERMANENT_REASONS = ['no_pending_scope', 'guard_site_missing', 'membership_failed', 'empty_scope'];
          let similarInvitation = false;
          for (let attempt = 0; attempt < 3 && !applied; attempt++) {
            if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt));
            try {
              const res = await base44.functions.invoke('applyMyPendingScope', {});
              const d = res?.data || res;
              if (d?.applied) {
                applied = true;
                // Refresh the authenticated user BEFORE any access evaluation
                // or landing choice — the freshly persisted scope/role must be
                // what the app routes on.
                currentUser = await base44.auth.me();
              } else {
                lastReason = d?.reason || null;
                if (d?.similar_invitation_exists) similarInvitation = true;
              }
            } catch (_) { lastReason = 'invoke_failed'; }
            if (PERMANENT_REASONS.includes(lastReason)) break;
          }
          if (!applied) {
            // One verified re-read before failing closed: the apply may have
            // completed server-side even though its response was lost.
            try { currentUser = await base44.auth.me(); } catch (_) {}
          }

          // Fail closed: a non-platform user whose tenant scope could not be
          // applied/resolved gets NO unscoped app access — no platform/default
          // customer fallback, no reseller guessing, no self-selection.
          const stillNoScope = !currentUser?.reseller_id && !currentUser?.customer_id && !currentUser?.admin_level;
          const stillNoRole = !currentUser?.role_type;
          if (stillNoScope && stillNoRole) {
            // ACTIONABLE DIAGNOSTIC: name the exact email so the administrator
            // knows precisely which account to repair — the canonical repair
            // is one invitation to this exact address from the Users page
            // (the pipeline's existing-user rescope path: no duplicate user,
            // no re-registration).
            const stuckEmail = currentUser?.email || '';
            setAuthError({
              type: 'onboarding_failed',
              message: lastReason === 'no_pending_scope'
                ? (similarInvitation
                    ? `No invitation matches this exact email address${stuckEmail ? ` (${stuckEmail})` : ''}, but an invitation exists for a similar address — it was likely mistyped. Ask your administrator to send an invitation to this exact address from the Users page, or sign up using the link in the original invitation email.`
                    : `No invitation is queued for this exact email address${stuckEmail ? ` (${stuckEmail})` : ''}. Ask your administrator to send you an invitation from the Users page — direct sign-up cannot be linked to an organisation.`)
                : 'Your account setup could not be completed. Please contact your administrator.'
            });
            setIsLoadingAuth(false);
            return;
          }

          // Membership RLS uses {{user.id}}, which IS present in every session
          // token, so reseller reads work immediately after applyMyPendingScope
          // adds the caller to the Reseller's members — no re-auth needed. The
          // previous forced re-auth was based on the false assumption that a
          // fresh token would expose custom user fields (reseller_id) to RLS;
          // empirical token inspection proved it does not.
        }
      }

      // ── Customer suspension gate (fresh sign-in) ─────────────────────────
      // Resolved from the authoritative Customer record server-side. A
      // suspended organisation never mounts the app. A failed check is a
      // retryable verification error — never a silent pass.
      if (!isPlatformAdminUser(currentUser) && currentUser?.customer_id) {
        pendingUserRef.current = currentUser;
        try {
          const d = await fetchAccessStatus();
          if (d?.status === 'suspended') {
            setAccessBlocked({
              customer_name: d.customer_name || 'Your organisation',
              reason: d.suspension_reason || null,
              support: d.support || null,
            });
            setIsLoadingAuth(false);
            return;
          }
          pendingUserRef.current = null;
        } catch (_) {
          setAccessVerifyFailed(true);
          setIsLoadingAuth(false);
          return;
        }
      }

      setUser(currentUser);
      setIsAuthenticated(true);
      setIsLoadingAuth(false);
    } catch (error) {
      console.error('User auth check failed:', error);
      setIsLoadingAuth(false);
      setIsAuthenticated(false);
      
      // If user auth fails, it might be an expired token
      if (error.status === 401 || error.status === 403) {
        setAuthError({
          type: 'auth_required',
          message: 'Authentication required'
        });
      }
    }
  };

  // Lightweight server-side access-status read (no polling, no intervals —
  // callers throttle). Callable by suspended users by design.
  const fetchAccessStatus = async () => {
    const res = await base44.functions.invoke('customerAccess', { action: 'my_status' });
    return res?.data || res;
  };

  // Existing sessions: revalidated on window focus and on navigation
  // (throttled to at most one check per minute). A suspension takes effect
  // immediately: the blocked screen replaces the app and cached protected
  // content unmounts. A FAILED check shows a retryable verification error —
  // never a silent pass and never a false non-payment claim.
  const revalidateAccess = useCallback(async (force = false) => {
    if (accessInFlightRef.current) return;
    const target = user || pendingUserRef.current;
    if (!target || isPlatformAdminUser(target) || !target.customer_id) return;
    const now = Date.now();
    if (!force && now - accessLastCheckRef.current < 60000) return;
    accessInFlightRef.current = true;
    accessLastCheckRef.current = now;
    setAccessChecking(true);
    try {
      const d = await fetchAccessStatus();
      if (d?.status === 'suspended') {
        setAccessBlocked({
          customer_name: d.customer_name || 'Your organisation',
          reason: d.suspension_reason || null,
          support: d.support || null,
        });
      } else {
        setAccessBlocked(null);
        setAccessVerifyFailed(false);
        if (pendingUserRef.current) {
          // Complete a sign-in that was withheld while suspended/failed.
          setUser(pendingUserRef.current);
          setIsAuthenticated(true);
          pendingUserRef.current = null;
        }
      }
    } catch (_) {
      setAccessVerifyFailed(true);
    } finally {
      accessInFlightRef.current = false;
      setAccessChecking(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    const onFocus = () => revalidateAccess();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user, revalidateAccess]);

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    
    if (shouldRedirect) {
      // Use the SDK's logout method which handles token cleanup and redirect
      base44.auth.logout(window.location.href);
    } else {
      // Just remove the token without redirect
      base44.auth.logout();
    }
  };

  const navigateToLogin = () => {
    // Use the SDK's redirectToLogin method
    base44.auth.redirectToLogin(window.location.href);
  };

  // Blocked / unverified: these screens REPLACE the app entirely — protected
  // pages (and their cached content) unmount, with no dismiss and no
  // background navigation.
  if (accessBlocked) {
    return (
      <AccountBlockedScreen
        info={accessBlocked}
        checking={accessChecking}
        onRecheck={() => revalidateAccess(true)}
        onSignOut={() => logout(true)}
      />
    );
  }
  if (accessVerifyFailed) {
    return (
      <AccessVerificationError
        checking={accessChecking}
        onRetry={() => revalidateAccess(true)}
        onSignOut={() => logout(true)}
      />
    );
  }

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      logout,
      navigateToLogin,
      checkAppState,
      revalidateAccess
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};