import React, { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus, InteractionManager } from 'react-native';
import { useAuth } from './AuthContext';
import * as syncService from '@/src/services/syncService';
import { getPendingChanges } from '@/src/db/syncChangeLogger';

// ─── Types ──────────────────────────────────────────────────────────

interface SyncState {
  isSyncing: boolean;
  lastSyncAt: string | null;
  syncError: string | null;
  isInitialSyncDone: boolean;
  /** Incremented after each successful pull — data contexts watch this to reload. */
  lastPullCompletedAt: number;
}

interface SyncContextType {
  state: SyncState;
  triggerSync: () => Promise<void>;
  performInitialSync: () => Promise<void>;
  forceResync: () => Promise<void>;
}

type SyncAction =
  | { type: 'SYNC_START' }
  | { type: 'SYNC_SUCCESS'; payload: { pulledCount: number } }
  | { type: 'SYNC_ERROR'; payload: string }
  | { type: 'INITIAL_SYNC_DONE' };

// ─── Reducer ────────────────────────────────────────────────────────

function syncReducer(state: SyncState, action: SyncAction): SyncState {
  switch (action.type) {
    case 'SYNC_START':
      return { ...state, isSyncing: true, syncError: null };
    case 'SYNC_SUCCESS':
      return {
        ...state,
        isSyncing: false,
        lastSyncAt: new Date().toISOString(),
        syncError: null,
        lastPullCompletedAt: action.payload.pulledCount > 0
          ? state.lastPullCompletedAt + 1
          : state.lastPullCompletedAt,
      };
    case 'SYNC_ERROR':
      return { ...state, isSyncing: false, syncError: action.payload };
    case 'INITIAL_SYNC_DONE':
      return { ...state, isInitialSyncDone: true };
    default:
      return state;
  }
}

const initialState: SyncState = {
  isSyncing: false,
  lastSyncAt: null,
  syncError: null,
  isInitialSyncDone: false,
  lastPullCompletedAt: 0,
};

// ─── Context ────────────────────────────────────────────────────────

const SyncContext = createContext<SyncContextType | null>(null);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(syncReducer, initialState);
  const { state: authState } = useAuth();
  const syncingRef = useRef(false);
  const initialCheckDone = useRef(false);

  // Check if initial sync was already done (supabase_user_id is set)
  useEffect(() => {
    if (!authState.isAuthenticated || initialCheckDone.current) return;
    initialCheckDone.current = true;

    syncService.getSyncUserId().then((existingUserId) => {
      if (existingUserId === authState.user?.id) {
        dispatch({ type: 'INITIAL_SYNC_DONE' });
      }
    });
  }, [authState.isAuthenticated, authState.user?.id]);

  const triggerSync = useCallback(async () => {
    if (!authState.isAuthenticated || !authState.user?.id) return;
    if (syncingRef.current) return;
    syncingRef.current = true;

    // Wait for any in-flight UI interactions (animations, touches) to finish
    // before starting sync work that could block the JS thread.
    await new Promise<void>((resolve) => InteractionManager.runAfterInteractions(() => resolve()));

    dispatch({ type: 'SYNC_START' });
    try {
      const result = await syncService.fullSync(authState.user.id);
      dispatch({ type: 'SYNC_SUCCESS', payload: { pulledCount: result.pulled } });
    } catch (err: any) {
      const message = err?.message ?? 'Sync failed';
      dispatch({ type: 'SYNC_ERROR', payload: message });
    } finally {
      syncingRef.current = false;
    }
  }, [authState.isAuthenticated, authState.user?.id]);

  const performInitialSyncFn = useCallback(async () => {
    if (!authState.isAuthenticated || !authState.user?.id) return;
    if (syncingRef.current) return;
    syncingRef.current = true;

    // Wait for any in-flight UI interactions (animations, touches) to finish
    // before starting the heavy initial sync.
    await new Promise<void>((resolve) => InteractionManager.runAfterInteractions(() => resolve()));

    dispatch({ type: 'SYNC_START' });
    try {
      const result = await syncService.performInitialSync(authState.user.id);
      dispatch({ type: 'INITIAL_SYNC_DONE' });
      dispatch({ type: 'SYNC_SUCCESS', payload: { pulledCount: result.pulled } });
    } catch (err: any) {
      const message = err?.message ?? 'Initial sync failed';
      dispatch({ type: 'SYNC_ERROR', payload: message });
    } finally {
      syncingRef.current = false;
    }
  }, [authState.isAuthenticated, authState.user?.id]);

  // Auto-trigger initial sync when user first authenticates.
  // Delay 3s so the UI finishes rendering + tab navigator mounts first.
  // performInitialSyncFn also waits for InteractionManager before starting.
  useEffect(() => {
    if (authState.isAuthenticated && !state.isInitialSyncDone && initialCheckDone.current) {
      const timer = setTimeout(() => {
        performInitialSyncFn();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [authState.isAuthenticated, state.isInitialSyncDone, performInitialSyncFn]);

  // Sync on app foreground
  useEffect(() => {
    if (!authState.isAuthenticated || !state.isInitialSyncDone) return;

    function handleAppState(nextState: AppStateStatus) {
      if (nextState === 'active') {
        // Wait for UI interactions (app-foreground animations) to finish,
        // then add a generous delay before syncing so we don't starve the
        // JS thread while continuous speech recognition is also running.
        InteractionManager.runAfterInteractions(() => {
          setTimeout(() => triggerSync(), 2000);
        });
      }
    }

    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [authState.isAuthenticated, state.isInitialSyncDone, triggerSync]);

  // Periodic sync for pending changes (every 30s)
  useEffect(() => {
    if (!authState.isAuthenticated || !state.isInitialSyncDone) return;

    const interval = setInterval(() => {
      // Wait for any running animations/interactions before checking for pending changes
      InteractionManager.runAfterInteractions(async () => {
        const pending = await getPendingChanges();
        if (pending.length > 0) {
          triggerSync();
        }
      });
    }, 30_000);

    return () => clearInterval(interval);
  }, [authState.isAuthenticated, state.isInitialSyncDone, triggerSync]);

  const forceResync = useCallback(async () => {
    if (!authState.isAuthenticated || !authState.user?.id) return;
    if (syncingRef.current) return;

    // Reset sync metadata so initial sync re-runs
    await syncService.resetSyncMeta();
    dispatch({ type: 'INITIAL_SYNC_DONE' }); // keep isInitialSyncDone true to avoid re-trigger loop

    // Wait for UI interactions to settle before heavy sync work
    await new Promise<void>((resolve) => InteractionManager.runAfterInteractions(() => resolve()));

    syncingRef.current = true;
    dispatch({ type: 'SYNC_START' });
    try {
      const result = await syncService.performInitialSync(authState.user.id);
      dispatch({ type: 'SYNC_SUCCESS', payload: { pulledCount: result.pulled } });
    } catch (err: any) {
      const message = err?.message ?? 'Force resync failed';
      dispatch({ type: 'SYNC_ERROR', payload: message });
    } finally {
      syncingRef.current = false;
    }
  }, [authState.isAuthenticated, authState.user?.id]);

  return (
    <SyncContext.Provider value={{ state, triggerSync, performInitialSync: performInitialSyncFn, forceResync }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync(): SyncContextType {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used within SyncProvider');
  return ctx;
}
