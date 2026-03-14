/**
 * Claude API Service — Golf transcript interpretation via Anthropic API.
 *
 * Framework-agnostic (no React). Follows the ghinService.ts singleton pattern.
 * Uses native fetch(), typed error classes, setApiKey() for configuration.
 *
 * The system prompt serializes full round state so Claude can resolve
 * relative scores ("bogey" → par+1), fuzzy player names, and multi-player
 * bulk entry from natural spoken language.
 */

// ─── Types ──────────────────────────────────────────────────────────────

export interface ClaudeScoreIntent {
  /** The spoken name Claude matched */
  playerName: string;
  /** The player ID from the round context */
  resolvedPlayerId: string;
  /** Hole the score applies to */
  holeNumber: number;
  /** Absolute gross score (Claude resolves relative terms) */
  grossScore: number;
  /** Original spoken term, e.g. "bogey", "5", "double" */
  spokenTerm?: string;
  /** 0.0–1.0 confidence */
  confidence: number;
}

export interface ClaudeInterpretationResult {
  intents: ClaudeScoreIntent[];
  /** Raw Claude response text for debugging */
  rawResponse?: string;
}

export interface RoundVoiceContext {
  currentHole: number;
  holePar: number;
  holeStrokeIndex: number;
  players: {
    id: string;
    displayName: string;
    firstName: string;
    lastName: string;
    nickname?: string;
    courseHandicap: number;
    playingHandicap: number;
    hasScoreOnCurrentHole: boolean;
  }[];
  activeBettingGames: {
    type: string;
    name: string;
  }[];
  courseName: string;
  roundType: string;
}

// ─── Constants ──────────────────────────────────────────────────────────

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-3-20250414';
const ANTHROPIC_VERSION = '2023-06-01';

// ─── Service ────────────────────────────────────────────────────────────

class ClaudeService {
  private apiKey: string | null = null;

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  isConfigured(): boolean {
    return this.apiKey !== null && this.apiKey.length > 0;
  }

  clearApiKey(): void {
    this.apiKey = null;
  }

  /**
   * Send a golf transcript to Claude for interpretation.
   * Returns structured score intents with player IDs resolved.
   */
  async interpretGolfTranscript(
    transcript: string,
    roundContext: RoundVoiceContext,
  ): Promise<ClaudeInterpretationResult> {
    if (!this.apiKey) {
      throw new ClaudeConfigError('Claude API key not configured');
    }

    const systemPrompt = buildGolfSystemPrompt(roundContext);

    let response: Response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      response = await fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 256,
          system: systemPrompt,
          messages: [{ role: 'user', content: transcript }],
        }),
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new ClaudeNetworkError('Claude API timed out (3s)');
      }
      throw new ClaudeNetworkError(
        err?.message ?? 'Network error calling Claude API',
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new ClaudeAuthError('Invalid Claude API key');
      }
      if (response.status === 429) {
        throw new ClaudeRateLimitError('Claude API rate limit exceeded');
      }
      throw new ClaudeNetworkError(
        `Claude API error (HTTP ${response.status})`,
      );
    }

    const data = await response.json();
    const textContent = data.content?.[0]?.text;

    if (!textContent) {
      throw new ClaudeParseError('No text content in Claude response');
    }

    return parseClaudeResponse(textContent, roundContext);
  }
}

// ─── System Prompt Builder ──────────────────────────────────────────────

