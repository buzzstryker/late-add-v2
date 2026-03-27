import { createClient, SupabaseClient } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { getSupabaseAnonKey, getSupabaseUrl, hasSupabaseAuthConfig } from '@/lib/config';
import { setAccessTokenGetter, setOnUnauthorized } from '@/lib/api';
import { authPersistence } from '@/lib/authPersistence';

type AuthContextValue = {
  ready: boolean;
  signedIn: boolean;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  sendOtp: (email: string) => Promise<{ error: string | null }>;
  verifyOtp: (email: string, token: string) => Promise<{ error: string | null }>;
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
  const readyRef = useRef(false);
  const signedInAtRef = useRef<number>(0); // timestamp of last sign-in

  // Wire up the access-token getter for api.ts
  useEffect(() => {
    setAccessTokenGetter(async () => {
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
      }
      return null;
    });
  }, [supabase]);

  // Auth state listener — single source of truth for signedIn + ready
  useEffect(() => {
    let cancelled = false;

    if (supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (_event, session) => {
          if (cancelled) return;
          const hasToken = Boolean(session?.access_token);
          console.log('[AUTH EVENT]', _event, 'email:', session?.user?.email ?? null, 'hasToken:', hasToken);
          setSignedIn(hasToken);
          if (hasToken) signedInAtRef.current = Date.now();
          if (!readyRef.current) {
            readyRef.current = true;
            console.log('[AUTH] ready=true');
            setReady(true);
          }
        }
      );
      return () => {
        cancelled = true;
        subscription.unsubscribe();
      };
    }

    // No Supabase client — mark ready with no session
    if (!cancelled) {
      readyRef.current = true;
      setReady(true);
    }
    return () => { cancelled = true; };
  }, [supabase]);

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      if (!supabase) return { error: 'Supabase not configured' };
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return { error: error.message };
      return { error: null };
    },
    [supabase]
  );

  // Send a 6-digit OTP code to the user's email
  const sendOtp = useCallback(
    async (email: string) => {
      if (!supabase) return { error: 'Supabase not configured' };
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false, emailRedirectTo: undefined },
      });
      if (error) return { error: error.message };
      return { error: null };
    },
    [supabase]
  );

  // Verify the 6-digit OTP code → establishes session
  const verifyOtp = useCallback(
    async (email: string, token: string) => {
      if (!supabase) return { error: 'Supabase not configured' };
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: token.trim(),
        type: 'email',
      });
      if (error) {
        console.log('[AUTH] verifyOtp error:', error.message);
        return { error: error.message };
      }
      console.log('[AUTH] verifyOtp success');
      // Explicitly set the session so the Supabase client (and getSession) has it
      // immediately — prevents 401s from API calls that fire before onAuthStateChange
      if (data.session) {
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
      }
      return { error: null };
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    console.log('[AUTH] signOut called');
    if (supabase) await supabase.auth.signOut();
    setSignedIn(false);
  }, [supabase]);

  // Auto-sign-out on server 401 (expired/invalid JWT).
  // Grace period: ignore 401s within 5 seconds of sign-in — the fresh session
  // may not have propagated to the API client for in-flight requests yet.
  useEffect(() => {
    setOnUnauthorized(() => {
      const msSinceSignIn = signedInAtRef.current ? Date.now() - signedInAtRef.current : 9999;
      if (msSinceSignIn < 5000) {
        console.log('[AUTH] 401 ignored — within 5s grace period of sign-in');
        return;
      }
      console.log('[AUTH] 401 intercepted → signOut');
      signOut();
    });
  }, [signOut]);

  const value = useMemo(
    () => ({ ready, signedIn, signInWithPassword, sendOtp, verifyOtp, signOut }),
    [ready, signedIn, signInWithPassword, sendOtp, verifyOtp, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth inside AuthProvider');
  return ctx;
}
