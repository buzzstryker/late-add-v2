/**
 * Team Service — pure functions for team pairing generation and lookup.
 *
 * Framework-agnostic (no React imports) so it can be reused by a future
 * REST API layer without modification.
 */

import {
  TeamConfig,
  TeamId,
  TeamPairing,
  TeamPeriod,
  TeamRotation,
  TeamScoringFormat,
} from '../models/Team';

// ─── Pairing Generation ─────────────────────────────────────────────────

/**
 * Generate the 3 unique 2v2 pairings from 4 players for "thirds" rotation.
 *
 * Given players [A, B, C, D], returns:
 *   Pairing 1: [A, B] vs [C, D]
 *   Pairing 2: [A, C] vs [B, D]
 *   Pairing 3: [A, D] vs [B, C]
 *
 * Every player partners with every other player exactly once.
 * Requires exactly 4 player IDs.
 */
export function generateThirdsPairings(playerIds: string[]): TeamPairing[] {
  if (playerIds.length !== 4) {
    throw new Error('Thirds rotation requires exactly 4 players');
  }

  const [a, b, c, d] = playerIds;
  return [
    { teamA: [a, b], teamB: [c, d] },
    { teamA: [a, c], teamB: [b, d] },
    { teamA: [a, d], teamB: [b, c] },
  ];
}

// ─── Config Builder ─────────────────────────────────────────────────────

/**
 * Build a complete TeamConfig for a given rotation, scoring format, and players.
 *
 * - For `thirds`: auto-generates 3 pairings from 4 players; `customPairings` is ignored.
 * - For `full_18`: `customPairings` must have 1 entry.
 * - For `halves`: `customPairings` must have 2 entries (front 9, back 9).
 */
export function buildTeamConfig(
  rotation: TeamRotation,
  scoringFormat: TeamScoringFormat,
  playerIds: string[],
  sharedJunk: boolean = false,
  customPairings?: TeamPairing[],
): TeamConfig {
  let periods: TeamPeriod[];

  switch (rotation) {
    case 'thirds': {
      const pairings = generateThirdsPairings(playerIds);
      periods = [
        { startHole: 1, endHole: 6, pairing: pairings[0] },
        { startHole: 7, endHole: 12, pairing: pairings[1] },
        { startHole: 13, endHole: 18, pairing: pairings[2] },
      ];
      break;
    }

    case 'halves': {
      if (!customPairings || customPairings.length < 2) {
        throw new Error('Halves rotation requires 2 custom pairings (front 9, back 9)');
      }
      periods = [
        { startHole: 1, endHole: 9, pairing: customPairings[0] },
        { startHole: 10, endHole: 18, pairing: customPairings[1] },
      ];
      break;
    }

    case 'full_18': {
      if (!customPairings || customPairings.length < 1) {
        throw new Error('Full 18 rotation requires 1 custom pairing');
      }
      periods = [
        { startHole: 1, endHole: 18, pairing: customPairings[0] },
      ];
      break;
    }

    default:
      throw new Error(`Unknown rotation type: ${rotation}`);
  }

  return { rotation, scoringFormat, periods, sharedJunk };
}

// ─── Lookup Helpers ─────────────────────────────────────────────────────

/**
 * Get the active TeamPairing for a specific hole number.
 * Returns null if the hole falls outside all defined periods.
 */
export function getTeamPairingForHole(
  teamConfig: TeamConfig,
  holeNumber: number,
): TeamPairing | null {
  for (const period of teamConfig.periods) {
    if (holeNumber >= period.startHole && holeNumber <= period.endHole) {
      return period.pairing;
    }
  }
  return null;
}

/**
 * Get the team ID ('A' or 'B') that a specific player belongs to on a given hole.
 * Returns null if the player is not found in the active pairing.
 */
export function getPlayerTeam(
  teamConfig: TeamConfig,
  playerId: string,
  holeNumber: number,
): TeamId | null {
  const pairing = getTeamPairingForHole(teamConfig, holeNumber);
  if (!pairing) return null;

  if (pairing.teamA.includes(playerId)) return 'A';
  if (pairing.teamB.includes(playerId)) return 'B';
  return null;
}

/**
 * Get the teammate IDs for a specific player on a given hole.
 * Returns an empty array if the player is not found in the active pairing.
 * (Does NOT include the player themselves.)
 */
export function getTeammates(
  teamConfig: TeamConfig,
  playerId: string,
  holeNumber: number,
): string[] {
  const pairing = getTeamPairingForHole(teamConfig, holeNumber);
  if (!pairing) return [];

  if (pairing.teamA.includes(playerId)) {
    return pairing.teamA.filter((id) => id !== playerId);
  }
  if (pairing.teamB.includes(playerId)) {
    return pairing.teamB.filter((id) => id !== playerId);
  }
  return [];
}

/**
 * Get the player IDs whose junk/dots should be aggregated for a given player.
 *
 * - If `sharedJunk` is true, returns the player + their teammate(s) on this hole.
 * - If `sharedJunk` is false, returns only the player.
 */
export function getSharedJunkPlayerIds(
  teamConfig: TeamConfig,
  playerId: string,
  holeNumber: number,
): string[] {
  if (!teamConfig.sharedJunk) return [playerId];
  const teammates = getTeammates(teamConfig, playerId, holeNumber);
  return [playerId, ...teammates];
}

/**
 * Get the TeamPeriod that a given hole falls in, including its index.
 * Useful for detecting period boundaries (e.g., "teams changed" notifications).
 */
export function getTeamPeriodForHole(
  teamConfig: TeamConfig,
  holeNumber: number,
): { period: TeamPeriod; index: number } | null {
  for (let i = 0; i < teamConfig.periods.length; i++) {
    const period = teamConfig.periods[i];
    if (holeNumber >= period.startHole && holeNumber <= period.endHole) {
      return { period, index: i };
    }
  }
  return null;
}

/**
 * Check if the given hole is the first hole of a new period (for rotation change UI).
 * Returns true if this hole starts a period that is NOT the first period.
 */
export function isTeamRotationBoundary(
  teamConfig: TeamConfig,
  holeNumber: number,
): boolean {
  for (let i = 1; i < teamConfig.periods.length; i++) {
    if (teamConfig.periods[i].startHole === holeNumber) {
      return true;
    }
  }
  return false;
}
