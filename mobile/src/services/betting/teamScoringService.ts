/**
 * Team Scoring Service — computes team-level scores from individual net scores.
 *
 * Framework-agnostic (no React imports). Pure functions only.
 */

import { Score } from '../../models/Score';
import { TeamId, TeamPairing, TeamScoringFormat } from '../../models/Team';

// ─── Types ───────────────────────────────────────────────────────────────

export interface TeamHoleScore {
  teamId: TeamId;
  playerIds: string[];
  teamScore: number;
  /** For 'one_net_low_tiebreaker': the secondary value used to break ties */
  tiebreaker?: number;
}

export interface TeamHoleResult {
  teamA: TeamHoleScore;
  teamB: TeamHoleScore;
}

/** Result for the low_vs_low_high_vs_high format — two independent sub-matches. */
export interface DualMatchResult {
  /** Low net vs low net sub-match */
  lowMatch: { teamAScore: number; teamBScore: number; winner: TeamId | null };
  /** High net vs high net sub-match */
  highMatch: { teamAScore: number; teamBScore: number; winner: TeamId | null };
  teamA: { teamId: TeamId; playerIds: string[] };
  teamB: { teamId: TeamId; playerIds: string[] };
}

// ─── Core Calculator ─────────────────────────────────────────────────────

/**
 * Compute team scores for a single hole given individual net scores and a pairing.
 *
 * Returns null if not all players in both teams have scored on this hole.
 */
export function calculateTeamHoleScores(
  pairing: TeamPairing,
  holeScores: Score[],
  scoringFormat: TeamScoringFormat,
): TeamHoleResult | null {
  // Build a lookup from playerId → netScore for this hole
  const scoreMap = new Map<string, number>();
  for (const s of holeScores) {
    scoreMap.set(s.playerId, s.netScore);
  }

  // Collect net scores for each team; bail if any player is missing
  const teamANets = getNetsForTeam(pairing.teamA, scoreMap);
  const teamBNets = getNetsForTeam(pairing.teamB, scoreMap);
  if (!teamANets || !teamBNets) return null;

  switch (scoringFormat) {
    case 'two_net_low_combined':
      return computeTwoNetLowCombined(pairing, teamANets, teamBNets);

    case 'one_net_low_tiebreaker':
      return computeOneNetLowTiebreaker(pairing, teamANets, teamBNets);

    case 'net_high_and_low':
      return computeNetHighAndLow(pairing, teamANets, teamBNets);

    default:
      return null;
  }
}

/**
 * Compute dual sub-match results for the low_vs_low_high_vs_high format.
 *
 * Returns null if not all players in both teams have scored on this hole.
 */
export function calculateDualMatchScores(
  pairing: TeamPairing,
  holeScores: Score[],
): DualMatchResult | null {
  const scoreMap = new Map<string, number>();
  for (const s of holeScores) {
    scoreMap.set(s.playerId, s.netScore);
  }

  const teamANets = getNetsForTeam(pairing.teamA, scoreMap);
  const teamBNets = getNetsForTeam(pairing.teamB, scoreMap);
  if (!teamANets || !teamBNets) return null;

  const teamALow = Math.min(...teamANets);
  const teamAHigh = Math.max(...teamANets);
  const teamBLow = Math.min(...teamBNets);
  const teamBHigh = Math.max(...teamBNets);

  const lowWinner = teamALow < teamBLow ? 'A' as TeamId : teamBLow < teamALow ? 'B' as TeamId : null;
  const highWinner = teamAHigh < teamBHigh ? 'A' as TeamId : teamBHigh < teamAHigh ? 'B' as TeamId : null;

  return {
    lowMatch: { teamAScore: teamALow, teamBScore: teamBLow, winner: lowWinner },
    highMatch: { teamAScore: teamAHigh, teamBScore: teamBHigh, winner: highWinner },
    teamA: { teamId: 'A', playerIds: pairing.teamA },
    teamB: { teamId: 'B', playerIds: pairing.teamB },
  };
}

