import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('scorekeeper.db');
    await db.execAsync('PRAGMA journal_mode = WAL;');
    await db.execAsync('PRAGMA foreign_keys = ON;');
    await runMigrations(db);
  }
  return db;
}

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  const result = await db.getFirstAsync<{ version: number }>(
    'SELECT MAX(version) as version FROM schema_version'
  );
  const currentVersion = result?.version ?? 0;

  const migrations = getMigrations();
  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      try {
        await db.execAsync(migration.sql);
      } catch (err: any) {
        // ALTER TABLE ADD COLUMN fails if column already exists (partial previous run)
        if (err?.message?.includes('duplicate column')) {
          console.warn(`Migration v${migration.version}: column already exists, skipping`);
        } else {
          throw err;
        }
      }
      await db.runAsync('INSERT INTO schema_version (version) VALUES (?)', migration.version);
    }
  }
}

interface Migration {
  version: number;
  sql: string;
}

function getMigrations(): Migration[] {
  return [
    {
      version: 1,
      sql: `
        CREATE TABLE IF NOT EXISTS players (
          id TEXT PRIMARY KEY,
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          nickname TEXT,
          handicap_index REAL NOT NULL DEFAULT 0,
          ghin_number TEXT,
          email TEXT,
          phone TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS courses (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          city TEXT,
          state TEXT,
          country TEXT,
          address TEXT,
          phone TEXT,
          website TEXT,
          number_of_holes INTEGER NOT NULL DEFAULT 18,
          api_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS tee_boxes (
          id TEXT PRIMARY KEY,
          course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          color TEXT,
          course_rating REAL NOT NULL,
          slope_rating REAL NOT NULL,
          par INTEGER NOT NULL,
          yardage INTEGER
        );

        CREATE TABLE IF NOT EXISTS holes (
          course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
          hole_number INTEGER NOT NULL,
          par INTEGER NOT NULL,
          stroke_index INTEGER NOT NULL,
          PRIMARY KEY (course_id, hole_number)
        );

        CREATE TABLE IF NOT EXISTS hole_yardages (
          course_id TEXT NOT NULL,
          hole_number INTEGER NOT NULL,
          tee_box_name TEXT NOT NULL,
          yardage INTEGER NOT NULL,
          PRIMARY KEY (course_id, hole_number, tee_box_name),
          FOREIGN KEY (course_id, hole_number) REFERENCES holes(course_id, hole_number) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS rounds (
          id TEXT PRIMARY KEY,
          course_id TEXT NOT NULL REFERENCES courses(id),
          round_type TEXT NOT NULL DEFAULT 'full_18',
          status TEXT NOT NULL DEFAULT 'setup',
          date TEXT NOT NULL DEFAULT (date('now')),
          round_code TEXT,
          current_hole INTEGER NOT NULL DEFAULT 1,
          start_time TEXT,
          end_time TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS round_players (
          round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
          player_id TEXT NOT NULL REFERENCES players(id),
          tee_box_id TEXT NOT NULL REFERENCES tee_boxes(id),
          course_handicap INTEGER NOT NULL DEFAULT 0,
          playing_handicap INTEGER NOT NULL DEFAULT 0,
          strokes_received INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (round_id, player_id)
        );

        CREATE TABLE IF NOT EXISTS scores (
          id TEXT PRIMARY KEY,
          round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
          player_id TEXT NOT NULL REFERENCES players(id),
          hole_number INTEGER NOT NULL,
          gross_score INTEGER NOT NULL,
          net_score INTEGER NOT NULL,
          putts INTEGER,
          fairway_hit INTEGER,
          green_in_regulation INTEGER,
          penalties INTEGER DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(round_id, player_id, hole_number)
        );

        CREATE TABLE IF NOT EXISTS betting_games (
          id TEXT PRIMARY KEY,
          round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          stakes REAL NOT NULL DEFAULT 0,
          use_net_scores INTEGER NOT NULL DEFAULT 1,
          config TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(status);
        CREATE INDEX IF NOT EXISTS idx_rounds_date ON rounds(date);
        CREATE INDEX IF NOT EXISTS idx_scores_round ON scores(round_id);
        CREATE INDEX IF NOT EXISTS idx_scores_player ON scores(player_id);
      `,
    },
    {
      version: 2,
      sql: `ALTER TABLE players ADD COLUMN gender TEXT NOT NULL DEFAULT 'M';`,
    },
    {
      version: 3,
      sql: `
        ALTER TABLE tee_boxes ADD COLUMN gender TEXT NOT NULL DEFAULT 'M';
        UPDATE tee_boxes SET gender = 'F' WHERE name LIKE '% (W)';
        UPDATE tee_boxes SET name = REPLACE(name, ' (M)', '') WHERE name LIKE '% (M)';
        UPDATE tee_boxes SET name = REPLACE(name, ' (W)', '') WHERE name LIKE '% (W)';
      `,
    },
    {
      version: 4,
      sql: `ALTER TABLE rounds ADD COLUMN handicap_mode TEXT NOT NULL DEFAULT 'full';`,
    },
    {
      version: 5,
      sql: `
        CREATE TABLE IF NOT EXISTS game_points (
          id TEXT PRIMARY KEY,
          round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
          player_id TEXT NOT NULL REFERENCES players(id),
          hole_number INTEGER NOT NULL,
          points INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(round_id, player_id, hole_number)
        );
        CREATE INDEX IF NOT EXISTS idx_game_points_round ON game_points(round_id);
      `,
    },
    {
      version: 6,
      sql: `
        -- Add game_id column to game_points to support multiple betting games per round.
        -- SQLite can't alter constraints, so recreate the table.
        CREATE TABLE IF NOT EXISTS game_points_new (
          id TEXT PRIMARY KEY,
          round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
          game_id TEXT REFERENCES betting_games(id) ON DELETE CASCADE,
          player_id TEXT NOT NULL REFERENCES players(id),
          hole_number INTEGER NOT NULL,
          points INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(round_id, game_id, player_id, hole_number)
        );
        INSERT INTO game_points_new (id, round_id, game_id, player_id, hole_number, points, created_at, updated_at)
          SELECT id, round_id, NULL, player_id, hole_number, points, created_at, updated_at FROM game_points;
        DROP TABLE game_points;
        ALTER TABLE game_points_new RENAME TO game_points;
        CREATE INDEX IF NOT EXISTS idx_game_points_round ON game_points(round_id);
        CREATE INDEX IF NOT EXISTS idx_game_points_game ON game_points(game_id);
      `,
    },
    {
      version: 7,
      sql: `ALTER TABLE game_points ADD COLUMN awarded_dots TEXT;`,
    },
    {
      version: 8,
      sql: `ALTER TABLE rounds ADD COLUMN team_config TEXT;`,
    },
    {
      version: 9,
      sql: `
        CREATE TABLE IF NOT EXISTS app_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          owner_player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO app_config (id) VALUES (1);
      `,
    },
    {
      version: 10,
      sql: `
        CREATE TABLE IF NOT EXISTS wolf_choices (
          id TEXT PRIMARY KEY,
          round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
          game_id TEXT NOT NULL REFERENCES betting_games(id) ON DELETE CASCADE,
          hole_number INTEGER NOT NULL,
          wolf_player_id TEXT NOT NULL,
          partner_id TEXT,
          is_lone_wolf INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(round_id, game_id, hole_number)
        );
        CREATE INDEX IF NOT EXISTS idx_wolf_choices_round_game
          ON wolf_choices(round_id, game_id);
      `,
    },
    {
      version: 11,
      sql: `
        CREATE TABLE IF NOT EXISTS sections (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS groups (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          logo_url TEXT,
          section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
          admin_player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
          season_start_month INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_groups_section ON groups(section_id);

        CREATE TABLE IF NOT EXISTS group_members (
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
          player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'member',
          is_active INTEGER NOT NULL DEFAULT 1,
          joined_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(group_id, player_id)
        );
        CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
        CREATE INDEX IF NOT EXISTS idx_group_members_player ON group_members(player_id);

        CREATE TABLE IF NOT EXISTS seasons (
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_seasons_group ON seasons(group_id);
        CREATE INDEX IF NOT EXISTS idx_seasons_dates ON seasons(start_date, end_date);

        CREATE TABLE IF NOT EXISTS league_rounds (
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
          season_id TEXT REFERENCES seasons(id) ON DELETE SET NULL,
          round_id TEXT REFERENCES rounds(id) ON DELETE SET NULL,
          round_date TEXT NOT NULL,
          submitted_at TEXT,
          scores_override INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_league_rounds_group ON league_rounds(group_id);
        CREATE INDEX IF NOT EXISTS idx_league_rounds_season ON league_rounds(season_id);
        CREATE INDEX IF NOT EXISTS idx_league_rounds_round ON league_rounds(round_id);

        CREATE TABLE IF NOT EXISTS league_scores (
          id TEXT PRIMARY KEY,
          league_round_id TEXT NOT NULL REFERENCES league_rounds(id) ON DELETE CASCADE,
          player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          score_value INTEGER,
          score_override INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(league_round_id, player_id)
        );
        CREATE INDEX IF NOT EXISTS idx_league_scores_round ON league_scores(league_round_id);
        CREATE INDEX IF NOT EXISTS idx_league_scores_player ON league_scores(player_id);

        CREATE TABLE IF NOT EXISTS payout_config (
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
          tier_index INTEGER NOT NULL,
          config TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(group_id, tier_index)
        );
        CREATE INDEX IF NOT EXISTS idx_payout_config_group ON payout_config(group_id);
      `,
    },
    {
      version: 12,
      sql: `ALTER TABLE players ADD COLUMN venmo_handle TEXT;`,
    },
    {
      version: 13,
      sql: `
        CREATE TABLE IF NOT EXISTS sync_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          last_push_at TEXT,
          last_pull_at TEXT,
          supabase_user_id TEXT
        );
        INSERT OR IGNORE INTO sync_meta (id) VALUES (1);

        CREATE TABLE IF NOT EXISTS sync_change_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          table_name TEXT NOT NULL,
          row_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          changed_at TEXT NOT NULL DEFAULT (datetime('now')),
          synced INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_sync_log_pending ON sync_change_log(synced, table_name);
        CREATE INDEX IF NOT EXISTS idx_sync_log_row ON sync_change_log(table_name, row_id);

        ALTER TABLE app_config ADD COLUMN supabase_user_id TEXT;
      `,
    },
    {
      version: 14,
      sql: `ALTER TABLE app_config ADD COLUMN home_group_id TEXT REFERENCES groups(id) ON DELETE SET NULL;`,
    },
  ];
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}
