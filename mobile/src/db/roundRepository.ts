import { getDatabase, generateId } from './database';
import { logChange } from './syncChangeLogger';
import { Round, RoundPlayer, RoundCreateInput, RoundStatus } from '../models/Round';
import { TeamConfig } from '../models/Team';
import { Score, ScoreCreateInput, PlayerRoundSummary } from '../models/Score';
import { GamePoint, GamePointInput } from '../models/GamePoint';

// ── Round CRUD ──

export async function getAllRounds(): Promise<Round[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>('SELECT * FROM rounds ORDER BY date DESC, created_at DESC');
  const rounds: Round[] = [];
  for (const row of rows) {
    rounds.push(await buildRound(row));
  }
  return rounds;
}

export async function getRecentRounds(limit: number = 10): Promise<Round[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM rounds ORDER BY date DESC, created_at DESC LIMIT ?',
    limit
  );
  const rounds: Round[] = [];
  for (const row of rows) {
    rounds.push(await buildRound(row));
  }
  return rounds;
}

export async function getActiveRounds(): Promise<Round[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    "SELECT * FROM rounds WHERE status IN ('setup', 'in_progress') ORDER BY date DESC"
  );
  const rounds: Round[] = [];
  for (const row of rows) {
    rounds.push(await buildRound(row));
  }
  return rounds;
}

export async function getRoundById(id: string): Promise<Round | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>('SELECT * FROM rounds WHERE id = ?', id);
  if (!row) return null;
  return buildRound(row);
}

export async function createRound(input: RoundCreateInput): Promise<Round> {
  const db = await getDatabase();
  const roundId = generateId();
  const now = new Date().toISOString();
  const today = new Date().toISOString().split('T')[0];

  const teamConfigJson = input.teamConfig ? JSON.stringify(input.teamConfig) : null;

  await db.runAsync(
    `INSERT INTO rounds (id, course_id, round_type, handicap_mode, status, date, current_hole, team_config, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'setup', ?, 1, ?, ?, ?)`,
    roundId,
    input.courseId,
    input.roundType,
    input.handicapMode || 'full',
    today,
    teamConfigJson,
    now,
    now
  );

  logChange('rounds', roundId, 'insert').catch(() => {});

  // Insert round players
  for (const p of input.players) {
    await db.runAsync(
      `INSERT INTO round_players (round_id, player_id, tee_box_id, course_handicap, playing_handicap, strokes_received)
       VALUES (?, ?, ?, 0, 0, 0)`,
      roundId,
      p.playerId,
      p.teeBoxId
    );
    logChange('round_players', `${roundId}:${p.playerId}`, 'insert').catch(() => {});
  }

  return (await getRoundById(roundId))!;
}

export async function updateRoundStatus(id: string, status: RoundStatus): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const updates: string[] = ['status = ?', 'updated_at = ?'];
  const values: any[] = [status, now];

  if (status === 'in_progress') {
    updates.push('start_time = COALESCE(start_time, ?)');
    values.push(now);
  } else if (status === 'completed') {
    updates.push('end_time = ?');
    values.push(now);
  }

  values.push(id);
  await db.runAsync(`UPDATE rounds SET ${updates.join(', ')} WHERE id = ?`, ...values);
  logChange('rounds', id, 'update').catch(() => {});
}

export async function updateCurrentHole(roundId: string, holeNumber: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE rounds SET current_hole = ?, updated_at = ? WHERE id = ?',
    holeNumber,
    new Date().toISOString(),
    roundId
  );
  logChange('rounds', roundId, 'update').catch(() => {});
}

export async function updateRoundPlayerHandicaps(
  roundId: string,
  playerHandicaps: { playerId: string; courseHandicap: number; playingHandicap: number; strokesReceived: number }[]
): Promise<void> {
  const db = await getDatabase();
  for (const ph of playerHandicaps) {
    await db.runAsync(
      `UPDATE round_players SET course_handicap = ?, playing_handicap = ?, strokes_received = ?
       WHERE round_id = ? AND player_id = ?`,
      ph.courseHandicap,
      ph.playingHandicap,
      ph.strokesReceived,
      roundId,
      ph.playerId
    );
    logChange('round_players', `${roundId}:${ph.playerId}`, 'update').catch(() => {});
  }
}

