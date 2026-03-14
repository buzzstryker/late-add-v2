import React, { createContext, useContext, useReducer, useCallback, useEffect, ReactNode, useState } from 'react';
import { Player, PlayerCreateInput } from '../models/Player';
import * as playerRepo from '../db/playerRepository';
import * as appConfigRepo from '../db/appConfigRepository';
import { ghinService, GhinAuthError, GhinLookupError, GhinNetworkError, GhinPostScoreInput, GhinPostScoreResult, GhinCourseResult } from '../services/ghinService';
import { isOwnerPlayer } from '../services/ownerService';
import * as SecureStore from 'expo-secure-store';
import { useSync } from './SyncContext';

// ─── Secure Store Keys ──────────────────────────────────────────────────

const GHIN_USERNAME_KEY = 'ghin_username';
const GHIN_PASSWORD_KEY = 'ghin_password';

// ─── State ──────────────────────────────────────────────────────────────

interface PlayerState {
  players: Player[];
  isLoading: boolean;
  error: string | null;
}

type PlayerAction =
  | { type: 'SET_PLAYERS'; payload: Player[] }
  | { type: 'ADD_PLAYER'; payload: Player }
  | { type: 'UPDATE_PLAYER'; payload: Player }
  | { type: 'REMOVE_PLAYER'; payload: string }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null };

const initialState: PlayerState = {
  players: [],
  isLoading: false,
  error: null,
};

function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'SET_PLAYERS':
      return { ...state, players: action.payload, isLoading: false };
    case 'ADD_PLAYER':
      return { ...state, players: [...state.players, action.payload] };
    case 'UPDATE_PLAYER':
      return {
        ...state,
        players: state.players.map((p) =>
          p.id === action.payload.id ? action.payload : p
        ),
      };
    case 'REMOVE_PLAYER':
      return {
        ...state,
        players: state.players.filter((p) => p.id !== action.payload),
      };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false };
    default:
      return state;
  }
}

// ─── Context Type ───────────────────────────────────────────────────────

interface PlayerContextType {
  state: PlayerState;
  loadPlayers: () => Promise<void>;
  addPlayer: (input: PlayerCreateInput) => Promise<Player>;
  updatePlayer: (id: string, updates: Partial<PlayerCreateInput>) => Promise<Player | null>;
  removePlayer: (id: string) => Promise<void>;
  // App Owner
  ownerPlayerId: string | null;
  ownerLoaded: boolean;
  setAppOwner: (playerId: string) => Promise<void>;
  clearAppOwner: () => Promise<void>;
  isAppOwner: (playerId: string) => boolean;
  // GHIN
  ghinConnected: boolean;
  ghinUsername: string | null;
  saveGhinCredentials: (username: string, password: string) => Promise<boolean>;
  clearGhinCredentials: () => Promise<void>;
  fetchGhinHandicap: (playerId: string) => Promise<number | null>;
  searchGhinCourses: (query: string) => Promise<GhinCourseResult[]>;
  postScoreToGhin: (input: GhinPostScoreInput) => Promise<GhinPostScoreResult>;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

// ─── Provider ───────────────────────────────────────────────────────────

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(playerReducer, initialState);
  const [ghinConnected, setGhinConnected] = useState(false);
  const [ghinUsername, setGhinUsername] = useState<string | null>(null);
  const [ownerPlayerId, setOwnerPlayerIdState] = useState<string | null>(null);
  const [ownerLoaded, setOwnerLoaded] = useState(false);
  const { state: syncState } = useSync();

  // Reload players when sync pulls new data
  useEffect(() => {
    if (syncState.lastPullCompletedAt > 0) {
      loadPlayers();
    }
  }, [syncState.lastPullCompletedAt]);

  // Load GHIN connection status, app owner, and players on mount
  useEffect(() => {
    (async () => {
      try {
        const storedUsername = await SecureStore.getItemAsync(GHIN_USERNAME_KEY);
        const storedPassword = await SecureStore.getItemAsync(GHIN_PASSWORD_KEY);
        if (storedUsername && storedPassword) {
          setGhinConnected(true);
          setGhinUsername(storedUsername);
        }
      } catch {
        // SecureStore not available or corrupted — treat as disconnected
      }

      try {
        const ownerId = await appConfigRepo.getOwnerPlayerId();
        setOwnerPlayerIdState(ownerId);
      } catch {
        // DB not ready yet or table doesn't exist — will be set after onboarding
      }
      setOwnerLoaded(true);

      // Load players from DB on mount (sync will reload later if new data arrives)
      try {
        const players = await playerRepo.getAllPlayers();
        dispatch({ type: 'SET_PLAYERS', payload: players });
      } catch {
        // Will be loaded when sync completes
      }
    })();
  }, []);

