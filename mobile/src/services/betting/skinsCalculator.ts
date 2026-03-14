/**
 * Skins point calculator — pure functions, no React imports.
 *
 * Skins: Each hole is worth 1 skin. Lowest net score wins outright.
 * Ties: no skin awarded; value carries over to the next hole (if carryOver enabled).
 * Must recalculate ALL holes on every score entry because carryover changes
 * the value of later holes.
 */

import { Score } from '../../models/Score';
import { SkinsConfig } from '../../models/BettingGame';
import { GamePointInput } from '../../models/GamePoint';

/**
 * Calculate Skins points across all scored holes in the round.
 *
 * @param roundId     - The round ID
 * @param gameId      - The betting game ID
 * @param allScores   - All scores for the round
 * @param playerIds   - All player IDs in the round
 * @param holeNumbers - Ordered list of hole numbers for the round (e.g. [1..18])
 * @param config      - Skins configuration (carryOver, perSkinValue)
 * @returns GamePointInput[] — one entry per player per hole that has been fully scored
 */
export function calculateSkinsPoints(
  roundId: string,
  gameId: string,
  allScores: Score[],
  playerIds: string[],
  holeNumbers: number[],
  config: SkinsConfig,
): GamePointInput[] {
  const results: GamePointInput[] = [];
  let carriedSkins = 0;

  for (const holeNum of holeNumbers) {
    // Get scores for this hole
    const holeScores = allScores.filter((s) => s.holeNumber === holeNum);

    // Only calculate if all players have scored this hole
    if (holeScores.length < playerIds.length) {
      // Hole not fully scored — stop here (can't calculate further with carryover)
      break;
    }

    const skinValue = (config.perSkinValue ?? 1) + carriedSkins;

    // Find lowest net score
    const minNet = Math.min(...holeScores.map((s) => s.netScore));
    const winnersCount = holeScores.filter((s) => s.netScore === minNet).length;

    if (winnersCount === 1) {
      // Outright winner — gets all accumulated skins
      for (const playerId of playerIds) {
        const score = holeScores.find((s) => s.playerId === playerId);
        results.push({
          roundId,
          gameId,
          playerId,
          holeNumber: holeNum,
          points: score && score.netScore === minNet ? skinValue : 0,
        });
      }
      carriedSkins = 0; // Reset carryover
    } else {
      // Tie — no one wins
      for (const playerId of playerIds) {
        results.push({
          roundId,
          gameId,
          playerId,
          holeNumber: holeNum,
          points: 0,
        });
      }
      if (config.carryOver) {
        carriedSkins += (config.perSkinValue ?? 1);
      }
    }
  }

  return results;
}
