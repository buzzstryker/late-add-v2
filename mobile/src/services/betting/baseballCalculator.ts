/**
 * Baseball point calculator — pure functions, no React imports.
 *
 * Baseball: Each hole distributes a fixed number of points based on net score
 * ranking.  3-Man awards 9 points per hole among 3 players.  4-Man awards 12
 * points per hole among 4 players.
 *
 * When ALL players tie on a hole, no points are awarded and the hole's points
 * carry over to the next hole.  When the tie breaks, the carried points are
 * distributed proportionally to the tie-breaking hole's distribution.
 *
 * Must recalculate ALL holes on every score entry because carryover changes
 * the value of later holes.
 */

import { Score } from '../../models/Score';
import { GamePointInput } from '../../models/GamePoint';

// ── Point distribution tables ──
// Each key is a JSON-stringified array of group sizes (sorted by net score asc).
// The value is the per-player point distribution (one entry per player, in rank order).
// A missing key means "all tied" → carry.

const THREE_MAN_DISTRIBUTIONS: Record<string, number[]> = {
  '[1,1,1]': [5, 3, 1],   // all unique
  '[2,1]':   [4, 4, 1],   // two-way tie for 1st
  '[1,2]':   [5, 2, 2],   // two-way tie for 2nd
};
const THREE_MAN_BASE = 9;
const THREE_MAN_PLAYERS = 3;

const FOUR_MAN_DISTRIBUTIONS: Record<string, number[]> = {
  '[1,1,1,1]': [6, 4, 2, 0],   // all unique
  '[2,1,1]':   [5, 5, 1, 1],   // two-way tie for 1st
  '[1,2,1]':   [6, 3, 3, 0],   // two-way tie for 2nd
  '[1,1,2]':   [6, 4, 1, 1],   // two-way tie for 3rd
  '[3,1]':     [4, 4, 4, 0],   // three-way tie for 1st
  '[1,3]':     [6, 2, 2, 2],   // three-way tie for 2nd
  '[2,2]':     [5, 5, 1, 1],   // two pairs tied
};
const FOUR_MAN_BASE = 12;
const FOUR_MAN_PLAYERS = 4;

/**
 * Build a group-sizes array from an array of net scores (already sorted ascending).
 * E.g. scores [3, 3, 5, 6] → group sizes [2, 1, 1] (two tied low, one middle, one high).
 */
function getGroupSizes(sortedNetScores: number[]): number[] {
  const groups: number[] = [];
  let i = 0;
  while (i < sortedNetScores.length) {
    let count = 1;
    while (i + count < sortedNetScores.length && sortedNetScores[i + count] === sortedNetScores[i]) {
      count++;
    }
    groups.push(count);
    i += count;
  }
  return groups;
}

/**
 * Expand a base distribution array by a scale factor.
 * Scale factor is always an integer (carried is always a multiple of base points).
 */
function scaleDistribution(base: number[], scaleFactor: number): number[] {
  return base.map((pts) => pts * scaleFactor);
}

/**
 * Check whether a specific hole is a "carry" hole (all players tied)
 * in a baseball game.
 */
export function isBaseballCarryHole(
  allScores: Score[],
  playerIds: string[],
  holeNumber: number,
  variant: '3man' | '4man',
): boolean {
  const expectedPlayers = variant === '3man' ? THREE_MAN_PLAYERS : FOUR_MAN_PLAYERS;
  if (playerIds.length !== expectedPlayers) return false;

  const holeScores = allScores.filter((s) => s.holeNumber === holeNumber);
  if (holeScores.length < expectedPlayers) return false;

  const sorted = [...holeScores].sort((a, b) => a.netScore - b.netScore);
  const sortedNetScores = sorted.map((s) => s.netScore);
  const groupSizes = getGroupSizes(sortedNetScores);
  const groupKey = JSON.stringify(groupSizes);
  const distributions = variant === '3man' ? THREE_MAN_DISTRIBUTIONS : FOUR_MAN_DISTRIBUTIONS;

  return !distributions[groupKey]; // Missing key = all tied = carry
}

/**
 * Check whether a hole has accumulated carry from prior all-tie holes.
 * Used by the UI to double junk dots — junk is doubled on holes that
 * RECEIVE carry (playing for double stakes), not the all-tie hole itself.
 */
