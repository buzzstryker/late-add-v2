import React, { createContext, useContext, useReducer, useCallback, useEffect, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  VoiceSettings,
  DEFAULT_VOICE_SETTINGS,
  speak as ttsSpeak,
  stopSpeaking,
  buildScoreConfirmation,
  buildHoleAnnouncement,
  buildRoundSummary,
  mergeWithDefaults,
  getSettingsStorageKey,
  requestSttPermissions,
  getSttPermissionStatus,
  startSttEngine,
  stopSttEngine,
  isSttAvailable,
  parseSpokenInput,
  parseMultipleScores,
  matchPlayerName,
  interpretWithClaude,
  startContinuousSttEngine,
  extractWakeWordCommand,
} from '../services/voiceService';
import type { ParsedIntent, ParsedScoreIntent, SttPermissionResult, PlayerMatchInfo } from '../services/voiceService';
import { claudeService } from '../services/claudeService';
import type { RoundVoiceContext } from '../services/claudeService';

// Conditionally import the hook — it crashes in Expo Go where the native module is absent
let useSpeechRecognitionEvent: any = (_event: string, _handler: any) => {};
try {
  useSpeechRecognitionEvent = require('expo-speech-recognition').useSpeechRecognitionEvent;
} catch {
  // Expo Go fallback — hooks are no-ops
}

// Re-export service helpers so screens only import from context
export {
  buildScoreConfirmation,
  buildHoleAnnouncement,
  buildRoundSummary,
  relativeScoreToAbsolute,
  parseSpokenInput,
  parseMultipleScores,
  parseDotCommand,
  parseNavigationCommand,
  matchPlayerName,
} from '../services/voiceService';
export type { SttPermissionResult, ParsedScoreIntent, ParsedDotIntent, ParsedNavigationIntent, PlayerMatchInfo } from '../services/voiceService';
export type { RoundVoiceContext } from '../services/claudeService';

// ─── State ────────────────────────────────────────────────────────────────

interface VoiceState {
  settings: VoiceSettings;
  isSpeaking: boolean;
  isListening: boolean;
  transcript: string | null;
  parsedIntent: ParsedIntent | null;
  error: string | null;
  isSettingsLoaded: boolean;
  sttPermission: SttPermissionResult | null;
  /** Whether Claude API key is configured and service is ready */
  claudeAvailable: boolean;
  /** Whether a Claude API interpretation call is in progress */
  isInterpreting: boolean;
  /** Whether hands-free (always-on) listening mode is active */
  handsFreeModeActive: boolean;
  /** Extracted command text after wake word detection (null = no wake word yet) */
  wakeWordCommand: string | null;
  /** Whether a wake word command is currently being processed */
  isProcessingWakeWord: boolean;
}

const initialState: VoiceState = {
  settings: DEFAULT_VOICE_SETTINGS,
  isSpeaking: false,
  isListening: false,
  transcript: null,
  parsedIntent: null,
  error: null,
  isSettingsLoaded: false,
  sttPermission: null,
  claudeAvailable: false,
  isInterpreting: false,
  handsFreeModeActive: false,
  wakeWordCommand: null,
  isProcessingWakeWord: false,
};

// ─── Actions ──────────────────────────────────────────────────────────────

type VoiceAction =
  | { type: 'SET_SETTINGS'; payload: VoiceSettings }
  | { type: 'SET_SPEAKING'; payload: boolean }
  | { type: 'SET_LISTENING'; payload: boolean }
  | { type: 'SET_TRANSCRIPT'; payload: string | null }
  | { type: 'SET_PARSED_INTENT'; payload: ParsedIntent | null }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SETTINGS_LOADED' }
  | { type: 'SET_STT_PERMISSION'; payload: SttPermissionResult | null }
  | { type: 'SET_CLAUDE_AVAILABLE'; payload: boolean }
  | { type: 'SET_INTERPRETING'; payload: boolean }
  | { type: 'SET_HANDS_FREE_MODE'; payload: boolean }
  | { type: 'SET_WAKE_WORD_COMMAND'; payload: string | null }
  | { type: 'SET_PROCESSING_WAKE_WORD'; payload: boolean };

// ─── Reducer ──────────────────────────────────────────────────────────────

