import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { courseApiService } from '../services/courseApiService';

interface AppState {
  isDbReady: boolean;
  isLoading: boolean;
  error: string | null;
}

type AppAction =
  | { type: 'DB_READY' }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'CLEAR_ERROR' };

const initialState: AppState = {
  isDbReady: false,
  isLoading: true,
  error: null,
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'DB_READY':
      return { ...state, isDbReady: true, isLoading: false };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  useEffect(() => {
    async function initDb() {
      try {
        const { getDatabase } = await import('../db/database');
        await getDatabase();
        dispatch({ type: 'DB_READY' });

        // Initialize the golf course API key from environment
        const apiKey = process.env.EXPO_PUBLIC_GOLF_COURSE_API_KEY;
        if (apiKey) {
          courseApiService.setApiKey(apiKey);
        }
      } catch (err) {
        dispatch({ type: 'SET_ERROR', payload: 'Failed to initialize database' });
      }
    }
    initDb();
  }, []);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}
