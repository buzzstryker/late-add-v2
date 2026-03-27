import { createClient, SupabaseClient } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { getSupabaseAnonKey, getSupabaseUrl, hasSupabaseAuthConfig } from '@/lib/config';
import { setAccessTokenGetter } from '@/lib/api';
import { authPersistence } from '@/lib/authPersistence';

const JWT_KEY = 'late_add_mobile_jwt';

type AuthContextValue = {
  ready: boolean;
  signedIn: boolean;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithJwt: (jwt: string) => Promise<void>;
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
      detectSessionInUrl: false,
    },
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const supabase = useMemo(() => (hasSupabaseAuthConfig() ? createSupabase() : null), []);

  const refreshSignedIn = useCallback(async () => {
    let token: string | null = null;
    const manual = await authPersistence.getItem(JWT_KEY);
    if (manual?.trim()) {
      token = manual.trim();
    } else if (supabase) {
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token ?? null;
    }
    setSignedIn(Boolean(token));
    return token;
  }, [supabase]);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshSignedIn();
      if (!cancelled) setReady(true);
    })();
    const sub = supabase?.auth.onAuthStateChange(() => {
      authPersistence.getItem(JWT_KEY).then((j) => {
        if (!j?.trim()) refreshSignedIn();
      });
    });
    return () => {
      cancelled = true;
      sub?.data.subscription.unsubscribe();
    };
  }, [supabase, refreshSignedIn]);

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      if (!supabase) return { error: 'Email sign-in needs EXPO_PUBLIC_SUPABASE_URL and ANON_KEY in .env' };
      await authPersistence.removeItem(JWT_KEY);
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return { error: error.message };
      setSignedIn(true);
      return { error: null };
    },
    [supabase]
  );

  const signInWithJwt = useCallback(async (jwt: string) => {
    const t = jwt.trim();
    if (!t) return;
    if (supabase) await supabase.auth.signOut();
    await authPersistence.setItem(JWT_KEY, t);
    setSignedIn(true);
  }, [supabase]);

  const signOut = useCallback(async () => {
    await authPersistence.removeItem(JWT_KEY);
    if (supabase) await supabase.auth.signOut();
    setSignedIn(false);
  }, [supabase]);

  const value = useMemo(
    () => ({
      ready,
      signedIn,
      signInWithPassword,
      signInWithJwt,
      signOut,
    }),
    [ready, signedIn, signInWithPassword, signInWithJwt, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth inside AuthProvider');
  return ctx;
}
