import React, { createContext, useState, useContext, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';
import { isPlatformAdminUser } from '@/lib/platformAdmin';
import { createAxiosClient } from '@base44/sdk/dist/utils/axios-client';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);

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
                ? `No invitation is queued for this exact email address${stuckEmail ? ` (${stuckEmail})` : ''}. Ask your administrator to send you an invitation from the Users page — direct sign-up cannot be linked to an organisation.`
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
      checkAppState
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