import { TeeBox, HoleInfo } from '../models/Course';
import { HandicapMode } from '../models/Round';

/**
 * Calculate Course Handicap from a player's Handicap Index and tee box data.
 *
 * Formula: Course Handicap = Handicap Index × (Slope Rating / 113) + (Course Rating − Par)
 * Result is rounded to nearest integer.
 *
 * Examples from requirements:
 *   Index 16.9, Slope 131, Rating 70.9, Par 72 → 18
 *   Index 16.9, Slope 141, Rating 72.1, Par 72 → 21
 *   Index 16.9, Slope 126, Rating 68.5, Par 72 → 15
 */
export function calculateCourseHandicap(
  handicapIndex: number,
  slopeRating: number,
  courseRating: number,
  par: number
): number {
  const raw = handicapIndex * (slopeRating / 113) + (courseRating - par);
  return Math.round(raw) || 0; // Normalize -0 to 0
}

/**
 * Calculate Course Handicap from a player's Handicap Index and a TeeBox object.
 */
export function getCourseHandicap(handicapIndex: number, teeBox: TeeBox): number {
  return calculateCourseHandicap(
    handicapIndex,
    teeBox.slopeRating,
    teeBox.courseRating,
    teeBox.par
  );
}

/**
 * Calculate each player's playing handicap based on the chosen mode.
 *
 * 'full' — each player uses their full course handicap for stroke allocation.
 * 'spin_off_low' — strokes are relative to the lowest course handicap in the group.
 */
export function calculatePlayingHandicaps(
  playerHandicaps: { playerId: string; courseHandicap: number }[],
  mode: HandicapMode = 'full'
): { playerId: string; courseHandicap: number; playingHandicap: number; strokesReceived: number }[] {
  if (playerHandicaps.length === 0) return [];

  if (mode === 'spin_off_low') {
    const lowestCH = Math.min(...playerHandicaps.map((p) => p.courseHandicap));
    return playerHandicaps.map((p) => ({
      playerId: p.playerId,
      courseHandicap: p.courseHandicap,
      playingHandicap: p.courseHandicap - lowestCH,
      strokesReceived: p.courseHandicap - lowestCH,
    }));
  }

  // Full handicap: each player uses their full course handicap
  return playerHandicaps.map((p) => ({
    playerId: p.playerId,
    courseHandicap: p.courseHandicap,
    playingHandicap: p.courseHandicap,
    strokesReceived: p.courseHandicap,
  }));
}

/**
 * Determine if a player receives a stroke on a given hole.
 *
 * A player receives a stroke on a hole if their playing handicap (strokes received)
 * is >= the hole's stroke index.
 *
 * For playing handicaps > 18 (rare but possible), the player gets:
 *   - 1 stroke on ALL holes, plus
 *   - 1 additional stroke on holes with stroke index <= (playingHandicap - 18)
 */
export function getStrokesOnHole(playingHandicap: number, holeStrokeIndex: number): number {
  if (playingHandicap <= 0) return 0;

  if (playingHandicap <= 18) {
    return playingHandicap >= holeStrokeIndex ? 1 : 0;
  }

  // More than 18 strokes: everyone gets 1 + extra on lowest stroke index holes
  const extraStrokes = playingHandicap - 18;
  return extraStrokes >= holeStrokeIndex ? 2 : 1;
}

/**
 * Calculate net score for a hole given gross score and stroke allocation.
 */
export function calculateNetScore(grossScore: number, playingHandicap: number, holeStrokeIndex: number): number {
  return grossScore - getStrokesOnHole(playingHandicap, holeStrokeIndex);
}

/**
 * Build a full stroke allocation table for a player across all holes.
 * Returns an array indexed by hole number (1-based, index 0 unused).
 */
export function buildStrokeAllocation(
  playingHandicap: number,
  holes: HoleInfo[]
): number[] {
  const allocation: number[] = [0]; // Index 0 is unused
  const sorted = [...holes].sort((a, b) => a.holeNumber - b.holeNumber);
  for (const hole of sorted) {
    allocation.push(getStrokesOnHole(playingHandicap, hole.strokeIndex));
  }
  return allocation;
}

/**
 * Maximum gross score allowed on a hole under the World Handicap System.
 * Net Double Bogey = Par + 2 + strokes received on the hole.
 */
export function getNetDoubleBogey(par: number, strokesOnHole: number): number {
  return par + 2 + strokesOnHole;
}

/**
 * Score relative to par label (e.g., -2 = "Eagle", -1 = "Birdie", etc.)
 */
export function getScoreLabel(grossScore: number, par: number): string {
  if (grossScore === 1) return 'HN1';
  const diff = grossScore - par;
  switch (diff) {
    case -3: return 'Albatross';
    case -2: return 'Eagle';
    case -1: return 'Birdie';
    case 0: return 'Par';
    case 1: return 'Bogey';
    case 2: return 'Double Bogey';
    case 3: return 'Triple Bogey';
    default:
      if (diff < -3) return `${Math.abs(diff)} Under`;
      return `+${diff}`;
  }
}

/**
 * Color coding for score relative to par.
 * Returns a color string for UI display.
 */
export function getScoreColor(grossScore: number, par: number): string {
  const diff = grossScore - par;
  if (diff <= -2) return '#FFD700'; // Gold — eagle or better
  if (diff === -1) return '#E74C3C'; // Red — birdie
  if (diff === 0) return '#FFFFFF'; // White — par
  if (diff === 1) return '#3498DB'; // Blue — bogey
  if (diff === 2) return '#2C3E50'; // Dark blue — double bogey
  return '#1A1A2E'; // Very dark — triple+ bogey
}
