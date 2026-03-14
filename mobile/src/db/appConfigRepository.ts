import { getDatabase } from './database';

/**
 * Read the app owner's player ID from the single-row app_config table.
 * Returns null if no owner has been set.
 */
export async function getOwnerPlayerId(): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ owner_player_id: string | null }>(
    'SELECT owner_player_id FROM app_config LIMIT 1'
  );
  return row?.owner_player_id ?? null;
}

/**
 * Set the app owner to a given player ID.
 * The app_config table always has exactly one row (seeded by migration 9).
 */
export async function setOwnerPlayerId(playerId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE app_config SET owner_player_id = ?, updated_at = datetime("now") WHERE id = 1',
    playerId,
  );
}

/**
 * Clear the app owner (set to NULL). This will re-trigger the onboarding prompt.
 */
export async function clearOwnerPlayerId(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE app_config SET owner_player_id = NULL, updated_at = datetime("now") WHERE id = 1',
  );
}

// ─── Home Group ──────────────────────────────────────────────────────────

/**
 * Read the home group ID used for displaying season standings on the home screen.
 * Returns null if none has been set.
 */
export async function getHomeGroupId(): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ home_group_id: string | null }>(
    'SELECT home_group_id FROM app_config LIMIT 1',
  );
  return row?.home_group_id ?? null;
}

/**
 * Set the home group ID for the home screen standings display.
 * Pass null to clear.
 */
export async function setHomeGroupId(groupId: string | null): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE app_config SET home_group_id = ?, updated_at = datetime("now") WHERE id = 1',
    groupId,
  );
}
