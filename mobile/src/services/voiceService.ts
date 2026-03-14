import * as Speech from 'expo-speech';

// expo-speech-recognition requires a native dev build; gracefully degrade in Expo Go
let ExpoSpeechRecognitionModule: any = null;
try {
  ExpoSpeechRecognitionModule = require('expo-speech-recognition').ExpoSpeechRecognitionModule;
} catch {
  // Native module not available (Expo Go) — STT functions will return safe defaults
}

// ─── Types ───────────────────────────────────────────────────────────────

export interface VoiceSettings {
  ttsEnabled: boolean;
  sttEnabled: boolean;
  ttsRate: number;         // 0.5 - 2.0, default 1.0
  ttsPitch: number;        // 0.5 - 2.0, default 1.0
  ttsVolume: number;       // 0.0 - 1.0, default 1.0
  confirmScores: boolean;  // Speak score confirmations after entry
  announceHole: boolean;   // Announce hole info on navigation
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  ttsEnabled: true,
  sttEnabled: false,
  ttsRate: 1.0,
  ttsPitch: 1.0,
  ttsVolume: 1.0,
  confirmScores: true,
  announceHole: true,
};

/** Result of NLP parsing a spoken score phrase (Phase 3). */
export interface ParsedScoreIntent {
  type: 'score';
  playerName?: string;
  holeNumber?: number;
  score?: number;
  scoreRelative?: string;
  confidence: number;
}

/** Result of NLP parsing a junk-dot award command (e.g. "Rage sandy"). */
export interface ParsedDotIntent {
  type: 'dot';
  playerName?: string;
  dotId: string;
  dotDisplayName: string;
  confidence: number;
}

/** Result of parsing a navigation command (e.g. "show hole 8 detail"). */
export interface ParsedNavigationIntent {
  type: 'navigation';
  action: 'go_to_hole' | 'show_scorecard' | 'show_hole_view';
  holeNumber?: number;
}

/** Result of NLP parsing a query phrase (Phase 4). */
export interface ParsedQueryIntent {
  type: 'query';
  queryKind: 'score_check' | 'total' | 'standings' | 'hole_info' | 'unknown';
  playerName?: string;
  holeNumber?: number;
  confidence: number;
}

export type ParsedIntent = ParsedScoreIntent | ParsedQueryIntent | ParsedDotIntent;

// ─── TTS Functions ───────────────────────────────────────────────────────

/**
 * Speak a text string using expo-speech.
 * Stops any ongoing speech first.
 */
export async function speak(
  text: string,
  settings: Pick<VoiceSettings, 'ttsEnabled' | 'ttsRate' | 'ttsPitch' | 'ttsVolume'>,
): Promise<void> {
  if (!settings.ttsEnabled) return;

  // Stop any ongoing speech, then give iOS a moment to finish stopping
  const wasSpeaking = await Speech.isSpeakingAsync();
  if (wasSpeaking) {
    Speech.stop();
    await new Promise<void>((r) => setTimeout(r, 100));
  }

  return new Promise<void>((resolve) => {
    Speech.speak(text, {
      language: 'en-US',
      rate: settings.ttsRate,
      pitch: settings.ttsPitch,
      volume: settings.ttsVolume,
      onDone: () => resolve(),
      onError: () => resolve(),
      onStopped: () => resolve(),
    });
  });
}

/** Stop any ongoing TTS playback. */
export async function stopSpeaking(): Promise<void> {
  const speaking = await Speech.isSpeakingAsync();
  if (speaking) {
    Speech.stop();
  }
}

/** Check if TTS is currently speaking. */
export async function isSpeaking(): Promise<boolean> {
  return Speech.isSpeakingAsync();
}

// ─── TTS Announcement Builders ───────────────────────────────────────────

/**
 * Build TTS string for a score confirmation.
 * Example: "Mike, bogey, 5 on hole 7"
 */
export function buildScoreConfirmation(
  playerDisplayName: string,
  grossScore: number,
  par: number,
  holeNumber: number,
): string {
  const label = getSpokenScoreLabel(grossScore, par);
  return `${playerDisplayName}, ${label}, ${grossScore} on hole ${holeNumber}`;
}