function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    case 'SET_SETTINGS':
      return { ...state, settings: action.payload };
    case 'SET_SPEAKING':
      return { ...state, isSpeaking: action.payload };
    case 'SET_LISTENING':
      return { ...state, isListening: action.payload };
    case 'SET_TRANSCRIPT':
      return { ...state, transcript: action.payload };
    case 'SET_PARSED_INTENT':
      return { ...state, parsedIntent: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SETTINGS_LOADED':
      return { ...state, isSettingsLoaded: true };
    case 'SET_STT_PERMISSION':
      return { ...state, sttPermission: action.payload };
    case 'SET_CLAUDE_AVAILABLE':
      return { ...state, claudeAvailable: action.payload };
    case 'SET_INTERPRETING':
      return { ...state, isInterpreting: action.payload };
    case 'SET_HANDS_FREE_MODE':
      return { ...state, handsFreeModeActive: action.payload };
    case 'SET_WAKE_WORD_COMMAND':
      return { ...state, wakeWordCommand: action.payload };
    case 'SET_PROCESSING_WAKE_WORD':
      return { ...state, isProcessingWakeWord: action.payload };
    default:
      return state;
  }
}

// ─── Context Type ─────────────────────────────────────────────────────────

interface VoiceContextType {
  state: VoiceState;
  speak: (text: string) => Promise<void>;
  speakScoreConfirmation: (playerName: string, grossScore: number, par: number, holeNumber: number) => Promise<void>;
  speakHoleAnnouncement: (holeNumber: number, par: number, strokeIndex: number) => Promise<void>;
  speakRoundSummary: (players: { name: string; gross: number; toPar: number }[]) => Promise<void>;
  stopSpeaking: () => Promise<void>;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  clearTranscript: () => void;
  updateSettings: (updates: Partial<VoiceSettings>) => Promise<void>;
  resetSettings: () => Promise<void>;
  requestSttPermission: () => Promise<boolean>;
  /** Parse current transcript into score intents using known player names (regex, sync) */
  parseTranscript: (
    playerNames: string[],
    currentHole: number,
    players: PlayerMatchInfo[],
  ) => ParsedScoreIntent[];
  /** Parse transcript with Claude API (async, falls back to regex). Returns usedClaude flag. */
  parseTranscriptWithClaude: (
    roundContext: RoundVoiceContext,
    playerMatchInfos: PlayerMatchInfo[],
    currentHole: number,
  ) => Promise<{ intents: ParsedScoreIntent[]; usedClaude: boolean }>;
  /** Parse an explicit command string with Claude API (for wake word flow) */
  parseCommandWithClaude: (
    command: string,
    roundContext: RoundVoiceContext,
    playerMatchInfos: PlayerMatchInfo[],
    currentHole: number,
  ) => Promise<{ intents: ParsedScoreIntent[]; usedClaude: boolean }>;
  /** Start hands-free listening mode (continuous, wake-word activated) */
  startHandsFreeMode: (playerNames: string[]) => Promise<void>;
  /** Stop hands-free listening mode */
  stopHandsFreeMode: () => void;
  /** Clear the wake word command (after processing — resumes detection) */
  clearWakeWordCommand: () => void;
}

// ─── Provider ─────────────────────────────────────────────────────────────

