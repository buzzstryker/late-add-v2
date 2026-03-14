/**
 * Wolf point calculator — pure functions, no React imports.
 *
 * Wolf: rotating player picks a partner (2v2) or goes lone (1v3).
 *
 * Team play (2v2):
 *   One net low from each team determines the winner.
 *   Winning team earns `teamPoints` each. Ties = 0 for all.
 *
 * Lone wolf (1v3):
 *   Points double. Wolf's net vs the best (lowest) net among 3 opponents.
 *   Wolf wins → wolf gets teamPoints × 2 from each of 3 opponents (= teamPoints × 6).
 *   Wolf loses → each opponent gets teamPoints × 2.
 *   Tie → 0 for all.
 */

import { Score } from '../../models/Score';
import { GamePointInput } from '../../models/GamePoint';
import { WolfChoice } from '../../db/wolfChoiceRepository';

/**
 * Calculate Wolf game points for a single hole.
 *
 * @param roundId     - The round ID
 * @param gameId      - The betting game ID
 * @param holeNumber  - The hole being scored
 * @param holeScores  - All player scores for this hole (must include netScore)
 * @param wolfChoice  - The wolf's partner/lone decision for this hole
 * @param teamPoints  - Base point value for team play
 * @returns GamePointInput[] — one entry per player (0 if not all 4 scored yet)
 */
export function calculateWolfHolePoints(
  roundId: string,
  gameId: string,
  holeNumber: number,
  holeScores: Score[],
  wolfChoice: WolfChoice,
  teamPoints: number,
): GamePointInput[] {
  if (holeScores.length === 0) return [];

  // Need exactly 4 scores for a valid calculation
  if (holeScores.length !== 4) {
    return holeScores.map((s) => ({
      roundId,
      gameId,
      playerId: s.playerId,
      holeNumber,
      points: 0,
    }));
  }

  // Build score lookup
  const scoreMap = new Map<string, number>();
  for (const s of holeScores) {
    scoreMap.set(s.playerId, s.netScore);
  }

  // Partition into wolf team vs opponents
  const allPlayerIds = holeScores.map((s) => s.playerId);
  let wolfTeam: string[];
  let opponents: string[];

  if (wolfChoice.isLoneWolf) {
    wolfTeam = [wolfChoice.wolfPlayerId];
    opponents = allPlayerIds.filter((pid) => pid !== wolfChoice.wolfPlayerId);
  } else {
    wolfTeam = [wolfChoice.wolfPlayerId, wolfChoice.partnerId!];
    opponents = allPlayerIds.filter(
      (pid) => pid !== wolfChoice.wolfPlayerId && pid !== wolfChoice.partnerId,
    );
  }

  // One net low from each side
  const wolfLow = Math.min(...wolfTeam.map((pid) => scoreMap.get(pid)!));
  const oppLow = Math.min(...opponents.map((pid) => scoreMap.get(pid)!));

  // Determine winner
  const wolfWins = wolfLow < oppLow;
  const oppWins = oppLow < wolfLow;

  // Distribute points
  const playerPoints = new Map<string, number>();

  if (wolfChoice.isLoneWolf) {
    const lonePoints = teamPoints * 2;
    if (wolfWins) {
      // Wolf collects lonePoints from each of 3 opponents
      playerPoints.set(wolfChoice.wolfPlayerId, lonePoints * opponents.length);
      for (const pid of opponents) playerPoints.set(pid, 0);
    } else if (oppWins) {
      // Each opponent collects lonePoints
      playerPoints.set(wolfChoice.wolfPlayerId, 0);
      for (const pid of opponents) playerPoints.set(pid, lonePoints);
    } else {
      // Tie
      for (const s of holeScores) playerPoints.set(s.playerId, 0);
    }
  } else {
    // Team play (2v2)
    if (wolfWins) {
      for (const pid of wolfTeam) playerPoints.set(pid, teamPoints);
      for (const pid of opponents) playerPoints.set(pid, 0);
    } else if (oppWins) {
      for (const pid of wolfTeam) playerPoints.set(pid, 0);
      for (const pid of opponents) playerPoints.set(pid, teamPoints);
    } else {
      // Tie
      for (const s of holeScores) playerPoints.set(s.playerId, 0);
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

/**
 * Get the teammate IDs for shared junk in a wolf game.
 *
 * - 2v2: wolf's partner gets the wolf's junk and vice versa; opponents share with each other.
 * - Lone wolf: wolf has no teammate; the 3 opponents share with each other.
 * - Returns teammate IDs (NOT including the player themselves).
 */
export function getWolfJunkTeammateIds(
  wolfChoice: WolfChoice,
  playerId: string,
  allPlayerIds: string[],
): string[] {
  const wolfId = wolfChoice.wolfPlayerId;

  if (wolfChoice.isLoneWolf) {
    // Wolf has no teammates; opponents share with each other
    if (playerId === wolfId) return [];
    // This player is an opponent — their teammates are the other 2 opponents
    return allPlayerIds.filter((pid) => pid !== wolfId && pid !== playerId);
  }

  // 2v2: wolf + partner vs opponents
  const partnerId = wolfChoice.partnerId!;
  const wolfTeam = [wolfId, partnerId];
  const opponents = allPlayerIds.filter((pid) => !wolfTeam.includes(pid));

  if (wolfTeam.includes(playerId)) {
    // Player is on wolf team — teammate is the other wolf team member
    return wolfTeam.filter((pid) => pid !== playerId);
  }
  // Player is an opponent — teammate is the other opponent
  return opponents.filter((pid) => pid !== playerId);
}