/**
 * Build TTS string for hole navigation.
 * Example: "Hole 4, par 3, stroke index 12"
 */
export function buildHoleAnnouncement(
  holeNumber: number,
  par: number,
  strokeIndex: number,
): string {
  return `Hole ${holeNumber}, par ${par}, stroke index ${strokeIndex}`;
}

/**
 * Build TTS string for round summary.
 * Example: "Round complete. Mike shot 78, 6 over par."
 */
export function buildRoundSummary(
  players: { name: string; gross: number; toPar: number }[],
): string {
  const parts = players.map((p) => {
    const toParStr =
      p.toPar === 0 ? 'even par'
        : p.toPar > 0 ? `${p.toPar} over par`
        : `${Math.abs(p.toPar)} under par`;
    return `${p.name} shot ${p.gross}, ${toParStr}`;
  });
  return `Round complete. ${parts.join('. ')}.`;
}

/**
 * Convert a numeric score + par into a spoken label.
 * Uses full words appropriate for TTS.
 */
export function getSpokenScoreLabel(grossScore: number, par: number): string {
  if (grossScore === 1) return 'hole in one';
  const diff = grossScore - par;
  switch (diff) {
    case -3: return 'albatross';
    case -2: return 'eagle';
    case -1: return 'birdie';
    case 0: return 'par';
    case 1: return 'bogey';
    case 2: return 'double bogey';
    case 3: return 'triple bogey';
    default:
      if (diff < -3) return `${Math.abs(diff)} under par`;
      return `${diff} over par`;
  }
}

// ─── NLP Parsing (Phase 3) ────────────────────────────────────────────────

/** Player info needed for NLP matching. */
export interface PlayerMatchInfo {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  nickname?: string;
}

/** All relative score terms recognised by the parser. */
const RELATIVE_SCORE_TERMS = [
  'hole in one', 'hole-in-one',
  'albatross', 'double eagle',
  'eagle',
  'birdie',
  'par',
  'bogey', 'bogie', 'bogy',
  'double bogey', 'double bogie', 'double bogy', 'double',
  'triple bogey', 'triple bogie', 'triple bogy', 'triple',
  'ace',
];

/** Word-form numbers the recogniser may produce ("one" → 1, etc.). */
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/**
 * Normalise a transcript: lowercase, collapse whitespace, strip punctuation.
 */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Convert a word-form number or digit string to a number.
 * Returns null if not a recognisable number.
 */
function toNumber(token: string): number | null {
  const n = Number(token);
  if (!isNaN(n) && Number.isInteger(n) && n >= 1 && n <= 20) return n;
  return WORD_NUMBERS[token.toLowerCase()] ?? null;
}

/**
 * Parse a transcribed speech string into a structured score intent.
 *
 * Supported patterns (case-insensitive, punctuation-stripped):
 *   "<number>"                         → score for current context
 *   "<relative>"                       → relative score (birdie, bogey, …)
 *   "<name> <number>"                  → score for named player
 *   "<name> got a <number>"            → score for named player
 *   "<name> <relative>"                → relative score for named player
 *   "<number> for <name>"              → score for named player
 *   "<relative> for <name>"            → relative score for named player
 *   "<name> got a <relative>"          → relative for named player
 *   "<name1> <n1> <name2> <n2> …"      → multiple scores (returns first only – caller should re-parse remainder)
 *
 * Returns null if the transcript cannot be parsed.
 */