const VoiceCtx = createContext<VoiceContextType | undefined>(undefined);

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(voiceReducer, initialState);

  // ── Refs for hands-free mode ──
  /** Player names for contextual biasing on auto-restart */
  const playerNamesRef = useRef<string[]>([]);
  /** Last processed wake word command (prevents duplicates) */
  const lastProcessedCommandRef = useRef<string | null>(null);
  /** Exponential backoff counter for auto-restart */
  const restartAttemptsRef = useRef(0);
  /** Timer for auto-restart delay */
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Mutable snapshot of handsFreeModeActive for use in event callbacks */
  const handsFreeModeRef = useRef(false);
  /** Mutable snapshot of isProcessingWakeWord for use in event callbacks */
  const processingWakeWordRef = useRef(false);
  /** Timer for stabilising an interim wake-word command (treat as final after silence) */
  const wakeWordStabiliseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Latest interim command text (avoids stale closure in timeout callback) */
  const pendingInterimCommandRef = useRef<string | null>(null);
  /** True while clearWakeWordCommand is doing a manual stop+restart — end handler should skip */
  const manualRestartingRef = useRef(false);

  // Keep refs in sync with state (event handlers close over stale state)
  useEffect(() => { handsFreeModeRef.current = state.handsFreeModeActive; }, [state.handsFreeModeActive]);
  useEffect(() => { processingWakeWordRef.current = state.isProcessingWakeWord; }, [state.isProcessingWakeWord]);

  // Load persisted settings on mount
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(getSettingsStorageKey());
        const parsed = raw ? JSON.parse(raw) : null;
        const settings = mergeWithDefaults(parsed);
        dispatch({ type: 'SET_SETTINGS', payload: settings });
      } catch {
        // Use defaults on error
      }
      dispatch({ type: 'SETTINGS_LOADED' });
    })();
  }, []);

  // Check STT permission status on mount (non-prompting)
  useEffect(() => {
    (async () => {
      try {
        const status = await getSttPermissionStatus();
        dispatch({ type: 'SET_STT_PERMISSION', payload: status });
      } catch {
        // Permission check not available
      }
    })();
  }, []);

  // Initialize Claude API key on mount (if env var is set)
  useEffect(() => {
    const key = process.env.EXPO_PUBLIC_CLAUDE_API_KEY;
    if (key && key.length > 0) {
      claudeService.setApiKey(key);
      dispatch({ type: 'SET_CLAUDE_AVAILABLE', payload: true });
    }
  }, []);

  // ── STT event subscriptions (must be top-level hooks) ──
  // Note: event handlers read from refs instead of state because the hooks
  // capture a single closure — state would be stale between re-renders.

  useSpeechRecognitionEvent('result', (event: any) => {
    const isFinal: boolean = event.isFinal ?? false;
    const transcript: string = event.results[0]?.transcript ?? '';

    if (!handsFreeModeRef.current) {
      // Push-to-talk: pass through as before
      dispatch({ type: 'SET_TRANSCRIPT', payload: transcript });
      if (state.error) dispatch({ type: 'SET_ERROR', payload: null });
      return;
    }

    // ── Hands-free mode: scan for wake word ──
    if (processingWakeWordRef.current) return; // busy processing previous command

    const command = extractWakeWordCommand(transcript);

    if (command === null) {
      // No wake word — silently ignore ambient speech
      return;
    }

    if (command === '') {
      // Wake word only, no command yet — show brief indicator
      dispatch({ type: 'SET_TRANSCRIPT', payload: '(listening for command...)' });
      return;
    }

    // Wake word + command text present
    // Helper to commit a command (shared by isFinal and stabilisation timer)
    const commitCommand = (cmd: string) => {
      if (lastProcessedCommandRef.current !== cmd) {
        lastProcessedCommandRef.current = cmd;
        pendingInterimCommandRef.current = null;
        if (wakeWordStabiliseRef.current) {
          clearTimeout(wakeWordStabiliseRef.current);
          wakeWordStabiliseRef.current = null;
        }
        dispatch({ type: 'SET_TRANSCRIPT', payload: cmd });
        dispatch({ type: 'SET_WAKE_WORD_COMMAND', payload: cmd });
        dispatch({ type: 'SET_PROCESSING_WAKE_WORD', payload: true });
        processingWakeWordRef.current = true;
      }
    };

    if (isFinal) {
      commitCommand(command);
    } else {
      // Interim result — show command preview + start stabilisation timer.
      // If no new results arrive within 1.5s, treat the interim as final.
      // This handles iOS continuous mode where isFinal may not fire promptly.
      dispatch({ type: 'SET_TRANSCRIPT', payload: command });
      pendingInterimCommandRef.current = command;

      if (wakeWordStabiliseRef.current) clearTimeout(wakeWordStabiliseRef.current);
      wakeWordStabiliseRef.current = setTimeout(() => {
        wakeWordStabiliseRef.current = null;
        const pending = pendingInterimCommandRef.current;
        if (pending && !processingWakeWordRef.current) {
          commitCommand(pending);
        }
      }, 750);
    }
  });

  useSpeechRecognitionEvent('error', (event: any) => {
    if (!handsFreeModeRef.current) {
      // Push-to-talk: original behaviour
      dispatch({ type: 'SET_ERROR', payload: event.error });
      dispatch({ type: 'SET_LISTENING', payload: false });
      return;
    }

    // Hands-free: recoverable errors trigger auto-restart via 'end' event
    const recoverable = ['no-speech', 'speech-timeout', 'network'];
    if (recoverable.includes(event.error)) {
      restartAttemptsRef.current++;
      return;
    }

    // Fatal error — show and disable hands-free
    dispatch({ type: 'SET_ERROR', payload: event.error });
    dispatch({ type: 'SET_HANDS_FREE_MODE', payload: false });
    handsFreeModeRef.current = false;
    dispatch({ type: 'SET_LISTENING', payload: false });
  });

  useSpeechRecognitionEvent('end', () => {
    if (!handsFreeModeRef.current) {
      // Push-to-talk: original behaviour
      dispatch({ type: 'SET_LISTENING', payload: false });
      return;
    }

    // If clearWakeWordCommand is doing a manual stop→restart, don't compete
    if (manualRestartingRef.current) return;

    // Hands-free: auto-restart with exponential backoff
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);

    const delay = Math.min(300 * Math.pow(2, restartAttemptsRef.current), 5000);
    restartTimerRef.current = setTimeout(() => {
      if (handsFreeModeRef.current && !manualRestartingRef.current) {
        try {
          startContinuousSttEngine(playerNamesRef.current);
          restartAttemptsRef.current = 0; // success — reset backoff
        } catch {
          restartAttemptsRef.current++;
        }
      }
    }, delay);
  });

  // ── TTS ──

  const speak = useCallback(async (text: string) => {
    dispatch({ type: 'SET_SPEAKING', payload: true });
    try {
      await ttsSpeak(text, state.settings);
    } finally {
      dispatch({ type: 'SET_SPEAKING', payload: false });
    }
  }, [state.settings]);

  const speakScoreConfirmation = useCallback(async (
    playerName: string,
    grossScore: number,
    par: number,
    holeNumber: number,
  ) => {
    if (!state.settings.confirmScores) return;
    const text = buildScoreConfirmation(playerName, grossScore, par, holeNumber);
    await speak(text);
  }, [state.settings.confirmScores, speak]);

  const speakHoleAnnouncement = useCallback(async (
    holeNumber: number,
    par: number,
    strokeIndex: number,
  ) => {
    if (!state.settings.announceHole) return;
    const text = buildHoleAnnouncement(holeNumber, par, strokeIndex);
    await speak(text);
  }, [state.settings.announceHole, speak]);

  const speakRoundSummaryFn = useCallback(async (
    players: { name: string; gross: number; toPar: number }[],
  ) => {
    const text = buildRoundSummary(players);
    await speak(text);
  }, [speak]);

  const handleStopSpeaking = useCallback(async () => {
    await stopSpeaking();
    dispatch({ type: 'SET_SPEAKING', payload: false });
  }, []);

  // ── STT ──

  const startListening = useCallback(async () => {
    if (!state.settings.sttEnabled) {
      dispatch({ type: 'SET_ERROR', payload: 'Voice input is disabled in settings' });
      return;
    }

    // Check / request permissions
    let permResult = state.sttPermission;
    if (!permResult || !permResult.granted) {
      permResult = await requestSttPermissions();
      dispatch({ type: 'SET_STT_PERMISSION', payload: permResult });
    }

    if (!permResult.granted) {
      dispatch({
        type: 'SET_ERROR',
        payload: permResult.canAskAgain
          ? 'Microphone permission is required for voice input'
          : 'Microphone permission was denied. Please enable it in Settings.',
      });
      return;
    }

    // Stop any ongoing TTS before listening
    await stopSpeaking();

    // Clear previous state
    dispatch({ type: 'SET_TRANSCRIPT', payload: null });
    dispatch({ type: 'SET_PARSED_INTENT', payload: null });
    dispatch({ type: 'SET_ERROR', payload: null });
    dispatch({ type: 'SET_LISTENING', payload: true });

    try {
      startSttEngine();
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err.message || 'Failed to start voice recognition' });
      dispatch({ type: 'SET_LISTENING', payload: false });
    }
  }, [state.settings.sttEnabled, state.sttPermission]);

  const handleStopListening = useCallback(async () => {
    stopSttEngine();
    dispatch({ type: 'SET_LISTENING', payload: false });
  }, []);

  const clearTranscript = useCallback(() => {
    dispatch({ type: 'SET_TRANSCRIPT', payload: null });
    dispatch({ type: 'SET_PARSED_INTENT', payload: null });
  }, []);

  const requestSttPermission = useCallback(async (): Promise<boolean> => {
    const result = await requestSttPermissions();
    dispatch({ type: 'SET_STT_PERMISSION', payload: result });
    return result.granted;
  }, []);

  // ── Settings ──

  const updateSettings = useCallback(async (updates: Partial<VoiceSettings>) => {
    const newSettings = { ...state.settings, ...updates };
    dispatch({ type: 'SET_SETTINGS', payload: newSettings });
    try {
      await AsyncStorage.setItem(getSettingsStorageKey(), JSON.stringify(newSettings));
    } catch {
      // In-memory state is still updated even if persistence fails
    }
  }, [state.settings]);

  const resetSettings = useCallback(async () => {
    dispatch({ type: 'SET_SETTINGS', payload: DEFAULT_VOICE_SETTINGS });
    try {
      await AsyncStorage.removeItem(getSettingsStorageKey());
    } catch {
      // Ignore persistence errors
    }
  }, []);

  // ── NLP Parsing ──

  const parseTranscript = useCallback((
    playerNames: string[],
    currentHole: number,
    players: PlayerMatchInfo[],
  ): ParsedScoreIntent[] => {
    const transcript = state.transcript;
    if (!transcript) return [];

    const intents = parseMultipleScores(transcript, playerNames, currentHole);

    // Resolve fuzzy player names to IDs
    for (const intent of intents) {
      if (intent.playerName) {
        const matchedId = matchPlayerName(intent.playerName, players);
        if (matchedId) {
          // Replace the spoken name with the matched player ID for easy lookup
          intent.playerName = matchedId;
        }
      }
    }

    // Store the first intent (or null) for UI feedback
    dispatch({
      type: 'SET_PARSED_INTENT',
      payload: intents.length > 0 ? intents[0] : null,
    });

    return intents;
  }, [state.transcript]);

  // ── Claude-powered NLP Parsing (async) ──

  const parseTranscriptWithClaude = useCallback(async (
    roundContext: RoundVoiceContext,
    playerMatchInfos: PlayerMatchInfo[],
    currentHole: number,
  ): Promise<{ intents: ParsedScoreIntent[]; usedClaude: boolean }> => {
    const transcript = state.transcript;
    if (!transcript) return { intents: [], usedClaude: false };

    dispatch({ type: 'SET_INTERPRETING', payload: true });
    try {
      const result = await interpretWithClaude(
        transcript,
        roundContext,
        playerMatchInfos,
        currentHole,
      );

      // Store the first intent for UI feedback
      dispatch({
        type: 'SET_PARSED_INTENT',
        payload: result.intents.length > 0 ? result.intents[0] : null,
      });

      return result;
    } finally {
      dispatch({ type: 'SET_INTERPRETING', payload: false });
    }
  }, [state.transcript]);

  // ── Claude parsing for explicit command string (wake word flow) ──

  const parseCommandWithClaude = useCallback(async (
    command: string,
    roundContext: RoundVoiceContext,
    playerMatchInfos: PlayerMatchInfo[],
    currentHole: number,
  ): Promise<{ intents: ParsedScoreIntent[]; usedClaude: boolean }> => {
    if (!command) return { intents: [], usedClaude: false };

    dispatch({ type: 'SET_INTERPRETING', payload: true });
    try {
      const result = await interpretWithClaude(
        command,
        roundContext,
        playerMatchInfos,
        currentHole,
      );

      dispatch({
        type: 'SET_PARSED_INTENT',
        payload: result.intents.length > 0 ? result.intents[0] : null,
      });

      return result;
    } finally {
      dispatch({ type: 'SET_INTERPRETING', payload: false });
    }
  }, []);

  // ── Hands-free mode ──

  const startHandsFreeMode = useCallback(async (playerNames: string[]) => {
    if (!state.settings.sttEnabled) {
      dispatch({ type: 'SET_ERROR', payload: 'Voice input is disabled in settings' });
      return;
    }

    // Check / request permissions
    let permResult = state.sttPermission;
    if (!permResult || !permResult.granted) {
      permResult = await requestSttPermissions();
      dispatch({ type: 'SET_STT_PERMISSION', payload: permResult });
    }
    if (!permResult.granted) {
      dispatch({
        type: 'SET_ERROR',
        payload: permResult.canAskAgain
          ? 'Microphone permission is required for voice input'
          : 'Microphone permission was denied. Please enable it in Settings.',
      });
      return;
    }

    // Stop any ongoing TTS
    await stopSpeaking();

    // Store player names for auto-restart
    playerNamesRef.current = playerNames;

    // Reset state
    dispatch({ type: 'SET_TRANSCRIPT', payload: null });
    dispatch({ type: 'SET_WAKE_WORD_COMMAND', payload: null });
    dispatch({ type: 'SET_PROCESSING_WAKE_WORD', payload: false });
    processingWakeWordRef.current = false;
    dispatch({ type: 'SET_ERROR', payload: null });
    dispatch({ type: 'SET_HANDS_FREE_MODE', payload: true });
    handsFreeModeRef.current = true;
    dispatch({ type: 'SET_LISTENING', payload: true });
    lastProcessedCommandRef.current = null;
    restartAttemptsRef.current = 0;

    try {
      startContinuousSttEngine(playerNames);
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err.message || 'Failed to start continuous listening' });
      dispatch({ type: 'SET_HANDS_FREE_MODE', payload: false });
      handsFreeModeRef.current = false;
      dispatch({ type: 'SET_LISTENING', payload: false });
    }
  }, [state.settings.sttEnabled, state.sttPermission]);

  const stopHandsFreeMode = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (wakeWordStabiliseRef.current) {
      clearTimeout(wakeWordStabiliseRef.current);
      wakeWordStabiliseRef.current = null;
    }
    pendingInterimCommandRef.current = null;
    stopSttEngine();
    dispatch({ type: 'SET_HANDS_FREE_MODE', payload: false });
    handsFreeModeRef.current = false;
    dispatch({ type: 'SET_LISTENING', payload: false });
    dispatch({ type: 'SET_WAKE_WORD_COMMAND', payload: null });
    dispatch({ type: 'SET_PROCESSING_WAKE_WORD', payload: false });
    processingWakeWordRef.current = false;
    lastProcessedCommandRef.current = null;
    restartAttemptsRef.current = 0;
  }, []);

  const clearWakeWordCommand = useCallback(() => {
    if (wakeWordStabiliseRef.current) {
      clearTimeout(wakeWordStabiliseRef.current);
      wakeWordStabiliseRef.current = null;
    }
    pendingInterimCommandRef.current = null;
    dispatch({ type: 'SET_WAKE_WORD_COMMAND', payload: null });
    dispatch({ type: 'SET_PROCESSING_WAKE_WORD', payload: false });
    processingWakeWordRef.current = false;
    dispatch({ type: 'SET_TRANSCRIPT', payload: null });
    lastProcessedCommandRef.current = null;

    // Restart the continuous STT engine to get a fresh transcript.
    // iOS continuous mode accumulates ALL text from session start in each
    // result, so subsequent wake word detection would re-match old text.
    // Stopping and restarting gives a clean slate.
    // Set manualRestartingRef so the 'end' event handler doesn't compete.
    if (handsFreeModeRef.current) {
      manualRestartingRef.current = true;
      try { stopSttEngine(); } catch { /* ignore */ }
      restartAttemptsRef.current = 0;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        manualRestartingRef.current = false;
        if (handsFreeModeRef.current) {
          try {
            startContinuousSttEngine(playerNamesRef.current);
            dispatch({ type: 'SET_LISTENING', payload: true });
          } catch {
            // Manual restart failed — allow end handler to take over
          }
        }
      }, 300);
    }
  }, []);

  return (
    <VoiceCtx.Provider
      value={{
        state,
        speak,
        speakScoreConfirmation,
        speakHoleAnnouncement,
        speakRoundSummary: speakRoundSummaryFn,
        stopSpeaking: handleStopSpeaking,
        startListening,
        stopListening: handleStopListening,
        clearTranscript,
        updateSettings,
        resetSettings,
        requestSttPermission,
        parseTranscript,
        parseTranscriptWithClaude,
        parseCommandWithClaude,
        startHandsFreeMode,
        stopHandsFreeMode,
        clearWakeWordCommand,
      }}
    >
      {children}
    </VoiceCtx.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useVoice() {
  const context = useContext(VoiceCtx);
  if (!context) throw new Error('useVoice must be used within VoiceProvider');
  return context;
}
