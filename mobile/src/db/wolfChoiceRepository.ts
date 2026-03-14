/**
 * Wolf Choice Repository — CRUD for wolf partner/lone decisions per hole.
 *
 * Each wolf game stores one choice per hole: who the wolf picked as a partner,
 * or whether they went lone wolf.
 */

import { getDatabase, generateId } from './database';
import { logChange } from './syncChangeLogger';

// ─── Types ───────────────────────────────────────────────────────────────

export interface WolfChoice {
  id: string;
  roundId: string;
  gameId: string;
  holeNumber: number;
  wolfPlayerId: string;
  partnerId: string | null; // null = lone wolf
  isLoneWolf: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WolfChoiceInput {
  roundId: string;
  gameId: string;
  holeNumber: number;
  wolfPlayerId: string;
  partnerId: string | null; // null = lone wolf
}

// ─── Row mapping ─────────────────────────────────────────────────────────

function rowToWolfChoice(row: Record<string, unknown>): WolfChoice {
  return {
    id: row.id as string,
    roundId: row.round_id as string,
    gameId: row.game_id as string,
    holeNumber: row.hole_number as number,
    wolfPlayerId: row.wolf_player_id as string,
    partnerId: (row.partner_id as string) ?? null,
    isLoneWolf: row.is_lone_wolf === 1,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────

/**
 * Insert or update the wolf choice for a specific hole.
 * Unique key: (round_id, game_id, hole_number).
 */
export async function upsertWolfChoice(input: WolfChoiceInput): Promise<WolfChoice> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const id = generateId();
  const isLoneWolf = input.partnerId === null ? 1 : 0;

  await db.runAsync(
    `INSERT INTO wolf_choices (id, round_id, game_id, hole_number, wolf_player_id, partner_id, is_lone_wolf, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(round_id, game_id, hole_number) DO UPDATE SET
       wolf_player_id = excluded.wolf_player_id,
       partner_id = excluded.partner_id,
       is_lone_wolf = excluded.is_lone_wolf,
       updated_at = excluded.updated_at`,
    id, input.roundId, input.gameId, input.holeNumber,
    input.wolfPlayerId, input.partnerId, isLoneWolf, now, now,
  );

  // Re-read the row (might be the inserted or the updated one)
  const choice = await getWolfChoice(input.roundId, input.gameId, input.holeNumber);
  if (!choice) throw new Error('Failed to upsert wolf choice');
  logChange('wolf_choices', choice.id, 'update').catch(() => {});
  return choice;
}

/**
 * Get the wolf choice for a specific hole.
 */
export async function getWolfChoice(
  roundId: string,
  gameId: string,
  holeNumber: number,
): Promise<WolfChoice | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM wolf_choices WHERE round_id = ? AND game_id = ? AND hole_number = ?',
    roundId, gameId, holeNumber,
  );
  if (!row) return null;
  return rowToWolfChoice(row);
}

/**
 * Get all wolf choices for a round/game, ordered by hole number.
 */
export async function getWolfChoicesForRound(
  roundId: string,
  gameId: string,
): Promise<WolfChoice[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM wolf_choices WHERE round_id = ? AND game_id = ? ORDER BY hole_number',
    roundId, gameId,
  );
  return rows.map(rowToWolfChoice);
}