export function parseSpokenInput(
  transcript: string,
  playerNames: string[],
  _currentHole: number,
): ParsedScoreIntent | null {
  const text = normalise(transcript);
  if (!text) return null;

  // ── 1. Try "<score> for <name>" / "<relative> for <name>" ──
  const forMatch = text.match(/^(.+?)\s+for\s+(.+)$/);
  if (forMatch) {
    const [, scorePart, namePart] = forMatch;
    const result = parseScorePart(scorePart.trim());
    if (result) {
      return {
        type: 'score',
        playerName: namePart.trim(),
        score: result.score,
        scoreRelative: result.scoreRelative,
        confidence: 0.9,
      };
    }
  }

  // ── 2. Try "<name> got a <score/relative>" ──
  const gotAMatch = text.match(/^(.+?)\s+got\s+(?:a|an)\s+(.+)$/);
  if (gotAMatch) {
    const [, namePart, scorePart] = gotAMatch;
    const result = parseScorePart(scorePart.trim());
    if (result) {
      return {
        type: 'score',
        playerName: namePart.trim(),
        score: result.score,
        scoreRelative: result.scoreRelative,
        confidence: 0.9,
      };
    }
  }

  // ── 3. Try "<name> made <relative>" ──
  const madeMatch = text.match(/^(.+?)\s+made\s+(?:a|an)?\s*(.+)$/);
  if (madeMatch) {
    const [, namePart, scorePart] = madeMatch;
    const result = parseScorePart(scorePart.trim());
    if (result) {
      return {
        type: 'score',
        playerName: namePart.trim(),
        score: result.score,
        scoreRelative: result.scoreRelative,
        confidence: 0.85,
      };
    }
  }

  // ── 4. Try "<name> shot <number>" ──
  const shotMatch = text.match(/^(.+?)\s+shot\s+(?:a|an)?\s*(.+)$/);
  if (shotMatch) {
    const [, namePart, scorePart] = shotMatch;
    const result = parseScorePart(scorePart.trim());
    if (result) {
      return {
        type: 'score',
        playerName: namePart.trim(),
        score: result.score,
        scoreRelative: result.scoreRelative,
        confidence: 0.85,
      };
    }
  }

  // ── 5. Try matching known player names at the start ──
  // Check each known player name (longest first to avoid partial match)
  const sortedNames = [...playerNames].sort((a, b) => b.length - a.length);
  for (const name of sortedNames) {
    const lowerName = name.toLowerCase();
    if (text.startsWith(lowerName + ' ')) {
      const remainder = text.slice(lowerName.length).trim();
      const result = parseScorePart(remainder);
      if (result) {
        return {
          type: 'score',
          playerName: name,
          score: result.score,
          scoreRelative: result.scoreRelative,
          confidence: 0.85,
        };
      }
    }
  }

  // ── 6. Try multi-word relative terms first, then single token at the end ──
  const tokens = text.split(' ');

  // Check for multi-word relative terms at the end (e.g., "double bogey", "triple bogey", "hole in one")
  if (tokens.length >= 2) {
    const lastTwo = tokens.slice(-2).join(' ');
    const multiResult = parseScorePart(lastTwo);
    if (multiResult) {
      const namePart = tokens.slice(0, -2).join(' ') || undefined;
      return {
        type: 'score',
        playerName: namePart,
        score: multiResult.score,
        scoreRelative: multiResult.scoreRelative,
        confidence: namePart ? 0.8 : 0.7,
      };
    }
  }
  if (tokens.length >= 3) {
    const lastThree = tokens.slice(-3).join(' ');
    const triResult = parseScorePart(lastThree);
    if (triResult) {
      const namePart = tokens.slice(0, -3).join(' ') || undefined;
      return {
        type: 'score',
        playerName: namePart,
        score: triResult.score,
        scoreRelative: triResult.scoreRelative,
        confidence: namePart ? 0.8 : 0.7,
      };
    }
  }

  // Single token at the end: "<name> <score>"
  if (tokens.length >= 2) {
    const lastToken = tokens[tokens.length - 1];
    const result = parseScorePart(lastToken);
    if (result) {
      const namePart = tokens.slice(0, -1).join(' ');
      return {
        type: 'score',
        playerName: namePart || undefined,
        score: result.score,
        scoreRelative: result.scoreRelative,
        confidence: namePart ? 0.8 : 0.7,
      };
    }
  }

  // ── 7. Bare score or relative term ──
  const bareResult = parseScorePart(text);
  if (bareResult) {
    return {
      type: 'score',
      score: bareResult.score,
      scoreRelative: bareResult.scoreRelative,
      confidence: 0.7,
    };
  }

  return null;
}

/**
 * Try to parse a string as a numeric score or relative score term.
 * Returns null if not recognisable.
 */
