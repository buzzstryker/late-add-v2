import { createClient, SupabaseClient } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { getSupabaseAnonKey, getSupabaseUrl, hasSupabaseAuthConfig } from '@/lib/config';
import { setAccessTokenGetter, setOnUnauthorized } from '@/lib/api';
import { authPersistence } from '@/lib/authPersistence';

const JWT_KEY = 'late_add_mobile_jwt';

type AuthContextValue = {
  ready: boolean;
  signedIn: boolean;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithOtp: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function createSupabase(): SupabaseClient | null {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      storage: authPersistence,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
      flowType: 'pkce',
    },
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const supabase = useMemo(() => (hasSupabaseAuthConfig() ? createSupabase() : null), []);
  const readyRef = useRef(false);

  // Wire up the access-token getter for api.ts
  useEffect(() => {
    setAccessTokenGetter(async () => {
      const manual = await authPersistence.getItem(JWT_KEY);
      if (manual?.trim()) return manual.trim();
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
      }
      return null;
    });
  }, [supabase]);

  // Listen for auth state changes — this is the ONLY place that sets ready + signedIn.
  // Supabase v2 emits INITIAL_SESSION once the client finishes initialization
  // (including processing any magic-link / PKCE tokens in the URL).
  // By waiting for that event to set `ready`, we avoid the race where the router
  // redirects to /login before the URL token exchange completes.
  useEffect(() => {
    let cancelled = false;

    if (supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (event, session) => {
          if (cancelled) return;

          // If a manual JWT is stored, it takes precedence
          const manual = await authPersistence.getItem(JWT_KEY);
          if (manual?.trim()) {
            setSignedIn(true);
          } else {
            setSignedIn(Boolean(session?.access_token));
          }

          // Mark ready after initial session is resolved (URL tokens processed)
          if (!readyRef.current) {
            readyRef.current = true;
            setReady(true);
          }
        }
      );
      return () => {
        cancelled = true;
        subscription.unsubscribe();
      };
    }

    // No Supabase client — check for manual JWT only
    (async () => {
      const manual = await authPersistence.getItem(JWT_KEY);
      if (!cancelled) {
        setSignedIn(Boolean(manual?.trim()));
        readyRef.current = true;
        setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      if (!supabase) return { error: 'Email sign-in needs EXPO_PUBLIC_SUPABASE_URL and ANON_KEY in .env' };
      await authPersistence.removeItem(JWT_KEY);
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return { error: error.message };
      // signedIn will be set by onAuthStateChange
      return { error: null };
    },
    [supabase]
  );

  const signInWithOtp = useCallback(
    async (email: string) => {
      if (!supabase) return { error: 'Magic link needs EXPO_PUBLIC_SUPABASE_URL and ANON_KEY in .env' };
      await authPersistence.removeItem(JWT_KEY);
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: Platform.OS === 'web' ? window.location.origin : undefined },
      });
      if (error) return { error: error.message };
      return { error: null };
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    await authPersistence.removeItem(JWT_KEY);
    if (supabase) await supabase.auth.signOut();
    setSignedIn(false);
  }, [supabase]);

  // Auto-sign-out on server 401 (expired/invalid JWT) so user is redirected to login
  useEffect(() => {
    setOnUnauthorized(() => { signOut(); });
  }, [signOut]);

  const value = useMemo(
    () => ({
      ready,
      signedIn,
      signInWithPassword,
      signInWithOtp,
      signOut,
    }),
    [ready, signedIn, signInWithPassword, signInWithOtp, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth inside AuthProvider');
  return ctx;
}
