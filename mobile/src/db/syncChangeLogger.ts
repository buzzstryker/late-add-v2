import { getDatabase } from './database';

export type SyncOperation = 'insert' | 'update' | 'delete';

export interface PendingChange {
  id: number;
  table_name: string;
  row_id: string;
  operation: SyncOperation;
  changed_at: string;
}

/** Log a local change for later sync push. Call after any repo write. */
export async function logChange(
  tableName: string,
  rowId: string,
  operation: SyncOperation,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO sync_change_log (table_name, row_id, operation, changed_at, synced)
     VALUES (?, ?, ?, datetime('now'), 0)`,
    tableName,
    rowId,
    operation,
  );
}

/** Get all pending (un-synced) changes ordered oldest first. */
export async function getPendingChanges(): Promise<PendingChange[]> {
  const db = await getDatabase();
  return db.getAllAsync<PendingChange>(
    `SELECT id, table_name, row_id, operation, changed_at
     FROM sync_change_log
     WHERE synced = 0
     ORDER BY changed_at ASC`,
  );
}

/** Mark changes as synced after successful push. */
export async function markChangesSynced(changeIds: number[]): Promise<void> {
  if (changeIds.length === 0) return;
  const db = await getDatabase();
  const placeholders = changeIds.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE sync_change_log SET synced = 1 WHERE id IN (${placeholders})`,
    ...changeIds,
  );
}

/** Clean up old synced changes to keep the table small. */
export async function purgeOldSyncedChanges(daysOld: number = 30): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `DELETE FROM sync_change_log WHERE synced = 1 AND changed_at < datetime('now', ?)`,
    `-${daysOld} days`,
  );
}
