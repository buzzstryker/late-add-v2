import { getDatabase, generateId } from './database';
import { logChange } from './syncChangeLogger';
import {
  Section,
  SectionCreateInput,
  Group,
  GroupCreateInput,
  GroupMember,
  GroupMemberRole,
  GroupMemberCreateInput,
  Season,
  SeasonCreateInput,
  LeagueRound,
  LeagueRoundCreateInput,
  LeagueScore,
  LeagueScoreCreateInput,
  PayoutTier,
  PayoutTierCreateInput,
} from '../models/League';

// ────────────────────────────────────────────────────────────
//  Sections
// ────────────────────────────────────────────────────────────

export async function getAllSections(): Promise<Section[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>('SELECT * FROM sections ORDER BY name');
  return rows.map(mapRowToSection);
}

export async function getSectionById(id: string): Promise<Section | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>('SELECT * FROM sections WHERE id = ?', id);
  return row ? mapRowToSection(row) : null;
}

export async function createSection(input: SectionCreateInput): Promise<Section> {
  const db = await getDatabase();
  const id = generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    'INSERT INTO sections (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    id,
    input.name,
    now,
    now,
  );
  logChange('sections', id, 'insert').catch(() => {});
  return (await getSectionById(id))!;
}

export async function updateSection(
  id: string,
  updates: Partial<SectionCreateInput>,
): Promise<Section | null> {
  const db = await getDatabase();
  const existing = await getSectionById(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }

  if (fields.length === 0) return existing;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await db.runAsync(`UPDATE sections SET ${fields.join(', ')} WHERE id = ?`, ...values);
  logChange('sections', id, 'update').catch(() => {});
  return (await getSectionById(id))!;
}

export async function deleteSection(id: string): Promise<boolean> {
  const db = await getDatabase();
  const result = await db.runAsync('DELETE FROM sections WHERE id = ?', id);
  if (result.changes > 0) logChange('sections', id, 'delete').catch(() => {});
  return result.changes > 0;
}

function mapRowToSection(row: any): Section {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ────────────────────────────────────────────────────────────
//  Groups
// ────────────────────────────────────────────────────────────

export async function getAllGroups(): Promise<Group[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>('SELECT * FROM groups ORDER BY name');
  return rows.map(mapRowToGroup);
}

export async function getGroupById(id: string): Promise<Group | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>('SELECT * FROM groups WHERE id = ?', id);
  return row ? mapRowToGroup(row) : null;
}

export async function getGroupsBySection(sectionId: string): Promise<Group[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM groups WHERE section_id = ? ORDER BY name',
    sectionId,
  );
  return rows.map(mapRowToGroup);
}

export async function createGroup(input: GroupCreateInput): Promise<Group> {
  const db = await getDatabase();
  const id = generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO groups (id, name, logo_url, section_id, admin_player_id, season_start_month, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.name,
    input.logoUrl ?? null,
    input.sectionId ?? null,
    input.adminPlayerId ?? null,
    input.seasonStartMonth,
    now,
    now,
  );
  logChange('groups', id, 'insert').catch(() => {});
  return (await getGroupById(id))!;
}

export async function updateGroup(
  id: string,
  updates: Partial<GroupCreateInput>,
): Promise<Group | null> {
  const db = await getDatabase();
  const existing = await getGroupById(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.logoUrl !== undefined) {
    fields.push('logo_url = ?');
    values.push(updates.logoUrl);
  }
  if (updates.sectionId !== undefined) {
    fields.push('section_id = ?');
    values.push(updates.sectionId);
  }
  if (updates.adminPlayerId !== undefined) {
    fields.push('admin_player_id = ?');
    values.push(updates.adminPlayerId);
  }
  if (updates.seasonStartMonth !== undefined) {
    fields.push('season_start_month = ?');
    values.push(updates.seasonStartMonth);
  }

  if (fields.length === 0) return existing;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await db.runAsync(`UPDATE groups SET ${fields.join(', ')} WHERE id = ?`, ...values);
  logChange('groups', id, 'update').catch(() => {});
  return (await getGroupById(id))!;
}

