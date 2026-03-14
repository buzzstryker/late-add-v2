/**
 * Betting Service — game type metadata, default configs, and orchestration.
 *
 * Framework-agnostic (no React imports) so it can be reused by a future
 * REST API layer without modification.
 */

import { BettingGame, BettingGameType, NassauConfig, SkinsConfig, WolfConfig, StablefordConfig, DotsConfig, BaseballConfig, TeamMatchConfig } from '../../models/BettingGame';
import { Score } from '../../models/Score';
import { GamePointInput } from '../../models/GamePoint';
import { TeamConfig } from '../../models/Team';
import { calculateNassauHolePoints } from './nassauCalculator';
import { calculateSkinsPoints } from './skinsCalculator';
import { calculateBaseballPoints, isBaseballCarryHole, hasBaseballCarryInto } from './baseballCalculator';
import { calculateTeamMatchHolePoints } from './teamMatchCalculator';
import { getTeamPairingForHole } from '../teamService';

// Re-export for use by screens via context layer
export { isBaseballCarryHole, hasBaseballCarryInto };

// ── Game type metadata ──

export function getGameTypeDisplayName(type: BettingGameType): string {
  switch (type) {
    case 'nassau': return 'Nassau';
    case 'skins': return 'Skins';
    case 'baseball_3man': return '3-Man Baseball';
    case 'baseball_4man': return '4-Man Baseball';
    case 'wolf': return 'Wolf';
    case 'stableford': return 'Stableford';
    case 'bingo_bango_bongo': return 'Bingo Bango Bongo';
    case 'dots': return 'Junk / Dots';
    case 'team_match': return 'Team Match';
    case 'custom': return 'Custom';
    default: return type;
  }
}

export function getGameTypeDescription(type: BettingGameType): string {
  switch (type) {
    case 'nassau':
      return 'Three bets: front 9, back 9, and overall 18. Low net wins 1 point per hole.';
    case 'skins':
      return 'Each hole is a skin. Lowest net wins outright; ties carry over.';
    case 'baseball_3man':
      return '9 points per hole distributed by net score ranking among 3 players. Ties carry over.';
    case 'baseball_4man':
      return '12 points per hole distributed by net score ranking among 4 players. Ties carry over.';
    case 'wolf':
      return 'Rotating wolf picks a partner or goes lone. Team or solo points per hole.';
    case 'stableford':
      return 'Points based on net score vs par. Higher is better.';
    case 'bingo_bango_bongo':
      return 'Three points per hole: first on green, closest to pin, first in hole.';
    case 'dots':
      return 'Earn bonus points for achievements: sandies, barkies, greenies, etc.';
    case 'team_match':
      return '2v2 team competition. Winning team earns points each hole.';
    case 'custom':
      return 'Manually track points per hole for any game.';
    default:
      return '';
  }
}

export function getGameTypeIcon(type: BettingGameType): string {
  switch (type) {
    case 'nassau': return 'trophy';
    case 'skins': return 'diamond';
    case 'baseball_3man': return 'users';
    case 'baseball_4man': return 'users';
    case 'wolf': return 'paw';         // wolf paw
    case 'stableford': return 'star';
    case 'bingo_bango_bongo': return 'bolt';
    case 'dots': return 'dot-circle-o';
    case 'team_match': return 'users';
    case 'custom': return 'pencil';
    default: return 'question';
  }
}

/** Whether a game type auto-calculates points from scores. */
export function isAutoCalculated(type: BettingGameType): boolean {
  return type === 'nassau' || type === 'skins' || type === 'baseball_3man' || type === 'baseball_4man' || type === 'team_match';
}

/** Whether a game type is a "main" game (Nassau, Skins, Stableford, Baseball). */
export function isMainGame(type: BettingGameType): boolean {
  return type === 'nassau' || type === 'skins' || type === 'stableford'
    || type === 'baseball_3man' || type === 'baseball_4man' || type === 'team_match';
}

