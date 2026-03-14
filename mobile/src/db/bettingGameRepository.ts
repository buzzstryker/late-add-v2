import { getDatabase, generateId } from './database';
import { logChange } from './syncChangeLogger';
import { BettingGame, BettingGameCreateInput } from '../models/BettingGame';

function mapRowToBettingGame(row: any): BettingGame {
  return {
    id: row.id,
    roundId: row.round_id,
    type: row.type,
    name: row.name,
    stakes: row.stakes,
    useNetScores: row.use_net_scores === 1,
    config: row.config ? JSON.parse(row.config) : {},
    createdAt: row.created_at,
  };
}

export async function createBettingGame(input: BettingGameCreateInput): Promise<BettingGame> {
  const db = await getDatabase();
  const id = generateId();
  const now = new Date().toISOString();

  await db.runAsync(
    `INSERT INTO betting_games (id, round_id, type, name, stakes, use_net_scores, config, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.roundId,
    input.type,
    input.name,
    input.stakes ?? 0,
    (input.useNetScores ?? true) ? 1 : 0,
    JSON.stringify(input.config ?? {}),
    now,
  );

  logChange('betting_games', id, 'insert').catch(() => {});
  const row = await db.getFirstAsync<any>('SELECT * FROM betting_games WHERE id = ?', id);
  return mapRowToBettingGame(row);
}

export async function getBettingGamesForRound(roundId: string): Promise<BettingGame[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM betting_games WHERE round_id = ? ORDER BY created_at',
    roundId,
  );
  return rows.map(mapRowToBettingGame);
}

export async function getBettingGameById(id: string): Promise<BettingGame | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>('SELECT * FROM betting_games WHERE id = ?', id);
  return row ? mapRowToBettingGame(row) : null;
}

export async function deleteBettingGame(id: string): Promise<boolean> {
  const db = await getDatabase();
  const result = await db.runAsync('DELETE FROM betting_games WHERE id = ?', id);
  if (result.changes > 0) logChange('betting_games', id, 'delete').catch(() => {});
  return result.changes > 0;
}

export async function deleteAllBettingGamesForRound(roundId: string): Promise<void> {
  const db = await getDatabase();
  const games = await db.getAllAsync<{ id: string }>('SELECT id FROM betting_games WHERE round_id = ?', roundId);
  await db.runAsync('DELETE FROM betting_games WHERE round_id = ?', roundId);
  for (const game of games) {
    logChange('betting_games', game.id, 'delete').catch(() => {});
  }
}