function parseScorePart(
  text: string,
): { score?: number; scoreRelative?: string } | null {
  const lower = text.toLowerCase().trim();

  // Try the whole string as a number first ("4", "six")
  const num = toNumber(lower);
  if (num !== null && num >= 1 && num <= 15) {
    return { score: num };
  }

  // Try relative terms (longest first to match "double bogey" before "double")
  const sorted = [...RELATIVE_SCORE_TERMS].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    if (lower === term) {
      return { scoreRelative: canonicalRelativeTerm(term) };
    }
  }

  // ── Fuzzy extraction: the text may contain filler words ──
  // e.g. "had a four and", "got a bogey", "made six"
  // Strip common filler then try each token / contiguous pair

  // Check for relative terms WITHIN the text (longest first)
  for (const term of sorted) {
    if (lower.includes(term)) {
      return { scoreRelative: canonicalRelativeTerm(term) };
    }
  }

  // Tokenise and look for a number or word-number
  const tokens = lower.split(/\s+/);
  for (const token of tokens) {
    const n = toNumber(token);
    if (n !== null && n >= 1 && n <= 15) {
      return { score: n };
    }
  }

  return null;
}

/**
 * Normalise relative-score spelling variants to a canonical form.
 * "bogie" → "bogey", "bogy" → "bogey", "hole-in-one" → "hole in one", etc.
 */
function canonicalRelativeTerm(term: string): string {
  const map: Record<string, string> = {
    'bogie': 'bogey',
    'bogy': 'bogey',
    'double bogie': 'double bogey',
    'double bogy': 'double bogey',
    'triple bogie': 'triple bogey',
    'triple bogy': 'triple bogey',
    'hole-in-one': 'hole in one',
    'double eagle': 'albatross',
  };
  return map[term] ?? term;
}

/**
 * Compute a simple Levenshtein edit distance between two strings.
 * Used for fuzzy matching spoken names.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Fuzzy-match a spoken name against known player names.
 * Returns the best-match playerId, or null if no good match.
 *
 * Matching priority:
 * 1. Exact match on nickname, firstName, lastName, or displayName (case-insensitive)
 * 2. Starts-with / contains match
 * 3. Levenshtein distance ≤ 2 (handles speech-recognition mishearings)
 */
export function matchPlayerName(
  spokenName: string,
  players: PlayerMatchInfo[],
): string | null {
  if (!spokenName || players.length === 0) return null;

  const spoken = spokenName.toLowerCase().trim();
  if (!spoken) return null;

  type Candidate = { id: string; score: number };
  const candidates: Candidate[] = [];

  for (const p of players) {
    const names = [
      p.nickname?.toLowerCase(),
      p.firstName.toLowerCase(),
      p.lastName.toLowerCase(),
      p.displayName.toLowerCase(),
    ].filter(Boolean) as string[];

    // Priority 1: Exact match
    if (names.some((n) => n === spoken)) {
      candidates.push({ id: p.id, score: 100 });
      continue;
    }

    // Priority 2: Starts-with or contains
    if (names.some((n) => n.startsWith(spoken) || spoken.startsWith(n))) {
      candidates.push({ id: p.id, score: 80 });
      continue;
    }
    if (names.some((n) => n.includes(spoken) || spoken.includes(n))) {
      candidates.push({ id: p.id, score: 60 });
      continue;
    }

    // Priority 3: Levenshtein distance on each name variant
    let bestDist = Infinity;
    for (const n of names) {
      const dist = levenshtein(spoken, n);
      if (dist < bestDist) bestDist = dist;
    }
    // Accept if distance ≤ 2, scoring inversely by distance
    if (bestDist <= 2) {
      candidates.push({ id: p.id, score: 40 - bestDist * 10 });
    }
  }

  if (candidates.length === 0) return null;

  // Return the best-scoring match
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].id;
}

/**
 * Parse a transcript that may contain multiple scores.
 * e.g. "Mike 5 John 4 Sarah bogey"
 * Returns an array of ParsedScoreIntents.
 */