/** Whether a game type is a "junk" game (Dots). */
export function isJunkGame(type: BettingGameType): boolean {
  return type === 'dots';
}

/** Whether a game type uses manual callout-based points. */
export function isManualCallout(type: BettingGameType): boolean {
  return type === 'dots' || type === 'custom' || type === 'wolf'
    || type === 'stableford' || type === 'bingo_bango_bongo';
}

// ── Wolf rotation helpers ──

/**
 * Get the player ID who is the wolf on a given hole.
 * Wolf rotates through the playerOrder array: hole 1 = player[0], hole 2 = player[1], etc.
 * Wraps around if there are more holes than players.
 *
 * @param playerOrder Array of player IDs in wolf rotation order
 * @param holeNumber The current hole number (1-indexed)
 * @returns The player ID of the wolf, or null if playerOrder is empty
 */
export function getWolfForHole(playerOrder: string[], holeNumber: number): string | null {
  if (playerOrder.length === 0) return null;
  const index = (holeNumber - 1) % playerOrder.length;
  return playerOrder[index];
}

/**
 * Get the hitting (tee) order for a given hole based on the wolf setting.
 * Non-wolf players maintain their relative order from playerOrder.
 * Wolf is placed first or last depending on wolfHitsFirst.
 */
export function getWolfHittingOrder(
  playerOrder: string[],
  holeNumber: number,
  wolfHitsFirst: boolean,
): string[] {
  if (playerOrder.length === 0) return [];
  const wolfIndex = (holeNumber - 1) % playerOrder.length;
  const wolfId = playerOrder[wolfIndex];
  const others = playerOrder.filter((_, i) => i !== wolfIndex);
  return wolfHitsFirst ? [wolfId, ...others] : [...others, wolfId];
}

// ── Default configs ──

export function getDefaultConfig(type: BettingGameType): Record<string, unknown> {
  switch (type) {
    case 'nassau':
      return {
        frontNineStake: 1,
        backNineStake: 1,
        overallStake: 1,
        autoPresses: false,
        pressAfterDown: 2,
      } satisfies NassauConfig as unknown as Record<string, unknown>;
    case 'skins':
      return {
        carryOver: true,
        perSkinValue: 1,
      } satisfies SkinsConfig as unknown as Record<string, unknown>;
    case 'baseball_3man':
      return {} satisfies BaseballConfig as unknown as Record<string, unknown>;
    case 'baseball_4man':
      return {} satisfies BaseballConfig as unknown as Record<string, unknown>;
    case 'wolf':
      return {
        playerOrder: [],
        teamPoints: 2,
        loneWolfPoints: 4,
        wolfHitsFirst: false,
        loneWolfJunk3x: false,
        sharedJunk: false,
      } satisfies WolfConfig as unknown as Record<string, unknown>;
    case 'stableford':
      return {
        useModifiedStableford: false,
      } satisfies StablefordConfig as unknown as Record<string, unknown>;
    case 'dots':
      return {
        activeDots: ['sandy', 'greenie', 'poleys', 'dingie', 'stinky', 'code_red', 'sneak', 'super_sneak', 'flaggy', 'birdie', 'eagle', 'albatross', 'hole_in_one', 'four_putt', 'ouzel', 'par3_sweepie', 'par4_sweepie', 'par5_sweepie'],
        pointsPerDot: 1,
        junkMultiplier: 1,
      } satisfies DotsConfig as unknown as Record<string, unknown>;
    case 'team_match':
      return {
        pointsPerHoleWon: 1,
      } satisfies TeamMatchConfig as unknown as Record<string, unknown>;
    case 'bingo_bango_bongo':
      return {};
    case 'custom':
      return {};
    default:
      return {};
  }
}

// ── Available dot types ──

export interface DotType {
  id: string;
  name: string;
  description: string;
  points: number;                // Base point value (before multipliers)
  autoAward?: 'birdie' | 'eagle' | 'albatross' | 'hole_in_one'; // Auto-award from score
  requiresParOrBetter: boolean;  // Gated by net par qualification
  autoCalculated?: boolean;      // true = auto-awarded by app logic, not manually toggled
}

