import { getDatabase, generateId } from './database';
import { logChange } from './syncChangeLogger';
import { Player, PlayerCreateInput } from '../models/Player';

export async function getAllPlayers(): Promise<Player[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM players ORDER BY first_name, last_name'
  );
  return rows.map(mapRowToPlayer);
}

export async function getPlayerById(id: string): Promise<Player | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>(
    'SELECT * FROM players WHERE id = ?',
    id
  );
  return row ? mapRowToPlayer(row) : null;
}

export async function createPlayer(input: PlayerCreateInput): Promise<Player> {
  const db = await getDatabase();
  const id = generateId();
  const now = new Date().toISOString();

  await db.runAsync(
    `INSERT INTO players (id, first_name, last_name, nickname, gender, handicap_index, ghin_number, email, phone, venmo_handle, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.firstName,
    input.lastName,
    input.nickname ?? null,
    input.gender,
    input.handicapIndex,
    input.ghinNumber ?? null,
    input.email ?? null,
    input.phone ?? null,
    input.venmoHandle ?? null,
    now,
    now
  );

  logChange('players', id, 'insert').catch(() => {});
  return (await getPlayerById(id))!;
}

export async function updatePlayer(
  id: string,
  updates: Partial<PlayerCreateInput>
): Promise<Player | null> {
  const db = await getDatabase();
  const existing = await getPlayerById(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: any[] = [];

  if (updates.firstName !== undefined) {
    fields.push('first_name = ?');
    values.push(updates.firstName);
  }
  if (updates.lastName !== undefined) {
    fields.push('last_name = ?');
    values.push(updates.lastName);
  }
  if (updates.nickname !== undefined) {
    fields.push('nickname = ?');
    values.push(updates.nickname);
  }
  if (updates.handicapIndex !== undefined) {
    fields.push('handicap_index = ?');
    values.push(updates.handicapIndex);
  }
  if (updates.ghinNumber !== undefined) {
    fields.push('ghin_number = ?');
    values.push(updates.ghinNumber);
  }
  if (updates.email !== undefined) {
    fields.push('email = ?');
    values.push(updates.email);
  }
  if (updates.gender !== undefined) {
    fields.push('gender = ?');
    values.push(updates.gender);
  }
  if (updates.phone !== undefined) {
    fields.push('phone = ?');
    values.push(updates.phone);
  }
  if (updates.venmoHandle !== undefined) {
    fields.push('venmo_handle = ?');
    values.push(updates.venmoHandle);
  }

  if (fields.length === 0) return existing;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await db.runAsync(
    `UPDATE players SET ${fields.join(', ')} WHERE id = ?`,
    ...values
  );

  logChange('players', id, 'update').catch(() => {});
  return (await getPlayerById(id))!;
}

export async function deletePlayer(id: string): Promise<boolean> {
  const db = await getDatabase();
  const result = await db.runAsync('DELETE FROM players WHERE id = ?', id);
  if (result.changes > 0) logChange('players', id, 'delete').catch(() => {});
  return result.changes > 0;
}

function mapRowToPlayer(row: any): Player {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    nickname: row.nickname,
    gender: row.gender || 'M',
    handicapIndex: row.handicap_index,
    ghinNumber: row.ghin_number,
    email: row.email,
    phone: row.phone,
    venmoHandle: row.venmo_handle,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