export async function deleteRound(id: string): Promise<boolean> {
  const db = await getDatabase();
  const result = await db.runAsync('DELETE FROM rounds WHERE id = ?', id);
  if (result.changes > 0) logChange('rounds', id, 'delete').catch(() => {});
  return result.changes > 0;
}

// ── Score CRUD ──

export async function getScoresForRound(roundId: string): Promise<Score[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM scores WHERE round_id = ? ORDER BY hole_number, player_id',
    roundId
  );
  return rows.map(mapRowToScore);
}

export async function getScoresForPlayer(roundId: string, playerId: string): Promise<Score[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM scores WHERE round_id = ? AND player_id = ? ORDER BY hole_number',
    roundId,
    playerId
  );
  return rows.map(mapRowToScore);
}

export async function upsertScore(input: ScoreCreateInput, netScore: number): Promise<Score> {
  const db = await getDatabase();
  const now = new Date().toISOString();

  // Check if score exists
  const existing = await db.getFirstAsync<any>(
    'SELECT id FROM scores WHERE round_id = ? AND player_id = ? AND hole_number = ?',
    input.roundId,
    input.playerId,
    input.holeNumber
  );

  if (existing) {
    await db.runAsync(
      `UPDATE scores SET gross_score = ?, net_score = ?, putts = ?, fairway_hit = ?,
       green_in_regulation = ?, penalties = ?, updated_at = ?
       WHERE id = ?`,
      input.grossScore,
      netScore,
      input.putts ?? null,
      input.fairwayHit != null ? (input.fairwayHit ? 1 : 0) : null,
      input.greenInRegulation != null ? (input.greenInRegulation ? 1 : 0) : null,
      input.penalties ?? 0,
      now,
      existing.id
    );
    logChange('scores', existing.id, 'update').catch(() => {});
    const updated = await db.getFirstAsync<any>('SELECT * FROM scores WHERE id = ?', existing.id);
    return mapRowToScore(updated);
  }

  const id = generateId();
  await db.runAsync(
    `INSERT INTO scores (id, round_id, player_id, hole_number, gross_score, net_score, putts, fairway_hit, green_in_regulation, penalties, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.roundId,
    input.playerId,
    input.holeNumber,
    input.grossScore,
    netScore,
    input.putts ?? null,
    input.fairwayHit != null ? (input.fairwayHit ? 1 : 0) : null,
    input.greenInRegulation != null ? (input.greenInRegulation ? 1 : 0) : null,
    input.penalties ?? 0,
    now,
    now
  );

  logChange('scores', id, 'insert').catch(() => {});
  const row = await db.getFirstAsync<any>('SELECT * FROM scores WHERE id = ?', id);
  return mapRowToScore(row);
}

export async function getPlayerRoundSummary(
  roundId: string,
  playerId: string,
  coursePar: number
): Promise<PlayerRoundSummary> {
  const scores = await getScoresForPlayer(roundId, playerId);

  let totalGross = 0, totalNet = 0;
  let frontNineGross = 0, frontNineNet = 0;
  let backNineGross = 0, backNineNet = 0;

  for (const s of scores) {
    totalGross += s.grossScore;
    totalNet += s.netScore;
    if (s.holeNumber <= 9) {
      frontNineGross += s.grossScore;
      frontNineNet += s.netScore;
    } else {
      backNineGross += s.grossScore;
      backNineNet += s.netScore;
    }
  }

  return {
    playerId,
    totalGross,
    totalNet,
    frontNineGross,
    frontNineNet,
    backNineGross,
    backNineNet,
    holesPlayed: scores.length,
    toPar: totalGross - coursePar,
    toParNet: totalNet - coursePar,
  };
}

// ── Tee History ──

/**
 * Get the most recent tee box each player used at a given course.
 * Returns a map of playerId -> teeBoxId.
 */
export async function getLastTeeSelections(
  courseId: string,
  playerIds: string[]
): Promise<Record<string, string>> {
  if (playerIds.length === 0) return {};
  const db = await getDatabase();
  const result: Record<string, string> = {};

  for (const playerId of playerIds) {
    const row = await db.getFirstAsync<any>(
      `SELECT rp.tee_box_id
       FROM round_players rp
       JOIN rounds r ON r.id = rp.round_id
       WHERE r.course_id = ? AND rp.player_id = ?
       ORDER BY r.date DESC, r.created_at DESC
       LIMIT 1`,
      courseId,
      playerId
    );
    if (row) {
      result[playerId] = row.tee_box_id;
    }
  }

  return result;
}

// ── Game Points CRUD ──

export async function getGamePointsForRound(roundId: string): Promise<GamePoint[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM game_points WHERE round_id = ? ORDER BY hole_number, player_id',
    roundId
  );
  return rows.map(mapRowToGamePoint);
}

export async function upsertGamePoint(input: GamePointInput): Promise<GamePoint> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const gameId = input.gameId ?? null;

  // Lookup considers game_id (NULL-safe comparison)
  const existing = gameId
    ? await db.getFirstAsync<any>(
        'SELECT id FROM game_points WHERE round_id = ? AND game_id = ? AND player_id = ? AND hole_number = ?',
        input.roundId, gameId, input.playerId, input.holeNumber
      )
    : await db.getFirstAsync<any>(
        'SELECT id FROM game_points WHERE round_id = ? AND game_id IS NULL AND player_id = ? AND hole_number = ?',
        input.roundId, input.playerId, input.holeNumber
      );

  const awardedDotsJson = input.awardedDots ? JSON.stringify(input.awardedDots) : null;

  if (existing) {
    await db.runAsync(
      'UPDATE game_points SET points = ?, awarded_dots = ?, updated_at = ? WHERE id = ?',
      input.points, awardedDotsJson, now, existing.id
    );
    logChange('game_points', existing.id, 'update').catch(() => {});
    const updated = await db.getFirstAsync<any>('SELECT * FROM game_points WHERE id = ?', existing.id);
    return mapRowToGamePoint(updated);
  }

  const id = generateId();
  await db.runAsync(
    `INSERT INTO game_points (id, round_id, game_id, player_id, hole_number, points, awarded_dots, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, input.roundId, gameId, input.playerId, input.holeNumber, input.points, awardedDotsJson, now, now
  );

  logChange('game_points', id, 'insert').catch(() => {});
  const row = await db.getFirstAsync<any>('SELECT * FROM game_points WHERE id = ?', id);
  return mapRowToGamePoint(row);
}

// ── Helpers ──

async function buildRound(row: any): Promise<Round> {
  const db = await getDatabase();
  const playerRows = await db.getAllAsync<any>(
    'SELECT * FROM round_players WHERE round_id = ?',
    row.id
  );

  const players: RoundPlayer[] = playerRows.map((p: any) => ({
    playerId: p.player_id,
    teeBoxId: p.tee_box_id,
    courseHandicap: p.course_handicap,
    playingHandicap: p.playing_handicap,
    strokesReceived: p.strokes_received,
  }));

  const bettingRows = await db.getAllAsync<any>(
    'SELECT id FROM betting_games WHERE round_id = ?',
    row.id
  );

  // Parse team_config JSON (null/undefined = individual play)
  let teamConfig: TeamConfig | undefined;
  if (row.team_config) {
    try { teamConfig = JSON.parse(row.team_config); } catch { teamConfig = undefined; }
  }

  return {
    id: row.id,
    courseId: row.course_id,
    roundType: row.round_type,
    handicapMode: row.handicap_mode || 'full',
    status: row.status,
    date: row.date,
    players,
    bettingGameIds: bettingRows.map((b: any) => b.id),
    roundCode: row.round_code,
    currentHole: row.current_hole,
    startTime: row.start_time,
    endTime: row.end_time,
    notes: row.notes,
    teamConfig,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRowToScore(row: any): Score {
  return {
    id: row.id,
    roundId: row.round_id,
    playerId: row.player_id,
    holeNumber: row.hole_number,
    grossScore: row.gross_score,
    netScore: row.net_score,
    putts: row.putts,
    fairwayHit: row.fairway_hit != null ? Boolean(row.fairway_hit) : undefined,
    greenInRegulation: row.green_in_regulation != null ? Boolean(row.green_in_regulation) : undefined,
    penalties: row.penalties,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRowToGamePoint(row: any): GamePoint {
  let awardedDots: string[] | null = null;
  if (row.awarded_dots) {
    try { awardedDots = JSON.parse(row.awarded_dots); } catch { awardedDots = null; }
  }
  return {
    id: row.id,
    roundId: row.round_id,
    gameId: row.game_id ?? null,
    playerId: row.player_id,
    holeNumber: row.hole_number,
    points: row.points,
    awardedDots,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