export const AVAILABLE_DOTS: DotType[] = [
  // ── Situational (par-gated) ──
  { id: 'sandy', name: 'Sandy', description: 'Par or better after being in a bunker', points: 2, requiresParOrBetter: true },
{ id: 'greenie', name: 'Greenie', description: 'Closest to pin in regulation, must make gross par (carries over by par type)', points: 1, requiresParOrBetter: true },
  { id: 'poleys', name: 'Poley', description: 'Putt longer than the flagstick', points: 1, requiresParOrBetter: true },
  { id: 'dingie', name: 'Dingie', description: 'Chip-in from off the green', points: 1, requiresParOrBetter: true },
  { id: 'stinky', name: 'Stinky', description: 'Par or better from another fairway', points: 1, requiresParOrBetter: true },
  { id: 'code_red', name: 'Code Red', description: 'Par or better after playing out of a hazard', points: 1, requiresParOrBetter: true },
  { id: 'sneak', name: 'Sneak', description: 'Up and down from less than 100 yards for net par', points: 1, requiresParOrBetter: true },
  { id: 'super_sneak', name: 'Super Sneak', description: 'Up and down from more than 100 yards for net par', points: 2, requiresParOrBetter: true },
  { id: 'flaggy', name: 'Flaggy', description: 'Net par or better, up and down within flagstick', points: 1, requiresParOrBetter: true },
  // ── Score-based (auto-awarded, par-gated) ──
  { id: 'birdie', name: 'Birdie', description: 'Net birdie', points: 3, autoAward: 'birdie', requiresParOrBetter: true },
  { id: 'eagle', name: 'Eagle', description: 'Net eagle', points: 10, autoAward: 'eagle', requiresParOrBetter: true },
  { id: 'albatross', name: 'Albatross', description: 'Net three under par', points: 50, autoAward: 'albatross', requiresParOrBetter: true },
  { id: 'hole_in_one', name: 'Hole in One', description: 'Gross score of 1', points: 100, autoAward: 'hole_in_one', requiresParOrBetter: false },
  // ── Round-level / auto-calculated (not par-gated) ──
  { id: 'par3_sweepie', name: 'Par 3 Sweepie', description: 'Auto: win all par 3 greenies (value = # par 3 holes)', points: 0, requiresParOrBetter: false, autoCalculated: true },
  { id: 'par4_sweepie', name: 'Par 4 Sweepie', description: 'Auto: win all par 4 greenies (value = # par 4 holes)', points: 0, requiresParOrBetter: false, autoCalculated: true },
  { id: 'par5_sweepie', name: 'Par 5 Sweepie', description: 'Auto: win all par 5 greenies (value = # par 5 holes)', points: 0, requiresParOrBetter: false, autoCalculated: true },
  // ── Penalty / negative (not par-gated) ──
  { id: 'four_putt', name: '4-Putt', description: 'Four putts regardless of score', points: -2, requiresParOrBetter: false },
  { id: 'ouzel', name: 'Ouzel', description: 'Failed greenie conversion — negative of carry value (+ sweepie if applicable)', points: -1, requiresParOrBetter: false },
];

/**
 * Get the base point value for a dot type.
 * Ouzel returns the negative of the greenie's base value.
 */
export function getDotPointValue(dotId: string): number {
  if (dotId === 'ouzel') {
    const greenie = AVAILABLE_DOTS.find((d) => d.id === 'greenie');
    return -(greenie?.points ?? 1);
  }
  const dot = AVAILABLE_DOTS.find((d) => d.id === dotId);
  return dot?.points ?? 0;
}

/**
 * Determine which dots should be auto-awarded based on score.
 * Only returns dot IDs that are in the active dots list.
 */