export async function deleteGroup(id: string): Promise<boolean> {
  const db = await getDatabase();
  const result = await db.runAsync('DELETE FROM groups WHERE id = ?', id);
  if (result.changes > 0) logChange('groups', id, 'delete').catch(() => {});
  return result.changes > 0;
}

function mapRowToGroup(row: any): Group {
  return {
    id: row.id,
    name: row.name,
    logoUrl: row.logo_url,
    sectionId: row.section_id,
    adminPlayerId: row.admin_player_id,
    seasonStartMonth: row.season_start_month,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ────────────────────────────────────────────────────────────
//  Group Members
// ────────────────────────────────────────────────────────────

export async function getGroupMembers(groupId: string): Promise<GroupMember[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM group_members WHERE group_id = ? ORDER BY joined_at',
    groupId,
  );
  return rows.map(mapRowToGroupMember);
}

export async function getActiveGroupMembers(groupId: string): Promise<GroupMember[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM group_members WHERE group_id = ? AND is_active = 1 ORDER BY joined_at',
    groupId,
  );
  return rows.map(mapRowToGroupMember);
}

export async function getPlayerGroups(playerId: string): Promise<Group[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT g.* FROM groups g
     INNER JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.player_id = ? AND gm.is_active = 1
     ORDER BY g.name`,
    playerId,
  );
  return rows.map(mapRowToGroup);
}

/**
 * Get all distinct player IDs that share at least one active group with the given player.
 * Useful for filtering the Players tab to "my golf buddies".
 */
export async function getGroupMatePlayerIds(playerId: string): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ player_id: string }>(
    `SELECT DISTINCT gm2.player_id
     FROM group_members gm1
     INNER JOIN group_members gm2 ON gm1.group_id = gm2.group_id
     WHERE gm1.player_id = ? AND gm1.is_active = 1 AND gm2.is_active = 1`,
    playerId,
  );
  return rows.map((r) => r.player_id);
}

export async function addGroupMember(input: GroupMemberCreateInput): Promise<GroupMember> {
  const db = await getDatabase();
  const id = generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO group_members (id, group_id, player_id, role, is_active, joined_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    input.groupId,
    input.playerId,
    input.role ?? 'member',
    input.isActive !== undefined ? (input.isActive ? 1 : 0) : 1,
    now,
  );
  logChange('group_members', id, 'insert').catch(() => {});
  return (await getGroupMemberById(id))!;
}

export async function updateGroupMember(
  id: string,
  updates: { role?: GroupMemberRole; isActive?: boolean },
): Promise<GroupMember | null> {
  const db = await getDatabase();
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.role !== undefined) {
    fields.push('role = ?');
    values.push(updates.role);
  }
  if (updates.isActive !== undefined) {
    fields.push('is_active = ?');
    values.push(updates.isActive ? 1 : 0);
  }

  if (fields.length === 0) return getGroupMemberById(id);

  values.push(id);
  await db.runAsync(`UPDATE group_members SET ${fields.join(', ')} WHERE id = ?`, ...values);
  logChange('group_members', id, 'update').catch(() => {});
  return getGroupMemberById(id);
}

export async function removeGroupMember(groupId: string, playerId: string): Promise<boolean> {
  const db = await getDatabase();
  // Look up the id before deleting so we can log the change
  const existing = await db.getFirstAsync<any>(
    'SELECT id FROM group_members WHERE group_id = ? AND player_id = ?',
    groupId,
    playerId,
  );
  const result = await db.runAsync(
    'DELETE FROM group_members WHERE group_id = ? AND player_id = ?',
    groupId,
    playerId,
  );
  if (result.changes > 0 && existing) logChange('group_members', existing.id, 'delete').catch(() => {});
  return result.changes > 0;
}

export async function isPlayerInGroup(groupId: string, playerId: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>(
    'SELECT 1 FROM group_members WHERE group_id = ? AND player_id = ? AND is_active = 1',
    groupId,
    playerId,
  );
  return row !== null;
}

async function getGroupMemberById(id: string): Promise<GroupMember | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>('SELECT * FROM group_members WHERE id = ?', id);
  return row ? mapRowToGroupMember(row) : null;
}

function mapRowToGroupMember(row: any): GroupMember {
  return {
    id: row.id,
    groupId: row.group_id,
    playerId: row.player_id,
    role: row.role as GroupMemberRole,
    isActive: row.is_active === 1,
    joinedAt: row.joined_at,
  };
}

// ────────────────────────────────────────────────────────────
//  Seasons
// ────────────────────────────────────────────────────────────

export async function getSeasonsForGroup(groupId: string): Promise<Season[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM seasons WHERE group_id = ? ORDER BY start_date DESC',
    groupId,
  );
  return rows.map(mapRowToSeason);
}

export async function getSeasonById(id: string): Promise<Season | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>('SELECT * FROM seasons WHERE id = ?', id);
  return row ? mapRowToSeason(row) : null;
}

export async function getCurrentSeason(groupId: string): Promise<Season | null> {
  const db = await getDatabase();
  const today = new Date().toISOString().split('T')[0];
  const row = await db.getFirstAsync<any>(
    'SELECT * FROM seasons WHERE group_id = ? AND start_date <= ? AND end_date >= ?',
    groupId,
    today,
    today,
  );
  return row ? mapRowToSeason(row) : null;
}

export async function createSeason(input: SeasonCreateInput): Promise<Season> {
  const db = await getDatabase();
  const id = generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO seasons (id, group_id, start_date, end_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    input.groupId,
    input.startDate,
    input.endDate,
    now,
    now,
  );
  logChange('seasons', id, 'insert').catch(() => {});
  return (await getSeasonById(id))!;
}

export async function updateSeason(
  id: string,
  updates: Partial<SeasonCreateInput>,
): Promise<Season | null> {
  const db = await getDatabase();
  const existing = await getSeasonById(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: any[] = [];

  if (updates.startDate !== undefined) {
    fields.push('start_date = ?');
    values.push(updates.startDate);
  }
  if (updates.endDate !== undefined) {
    fields.push('end_date = ?');
    values.push(updates.endDate);
  }

  if (fields.length === 0) return existing;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await db.runAsync(`UPDATE seasons SET ${fields.join(', ')} WHERE id = ?`, ...values);
  logChange('seasons', id, 'update').catch(() => {});
  return (await getSeasonById(id))!;
}

export async function deleteSeason(id: string): Promise<boolean> {
  const db = await getDatabase();
  const result = await db.runAsync('DELETE FROM seasons WHERE id = ?', id);
  if (result.changes > 0) logChange('seasons', id, 'delete').catch(() => {});
  return result.changes > 0;
}

function mapRowToSeason(row: any): Season {
  return {
    id: row.id,
    groupId: row.group_id,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ────────────────────────────────────────────────────────────
//  League Rounds
// ────────────────────────────────────────────────────────────

export async function getLeagueRoundsForSeason(seasonId: string): Promise<LeagueRound[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM league_rounds WHERE season_id = ? ORDER BY round_date DESC',
    seasonId,
  );
  return rows.map(mapRowToLeagueRound);
}

export async function getLeagueRoundsForGroup(groupId: string): Promise<LeagueRound[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM league_rounds WHERE group_id = ? ORDER BY round_date DESC',
    groupId,
  );
  return rows.map(mapRowToLeagueRound);
}

export async function getLeagueRoundById(id: string): Promise<LeagueRound | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>('SELECT * FROM league_rounds WHERE id = ?', id);
  return row ? mapRowToLeagueRound(row) : null;
}

export async function getLeagueRoundByRoundId(roundId: string): Promise<LeagueRound | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>(
    'SELECT * FROM league_rounds WHERE round_id = ?',
    roundId,
  );
  return row ? mapRowToLeagueRound(row) : null;
}

export async function createLeagueRound(input: LeagueRoundCreateInput): Promise<LeagueRound> {
  const db = await getDatabase();
  const id = generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO league_rounds (id, group_id, season_id, round_id, round_date, submitted_at, scores_override, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.groupId,
    input.seasonId ?? null,
    input.roundId ?? null,
    input.roundDate,
    input.submittedAt ?? null,
    input.scoresOverride ? 1 : 0,
    now,
    now,
  );
  logChange('league_rounds', id, 'insert').catch(() => {});
  return (await getLeagueRoundById(id))!;
}

export async function updateLeagueRound(
  id: string,
  updates: Partial<LeagueRoundCreateInput>,
): Promise<LeagueRound | null> {
  const db = await getDatabase();
  const existing = await getLeagueRoundById(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: any[] = [];

  if (updates.seasonId !== undefined) {
    fields.push('season_id = ?');
    values.push(updates.seasonId);
  }
  if (updates.roundId !== undefined) {
    fields.push('round_id = ?');
    values.push(updates.roundId);
  }
  if (updates.roundDate !== undefined) {
    fields.push('round_date = ?');
    values.push(updates.roundDate);
  }
  if (updates.submittedAt !== undefined) {
    fields.push('submitted_at = ?');
    values.push(updates.submittedAt);
  }
  if (updates.scoresOverride !== undefined) {
    fields.push('scores_override = ?');
    values.push(updates.scoresOverride ? 1 : 0);
  }

  if (fields.length === 0) return existing;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await db.runAsync(`UPDATE league_rounds SET ${fields.join(', ')} WHERE id = ?`, ...values);
  logChange('league_rounds', id, 'update').catch(() => {});
  return (await getLeagueRoundById(id))!;
}

export async function deleteLeagueRound(id: string): Promise<boolean> {
  const db = await getDatabase();
  const result = await db.runAsync('DELETE FROM league_rounds WHERE id = ?', id);
  if (result.changes > 0) logChange('league_rounds', id, 'delete').catch(() => {});
  return result.changes > 0;
}

function mapRowToLeagueRound(row: any): LeagueRound {
  return {
    id: row.id,
    groupId: row.group_id,
    seasonId: row.season_id,
    roundId: row.round_id,
    roundDate: row.round_date,
    submittedAt: row.submitted_at,
    scoresOverride: row.scores_override === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ────────────────────────────────────────────────────────────
//  League Scores
// ────────────────────────────────────────────────────────────

export async function getLeagueScoresForRound(leagueRoundId: string): Promise<LeagueScore[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM league_scores WHERE league_round_id = ?',
    leagueRoundId,
  );
  return rows.map(mapRowToLeagueScore);
}

export async function getLeagueScoresForPlayer(
  playerId: string,
  seasonId: string,
): Promise<LeagueScore[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT ls.* FROM league_scores ls
     INNER JOIN league_rounds lr ON lr.id = ls.league_round_id
     WHERE ls.player_id = ? AND lr.season_id = ?
     ORDER BY lr.round_date`,
    playerId,
    seasonId,
  );
  return rows.map(mapRowToLeagueScore);
}

