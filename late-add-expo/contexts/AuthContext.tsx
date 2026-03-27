import { createClient, SupabaseClient } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { getSupabaseAnonKey, getSupabaseUrl, hasSupabaseAuthConfig } from '@/lib/config';
import { setAccessTokenGetter, setOnUnauthorized } from '@/lib/api';
import { authPersistence } from '@/lib/authPersistence';

const JWT_KEY = 'late_add_mobile_jwt';

// ── Capture PKCE auth code from URL at module load time ────────────────────
// Expo Router strips query params during rendering (before useEffect runs).
// We must grab ?code= synchronously before that happens.
let _pendingAuthCode: string | null = null;
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search);
  _pendingAuthCode = params.get('code');
  if (_pendingAuthCode) {
    // Clean the URL so Supabase's detectSessionInUrl doesn't also try to exchange it
    window.history.replaceState({}, '', window.location.pathname + window.location.hash);
  }
}

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
      detectSessionInUrl: false, // We handle URL codes explicitly above
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

  // Main auth initialization + ongoing state listener
  useEffect(() => {
    let cancelled = false;
    // If a PKCE code exchange is pending, delay setting ready until it resolves
    let exchangePending = Boolean(_pendingAuthCode);

    function markReady() {
      if (!readyRef.current && !cancelled) {
        readyRef.current = true;
        setReady(true);
      }
    }

    if (supabase) {
      // Listen for ongoing auth events (token refresh, sign-out, etc.)
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (_event, session) => {
          if (cancelled) return;
          const manual = await authPersistence.getItem(JWT_KEY);
          if (manual?.trim()) {
            setSignedIn(true);
          } else {
            setSignedIn(Boolean(session?.access_token));
          }
          // Only mark ready here if no code exchange is in-flight
          if (!exchangePending) markReady();
        }
      );

      // Explicit PKCE code exchange (captured at module load time)
      if (_pendingAuthCode) {
        const code = _pendingAuthCode;
        _pendingAuthCode = null; // Consume so it's not reused
        supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
          exchangePending = false;
          if (!cancelled) {
            setSignedIn(Boolean(data.session?.access_token) && !error);
            markReady();
          }
        }).catch(() => {
          exchangePending = false;
          if (!cancelled) markReady();
        });
      }

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
        markReady();
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

  // Auto-sign-out on server 401 (expired/invalid JWT)
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