export function parseMultipleScores(
  transcript: string,
  playerNames: string[],
  currentHole: number,
): ParsedScoreIntent[] {
  const results: ParsedScoreIntent[] = [];
  let text = normalise(transcript);
  if (!text) return results;

  // Strip leading "on hole X" / "hole X" preamble — the hole number is
  // already known from round state and would confuse the score parser.
  text = text.replace(/^(?:on\s+)?hole\s+\d+\s*/i, '').trim();
  if (!text) return results;

  // Sort player names longest first for greedy matching
  const sortedNames = [...playerNames].sort((a, b) => b.length - a.length);

  // Build a regex that matches any known player name
  const escapedNames = sortedNames.map((n) => n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escapedNames.length === 0) {
    // No players — try to parse as a single bare score
    const single = parseSpokenInput(transcript, playerNames, currentHole);
    if (single && single.type === 'score') results.push(single);
    return results;
  }

  const namePattern = new RegExp(`(${escapedNames.join('|')})`, 'gi');

  // Split transcript around player names
  const segments = text.split(namePattern);

  let currentName: string | undefined;
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    // Check if this segment is a player name
    const isName = sortedNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());
    if (isName) {
      currentName = trimmed;
      continue;
    }

    // This segment should be a score/relative term
    const scorePart = parseScorePart(trimmed);
    if (scorePart && currentName) {
      results.push({
        type: 'score',
        playerName: currentName,
        score: scorePart.score,
        scoreRelative: scorePart.scoreRelative,
        confidence: 0.85,
      });
      currentName = undefined;
    } else if (scorePart) {
      // Score without a preceding name
      results.push({
        type: 'score',
        score: scorePart.score,
        scoreRelative: scorePart.scoreRelative,
        confidence: 0.6,
      });
    }
  }

  // If no multi-parse results, fall back to single parse
  if (results.length === 0) {
    const single = parseSpokenInput(transcript, playerNames, currentHole);
    if (single && single.type === 'score') results.push(single);
  }

  return results;
}

/**
 * Convert a relative score term ("birdie", "bogey") to an absolute score
 * given the hole par.
 */
export function relativeScoreToAbsolute(
  relativeLabel: string,
  par: number,
): number | null {
  const map: Record<string, number> = {
    'ace': 1,
    'hole in one': 1,
    'albatross': par - 3,
    'double eagle': par - 3,
    'eagle': par - 2,
    'birdie': par - 1,
    'par': par,
    'bogey': par + 1,
    'double bogey': par + 2,
    'double': par + 2,
    'triple bogey': par + 3,
    'triple': par + 3,
  };
  return map[relativeLabel.toLowerCase()] ?? null;
}

// ─── STT Lifecycle (framework-agnostic) ──────────────────────────────────

/** Result of requesting STT permissions. */
export interface SttPermissionResult {
  granted: boolean;
  canAskAgain: boolean;
}

/**
 * Whether the native STT module is available (dev build only).
 */
export function isSttAvailable(): boolean {
  return ExpoSpeechRecognitionModule != null;
}

/**
 * Request microphone + speech recognition permissions from the OS.
 */
export async function requestSttPermissions(): Promise<SttPermissionResult> {
  if (!ExpoSpeechRecognitionModule) return { granted: false, canAskAgain: false };
  const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  return { granted: result.granted, canAskAgain: result.canAskAgain };
}

/**
 * Check current STT permission status without prompting.
 */
export async function getSttPermissionStatus(): Promise<SttPermissionResult> {
  if (!ExpoSpeechRecognitionModule) return { granted: false, canAskAgain: false };
  const result = await ExpoSpeechRecognitionModule.getPermissionsAsync();
  return { granted: result.granted, canAskAgain: result.canAskAgain };
}

/**
 * Start the speech recognition engine.
 * Callers must subscribe to events via React hooks in the context layer.
 */
export function startSttEngine(): void {
  if (!ExpoSpeechRecognitionModule) throw new Error('Speech recognition requires a development build');
  ExpoSpeechRecognitionModule.start({
    lang: 'en-US',
    interimResults: true,
    continuous: false,
  });
}

/**
 * Stop the speech recognition engine.
 */
export function stopSttEngine(): void {
  if (!ExpoSpeechRecognitionModule) return;
  ExpoSpeechRecognitionModule.stop();
}

// ─── Continuous / Hands-Free Listening ──────────────────────────────────

/**
 * Start the speech recognition engine in continuous mode for always-on
 * wake-word detection. The engine runs indefinitely until explicitly stopped.
 *
 * `contextualStrings` biases recognition toward the wake word, player names,
 * golf score terms, and junk dot names for improved accuracy.
 *
 * Requires iOS 18+ or Android 13+ for true continuous behaviour.
 * On older iOS (17-) the engine will stop after ~3s silence; the context
 * layer handles auto-restart via the 'end' event.
 */
