/**
 * Sync Service — Push/pull engine for Supabase cloud sync.
 *
 * Framework-agnostic (no React). Handles bidirectional sync between
 * local SQLite and Supabase Postgres.
 *
 * Strategy: change-log based push + timestamp-based pull.
 * Conflict resolution: last-write-wins using updated_at.
 */

import { InteractionManager } from 'react-native';
import { supabase } from './supabaseClient';
import { getDatabase } from '../db/database';
import {
  getPendingChanges,
  markChangesSynced,
  purgeOldSyncedChanges,
  type PendingChange,
} from '../db/syncChangeLogger';

// ─── Types ──────────────────────────────────────────────────────────

export interface SyncResult {
  pushed: number;
  pulled: number;
  errors: number;
}

interface SyncMeta {
  last_push_at: string | null;
  last_pull_at: string | null;
  supabase_user_id: string | null;
}

interface SyncTableConfig {
  /** SQLite/Postgres table name */
  name: string;
  /** Primary key column(s) — for composite keys, these are the SQLite column names */
  pkColumns: string[];
  /** Whether the table has an updated_at column (for incremental pull) */
  hasUpdatedAt: boolean;
}

// ─── Table config — ordered by dependency (parents first) ───────────

const SYNC_TABLES: SyncTableConfig[] = [
  { name: 'players', pkColumns: ['id'], hasUpdatedAt: true },
  { name: 'courses', pkColumns: ['id'], hasUpdatedAt: true },
  { name: 'tee_boxes', pkColumns: ['id'], hasUpdatedAt: false },
  { name: 'holes', pkColumns: ['course_id', 'hole_number'], hasUpdatedAt: false },
  { name: 'hole_yardages', pkColumns: ['course_id', 'hole_number', 'tee_box_name'], hasUpdatedAt: false },
  { name: 'sections', pkColumns: ['id'], hasUpdatedAt: true },
  { name: 'groups', pkColumns: ['id'], hasUpdatedAt: true },
  { name: 'group_members', pkColumns: ['id'], hasUpdatedAt: false },
  { name: 'seasons', pkColumns: ['id'], hasUpdatedAt: true },
  { name: 'rounds', pkColumns: ['id'], hasUpdatedAt: true },
  { name: 'round_players', pkColumns: ['round_id', 'player_id'], hasUpdatedAt: false },
  { name: 'betting_games', pkColumns: ['id'], hasUpdatedAt: false },
  { name: 'scores', pkColumns: ['id'], hasUpdatedAt: true },
  { name: 'game_points', pkColumns: ['id'], hasUpdatedAt: true },
  { name: 'wolf_choices', pkColumns: ['id'], hasUpdatedAt: true },
  { name: 'league_rounds', pkColumns: ['id'], hasUpdatedAt: true },
  { name: 'league_scores', pkColumns: ['id'], hasUpdatedAt: true },
  { name: 'payout_config', pkColumns: ['id'], hasUpdatedAt: false },
];

// ─── UI yield helper ─────────────────────────────────────────────────
// InteractionManager.runAfterInteractions() is React Native's built-in
// mechanism for deferring work until all pending touch & animation
// interactions have finished. Unlike setTimeout (which just delays on
// the same JS queue), this actually waits for the native run-loop to
// drain its event queue. We add a small setTimeout(50) after that to
// guarantee at least ~3 frames of breathing room at 60fps.
//
// Previous setTimeout-only approaches (0ms, 16ms, 50ms, 100ms) still
// froze iPad tabs because the JS thread never truly yielded to native.
//
// NOTE: This uses InteractionManager from react-native. Although the
// service is otherwise framework-agnostic, this is a necessary
// pragmatic exception — setTimeout alone cannot prevent UI starvation
// on iPad.

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => {
    InteractionManager.runAfterInteractions(() => {
      setTimeout(resolve, 50);
    });
  });
}

