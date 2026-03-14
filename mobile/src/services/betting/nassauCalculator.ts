/**
 * Nassau point calculator — pure functions, no React imports.
 *
 * Nassau: Three separate competitions (Front 9, Back 9, Overall 18).
 * Each hole: 1 point to the player/team with the lowest net score.
 * Ties: no points awarded.
 */

import { Score } from '../../models/Score';
import { GamePointInput } from '../../models/GamePoint';

/**
 * Calculate Nassau points for a single hole.
 *
 * @param roundId   - The round ID
 * @param gameId    - The betting game ID
 * @param holeNumber - The hole being scored
 * @param holeScores - All player scores for this hole (must include netScore)
 * @returns GamePointInput[] — one entry per player with scores on this hole
 */
export function calculateNassauHolePoints(
  roundId: string,
  gameId: string,
  holeNumber: number,
  holeScores: Score[],
): GamePointInput[] {
  if (holeScores.length === 0) return [];

  // Find the lowest net score on this hole
  const minNet = Math.min(...holeScores.map((s) => s.netScore));

  // Count how many players have the minimum
  const winnersCount = holeScores.filter((s) => s.netScore === minNet).length;

  // If exactly one player has the lowest net, they get 1 point. Ties = 0 for all.
  return holeScores.map((s) => ({
    roundId,
    gameId,
    playerId: s.playerId,
    holeNumber,
    points: winnersCount === 1 && s.netScore === minNet ? 1 : 0,
  }));
}