export async function getPlayerScoresForGroup(
  playerId: string,
  groupId: string,
): Promise<LeagueScore[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT ls.* FROM league_scores ls
     INNER JOIN league_rounds lr ON lr.id = ls.league_round_id
     WHERE ls.player_id = ? AND lr.group_id = ?
     ORDER BY lr.round_date`,
    playerId,
    groupId,
  );
  return rows.map(mapRowToLeagueScore);
}

export async function getLeagueScoresForSeason(seasonId: string): Promise<LeagueScore[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT ls.* FROM league_scores ls
     INNER JOIN league_rounds lr ON lr.id = ls.league_round_id
     WHERE lr.season_id = ?
     ORDER BY lr.round_date`,
    seasonId,
  );
  return rows.map(mapRowToLeagueScore);
}

export async function upsertLeagueScore(input: LeagueScoreCreateInput): Promise<LeagueScore> {
  const db = await getDatabase();
  const now = new Date().toISOString();

  // Check if a score already exists for this league_round + player
  const existing = await db.getFirstAsync<any>(
    'SELECT id FROM league_scores WHERE league_round_id = ? AND player_id = ?',
    input.leagueRoundId,
    input.playerId,
  );

  if (existing) {
    await db.runAsync(
      `UPDATE league_scores SET score_value = ?, score_override = ?, updated_at = ?
       WHERE id = ?`,
      input.scoreValue ?? null,
      input.scoreOverride ?? null,
      now,
      existing.id,
    );
    logChange('league_scores', existing.id, 'update').catch(() => {});
    return (await getLeagueScoreById(existing.id))!;
  }

  const id = generateId();
  await db.runAsync(
    `INSERT INTO league_scores (id, league_round_id, player_id, score_value, score_override, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.leagueRoundId,
    input.playerId,
    input.scoreValue ?? null,
    input.scoreOverride ?? null,
    now,
    now,
  );
  logChange('league_scores', id, 'insert').catch(() => {});
  return (await getLeagueScoreById(id))!;
}

export async function deleteLeagueScore(id: string): Promise<boolean> {
  const db = await getDatabase();
  const result = await db.runAsync('DELETE FROM league_scores WHERE id = ?', id);
  if (result.changes > 0) logChange('league_scores', id, 'delete').catch(() => {});
  return result.changes > 0;
}

async function getLeagueScoreById(id: string): Promise<LeagueScore | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>('SELECT * FROM league_scores WHERE id = ?', id);
  return row ? mapRowToLeagueScore(row) : null;
}

function mapRowToLeagueScore(row: any): LeagueScore {
  return {
    id: row.id,
    leagueRoundId: row.league_round_id,
    playerId: row.player_id,
    scoreValue: row.score_value,
    scoreOverride: row.score_override,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ────────────────────────────────────────────────────────────
//  Clear All League Data (for re-import)
// ────────────────────────────────────────────────────────────

/**
 * Delete ALL league-related data: scores, rounds, seasons, group_members,
 * groups, sections, and payout_config.
 *
 * Does NOT delete players (they're shared across the app, not league-specific).
 * Does NOT log to sync change log (re-import will log fresh INSERTs).
 */
export async function clearAllLeagueData(): Promise<{
  leagueScores: number;
  leagueRounds: number;
  seasons: number;
  groupMembers: number;
  groups: number;
  sections: number;
  payoutConfig: number;
}> {
  const db = await getDatabase();

  // Delete in dependency order (children first)
  const scores = await db.runAsync('DELETE FROM league_scores');
  const rounds = await db.runAsync('DELETE FROM league_rounds');
  const payout = await db.runAsync('DELETE FROM payout_config');
  const seasonResult = await db.runAsync('DELETE FROM seasons');
  const members = await db.runAsync('DELETE FROM group_members');
  const groupResult = await db.runAsync('DELETE FROM groups');
  const sectionResult = await db.runAsync('DELETE FROM sections');

  return {
    leagueScores: scores.changes,
    leagueRounds: rounds.changes,
    seasons: seasonResult.changes,
    groupMembers: members.changes,
    groups: groupResult.changes,
    sections: sectionResult.changes,
    payoutConfig: payout.changes,
  };
}

// ────────────────────────────────────────────────────────────
//  Orphaned Score Detection & Reassignment
// ────────────────────────────────────────────────────────────

/**
 * Find league_scores whose player_id doesn't exist in the players table.
 * Returns each orphaned player_id and how many scores it has.
 */
export async function getOrphanedScoreInfo(): Promise<{ playerId: string; scoreCount: number }[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ player_id: string; score_count: number }>(
    `SELECT ls.player_id, COUNT(*) as score_count FROM league_scores ls
     LEFT JOIN players p ON p.id = ls.player_id
     WHERE p.id IS NULL
     GROUP BY ls.player_id`,
  );
  return rows.map((r) => ({ playerId: r.player_id, scoreCount: r.score_count }));
}

/**
 * Reassign all league_scores from one player_id to another.
 * Used to map orphaned Glide import player IDs to existing player records.
 *
 * If the target player already has a score in the same round (conflict),
 * those scores are skipped and the count is returned.
 */
export async function reassignLeagueScores(
  fromPlayerId: string,
  toPlayerId: string,
): Promise<{ reassigned: number; conflicts: number }> {
  const db = await getDatabase();
  const now = new Date().toISOString();

  // Find scores to reassign
  const fromScores = await db.getAllAsync<{ id: string; league_round_id: string }>(
    'SELECT id, league_round_id FROM league_scores WHERE player_id = ?',
    fromPlayerId,
  );

  if (fromScores.length === 0) return { reassigned: 0, conflicts: 0 };

  // Find rounds where the target player already has a score (conflicts)
  const targetRounds = await db.getAllAsync<{ league_round_id: string }>(
    'SELECT DISTINCT league_round_id FROM league_scores WHERE player_id = ?',
    toPlayerId,
  );
  const targetRoundSet = new Set(targetRounds.map((r) => r.league_round_id));

  let reassigned = 0;
  let conflicts = 0;

  for (const score of fromScores) {
    if (targetRoundSet.has(score.league_round_id)) {
      // Conflict: target player already has a score in this round — skip
      conflicts++;
      continue;
    }

    await db.runAsync(
      'UPDATE league_scores SET player_id = ?, updated_at = ? WHERE id = ?',
      toPlayerId,
      now,
      score.id,
    );
    logChange('league_scores', score.id, 'update').catch(() => {});
    reassigned++;
  }

  return { reassigned, conflicts };
}

// ────────────────────────────────────────────────────────────
//  Payout Config
// ────────────────────────────────────────────────────────────

export async function getPayoutConfig(groupId: string): Promise<PayoutTier[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM payout_config WHERE group_id = ? ORDER BY tier_index',
    groupId,
  );
  return rows.map(mapRowToPayoutTier);
}

export async function upsertPayoutTier(input: PayoutTierCreateInput): Promise<PayoutTier> {
  const db = await getDatabase();
  const now = new Date().toISOString();

  const existing = await db.getFirstAsync<any>(
    'SELECT id FROM payout_config WHERE group_id = ? AND tier_index = ?',
    input.groupId,
    input.tierIndex,
  );

  if (existing) {
    await db.runAsync(
      'UPDATE payout_config SET config = ? WHERE id = ?',
      JSON.stringify(input.config ?? {}),
      existing.id,
    );
    logChange('payout_config', existing.id, 'update').catch(() => {});
    return (await getPayoutTierById(existing.id))!;
  }

  const id = generateId();
  await db.runAsync(
    `INSERT INTO payout_config (id, group_id, tier_index, config, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    id,
    input.groupId,
    input.tierIndex,
    JSON.stringify(input.config ?? {}),
    now,
  );
  logChange('payout_config', id, 'insert').catch(() => {});
  return (await getPayoutTierById(id))!;
}

export async function deletePayoutConfig(groupId: string): Promise<boolean> {
  const db = await getDatabase();
  // Look up all affected rows before deleting so we can log each change
  const rows = await db.getAllAsync<any>(
    'SELECT id FROM payout_config WHERE group_id = ?',
    groupId,
  );
  const result = await db.runAsync('DELETE FROM payout_config WHERE group_id = ?', groupId);
  if (result.changes > 0) {
    for (const row of rows) {
      logChange('payout_config', row.id, 'delete').catch(() => {});
    }
  }
  return result.changes > 0;
}

async function getPayoutTierById(id: string): Promise<PayoutTier | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>('SELECT * FROM payout_config WHERE id = ?', id);
  return row ? mapRowToPayoutTier(row) : null;
}

function mapRowToPayoutTier(row: any): PayoutTier {
  return {
    id: row.id,
    groupId: row.group_id,
    tierIndex: row.tier_index,
    config: JSON.parse(row.config || '{}'),
    createdAt: row.created_at,
  };
}
