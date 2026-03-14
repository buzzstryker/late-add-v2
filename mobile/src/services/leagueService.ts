/**
 * League Service — framework-agnostic business logic for league/group management.
 *
 * Handles: season auto-assignment, standings calculation, round-to-league
 * score flow, and group management validation.
 */
import {
  Season,
  LeagueRound,
  LeagueScore,
  PlayerStanding,
  GroupCreateInput,
  getEffectiveLeagueScore,
} from '../models/League';
import { GamePoint } from '../models/GamePoint';

// ── Net Position Calculations ──

/**
 * Get the net $ amount for each player in a single round.
 *
 * Two modes based on the round's scoresOverride flag:
 * - scoresOverride=true  → scores ARE pre-calculated net $ amounts (direct use)
 * - scoresOverride=false → scores are game points, apply round-robin
 *   Round-robin: each player's net = n × score − totalAllScores
 */
export function getRoundNetAmounts(
  scores: LeagueScore[],
  scoresOverride: boolean = true,
): Map<string, number> {
  const validScores = scores.filter(
    (s) => getEffectiveLeagueScore(s) !== null,
  );

  if (scoresOverride) {
    // Scores are already net $ amounts — use directly
    const positions = new Map<string, number>();
    for (const score of validScores) {
      positions.set(score.playerId, getEffectiveLeagueScore(score)!);
    }
    return positions;
  }

  // Game points — apply round-robin: n × score − total
  const n = validScores.length;
  if (n < 2) return new Map();

  const total = validScores.reduce(
    (sum, s) => sum + getEffectiveLeagueScore(s)!,
    0,
  );

  const positions = new Map<string, number>();
  for (const score of validScores) {
    const pts = getEffectiveLeagueScore(score)!;
    const net = n * pts - total;
    positions.set(score.playerId, Math.round(net * 100) / 100);
  }
  return positions;
}

/**
 * Calculate cumulative net $ positions across all rounds in a season.
 *
 * Uses the round's scoresOverride flag to determine calculation mode:
 * - Override rounds: scores are net amounts, summed directly
 * - Non-override rounds: scores are game points, round-robin applied first
 */
export function calculateSeasonNetPositions(
  scores: LeagueScore[],
  rounds: LeagueRound[],
): Map<string, number> {
  // Build a lookup: roundId → scoresOverride
  const overrideMap = new Map<string, boolean>();
  for (const round of rounds) {
    overrideMap.set(round.id, round.scoresOverride);
  }

  // Group scores by round
  const byRound = new Map<string, LeagueScore[]>();
  for (const score of scores) {
    const existing = byRound.get(score.leagueRoundId) ?? [];
    existing.push(score);
    byRound.set(score.leagueRoundId, existing);
  }

  const cumulative = new Map<string, number>();
  for (const [roundId, roundScores] of byRound) {
    const isOverride = overrideMap.get(roundId) ?? true;
    const roundNets = getRoundNetAmounts(roundScores, isOverride);
    for (const [playerId, net] of roundNets) {
      const current = cumulative.get(playerId) ?? 0;
      cumulative.set(playerId, Math.round((current + net) * 100) / 100);
    }
  }

  return cumulative;
}

// ── Season Logic ──

/**
 * Determine which season a given date falls into for a set of seasons.
 * Matches on start_date <= date <= end_date.
 */
export function findSeasonForDate(
  seasons: Season[],
  date: string, // ISO date YYYY-MM-DD or full ISO datetime
): Season | null {
  const dateOnly = date.split('T')[0]; // normalize to YYYY-MM-DD
  for (const season of seasons) {
    const start = season.startDate.split('T')[0];
    const end = season.endDate.split('T')[0];
    if (dateOnly >= start && dateOnly <= end) {
      return season;
    }
  }
  return null;
}

/**
 * Generate the next season's date range based on the group's season_start_month.
 *
 * If afterDate is provided, generates the season starting on or after that date.
 * Otherwise generates the season that contains the current date, or the next
 * upcoming season if we're past this year's start.
 *
 * E.g., seasonStartMonth = 9 (September), current date in 2026:
 *   → { startDate: '2025-09-01', endDate: '2026-08-31' } if before Sep 2026
 *   → { startDate: '2026-09-01', endDate: '2027-08-31' } if after Sep 2026
 */