export function getAutoAwardDots(
  grossScore: number,
  netScore: number,
  par: number,
  activeDotIds: string[],
): string[] {
  const result: string[] = [];
  const activeSet = new Set(activeDotIds);

  // Gross score-based — hole-in-one takes priority over all net-score awards
  if (grossScore === 1 && activeSet.has('hole_in_one')) {
    result.push('hole_in_one');
    return result;
  }

  // Net score-based awards (each independent — a net eagle does NOT also award birdie)
  const netDiff = netScore - par;
  if (netDiff <= -3 && activeSet.has('albatross')) result.push('albatross');
  else if (netDiff === -2 && activeSet.has('eagle')) result.push('eagle');
  else if (netDiff === -1 && activeSet.has('birdie')) result.push('birdie');

  return result;
}

/**
 * Get the display name for an auto-awarded dot, prefixing "Net" when the
 * award is based on net score but the gross score alone wouldn't earn it.
 * Hole-in-one is always gross-based so never prefixed.
 */
export function getAutoAwardDotDisplayName(
  dotId: string,
  dotName: string,
  grossScore: number,
  par: number,
): string {
  if (dotId === 'hole_in_one') return dotName;
  const grossDiff = grossScore - par;
  switch (dotId) {
    case 'albatross':
      if (grossScore !== 1 && grossDiff <= -3) return dotName;
      return `Net ${dotName}`;
    case 'eagle':
      if (grossScore !== 1 && grossDiff === -2) return dotName;
      return `Net ${dotName}`;
    case 'birdie':
      if (grossScore !== 1 && grossDiff === -1) return dotName;
      return `Net ${dotName}`;
    default:
      return dotName;
  }
}

// ── Greenie carry-over, dynamic sweepie & ouzel ──

/** All data needed to compute dynamic greenie/sweepie/ouzel values for a round. */
export interface GreenieRoundContext {
  /** All holes on the course (need par values to identify par 3s, 4s, and 5s) */
  holes: { holeNumber: number; par: number }[];
  /** All junk game points for this round (to find greenie awards per hole) */
  junkGamePoints: { playerId: string; holeNumber: number; awardedDots: string[] | null }[];
  /** The dot IDs that are active in this round's dots config */
  activeDotIds: string[];
  /** Hole numbers where at least one player has recorded a score (skipped holes excluded from carry) */
  scoredHoleNumbers: Set<number>;
}

/** Result of analyzing greenie carry state for a specific hole. */
export interface GreenieCarryInfo {
  /** Effective point value of a greenie on this hole (1 + count of consecutive unclaimed prior holes) */
  carryValue: number;
  /** Hole numbers that contributed to the carry (consecutive unclaimed prior same-par holes) */
  carriedFromHoles: number[];
  /** The par type: 3, 4, or 5 */
  parType: 3 | 4 | 5;
}

/** Result of sweepie eligibility check. */
export interface SweepieInfo {
  earned: boolean;
  playerId: string | null;
  /** Sweepie value = number of holes of that par type on the course */
  value: number;
  parType: 3 | 4 | 5;
}

/** Get all hole numbers of a specific par, sorted by hole number. */
export function getHolesByPar(
  holes: { holeNumber: number; par: number }[],
  par: 3 | 4 | 5,
): number[] {
  return holes.filter((h) => h.par === par).map((h) => h.holeNumber).sort((a, b) => a - b);
}

/** Check if any player has a 'greenie' in their awardedDots on a given hole. */
export function getGreenieWinnerOnHole(
  ctx: GreenieRoundContext,
  holeNumber: number,
): string | null {
  for (const gp of ctx.junkGamePoints) {
    if (gp.holeNumber === holeNumber && gp.awardedDots?.includes('greenie')) {
      return gp.playerId;
    }
  }
  return null;
}

/**
 * Compute greenie carry info for a specific hole.
 * Returns null if the hole has an unsupported par value.
 *
 * Walks backward through prior holes of the same par type. For each
 * consecutive unclaimed hole, the carry increments. A claimed greenie
 * on a prior hole stops the carry chain. Holes that have not been
 * scored (skipped or not yet played) are excluded from the carry —
 * they don't break the chain but they don't add to it either.
 */