export function startContinuousSttEngine(playerNames: string[]): void {
  if (!ExpoSpeechRecognitionModule) throw new Error('Speech recognition requires a development build');
  ExpoSpeechRecognitionModule.start({
    lang: 'en-US',
    interimResults: true,
    continuous: true,
    contextualStrings: [
      // Wake word
      'scorecard', 'hey scorecard',
      // Player names (from round)
      ...playerNames,
      // Golf score terms
      'birdie', 'bogey', 'par', 'eagle', 'double bogey', 'triple bogey',
      'albatross', 'snowman', 'ace', 'hole in one', 'double eagle',
      // Junk dot names
      'sandy', 'greenie', 'poley', 'dingie', 'stinky', 'code red',
      'sneak', 'super sneak', 'flaggy', 'sweepie', 'four putt', 'ouzel',
    ],
    iosTaskHint: 'dictation',
  });
}

/** Wake phrase variants, longest first for correct extraction. */
const WAKE_PHRASES = ['hey scorecard', 'scorecard'];

/**
 * Extract the command portion from a transcript containing the wake word.
 *
 * Returns the text after the wake phrase (trimmed), or `null` if no wake
 * word is present. Returns `""` if only the wake word was spoken with
 * no following command.
 *
 * Examples:
 *   "Scorecard Mike bogey"  → "Mike bogey"
 *   "Hey scorecard 5"       → "5"
 *   "nice weather"          → null
 *   "Scorecard"             → ""
 */
export function extractWakeWordCommand(transcript: string): string | null {
  const lower = transcript.toLowerCase();
  // Use lastIndexOf so that if iOS accumulates transcripts across a session
  // we always match the MOST RECENT wake phrase, not an old one.
  for (const phrase of WAKE_PHRASES) {
    const idx = lower.lastIndexOf(phrase);
    if (idx !== -1) {
      return transcript.slice(idx + phrase.length).trim();
    }
  }
  return null;
}

// ─── Claude API Interpretation (Phase 5) ────────────────────────────────

import { claudeService, type RoundVoiceContext } from './claudeService';

/**
 * Interpret a transcript using Claude API, returning ParsedScoreIntents
 * compatible with the existing regex parser output.
 *
 * Falls back to regex parsing silently on any Claude error (network, auth,
 * parse, rate limit, or API key not configured).
 *
 * Never throws — always returns a result.
 */
export async function interpretWithClaude(
  transcript: string,
  roundContext: RoundVoiceContext,
  playerMatchInfos: PlayerMatchInfo[],
  currentHole: number,
): Promise<{ intents: ParsedScoreIntent[]; usedClaude: boolean }> {
  // Fall back to regex if Claude isn't configured
  if (!claudeService.isConfigured()) {
    return {
      intents: regexFallback(transcript, playerMatchInfos, currentHole),
      usedClaude: false,
    };
  }

  try {
    const result = await claudeService.interpretGolfTranscript(
      transcript,
      roundContext,
    );

    // Map ClaudeScoreIntents → ParsedScoreIntents for compatibility
    const intents: ParsedScoreIntent[] = result.intents.map((ci) => ({
      type: 'score' as const,
      playerName: ci.resolvedPlayerId, // Already resolved to player ID by Claude
      holeNumber: ci.holeNumber,
      score: ci.grossScore,
      scoreRelative: ci.spokenTerm,
      confidence: ci.confidence,
    }));

    return { intents, usedClaude: true };
  } catch (err) {
    // On any Claude error, silently fall back to regex parser
    console.warn('[VOICE] Claude interpretation failed, using regex fallback:', err);
    return {
      intents: regexFallback(transcript, playerMatchInfos, currentHole),
      usedClaude: false,
    };
  }
}

/** Internal helper: run the regex parser as a fallback. */
function regexFallback(
  transcript: string,
  playerMatchInfos: PlayerMatchInfo[],
  currentHole: number,
): ParsedScoreIntent[] {
  const playerNames = playerMatchInfos.flatMap((p) =>
    [p.nickname, p.firstName, p.lastName, p.displayName].filter(Boolean) as string[],
  );
  const unique = [...new Set(playerNames)];
  return parseMultipleScores(transcript, unique, currentHole);
}