export function hasBaseballCarryInto(
  allScores: Score[],
  playerIds: string[],
  holeNumber: number,
  holeNumbers: number[],
  variant: '3man' | '4man',
): boolean {
  const expectedPlayers = variant === '3man' ? THREE_MAN_PLAYERS : FOUR_MAN_PLAYERS;
  if (playerIds.length !== expectedPlayers) return false;
  const distributions = variant === '3man' ? THREE_MAN_DISTRIBUTIONS : FOUR_MAN_DISTRIBUTIONS;
  const basePoints = variant === '3man' ? THREE_MAN_BASE : FOUR_MAN_BASE;

  // Ensure holes are in ascending order (defensive — DB returns sorted but callers may not)
  const sortedHoleNumbers = [...holeNumbers].sort((a, b) => a - b);

  let carriedPoints = 0;

  for (const holeNum of sortedHoleNumbers) {
    if (holeNum === holeNumber) return carriedPoints > 0;

    // Only count scores from players in this game (ignore extra players in the round)
    const holeScores = allScores.filter(
      (s) => s.holeNumber === holeNum && playerIds.includes(s.playerId),
    );
    if (holeScores.length < expectedPlayers) break; // not enough scores yet

    const sorted = [...holeScores].sort((a, b) => a.netScore - b.netScore);
    const sortedNetScores = sorted.map((s) => s.netScore);
    const groupSizes = getGroupSizes(sortedNetScores);
    const groupKey = JSON.stringify(groupSizes);

    if (!distributions[groupKey]) {
      carriedPoints += basePoints; // all tie, carry forward
    } else {
      carriedPoints = 0; // resolved, carry resets
    }
  }

  return false; // hole not found or not reached yet
}

/**
 * Calculate Baseball points across all scored holes in the round.
 *
 * @param roundId     - The round ID
 * @param gameId      - The betting game ID
 * @param allScores   - All scores for the round
 * @param playerIds   - All player IDs in the round
 * @param holeNumbers - Ordered list of hole numbers for the round (e.g. [1..18])
 * @param variant     - '3man' or '4man'
 * @returns GamePointInput[] — one entry per player per hole that has been fully scored
 */
export function calculateBaseballPoints(
  roundId: string,
  gameId: string,
  allScores: Score[],
  playerIds: string[],
  holeNumbers: number[],
  variant: '3man' | '4man',
): GamePointInput[] {
  const distributions = variant === '3man' ? THREE_MAN_DISTRIBUTIONS : FOUR_MAN_DISTRIBUTIONS;
  const basePoints = variant === '3man' ? THREE_MAN_BASE : FOUR_MAN_BASE;
  const expectedPlayers = variant === '3man' ? THREE_MAN_PLAYERS : FOUR_MAN_PLAYERS;

  // Guard: wrong player count
  if (playerIds.length !== expectedPlayers) return [];

  // Ensure holes are in ascending order (defensive)
  const sortedHoleNumbers = [...holeNumbers].sort((a, b) => a - b);

  const results: GamePointInput[] = [];
  let carriedPoints = 0;

  for (const holeNum of sortedHoleNumbers) {
    // Only count scores from players in this game (ignore extra players in the round)
    const holeScores = allScores.filter(
      (s) => s.holeNumber === holeNum && playerIds.includes(s.playerId),
    );

    // Only calculate if all players have scored this hole
    if (holeScores.length < expectedPlayers) break;

    // Sort players by net score ascending (lowest = best)
    const sorted = [...holeScores].sort((a, b) => a.netScore - b.netScore);
    const sortedNetScores = sorted.map((s) => s.netScore);
    const groupSizes = getGroupSizes(sortedNetScores);
    const groupKey = JSON.stringify(groupSizes);
    const baseDist = distributions[groupKey];

    if (!baseDist) {
      // All tied — carry points, everyone gets 0
      for (const playerId of playerIds) {
        results.push({ roundId, gameId, playerId, holeNumber: holeNum, points: 0 });
      }
      carriedPoints += basePoints;
    } else {
      // Distribute points with carryover scaling
      const totalPool = carriedPoints + basePoints;
      const scaleFactor = totalPool / basePoints;
      const scaledDist = scaleDistribution(baseDist, scaleFactor);

      // Assign points: walk through sorted players and assign from scaledDist
      // Players with the same net score get the same point value (the distribution
      // table already has repeated values for tied positions).
      for (let i = 0; i < sorted.length; i++) {
        results.push({
          roundId,
          gameId,
          playerId: sorted[i].playerId,
          holeNumber: holeNum,
          points: scaledDist[i],
        });
      }
      carriedPoints = 0;
    }
  }

  return results;
}