export function generateNextSeasonDates(
  seasonStartMonth: number,
  afterDate?: string, // ISO date, defaults to today
): { startDate: string; endDate: string } {
  const ref = afterDate ? new Date(afterDate) : new Date();
  const refYear = ref.getFullYear();
  const refMonth = ref.getMonth() + 1; // 1-indexed

  // Determine the start year: if we haven't reached the start month yet this
  // year, the season started last year. Otherwise it starts this year.
  let startYear: number;
  if (refMonth < seasonStartMonth) {
    startYear = refYear - 1;
  } else {
    startYear = refYear;
  }

  // If an afterDate is provided and the season we computed has already ended,
  // bump forward by a year.
  const endYear = seasonStartMonth === 1 ? startYear : startYear + 1;
  const endMonth = seasonStartMonth === 1 ? 12 : seasonStartMonth - 1;
  const endDateCandidate = `${endYear}-${String(endMonth).padStart(2, '0')}-${lastDayOfMonth(endYear, endMonth)}`;

  if (afterDate && afterDate.split('T')[0] > endDateCandidate) {
    startYear += 1;
  }

  const startDate = `${startYear}-${String(seasonStartMonth).padStart(2, '0')}-01`;

  // End date: last day of the month before the start month of the next year
  let endMonthFinal: number;
  let endYearFinal: number;
  if (seasonStartMonth === 1) {
    // Jan start → Dec 31 of same year
    endMonthFinal = 12;
    endYearFinal = startYear;
  } else {
    endMonthFinal = seasonStartMonth - 1;
    endYearFinal = startYear + 1;
  }

  const endDate = `${endYearFinal}-${String(endMonthFinal).padStart(2, '0')}-${lastDayOfMonth(endYearFinal, endMonthFinal)}`;

  return { startDate, endDate };
}

function lastDayOfMonth(year: number, month: number): string {
  // Day 0 of the next month = last day of this month
  const d = new Date(year, month, 0).getDate();
  return String(d).padStart(2, '0');
}

// ── Standings ──

/**
 * Calculate standings from a set of league scores.
 * Returns players ranked by total effective points (override > value), descending.
 * Ties share the same rank.
 *
 * If groupMemberIds is provided, all members are included in standings —
 * even those with zero rounds played (they appear at the bottom with $0).
 */
export function calculateStandings(
  scores: LeagueScore[],
  groupMemberIds?: string[],
): PlayerStanding[] {
  // Aggregate per player
  const playerMap = new Map<string, { total: number; rounds: number }>();

  for (const score of scores) {
    const effective = getEffectiveLeagueScore(score);
    if (effective === null) continue;

    const current = playerMap.get(score.playerId) ?? { total: 0, rounds: 0 };
    current.total += effective;
    current.rounds += 1;
    playerMap.set(score.playerId, current);
  }

  // Include all group members (even those with 0 rounds)
  if (groupMemberIds) {
    for (const memberId of groupMemberIds) {
      if (!playerMap.has(memberId)) {
        playerMap.set(memberId, { total: 0, rounds: 0 });
      }
    }
  }

  // Build standings sorted by total descending
  const standings: PlayerStanding[] = [];
  for (const [playerId, data] of playerMap) {
    standings.push({
      playerId,
      totalPoints: data.total,
      roundsPlayed: data.rounds,
      averagePoints: data.rounds > 0 ? Math.round((data.total / data.rounds) * 100) / 100 : 0,
      rank: 0, // assigned below
    });
  }

  standings.sort((a, b) => b.totalPoints - a.totalPoints);

  // Assign ranks (ties share rank, next rank skips)
  let currentRank = 1;
  for (let i = 0; i < standings.length; i++) {
    if (i > 0 && standings[i].totalPoints < standings[i - 1].totalPoints) {
      currentRank = i + 1;
    }
    standings[i].rank = currentRank;
  }

  return standings;
}

// ── Round-to-League Flow ──

/**
 * Summarize a completed Scorekeeper round's game_points into a single
 * per-player point total suitable for league_scores.score_value.
 *
 * Logic: sum all game_points for each player in the round.
 * This is called when a round is completed and linked to a league.
 */