// ─── Sync Meta ──────────────────────────────────────────────────────

async function getSyncMeta(): Promise<SyncMeta> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<SyncMeta>(
    'SELECT last_push_at, last_pull_at, supabase_user_id FROM sync_meta WHERE id = 1',
  );
  return row ?? { last_push_at: null, last_pull_at: null, supabase_user_id: null };
}

async function updateSyncMeta(updates: Partial<SyncMeta>): Promise<void> {
  const db = await getDatabase();
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.last_push_at !== undefined) { fields.push('last_push_at = ?'); values.push(updates.last_push_at); }
  if (updates.last_pull_at !== undefined) { fields.push('last_pull_at = ?'); values.push(updates.last_pull_at); }
  if (updates.supabase_user_id !== undefined) { fields.push('supabase_user_id = ?'); values.push(updates.supabase_user_id); }
  if (fields.length === 0) return;
  await db.runAsync(`UPDATE sync_meta SET ${fields.join(', ')} WHERE id = 1`, ...values);
}

export async function getSyncUserId(): Promise<string | null> {
  const meta = await getSyncMeta();
  return meta.supabase_user_id;
}

/** Reset sync metadata so initial sync will re-run. */
export async function resetSyncMeta(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE sync_meta SET last_push_at = NULL, last_pull_at = NULL, supabase_user_id = NULL WHERE id = 1');
}

// ─── Push (local → cloud) ──────────────────────────────────────────

export async function pushChanges(userId: string): Promise<number> {
  const pending = await getPendingChanges();
  if (pending.length === 0) return 0;

  const db = await getDatabase();
  const syncedIds: number[] = [];

  // Group by table
  const byTable = new Map<string, PendingChange[]>();
  for (const change of pending) {
    const list = byTable.get(change.table_name) ?? [];
    list.push(change);
    byTable.set(change.table_name, list);
  }

  // Iterate in SYNC_TABLES dependency order (parents first) so FK constraints
  // are satisfied in Supabase. The byTable map preserves change-log insertion
  // order which may have children before parents.
  for (const config of SYNC_TABLES) {
    const changes = byTable.get(config.name);
    if (!changes || changes.length === 0) continue;

    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      try {
        if (change.operation === 'delete') {
          await pushDelete(config, change.row_id, userId);
        } else {
          await pushUpsert(db, config, change.row_id, userId);
        }
        syncedIds.push(change.id);
      } catch (err) {
        console.warn(`Sync push failed for ${config.name}/${change.row_id}:`, err);
      }

      // Yield to UI every 5 changes so iPad touch events aren't blocked
      if ((i + 1) % 5 === 0) await yieldToUI();
    }

    // Yield between tables
    await yieldToUI();
  }

  // Mark unknown-table changes as synced so they don't accumulate
  const knownTableNames = new Set(SYNC_TABLES.map((t) => t.name));
  for (const [tableName, changes] of byTable) {
    if (!knownTableNames.has(tableName)) {
      syncedIds.push(...changes.map((c) => c.id));
    }
  }

  await markChangesSynced(syncedIds);
  await updateSyncMeta({ last_push_at: new Date().toISOString() });
  return syncedIds.length;
}

async function pushDelete(
  config: SyncTableConfig,
  rowId: string,
  userId: string,
): Promise<void> {
  const match = buildPkMatch(config, rowId);
  // Soft-delete: set deleted_at in cloud
  const { error } = await supabase
    .from(config.name)
    .update({ deleted_at: new Date().toISOString() })
    .match({ ...match, user_id: userId });

  // If row doesn't exist in cloud yet, that's fine
  if (error && !error.message.includes('0 rows')) {
    throw error;
  }
}