export function getGreenieCarryInfo(
  ctx: GreenieRoundContext,
  holeNumber: number,
): GreenieCarryInfo | null {
  const hole = ctx.holes.find((h) => h.holeNumber === holeNumber);
  if (!hole || (hole.par !== 3 && hole.par !== 4 && hole.par !== 5)) return null;

  const parType = hole.par as 3 | 4 | 5;
  const sameParHoles = getHolesByPar(ctx.holes, parType);
  const currentIndex = sameParHoles.indexOf(holeNumber);
  if (currentIndex < 0) return null;

  const carriedFromHoles: number[] = [];
  for (let i = currentIndex - 1; i >= 0; i--) {
    const priorHole = sameParHoles[i];
    // Skip unscored holes — they don't contribute to carry or break the chain
    if (!ctx.scoredHoleNumbers.has(priorHole)) continue;
    if (getGreenieWinnerOnHole(ctx, priorHole) === null) {
      carriedFromHoles.unshift(priorHole);
    } else {
      break;
    }
  }

  return { carryValue: 1 + carriedFromHoles.length, carriedFromHoles, parType };
}

/**
 * Check whether a single player has won ALL awarded greenies on all holes of a
 * given par type. Sweepie value = count of holes of that par type.
 *
 * Unclaimed greenie holes (nobody hit the green) don't block the sweepie —
 * their carry value was already collected by the winner on a subsequent hole.
 * However, all par holes of that type must have been scored (played) to avoid
 * premature sweepie awards mid-round.
 */
export function getSweepieInfo(
  ctx: GreenieRoundContext,
  parType: 3 | 4 | 5,
): SweepieInfo {
  const parHoles = getHolesByPar(ctx.holes, parType);
  const value = parHoles.length;
  if (parHoles.length === 0) return { earned: false, playerId: null, value: 0, parType };

  // All par holes of this type must have been scored before awarding
  const allScored = parHoles.every((h) => ctx.scoredHoleNumbers.has(h));
  if (!allScored) return { earned: false, playerId: null, value, parType };

  // Collect the winners for each hole (null = unclaimed, carried over)
  const winners = parHoles.map((h) => getGreenieWinnerOnHole(ctx, h));
  const claimedWinners = winners.filter((w): w is string => w !== null);

  // At least one greenie must have been won
  if (claimedWinners.length === 0) return { earned: false, playerId: null, value, parType };

  // All claimed greenies must belong to the same player
  const unique = new Set(claimedWinners);
  if (unique.size === 1) return { earned: true, playerId: claimedWinners[0], value, parType };

  return { earned: false, playerId: null, value, parType };
}

/**
 * Compute the dynamic ouzel value for a hole.
 * Ouzel = negative of (greenie carry value + sweepie if converting would complete it).
 * Returns a negative number (e.g., -8).
 */
export function getDynamicOuzelValue(
  ctx: GreenieRoundContext,
  holeNumber: number,
): number {
  const carryInfo = getGreenieCarryInfo(ctx, holeNumber);
  if (!carryInfo) return -1; // fallback for non-greenie holes

  let value = carryInfo.carryValue;

  // Check if converting a greenie here would also complete the sweepie.
  // If ONE player won all OTHER holes of this par type, then winning this
  // one would also earn the sweepie.
  const parHoles = getHolesByPar(ctx.holes, carryInfo.parType);
  const otherHoles = parHoles.filter((h) => h !== holeNumber);

  if (otherHoles.length > 0) {
    const otherWinners = otherHoles.map((h) => getGreenieWinnerOnHole(ctx, h));
    const claimedOther = otherWinners.filter((w): w is string => w !== null);
    // Sweepie is at stake only when ALL other holes are claimed by the same player
    const allClaimedBySame = claimedOther.length === otherHoles.length && new Set(claimedOther).size === 1;
    if (allClaimedBySame) {
      value += parHoles.length; // sweepie value = count of holes of that par type
    }
  } else {
    // This is the ONLY hole of this par type — converting also earns the sweepie
    value += parHoles.length;
  }

  return -value;
}