// ─── Scoring Format Implementations ──────────────────────────────────────

/**
 * Two Net Low Combined: sum both teammates' net scores.
 * Lower team total wins the hole.
 */
function computeTwoNetLowCombined(
  pairing: TeamPairing,
  teamANets: number[],
  teamBNets: number[],
): TeamHoleResult {
  const teamAScore = sum(teamANets);
  const teamBScore = sum(teamBNets);

  return {
    teamA: { teamId: 'A', playerIds: pairing.teamA, teamScore: teamAScore },
    teamB: { teamId: 'B', playerIds: pairing.teamB, teamScore: teamBScore },
  };
}

/**
 * One Net Low with Tiebreaker: lower of the two teammates' nets counts.
 * If teams are tied on the low net, the second player's (higher) net breaks it.
 */
function computeOneNetLowTiebreaker(
  pairing: TeamPairing,
  teamANets: number[],
  teamBNets: number[],
): TeamHoleResult {
  const sortedA = [...teamANets].sort((a, b) => a - b);
  const sortedB = [...teamBNets].sort((a, b) => a - b);

  // Primary: lowest net on team
  const teamALow = sortedA[0];
  const teamBLow = sortedB[0];

  // Tiebreaker: second-lowest (or same if solo player)
  const teamATie = sortedA.length > 1 ? sortedA[1] : sortedA[0];
  const teamBTie = sortedB.length > 1 ? sortedB[1] : sortedB[0];

  return {
    teamA: { teamId: 'A', playerIds: pairing.teamA, teamScore: teamALow, tiebreaker: teamATie },
    teamB: { teamId: 'B', playerIds: pairing.teamB, teamScore: teamBLow, tiebreaker: teamBTie },
  };
}

/**
 * Net High and Low: team score = best net + worst net.
 * Lower combined total wins.
 */
function computeNetHighAndLow(
  pairing: TeamPairing,
  teamANets: number[],
  teamBNets: number[],
): TeamHoleResult {
  const teamAScore = Math.min(...teamANets) + Math.max(...teamANets);
  const teamBScore = Math.min(...teamBNets) + Math.max(...teamBNets);

  return {
    teamA: { teamId: 'A', playerIds: pairing.teamA, teamScore: teamAScore },
    teamB: { teamId: 'B', playerIds: pairing.teamB, teamScore: teamBScore },
  };
}

// ─── Comparison Helper ───────────────────────────────────────────────────

/**
 * Compare two TeamHoleScores and return the winning team ID, or null for a tie.
 *
 * For 'one_net_low_tiebreaker': uses tiebreaker if primary scores are equal.
 * For other formats: lower teamScore wins outright; equal = tie.
 */
export function getHoleWinner(
  teamA: TeamHoleScore,
  teamB: TeamHoleScore,
): TeamId | null {
  if (teamA.teamScore < teamB.teamScore) return 'A';
  if (teamB.teamScore < teamA.teamScore) return 'B';

  // Primary scores tied — check tiebreaker (for one_net_low_tiebreaker)
  if (teamA.tiebreaker != null && teamB.tiebreaker != null) {
    if (teamA.tiebreaker < teamB.tiebreaker) return 'A';
    if (teamB.tiebreaker < teamA.tiebreaker) return 'B';
  }

  // Still tied
  return null;
}

// ─── Internal Helpers ────────────────────────────────────────────────────

/**
 * Collect net scores for a team's players from the score map.
 * Returns null if any player is missing a score.
 */
function getNetsForTeam(
  playerIds: string[],
  scoreMap: Map<string, number>,
): number[] | null {
  const nets: number[] = [];
  for (const pid of playerIds) {
    const net = scoreMap.get(pid);
    if (net === undefined) return null;
    nets.push(net);
  }
  return nets;
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}