async function pushUpsert(
  db: Awaited<ReturnType<typeof getDatabase>>,
  config: SyncTableConfig,
  rowId: string,
  userId: string,
): Promise<void> {
  // Read current row from local SQLite
  const localRow = await readLocalRow(db, config, rowId);
  if (!localRow) return; // Row deleted locally after change was logged

  const cloudRow = { ...localRow, user_id: userId, deleted_at: null };
  const { error } = await supabase
    .from(config.name)
    .upsert(cloudRow, { onConflict: config.pkColumns.join(',') });

  if (error) throw error;
}

// ─── Pull (cloud → local) ──────────────────────────────────────────

export async function pullChanges(userId: string): Promise<number> {
  const db = await getDatabase();
  const meta = await getSyncMeta();
  let totalPulled = 0;

  // Disable FK constraints during pull so child rows can be inserted
  // before their parent rows (tables are pulled in dependency order,
  // but the parent row may already exist locally while a new child
  // references a parent from another table not yet pulled).
  await db.runAsync('PRAGMA foreign_keys = OFF');

  try {
    for (const config of SYNC_TABLES) {
      try {
        // Yield before each Supabase network call so touches are never blocked
        // waiting for a query to begin.
        await yieldToUI();

        let query = supabase
          .from(config.name)
          .select('*')
          .eq('user_id', userId);

        // Incremental pull for tables with updated_at
        if (meta.last_pull_at && config.hasUpdatedAt) {
          query = query.gt('updated_at', meta.last_pull_at);
        }

        const { data, error } = await query;
        if (error) {
          console.warn(`[SYNC] Pull query failed for ${config.name}:`, error.message);
          continue;
        }
        if (!data || data.length === 0) continue;

        let tableCount = 0;
        for (let i = 0; i < data.length; i++) {
          const cloudRow = data[i];
          // Handle soft deletes
          if (cloudRow.deleted_at) {
            await deleteLocalRow(db, config, cloudRow);
            tableCount++;
            totalPulled++;
          } else {
            // Upsert into local SQLite (bypass repo to avoid re-logging to change log)
            await upsertLocalRow(db, config, cloudRow);
            tableCount++;
            totalPulled++;
          }

          // Yield to UI every 5 rows so touch events can be processed.
          // On iPad the native run-loop needs generous breathing room.
          if ((i + 1) % 5 === 0) await yieldToUI();
        }
        console.log(`[SYNC] Pulled ${tableCount} rows for ${config.name}`);
      } catch (err) {
        console.warn(`[SYNC] Pull error for ${config.name}:`, err);
      }

      // Yield between tables
      await yieldToUI();
    }
  } finally {
    // Always re-enable FK constraints
    await db.runAsync('PRAGMA foreign_keys = ON');
  }

  await updateSyncMeta({ last_pull_at: new Date().toISOString() });
  return totalPulled;
}

// ─── Initial Sync (first time) ─────────────────────────────────────