function buildGolfSystemPrompt(ctx: RoundVoiceContext): string {
  const playerList = ctx.players
    .map((p) => {
      const names = [p.firstName, p.lastName, p.nickname, p.displayName]
        .filter(Boolean)
        .join(', ');
      const scored = p.hasScoreOnCurrentHole
        ? ' (already scored)'
        : ' (needs score)';
      return `  - ID: "${p.id}" | Names: ${names} | Handicap: ${p.courseHandicap}${scored}`;
    })
    .join('\n');

  const games =
    ctx.activeBettingGames.length > 0
      ? ctx.activeBettingGames.map((g) => `  - ${g.name} (${g.type})`).join('\n')
      : '  None';

  return `You are a golf score interpreter for a mobile scorecard app. Your job is to parse spoken score transcripts into structured JSON.

CURRENT ROUND STATE:
- Course: ${ctx.courseName}
- Hole ${ctx.currentHole}, Par ${ctx.holePar}, Stroke Index ${ctx.holeStrokeIndex}
- Round type: ${ctx.roundType}

PLAYERS IN THIS ROUND:
${playerList}

ACTIVE BETTING GAMES:
${games}

RULES FOR INTERPRETATION:
1. Match spoken names to player IDs using fuzzy matching (first name, last name, nickname). Speech recognition may mishear names slightly.
2. Convert relative score terms to absolute scores using the current hole par (${ctx.holePar}):
   - "ace" or "hole in one" = 1
   - "albatross" or "double eagle" = par - 3 = ${ctx.holePar - 3}
   - "eagle" = par - 2 = ${ctx.holePar - 2}
   - "birdie" = par - 1 = ${ctx.holePar - 1}
   - "par" = ${ctx.holePar}
   - "bogey" = par + 1 = ${ctx.holePar + 1}
   - "double bogey" or "double" = par + 2 = ${ctx.holePar + 2}
   - "triple bogey" or "triple" = par + 3 = ${ctx.holePar + 3}
   - "snowman" = 8
3. If no player name is mentioned and only one player needs a score, assign it to that player.
4. If no hole number is mentioned, assume hole ${ctx.currentHole}.
5. Handle corrections: "actually", "change to", "make that", "not a" indicate a correction to a previously stated score — use the corrected value.
6. Handle multi-player bulk: "Mike 5 John 4 Sarah bogey" means three separate scores.
7. Handle sloppy/natural speech: "uh I think I had like a 5" means score of 5. Ignore filler words.
8. Scores must be between 1 and 15 inclusive.
9. Confidence should be 0.9+ for clear matches, 0.7-0.9 for fuzzy matches, below 0.7 for guesses.

RESPOND WITH ONLY a JSON array. No prose, no markdown fences, no explanation. Example:
[{"playerName":"Mike","resolvedPlayerId":"abc-123","holeNumber":7,"grossScore":5,"spokenTerm":"5","confidence":0.95}]

If you cannot parse any scores from the transcript, return an empty array: []`;
}

// ─── Response Parser ────────────────────────────────────────────────────

function parseClaudeResponse(
  text: string,
  ctx: RoundVoiceContext,
): ClaudeInterpretationResult {
  // Strip markdown code fences if Claude adds them despite instructions
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '');
  }

  let parsed: any[];
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new ClaudeParseError(
      `Failed to parse Claude JSON: ${cleaned.slice(0, 200)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new ClaudeParseError('Claude response is not an array');
  }

  const validPlayerIds = new Set(ctx.players.map((p) => p.id));

  const intents: ClaudeScoreIntent[] = parsed
    .filter((item: any) => {
      return (
        typeof item.grossScore === 'number' &&
        item.grossScore >= 1 &&
        item.grossScore <= 15 &&
        typeof item.resolvedPlayerId === 'string' &&
        validPlayerIds.has(item.resolvedPlayerId)
      );
    })
    .map((item: any) => ({
      playerName: String(item.playerName || ''),
      resolvedPlayerId: String(item.resolvedPlayerId),
      holeNumber:
        typeof item.holeNumber === 'number'
          ? item.holeNumber
          : ctx.currentHole,
      grossScore: Math.max(1, Math.min(15, Math.round(item.grossScore))),
      spokenTerm: item.spokenTerm ? String(item.spokenTerm) : undefined,
      confidence:
        typeof item.confidence === 'number'
          ? Math.max(0, Math.min(1, item.confidence))
          : 0.8,
    }));

  return { intents, rawResponse: text };
}

// ─── Error Classes ──────────────────────────────────────────────────────

export class ClaudeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeConfigError';
  }
}

export class ClaudeAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeAuthError';
  }
}

export class ClaudeNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeNetworkError';
  }
}

export class ClaudeRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeRateLimitError';
  }
}

export class ClaudeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeParseError';
  }
}

// ─── Singleton Export ───────────────────────────────────────────────────

export const claudeService = new ClaudeService();