// ─── Junk Dot Parsing ────────────────────────────────────────────────────

/**
 * Map of spoken dot names → dot IDs.
 * Includes common voice recognition variants and abbreviations.
 */
const DOT_VOICE_MAP: Record<string, { id: string; name: string }> = {
  'sandy': { id: 'sandy', name: 'Sandy' },
  'sandie': { id: 'sandy', name: 'Sandy' },
  'greenie': { id: 'greenie', name: 'Greenie' },
  'greeny': { id: 'greenie', name: 'Greenie' },
  'green e': { id: 'greenie', name: 'Greenie' },
  'poley': { id: 'poleys', name: 'Poley' },
  'poly': { id: 'poleys', name: 'Poley' },
  'polie': { id: 'poleys', name: 'Poley' },
  'pole e': { id: 'poleys', name: 'Poley' },
  'dingie': { id: 'dingie', name: 'Dingie' },
  'dingy': { id: 'dingie', name: 'Dingie' },
  'dinghy': { id: 'dingie', name: 'Dingie' },
  'stinky': { id: 'stinky', name: 'Stinky' },
  'stinkey': { id: 'stinky', name: 'Stinky' },
  'code red': { id: 'code_red', name: 'Code Red' },
  'sneak': { id: 'sneak', name: 'Sneak' },
  'super sneak': { id: 'super_sneak', name: 'Super Sneak' },
  'flaggy': { id: 'flaggy', name: 'Flaggy' },
  'flaggie': { id: 'flaggy', name: 'Flaggy' },
  'four putt': { id: 'four_putt', name: '4-Putt' },
  '4 putt': { id: 'four_putt', name: '4-Putt' },
  'ouzel': { id: 'ouzel', name: 'Ouzel' },
  'ousel': { id: 'ouzel', name: 'Ouzel' },
};

// Sort longest-first so "super sneak" matches before "sneak"
const DOT_VOICE_KEYS = Object.keys(DOT_VOICE_MAP).sort((a, b) => b.length - a.length);

// ─── Navigation command parser ────────────────────────────────────────────

/**
 * Parse a wake-word command for navigation intents.
 * e.g. "show hole 8"         → { action: 'go_to_hole', holeNumber: 8 }
 *      "show hole 8 detail"  → { action: 'go_to_hole', holeNumber: 8 }
 *      "go to hole 5"        → { action: 'go_to_hole', holeNumber: 5 }
 *      "view hole 12"        → { action: 'go_to_hole', holeNumber: 12 }
 *      "hole 3 detail"       → { action: 'go_to_hole', holeNumber: 3 }
 *      "show scorecard"      → { action: 'show_scorecard' }
 *      "Mike bogey"          → null (no navigation intent)
 *
 * Bare "hole 3" without a verb is NOT matched to avoid conflicts with score commands.
 */
export function parseNavigationCommand(command: string): ParsedNavigationIntent | null {
  const text = command.toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  // ── Go to specific hole ────────────────────────────────────────────────
  // Verb-first: "show hole 8", "go to hole 5", "view hole 12", "open hole 3",
  //             "switch to hole 9", "jump to hole 14", "navigate to hole 1"
  const verbHoleMatch = text.match(
    /(?:show|go\s*to|view|open|switch\s*to|jump\s*to|navigate\s*to)\s+hole\s+(\d+)/,
  );
  if (verbHoleMatch) {
    return { type: 'navigation', action: 'go_to_hole', holeNumber: parseInt(verbHoleMatch[1], 10) };
  }

  // "hole 3 detail", "hole 8 details", "hole 12 view"
  const holeDetailMatch = text.match(/hole\s+(\d+)\s+(?:detail|details|view)/);
  if (holeDetailMatch) {
    return { type: 'navigation', action: 'go_to_hole', holeNumber: parseInt(holeDetailMatch[1], 10) };
  }

  // ── Scorecard / grid view ──────────────────────────────────────────────
  // "show scorecard", "go to scorecard", "go to scorecard view",
  // "switch to scorecard", "view the scorecard", "open scorecard view",
  // "scorecard view", "show the scorecard"
  const scorecardMatch = text.match(
    /(?:show|view|open|go\s*to|switch\s*to|navigate\s*to)\s+(?:the\s+)?scorecard(?:\s+view)?/,
  );
  if (scorecardMatch) {
    return { type: 'navigation', action: 'show_scorecard' };
  }

  // Standalone "scorecard view" (no verb — the verb IS the wake word "Scorecard")
  if (/^scorecard\s+view$/.test(text)) {
    return { type: 'navigation', action: 'show_scorecard' };
  }

  // ── Hole view (switch from scorecard grid to hole detail) ──────────────
  // "show hole view", "go to hole view", "switch to hole view", "hole detail view"
  const holeViewMatch = text.match(
    /(?:show|view|open|go\s*to|switch\s*to|navigate\s*to)\s+(?:the\s+)?hole\s+(?:view|detail|details)/,
  );
  if (holeViewMatch) {
    return { type: 'navigation', action: 'show_hole_view' };
  }

  // "hole detail view", "hole view"
  if (/^hole\s+(?:detail\s+)?view$/.test(text)) {
    return { type: 'navigation', action: 'show_hole_view' };
  }

  return null;
}