/**
 * Compute dynamic point value for a single dot, given greenie context.
 * For most dots this returns the static value. For greenie, ouzel, and
 * sweepies it uses the carry/sweepie logic.
 */
export function getDynamicDotPointValue(
  dotId: string,
  ctx: GreenieRoundContext,
  holeNumber: number,
): number {
  if (dotId === 'greenie') {
    return getGreenieCarryInfo(ctx, holeNumber)?.carryValue ?? 1;
  }
  if (dotId === 'ouzel') {
    return getDynamicOuzelValue(ctx, holeNumber);
  }
  if (dotId === 'par3_sweepie') {
    return getSweepieInfo(ctx, 3).value;
  }
  if (dotId === 'par4_sweepie') {
    return getSweepieInfo(ctx, 4).value;
  }
  if (dotId === 'par5_sweepie') {
    return getSweepieInfo(ctx, 5).value;
  }
  return getDotPointValue(dotId);
}

/**
 * Sum point values for an array of awarded dots using dynamic context.
 * Replaces the static `calcRawDotPoints` in the hole view.
 */
export function calcDynamicDotPoints(
  awardedDots: string[],
  ctx: GreenieRoundContext,
  holeNumber: number,
): number {
  let total = 0;
  for (const dotId of awardedDots) {
    total += getDynamicDotPointValue(dotId, ctx, holeNumber);
  }
  return total;
}

// ── Point calculation orchestration ──

/**
 * Calculate game points for a single hole after a score is entered.
 * Only handles auto-calculated game types (Nassau, Skins, Baseball, Team Match).
 * For Skins/Baseball, must recalculate all holes (carryover).
 *
 * @returns array of GamePointInput to upsert, or empty array if not auto-calculated
 */
export function calculateGamePoints(
  game: BettingGame,
  holeNumber: number,
  allScores: Score[],        // All scores for the round
  playerIds: string[],       // All player IDs in the round
  holeNumbers: number[],     // Ordered list of hole numbers for the round
  teamConfig?: TeamConfig,   // Required for team_match
): GamePointInput[] {
  if (!isAutoCalculated(game.type)) return [];

  switch (game.type) {
    case 'nassau': {
      // Nassau: per-hole calculation — only need scores for this hole
      const holeScores = allScores.filter((s) => s.holeNumber === holeNumber);
      return calculateNassauHolePoints(game.roundId, game.id, holeNumber, holeScores);
    }
    case 'skins': {
      // Skins: must recalculate ALL holes because of carryover
      const config = game.config as unknown as { carryOver?: boolean; perSkinValue?: number };
      return calculateSkinsPoints(
        game.roundId,
        game.id,
        allScores,
        playerIds,
        holeNumbers,
        { carryOver: config.carryOver ?? true, perSkinValue: config.perSkinValue ?? 1 },
      );
    }
    case 'baseball_3man': {
      return calculateBaseballPoints(game.roundId, game.id, allScores, playerIds, holeNumbers, '3man');
    }
    case 'baseball_4man': {
      return calculateBaseballPoints(game.roundId, game.id, allScores, playerIds, holeNumbers, '4man');
    }
    case 'team_match': {
      if (!teamConfig) return [];
      const holeScores = allScores.filter((s) => s.holeNumber === holeNumber);
      const pairing = getTeamPairingForHole(teamConfig, holeNumber);
      if (!pairing) return [];
      const config = game.config as unknown as TeamMatchConfig;
      return calculateTeamMatchHolePoints(
        game.roundId, game.id, holeNumber, holeScores,
        pairing, teamConfig.scoringFormat, config.pointsPerHoleWon ?? 1,
        config.lowMatchPoints, config.highMatchPoints,
      );
    }
    default:
      return [];
  }
}