export async function performInitialSync(userId: string): Promise<SyncResult> {
  const db = await getDatabase();
  let pushed = 0;
  let errors = 0;

  // Push ALL local data to cloud
  for (const config of SYNC_TABLES) {
    try {
      const rows = await db.getAllAsync<Record<string, any>>(`SELECT * FROM ${config.name}`);
      console.log(`[SYNC] Pushing ${config.name}: ${rows.length} rows`);

      if (rows.length === 0) continue;

      // Batch upsert in chunks of 20 (smaller to avoid starving UI thread)
      for (let i = 0; i < rows.length; i += 20) {
        const chunk = rows.slice(i, i + 20).map((row) => ({
          ...row,
          user_id: userId,
          deleted_at: null,
        }));

        const { error } = await supabase
          .from(config.name)
          .upsert(chunk, { onConflict: config.pkColumns.join(',') });

        if (error) {
          console.error(`[SYNC] ❌ Push FAILED for ${config.name}: ${error.message} | code: ${error.code} | details: ${error.details}`);
          errors += chunk.length;
        } else {
          console.log(`[SYNC] ✓ Pushed ${chunk.length} rows to ${config.name}`);
          pushed += chunk.length;
        }

        // Yield to UI between push batches so touch events can process
        await yieldToUI();
      }
    } catch (err: any) {
      console.error(`[SYNC] ❌ Exception for ${config.name}:`, err?.message ?? err);
    }

    // Yield between tables
    await yieldToUI();
  }

  // Verify cloud row counts match local (detect duplication)
  for (const config of SYNC_TABLES) {
    const localCount = await db.getFirstAsync<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM ${config.name}`,
    );
    const { count: cloudCount, error: countErr } = await supabase
      .from(config.name)
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('deleted_at', null);
    if (!countErr && cloudCount !== null && localCount) {
      if (cloudCount !== localCount.cnt) {
        console.warn(`[SYNC] ⚠️ COUNT MISMATCH ${config.name}: local=${localCount.cnt} cloud=${cloudCount}`);
      }
    }

    // Yield between count checks
    await yieldToUI();
  }

  // Yield before heavy pull phase
  await yieldToUI();

  // Pull any cloud data (from other devices)
  const pulled = await pullChanges(userId);

  // Mark all existing change log entries as synced
  const allPending = await getPendingChanges();
  await markChangesSynced(allPending.map((c) => c.id));

  // Update sync metadata
  await updateSyncMeta({
    last_push_at: new Date().toISOString(),
    last_pull_at: new Date().toISOString(),
    supabase_user_id: userId,
  });

  // Housekeeping
  await purgeOldSyncedChanges();

  console.log(`[SYNC] ✅ Initial sync complete: pushed=${pushed}, pulled=${pulled}, errors=${errors}`);
  return { pushed, pulled, errors };
}

// ─── Full sync (push + pull) ───────────────────────────────────────

export async function fullSync(userId: string): Promise<SyncResult> {
  const pushed = await pushChanges(userId);
  await yieldToUI(); // Breathe between push and pull phases
  const pulled = await pullChanges(userId);
  await yieldToUI();
  await purgeOldSyncedChanges();
  return { pushed, pulled, errors: 0 };
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Build a PK match object from the composite row_id string.
 * Single PK: rowId = "abc123"
 * Composite PK: rowId = "abc123:4" (colon separated)
 */
function buildPkMatch(
  config: SyncTableConfig,
  rowId: string,
): Record<string, any> {
  const parts = rowId.split(':');
  const match: Record<string, any> = {};
  for (let i = 0; i < config.pkColumns.length; i++) {
    match[config.pkColumns[i]] = parts[i] ?? rowId;
  }
  return match;
}

/** Read a single row from local SQLite by PK. */
async function readLocalRow(
  db: Awaited<ReturnType<typeof getDatabase>>,
  config: SyncTableConfig,
  rowId: string,
): Promise<Record<string, any> | null> {
  const match = buildPkMatch(config, rowId);
  const whereClauses = Object.keys(match).map((col) => `${col} = ?`);
  const values = Object.values(match);

  return db.getFirstAsync<Record<string, any>>(
    `SELECT * FROM ${config.name} WHERE ${whereClauses.join(' AND ')}`,
    ...values,
  );
}

/** Upsert a cloud row into local SQLite (bypass repo layer). */
async function upsertLocalRow(
  db: Awaited<ReturnType<typeof getDatabase>>,
  config: SyncTableConfig,
  cloudRow: Record<string, any>,
): Promise<void> {
  // Remove cloud-only columns
  const { user_id, deleted_at, ...localRow } = cloudRow;

  const columns = Object.keys(localRow);
  const placeholders = columns.map(() => '?').join(', ');
  const values = columns.map((col) => localRow[col]);

  // Build ON CONFLICT clause
  const pkCols = config.pkColumns.join(', ');
  const updateCols = columns
    .filter((col) => !config.pkColumns.includes(col))
    .map((col) => `${col} = excluded.${col}`)
    .join(', ');

  if (updateCols) {
    await db.runAsync(
      `INSERT INTO ${config.name} (${columns.join(', ')})
       VALUES (${placeholders})
       ON CONFLICT(${pkCols}) DO UPDATE SET ${updateCols}`,
      ...values,
    );
  } else {
    await db.runAsync(
      `INSERT OR IGNORE INTO ${config.name} (${columns.join(', ')})
       VALUES (${placeholders})`,
      ...values,
    );
  }
}

/** Delete a local row based on cloud soft-delete. */
async function deleteLocalRow(
  db: Awaited<ReturnType<typeof getDatabase>>,
  config: SyncTableConfig,
  cloudRow: Record<string, any>,
): Promise<void> {
  const whereClauses = config.pkColumns.map((col) => `${col} = ?`);
  const values = config.pkColumns.map((col) => cloudRow[col]);

  await db.runAsync(
    `DELETE FROM ${config.name} WHERE ${whereClauses.join(' AND ')}`,
    ...values,
  );
}

// ─── One-time cleanup: remove duplicate groups from Glide multi-import ──

export async function cleanupDuplicates(userId: string): Promise<{ groupsRemoved: number; sectionsRemoved: number }> {
  const db = await getDatabase();
  let groupsRemoved = 0;
  let sectionsRemoved = 0;

  // --- Deduplicate sections first (groups reference sections) ---
  const dupeSections = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sections GROUP BY name HAVING COUNT(*) > 1`,
  );
  for (const { name } of dupeSections) {
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM sections WHERE name = ? ORDER BY created_at ASC`, name,
    );
    const keepId = rows[0].id;
    for (let i = 1; i < rows.length; i++) {
      const dupeId = rows[i].id;
      // Re-point groups to the kept section (local + cloud)
      await db.runAsync('UPDATE groups SET section_id = ? WHERE section_id = ?', keepId, dupeId);
      await supabase.from('groups').update({ section_id: keepId }).eq('section_id', dupeId).eq('user_id', userId);
      // Delete the dupe section
      await supabase.from('sections').delete().eq('id', dupeId).eq('user_id', userId);
      await db.runAsync('DELETE FROM sections WHERE id = ?', dupeId);
      sectionsRemoved++;
      console.log(`[CLEANUP] Removed duplicate section "${name}" (${dupeId})`);
    }
  }

  // --- Deduplicate groups ---
  const dupeGroups = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM groups GROUP BY name HAVING COUNT(*) > 1`,
  );
  for (const { name } of dupeGroups) {
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM groups WHERE name = ? ORDER BY created_at ASC`, name,
    );
    const keepId = rows[0].id;
    for (let i = 1; i < rows.length; i++) {
      const dupeId = rows[i].id;

      // Delete children in dependency order (local)
      // league_scores → league_rounds → seasons → group_members → payout_config → group
      await db.runAsync(
        'DELETE FROM league_scores WHERE league_round_id IN (SELECT id FROM league_rounds WHERE group_id = ?)', dupeId,
      );
      await db.runAsync('DELETE FROM league_rounds WHERE group_id = ?', dupeId);
      await db.runAsync('DELETE FROM seasons WHERE group_id = ?', dupeId);
      await db.runAsync('DELETE FROM group_members WHERE group_id = ?', dupeId);
      await db.runAsync('DELETE FROM payout_config WHERE group_id = ?', dupeId);
      await db.runAsync('DELETE FROM groups WHERE id = ?', dupeId);

      // Delete from Supabase (CASCADE handles children in Postgres)
      await supabase.from('groups').delete().eq('id', dupeId).eq('user_id', userId);

      groupsRemoved++;
      console.log(`[CLEANUP] Removed duplicate group "${name}" (${dupeId}), kept ${keepId}`);
    }
  }

  console.log(`[CLEANUP] Done: removed ${groupsRemoved} groups, ${sectionsRemoved} sections`);
  return { groupsRemoved, sectionsRemoved };
}