/**
 * Parse a wake-word command for junk dot intents.
 * e.g. "Rage sandy" → [{ type: 'dot', playerName: 'rage', dotId: 'sandy' }]
 *      "Buzz code red" → [{ type: 'dot', playerName: 'buzz', dotId: 'code_red' }]
 *
 * Returns an empty array if no dot terms are found (the command may be a score).
 */
export function parseDotCommand(
  command: string,
  playerNames: string[],
): ParsedDotIntent[] {
  const text = command.toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return [];

  // Strip leading "on hole X" preamble
  const cleaned = text.replace(/^(?:on\s+)?hole\s+\d+\s*/i, '').trim();
  if (!cleaned) return [];

  const results: ParsedDotIntent[] = [];

  // Check if any dot term exists in the command
  const foundDots: { dotKey: string; idx: number }[] = [];
  for (const key of DOT_VOICE_KEYS) {
    const idx = cleaned.indexOf(key);
    if (idx !== -1) {
      // Make sure we don't double-match (e.g. "super sneak" and "sneak")
      const alreadyCovered = foundDots.some(
        (fd) => idx >= fd.idx && idx < fd.idx + fd.dotKey.length,
      );
      if (!alreadyCovered) {
        foundDots.push({ dotKey: key, idx });
      }
    }
  }

  if (foundDots.length === 0) return [];

  // Sort found dots by position in the command
  foundDots.sort((a, b) => a.idx - b.idx);

  // Build name regex for splitting
  const sortedNames = [...playerNames].sort((a, b) => b.length - a.length);
  const escapedNames = sortedNames.map((n) => n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  // For each found dot, try to find the nearest player name before it
  for (const fd of foundDots) {
    const dot = DOT_VOICE_MAP[fd.dotKey];
    let playerName: string | undefined;

    // Look for a player name in the text before this dot
    const textBefore = cleaned.slice(0, fd.idx).trim();
    if (textBefore && escapedNames.length > 0) {
      // Find the last player name in the preceding text
      for (const name of sortedNames) {
        const nameIdx = textBefore.toLowerCase().lastIndexOf(name.toLowerCase());
        if (nameIdx !== -1) {
          playerName = name.toLowerCase();
          break;
        }
      }
    }

    results.push({
      type: 'dot',
      playerName,
      dotId: dot.id,
      dotDisplayName: dot.name,
      confidence: playerName ? 0.9 : 0.7,
    });
  }

  return results;
}

// ─── Settings Persistence Helpers ────────────────────────────────────────

const SETTINGS_STORAGE_KEY = 'voice_settings';

/**
 * Merge stored partial settings with defaults.
 * Returns defaults if nothing is stored.
 */
export function mergeWithDefaults(
  stored: Partial<VoiceSettings> | null,
): VoiceSettings {
  if (!stored) return { ...DEFAULT_VOICE_SETTINGS };
  return { ...DEFAULT_VOICE_SETTINGS, ...stored };
}

export function getSettingsStorageKey(): string {
  return SETTINGS_STORAGE_KEY;
}
