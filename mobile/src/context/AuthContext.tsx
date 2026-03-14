import React, { createContext, useContext, useEffect, useReducer, useCallback, useRef } from 'react';
import * as Linking from 'expo-linking';
import { supabase } from '@/src/services/supabaseClient';
import * as authService from '@/src/services/supabaseAuthService';
import type { Session, User } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────────

interface AuthState {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextType {
  state: AuthState;
  sendMagicLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

type AuthAction =
  | { type: 'SET_SESSION'; payload: Session | null }
  | { type: 'SET_LOADING'; payload: boolean };

// ─── Reducer ────────────────────────────────────────────────────────

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'SET_SESSION':
      return {
        ...state,
        session: action.payload,
        user: action.payload?.user ?? null,
        isAuthenticated: action.payload !== null,
        isLoading: false,
      };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    default:
      return state;
  }
}

const initialState: AuthState = {
  session: null,
  user: null,
  isLoading: true,
  isAuthenticated: false,
};

// ─── Context ────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);
  const initializedRef = useRef(false);

  // Restore session on mount + listen for auth changes
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // Get existing session
    authService.getSession().then((session) => {
      dispatch({ type: 'SET_SESSION', payload: session });
    });

    // Subscribe to auth state changes
    const unsubscribe = authService.onAuthStateChange((session) => {
      dispatch({ type: 'SET_SESSION', payload: session });
    });

    return unsubscribe;
  }, []);

  // Handle deep link for magic link callback
  useEffect(() => {
    function handleDeepLink(event: { url: string }) {
      if (event.url.includes('auth-callback')) {
        // Supabase client handles token extraction automatically
        // when we call createSessionFromUrl or via the auth listener
        const url = new URL(event.url);
        const params = new URLSearchParams(url.hash.replace('#', '?'));
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');

        if (accessToken && refreshToken) {
          supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        }
      }
    }

    // Handle link that opened the app
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink({ url });
    });

    // Handle link while app is open
    const sub = Linking.addEventListener('url', handleDeepLink);
    return () => sub.remove();
  }, []);

  const sendMagicLink = useCallback(async (email: string) => {
    await authService.sendMagicLink(email);
  }, []);

  const signOut = useCallback(async () => {
    await authService.signOut();
    dispatch({ type: 'SET_SESSION', payload: null });
  }, []);

  return (
    <AuthContext.Provider value={{ state, sendMagicLink, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
