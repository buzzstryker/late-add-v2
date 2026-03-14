/**
 * Owner Service — framework-agnostic business logic for app owner identity.
 *
 * The "app owner" is the person using this device. They are represented by
 * a single player record in the roster. GHIN credentials and score posting
 * are restricted to this player.
 */

/**
 * Check whether a given player is the app owner.
 */
export function isOwnerPlayer(
  ownerPlayerId: string | null,
  playerId: string,
): boolean {
  return ownerPlayerId !== null && ownerPlayerId === playerId;
}

/**
 * Validate that a player ID is a valid choice for app owner.
 * The player must exist in the current roster.
 */
export function validateOwnerSelection(
  playerId: string,
  allPlayerIds: string[],
): boolean {
  return allPlayerIds.includes(playerId);
}
