/**
 * Team Match point calculator — pure functions, no React imports.
 *
 * Team Match: hole-by-hole 2v2 competition. Winning team's players each
 * earn the configured points. Ties award 0.
 *
 * For 'low_vs_low_high_vs_high' format: two independent sub-bets per hole,
 * each with its own point value. Points from both sub-bets are summed.
 */

import { Score } from '../../models/Score';
import { GamePointInput } from '../../models/GamePoint';
import { TeamPairing, TeamScoringFormat } from '../../models/Team';
import { calculateTeamHoleScores, calculateDualMatchScores, getHoleWinner } from './teamScoringService';

/**
 * Calculate Team Match points for a single hole.
 *
 * @param roundId          - The round ID
 * @param gameId           - The betting game ID
 * @param holeNumber       - The hole being scored
 * @param holeScores       - All player scores for this hole (must include netScore)
 * @param teamPairing      - The team pairing for this hole
 * @param scoringFormat    - How individual nets combine into a team score
 * @param pointsPerHoleWon - Points each winning-team player earns (single-bet formats)
 * @param lowMatchPoints   - Points for winning the low sub-bet (dual format only)
 * @param highMatchPoints  - Points for winning the high sub-bet (dual format only)
 * @returns GamePointInput[] — one entry per player
 */
export function calculateTeamMatchHolePoints(
  roundId: string,
  gameId: string,
  holeNumber: number,
  holeScores: Score[],
  teamPairing: TeamPairing,
  scoringFormat: TeamScoringFormat,
  pointsPerHoleWon: number,
  lowMatchPoints?: number,
  highMatchPoints?: number,
): GamePointInput[] {
  if (holeScores.length === 0) return [];

  // Dual sub-bet format
  if (scoringFormat === 'low_vs_low_high_vs_high') {
    return calculateDualMatchHolePoints(
      roundId, gameId, holeNumber, holeScores, teamPairing,
      lowMatchPoints ?? pointsPerHoleWon,
      highMatchPoints ?? pointsPerHoleWon,
    );
  }

  // Single-bet formats
  const result = calculateTeamHoleScores(teamPairing, holeScores, scoringFormat);

  // If not all players have scored, give everyone 0 for now
  if (!result) {
    return holeScores.map((s) => ({
      roundId,
      gameId,
      playerId: s.playerId,
      holeNumber,
      points: 0,
    }));
  }

  const winner = getHoleWinner(result.teamA, result.teamB);

  const winningPlayerIds = new Set<string>();
  if (winner === 'A') {
    result.teamA.playerIds.forEach((id) => winningPlayerIds.add(id));
  } else if (winner === 'B') {
    result.teamB.playerIds.forEach((id) => winningPlayerIds.add(id));
  }

  return holeScores.map((s) => ({
    roundId,
    gameId,
    playerId: s.playerId,
    holeNumber,
    points: winningPlayerIds.has(s.playerId) ? pointsPerHoleWon : 0,
  }));
}

/**
 * Calculate points for the low_vs_low_high_vs_high dual sub-bet format.
 *
 * Two independent comparisons per hole:
 *   1. Low net vs low net → winner earns lowPts
 *   2. High net vs high net → winner earns highPts
 * Points from both sub-bets are summed per player. A team can win both,
 * lose both, or split.
 */
function calculateDualMatchHolePoints(
  roundId: string,
  gameId: string,
  holeNumber: number,
  holeScores: Score[],
  teamPairing: TeamPairing,
  lowPts: number,
  highPts: number,
): GamePointInput[] {
  const result = calculateDualMatchScores(teamPairing, holeScores);

  // If not all players have scored, give everyone 0
  if (!result) {
    return holeScores.map((s) => ({
      roundId,
      gameId,
      playerId: s.playerId,
      holeNumber,
      points: 0,
    }));
  }

  // Build per-player point totals from both sub-bets
  const playerPoints = new Map<string, number>();
  for (const s of holeScores) {
    playerPoints.set(s.playerId, 0);
  }

  // Low match points
  if (result.lowMatch.winner) {
    const winnerTeam = result.lowMatch.winner === 'A' ? result.teamA : result.teamB;
    for (const pid of winnerTeam.playerIds) {
      playerPoints.set(pid, (playerPoints.get(pid) ?? 0) + lowPts);
    }
  }

  // High match points
  if (result.highMatch.winner) {
    const winnerTeam = result.highMatch.winner === 'A' ? result.teamA : result.teamB;
    for (const pid of winnerTeam.playerIds) {
      playerPoints.set(pid, (playerPoints.get(pid) ?? 0) + highPts);
    }
  }

  return holeScores.map((s) => ({
    roundId,
    gameId,
    playerId: s.playerId,
    holeNumber,
    points: playerPoints.get(s.playerId) ?? 0,
  }));
}
