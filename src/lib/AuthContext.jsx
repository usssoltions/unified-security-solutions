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
  const [needsReauth, setNeedsReauth] = useState(false);
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
          try {
            const res = await base44.functions.invoke('applyMyPendingScope', {});
            const d = res?.data || res;
            applied = !!d?.applied;
            if (applied) {
              currentUser = await base44.auth.me();
            }
          } catch (_) { /* swallow; fail-closed check below */ }

          // Fail closed: a non-platform user whose tenant scope could not be
          // applied/resolved gets NO unscoped app access — no platform/default
          // customer fallback, no reseller guessing, no self-selection.
          const stillNoScope = !currentUser?.reseller_id && !currentUser?.customer_id && !currentUser?.admin_level;
          const stillNoRole = !currentUser?.role_type;
          if (stillNoScope && stillNoRole) {
            setAuthError({
              type: 'onboarding_failed',
              message: 'Your account setup could not be completed. Please contact your administrator.'
            });
            setIsLoadingAuth(false);
            return;
          }

          // The session token was issued at signup BEFORE the invitation scope
          // existed, and RLS resolves tenant fields (reseller_id/customer_id)
          // from the token. Without a fresh token, entity reads such as
          // Reseller.get are denied with the stale token → "Reseller not
          // found". Force a re-authentication so a fresh token carries the
          // applied scope; the pending scope is already consumed, so the next
          // login proceeds straight to the portal.
          if (applied) {
            setNeedsReauth(true);
            setIsLoadingAuth(false);
            return;
          }
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
      checkAppState,
      needsReauth
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