  const loadPlayers = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const players = await playerRepo.getAllPlayers();
      dispatch({ type: 'SET_PLAYERS', payload: players });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: 'Failed to load players' });
    }
  }, []);

  const addPlayer = useCallback(async (input: PlayerCreateInput) => {
    const player = await playerRepo.createPlayer(input);
    dispatch({ type: 'ADD_PLAYER', payload: player });
    return player;
  }, []);

  const updatePlayer = useCallback(async (id: string, updates: Partial<PlayerCreateInput>) => {
    const player = await playerRepo.updatePlayer(id, updates);
    if (player) {
      dispatch({ type: 'UPDATE_PLAYER', payload: player });
    }
    return player;
  }, []);

  const removePlayer = useCallback(async (id: string) => {
    await playerRepo.deletePlayer(id);
    dispatch({ type: 'REMOVE_PLAYER', payload: id });
  }, []);

  // ─── App Owner Methods ─────────────────────────────────────────────

  const setAppOwner = useCallback(async (playerId: string) => {
    await appConfigRepo.setOwnerPlayerId(playerId);
    setOwnerPlayerIdState(playerId);
  }, []);

  const clearAppOwner = useCallback(async () => {
    await appConfigRepo.clearOwnerPlayerId();
    setOwnerPlayerIdState(null);
  }, []);

  const isAppOwnerFn = useCallback((playerId: string): boolean => {
    return isOwnerPlayer(ownerPlayerId, playerId);
  }, [ownerPlayerId]);

  // ─── GHIN Methods ───────────────────────────────────────────────────

  /**
   * Validate credentials by calling GHIN login, then store securely on success.
   * Returns true if credentials are valid & stored, false otherwise.
   */
  const saveGhinCredentials = useCallback(async (username: string, password: string): Promise<boolean> => {
    try {
      const valid = await ghinService.validateCredentials({ username, password });
      if (!valid) return false;

      await SecureStore.setItemAsync(GHIN_USERNAME_KEY, username);
      await SecureStore.setItemAsync(GHIN_PASSWORD_KEY, password);
      setGhinConnected(true);
      setGhinUsername(username);
      return true;
    } catch {
      return false;
    }
  }, []);

  /**
   * Clear stored GHIN credentials and reset connection state.
   */
  const clearGhinCredentials = useCallback(async () => {
    try {
      await SecureStore.deleteItemAsync(GHIN_USERNAME_KEY);
      await SecureStore.deleteItemAsync(GHIN_PASSWORD_KEY);
    } catch {
      // Ignore deletion errors
    }
    ghinService.clearToken();
    setGhinConnected(false);
    setGhinUsername(null);
  }, []);

  /**
   * Fetch a player's latest handicap from GHIN by their stored ghinNumber.
   * Updates the player in the DB + dispatches UPDATE_PLAYER.
   * Returns the new handicap index, or null on failure.
   */
  const fetchGhinHandicap = useCallback(async (playerId: string): Promise<number | null> => {
    // Find the player
    const player = state.players.find((p) => p.id === playerId);
    if (!player?.ghinNumber) return null;

    // Load credentials from SecureStore
    const username = await SecureStore.getItemAsync(GHIN_USERNAME_KEY);
    const password = await SecureStore.getItemAsync(GHIN_PASSWORD_KEY);
    if (!username || !password) return null;

    // Fetch from GHIN
    const result = await ghinService.fetchHandicapIndex(player.ghinNumber, { username, password });

    // Update player in DB
    const updated = await playerRepo.updatePlayer(playerId, {
      handicapIndex: result.handicapIndex,
    });
    if (updated) {
      dispatch({ type: 'UPDATE_PLAYER', payload: updated });
    }

    return result.handicapIndex;
  }, [state.players]);

  /**
   * Search for courses/facilities in GHIN by name.
   */
  const searchGhinCourses = useCallback(async (query: string): Promise<GhinCourseResult[]> => {
    const username = await SecureStore.getItemAsync(GHIN_USERNAME_KEY);
    const password = await SecureStore.getItemAsync(GHIN_PASSWORD_KEY);
    if (!username || !password) throw new Error('GHIN credentials not configured');

    return ghinService.searchCourses(query, { username, password });
  }, []);

  /**
   * Post a score to GHIN on behalf of a player.
   */
  const postScoreToGhin = useCallback(async (input: GhinPostScoreInput): Promise<GhinPostScoreResult> => {
    const username = await SecureStore.getItemAsync(GHIN_USERNAME_KEY);
    const password = await SecureStore.getItemAsync(GHIN_PASSWORD_KEY);
    if (!username || !password) throw new Error('GHIN credentials not configured');

    return ghinService.postScore(input, { username, password });
  }, []);

  return (
    <PlayerContext.Provider
      value={{
        state,
        loadPlayers,
        addPlayer,
        updatePlayer,
        removePlayer,
        ownerPlayerId,
        ownerLoaded,
        setAppOwner,
        clearAppOwner,
        isAppOwner: isAppOwnerFn,
        ghinConnected,
        ghinUsername,
        saveGhinCredentials,
        clearGhinCredentials,
        fetchGhinHandicap,
        searchGhinCourses,
        postScoreToGhin,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayers() {
  const context = useContext(PlayerContext);
  if (!context) throw new Error('usePlayers must be used within PlayerProvider');
  return context;
}