export function summarizeRoundPoints(
  gamePoints: GamePoint[],
  playerIds: string[],
): Map<string, number> {
  const totals = new Map<string, number>();

  // Initialize all players with 0
  for (const pid of playerIds) {
    totals.set(pid, 0);
  }

  for (const gp of gamePoints) {
    if (!playerIds.includes(gp.playerId)) continue;
    const current = totals.get(gp.playerId) ?? 0;
    totals.set(gp.playerId, current + gp.points);
  }

  return totals;
}

// ── Validation ──

/**
 * Validate that a season's dates don't overlap with existing seasons
 * for the same group.
 */
export function validateSeasonDates(
  existing: Season[],
  startDate: string,
  endDate: string,
  excludeId?: string,
): { valid: boolean; error?: string } {
  if (startDate >= endDate) {
    return { valid: false, error: 'Start date must be before end date' };
  }

  const startOnly = startDate.split('T')[0];
  const endOnly = endDate.split('T')[0];

  for (const season of existing) {
    if (excludeId && season.id === excludeId) continue;

    const sStart = season.startDate.split('T')[0];
    const sEnd = season.endDate.split('T')[0];

    // Overlap: !(end < sStart || start > sEnd) → start <= sEnd && end >= sStart
    if (startOnly <= sEnd && endOnly >= sStart) {
      return {
        valid: false,
        error: `Overlaps with season ${sStart} to ${sEnd}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validate group creation/update inputs.
 */
export function validateGroupInput(
  input: GroupCreateInput,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!input.name || input.name.trim().length === 0) {
    errors.push('Group name is required');
  }

  if (input.seasonStartMonth < 1 || input.seasonStartMonth > 12) {
    errors.push('Season start month must be between 1 and 12');
  }

  return { valid: errors.length === 0, errors };
}

// ── Player Stats ──

export interface PlayerRoundDetail {
  roundDate: string;
  seasonId: string | null;
  net: number;
}

export interface PlayerStats {
  // Season scope
  seasonRoundsPlayed: number;
  seasonNetWinnings: number;
  seasonAverageWinnings: number;
  seasonBestPayout: number;
  // Lifetime scope (all seasons in group)
  lifetimeRoundsPlayed: number;
  lifetimeNetWinnings: number;
  lifetimeAverageWinnings: number;
  lifetimeBestPayout: number;
  // Recent rounds for display (current season, most recent first)
  recentRounds: PlayerRoundDetail[];
}

/**
 * Calculate a single player's stats for both season and lifetime scopes.
 *
 * For each round, we compute net using getRoundNetAmounts (respects scoresOverride).
 * Then we extract just the target player's net from each round.
 */
export function calculatePlayerStats(
  playerId: string,
  seasonScores: LeagueScore[],
  seasonRounds: LeagueRound[],
  lifetimeScores: LeagueScore[],
  lifetimeRounds: LeagueRound[],
): PlayerStats {
  const seasonNets = computePlayerRoundNets(playerId, seasonScores, seasonRounds);
  const lifetimeNets = computePlayerRoundNets(playerId, lifetimeScores, lifetimeRounds);

  return {
    // Season
    seasonRoundsPlayed: seasonNets.length,
    seasonNetWinnings: sumNets(seasonNets),
    seasonAverageWinnings: avgNets(seasonNets),
    seasonBestPayout: bestNet(seasonNets),
    // Lifetime
    lifetimeRoundsPlayed: lifetimeNets.length,
    lifetimeNetWinnings: sumNets(lifetimeNets),
    lifetimeAverageWinnings: avgNets(lifetimeNets),
    lifetimeBestPayout: bestNet(lifetimeNets),
    // Recent rounds (season, most recent first)
    recentRounds: [...seasonNets].reverse(),
  };
}

/** Compute per-round net amounts for a specific player */
function computePlayerRoundNets(
  playerId: string,
  allScores: LeagueScore[],
  allRounds: LeagueRound[],
): PlayerRoundDetail[] {
  // Build lookup: roundId → round
  const roundMap = new Map<string, LeagueRound>();
  for (const r of allRounds) {
    roundMap.set(r.id, r);
  }

  // Group scores by round
  const scoresByRound = new Map<string, LeagueScore[]>();
  for (const s of allScores) {
    const arr = scoresByRound.get(s.leagueRoundId) ?? [];
    arr.push(s);
    scoresByRound.set(s.leagueRoundId, arr);
  }

  const results: PlayerRoundDetail[] = [];

  for (const [roundId, roundScores] of scoresByRound) {
    const round = roundMap.get(roundId);
    if (!round) continue;

    // Check if this player has a score in this round
    const hasScore = roundScores.some((s) => s.playerId === playerId);
    if (!hasScore) continue;

    // Calculate net amounts for all players in this round
    const nets = getRoundNetAmounts(roundScores, round.scoresOverride);
    const playerNet = nets.get(playerId) ?? 0;

    results.push({
      roundDate: round.roundDate,
      seasonId: round.seasonId ?? null,
      net: playerNet,
    });
  }

  // Sort by date ascending
  results.sort((a, b) => a.roundDate.localeCompare(b.roundDate));
  return results;
}

function sumNets(nets: PlayerRoundDetail[]): number {
  const total = nets.reduce((sum, n) => sum + n.net, 0);
  return Math.round(total * 100) / 100;
}

function avgNets(nets: PlayerRoundDetail[]): number {
  if (nets.length === 0) return 0;
  return Math.round((sumNets(nets) / nets.length) * 100) / 100;
}

function bestNet(nets: PlayerRoundDetail[]): number {
  if (nets.length === 0) return 0;
  return Math.max(...nets.map((n) => n.net));
}

// ── Head-to-Head ──

export interface HeadToHeadEntry {
  opponentId: string;
  /** Target player's cumulative net across rounds they both played in */
  totalNet: number;
  /** Number of rounds both players participated in */
  roundsTogether: number;
}

/**
 * Calculate a player's head-to-head outcomes against every opponent in the season.
 *
 * For each round both the target player and an opponent played in, the target
 * player's net $ amount for that round is attributed to the matchup.  Results
 * are sorted from highest positive (most won) to most negative (most lost).
 */
export function calculateHeadToHead(
  playerId: string,
  scores: LeagueScore[],
  rounds: LeagueRound[],
): HeadToHeadEntry[] {
  // Build round lookup
  const roundMap = new Map<string, LeagueRound>();
  for (const r of rounds) roundMap.set(r.id, r);

  // Group scores by round
  const scoresByRound = new Map<string, LeagueScore[]>();
  for (const s of scores) {
    const arr = scoresByRound.get(s.leagueRoundId) ?? [];
    arr.push(s);
    scoresByRound.set(s.leagueRoundId, arr);
  }

  // For each round, compute net amounts and track per-opponent
  const opponentMap = new Map<string, { totalNet: number; roundsTogether: number }>();

  for (const [roundId, roundScores] of scoresByRound) {
    const round = roundMap.get(roundId);
    if (!round) continue;

    // Check if target player has a valid score in this round
    const hasTarget = roundScores.some(
      (s) => s.playerId === playerId && getEffectiveLeagueScore(s) !== null,
    );
    if (!hasTarget) continue;

    const nets = getRoundNetAmounts(roundScores, round.scoresOverride);
    const playerNet = nets.get(playerId) ?? 0;

    // Attribute playerNet against each opponent present in this round
    for (const s of roundScores) {
      if (s.playerId === playerId) continue;
      if (getEffectiveLeagueScore(s) === null) continue;

      const existing = opponentMap.get(s.playerId) ?? { totalNet: 0, roundsTogether: 0 };
      existing.totalNet = Math.round((existing.totalNet + playerNet) * 100) / 100;
      existing.roundsTogether += 1;
      opponentMap.set(s.playerId, existing);
    }
  }

  // Convert to sorted array: most won → most lost
  const entries: HeadToHeadEntry[] = [];
  for (const [opponentId, data] of opponentMap) {
    entries.push({
      opponentId,
      totalNet: data.totalNet,
      roundsTogether: data.roundsTogether,
    });
  }
  entries.sort((a, b) => b.totalNet - a.totalNet);

  return entries;
}
