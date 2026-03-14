import { RoundType } from '../models/Round';
import { HoleInfo } from '../models/Course';
import { Score } from '../models/Score';

/**
 * Returns the hole range [start, end] (inclusive, 1-based) for a given round type.
 */
export function getHoleRange(roundType: RoundType): { start: number; end: number } {
  switch (roundType) {
    case 'front_9':
      return { start: 1, end: 9 };
    case 'back_9':
      return { start: 10, end: 18 };
    case 'full_18':
    default:
      return { start: 1, end: 18 };
  }
}

/**
 * Filters course holes to only those played in a given round type.
 */
export function getHolesForRoundType(holes: HoleInfo[], roundType: RoundType): HoleInfo[] {
  const { start, end } = getHoleRange(roundType);
  return holes.filter((h) => h.holeNumber >= start && h.holeNumber <= end);
}

/**
 * Split holes into front nine (1-9) and back nine (10-18).
 * Returns only the nines that are part of the round.
 */
export function splitHolesIntoNines(
  holes: HoleInfo[],
  roundType: RoundType
): { label: string; holes: HoleInfo[] }[] {
  const played = getHolesForRoundType(holes, roundType);
  const front = played.filter((h) => h.holeNumber <= 9);
  const back = played.filter((h) => h.holeNumber >= 10);

  const nines: { label: string; holes: HoleInfo[] }[] = [];
  if (front.length > 0) nines.push({ label: 'Out', holes: front });
  if (back.length > 0) nines.push({ label: 'In', holes: back });
  return nines;
}

/**
 * Determine which nine (0 = front, 1 = back) should be visible
 * based on the current hole number.
 *
 * The current hole is the source of truth — if the user navigates
 * to a front-nine hole, show the front nine; if they navigate to
 * a back-nine hole, show the back nine.
 */
export function getActiveNineIndex(
  currentHole: number,
  roundType: RoundType,
  _scores: Score[],
  _playerCount: number
): number {
  if (roundType === 'front_9') return 0;
  if (roundType === 'back_9') return 0; // back_9 only has one nine in the split

  // Full 18: show based on which nine the current hole belongs to
  return currentHole >= 10 ? 1 : 0;
}

/**
 * Sum par for a set of holes.
 */
export function getParTotal(holes: HoleInfo[]): number {
  return holes.reduce((sum, h) => sum + h.par, 0);
}

/**
 * Sum a player's gross scores for a set of hole numbers.
 */
export function getPlayerNineTotal(
  scores: Score[],
  playerId: string,
  holes: HoleInfo[]
): number {
  const holeNumbers = new Set(holes.map((h) => h.holeNumber));
  return scores
    .filter((s) => s.playerId === playerId && holeNumbers.has(s.holeNumber))
    .reduce((sum, s) => sum + s.grossScore, 0);
}
