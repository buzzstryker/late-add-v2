/**
 * Glide Import Service — one-time migration of Glide app data
 * into Scorekeeper's league tables.
 *
 * This service receives already-parsed data (typed arrays from
 * src/data/glideImportData.ts) and transforms them into Scorekeeper
 * model inputs. The actual DB writes are done through the repository layer.
 */
import { Player, PlayerCreateInput } from '../models/Player';
import {
  SectionCreateInput,
  GroupCreateInput,
  GroupMemberCreateInput,
  SeasonCreateInput,
  LeagueRoundCreateInput,
  LeagueScoreCreateInput,
  Season,
} from '../models/League';
import { findSeasonForDate } from './leagueService';

// ── Glide CSV Row Types ──

export interface GlideSectionRow {
  rowId: string;
  sectionName: string;
}

export interface GlideGroupRow {
  rowId: string;
  groupName: string;
  logoUrl: string;
  sectionId: string;
  adminId: string;
  seasonStartMonth: number;
  createdAt: string;
}

export interface GlideUserProfileRow {
  rowId: string;
  username: string;
  name: string;
  email: string;
  venmoHandle: string;
  role: string;
  isActive: boolean;
  groupId: string;
  photoUrl?: string;
}

export interface GlideSeasonRow {
  rowId: string;
  startDate: string;
  endDate: string;
  groupId: string;
}

export interface GlideRoundRow {
  rowId: string;
  roundDate: string;
  submittedAt: string;
  scoresOverride: boolean;
  groupId: string;
}

export interface GlideScoreRow {
  rowId: string;
  roundId: string;
  playerId: string;
  scoreValue: number | null;
  scoreOverride: number | null;
}

export interface GlidePayoutRow {
  rowId: string;
  index: number;
}

// ── ID Map ──

/**
 * Tracks mapping from Glide Row IDs to new Scorekeeper IDs.
 * Used to resolve foreign keys during import.
 */
export interface GlideIdMap {
  sections: Map<string, string>;      // glideRowId -> scorekeeperSectionId
  groups: Map<string, string>;        // glideRowId -> scorekeeperGroupId
  players: Map<string, string>;       // glideRowId -> scorekeeperPlayerId
  seasons: Map<string, string>;       // glideRowId -> scorekeeperSeasonId
  leagueRounds: Map<string, string>;  // glideRowId -> scorekeeperLeagueRoundId
}

export function createEmptyIdMap(): GlideIdMap {
  return {
    sections: new Map(),
    groups: new Map(),
    players: new Map(),
    seasons: new Map(),
    leagueRounds: new Map(),
  };
}

// ── Transform Functions ──

/**
 * Transform Glide sections into Scorekeeper SectionCreateInput[].
 * Returns tuples of [glideRowId, input] so the caller can build the ID map.
 */
export function transformSections(
  rows: GlideSectionRow[],
): Array<{ glideRowId: string; input: SectionCreateInput }> {
  return rows.map((row) => ({
    glideRowId: row.rowId,
    input: { name: row.sectionName },
  }));
}

/**
 * Transform Glide groups into Scorekeeper GroupCreateInput[].
 * Requires ID map for section and admin player FK resolution.
 */
export function transformGroups(
  rows: GlideGroupRow[],
  idMap: GlideIdMap,
): Array<{ glideRowId: string; input: GroupCreateInput }> {
  return rows.map((row) => ({
    glideRowId: row.rowId,
    input: {
      name: row.groupName,
      logoUrl: row.logoUrl || undefined,
      sectionId: idMap.sections.get(row.sectionId) || undefined,
      adminPlayerId: idMap.players.get(row.adminId) || undefined,
      seasonStartMonth: row.seasonStartMonth || 1,
    },
  }));
}

/**
 * Match Glide UserProfiles to existing Scorekeeper players by email.
 *
 * Returns:
 * - matches: map of glideRowId -> existing playerId (for profiles matched by email)
 * - newPlayers: PlayerCreateInput[] for unmatched profiles that need new records
 * - venmoUpdates: map of playerId -> venmoHandle for existing players to update
 * - memberships: GroupMemberCreateInput[] derived from profile group assignments
 *
 * Deduplication: Same email may appear in multiple Glide profiles (same person in
 * different groups). We deduplicate by email — one player record, multiple memberships.
 */
export function matchAndTransformPlayers(
  profiles: GlideUserProfileRow[],
  existingPlayers: Player[],
  idMap: GlideIdMap,
): {
  matches: Map<string, string>;              // glideRowId -> existing playerId
  newPlayers: Array<{ glideRowId: string; input: PlayerCreateInput }>;
  venmoUpdates: Map<string, string>;         // playerId -> venmoHandle
  memberships: Array<{ glideRowId: string; input: GroupMemberCreateInput }>;
} {
  const matches = new Map<string, string>();
  const newPlayers: Array<{ glideRowId: string; input: PlayerCreateInput }> = [];
  const venmoUpdates = new Map<string, string>();
  const memberships: Array<{ glideRowId: string; input: GroupMemberCreateInput }> = [];

  // Build email -> player lookup (case-insensitive)
  const emailToPlayer = new Map<string, Player>();
  for (const player of existingPlayers) {
    if (player.email) {
      emailToPlayer.set(player.email.toLowerCase(), player);
    }
  }

  // Track email -> first Glide rowId (for dedup)
  const emailToFirstRowId = new Map<string, string>();
  // Track Glide rowId -> playerId (combines matches and new creates)
  const resolvedPlayers = new Map<string, string>();

  for (const profile of profiles) {
    if (!profile.email) continue; // skip empty profiles (e.g., row Wb)

    const emailKey = profile.email.toLowerCase();

    // Check if we already processed this email (same person, different group)
    const firstRowId = emailToFirstRowId.get(emailKey);
    if (firstRowId) {
      // Reuse the same player ID
      const playerId = resolvedPlayers.get(firstRowId);
      if (playerId) {
        matches.set(profile.rowId, playerId);
        resolvedPlayers.set(profile.rowId, playerId);
      }
    } else {
      emailToFirstRowId.set(emailKey, profile.rowId);

      // Try to match to existing Scorekeeper player
      const existingPlayer = emailToPlayer.get(emailKey);
      if (existingPlayer) {
        matches.set(profile.rowId, existingPlayer.id);
        resolvedPlayers.set(profile.rowId, existingPlayer.id);

        // Queue venmo update if available
        if (profile.venmoHandle) {
          venmoUpdates.set(existingPlayer.id, profile.venmoHandle);
        }
      } else {
        // Need to create a new player
        const nameParts = splitName(profile.name);
        newPlayers.push({
          glideRowId: profile.rowId,
          input: {
            firstName: nameParts.firstName,
            lastName: nameParts.lastName,
            nickname: profile.username || undefined,
            gender: 'M', // default; Glide doesn't store gender
            handicapIndex: 0, // will be updated from GHIN later
            email: profile.email,
            venmoHandle: profile.venmoHandle || undefined,
          },
        });
        // The playerId will be assigned after creation and added to resolvedPlayers
      }
    }

    // Build group membership (uses group idMap)
    const groupId = idMap.groups.get(profile.groupId);
    if (groupId) {
      const isAdmin =
        profile.role === 'Admin' ||
        profile.role === profile.groupId; // Glide stores groupId as role for group admins

      memberships.push({
        glideRowId: profile.rowId,
        input: {
          groupId,
          playerId: '', // will be resolved after player creation
          role: isAdmin ? 'admin' : 'member',
          isActive: profile.isActive,
        },
      });
    }
  }

  return { matches, newPlayers, venmoUpdates, memberships };
}

/**
 * Split a full name into first and last name.
 */
function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return { firstName: 'Unknown', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

/**
 * Transform Glide seasons into SeasonCreateInput[].
 */
export function transformSeasons(
  rows: GlideSeasonRow[],
  idMap: GlideIdMap,
): Array<{ glideRowId: string; input: SeasonCreateInput }> {
  return rows.map((row) => ({
    glideRowId: row.rowId,
    input: {
      groupId: idMap.groups.get(row.groupId) || '',
      startDate: row.startDate.split('T')[0], // normalize to YYYY-MM-DD
      endDate: row.endDate.split('T')[0],
    },
  }));
}

/**
 * Transform Glide rounds into LeagueRoundCreateInput[].
 * Auto-assigns season_id based on round_date + group's seasons.
 */
export function transformLeagueRounds(
  rows: GlideRoundRow[],
  seasons: Season[],
  idMap: GlideIdMap,
): Array<{ glideRowId: string; input: LeagueRoundCreateInput }> {
  return rows.map((row) => {
    const groupId = idMap.groups.get(row.groupId) || '';
    const roundDate = row.roundDate.split('T')[0];

    // Find the matching season for this group and date
    const groupSeasons = seasons.filter((s) => s.groupId === groupId);
    const matchedSeason = findSeasonForDate(groupSeasons, roundDate);

    return {
      glideRowId: row.rowId,
      input: {
        groupId,
        seasonId: matchedSeason?.id || undefined,
        roundDate,
        submittedAt: row.submittedAt || undefined,
        scoresOverride: row.scoresOverride,
      },
    };
  });
}

/**
 * Transform Glide scores into LeagueScoreCreateInput[].
 */
export function transformLeagueScores(
  rows: GlideScoreRow[],
  idMap: GlideIdMap,
): Array<{ glideRowId: string; input: LeagueScoreCreateInput }> {
  return rows
    .filter((row) => {
      // Must have a valid round and player mapping
      return idMap.leagueRounds.has(row.roundId) && idMap.players.has(row.playerId);
    })
    .map((row) => ({
      glideRowId: row.rowId,
      input: {
        leagueRoundId: idMap.leagueRounds.get(row.roundId)!,
        playerId: idMap.players.get(row.playerId)!,
        scoreValue: row.scoreValue,
        scoreOverride: row.scoreOverride,
      },
    }));
}

// ── Import Stats ──

export interface ImportStats {
  sectionsCreated: number;
  groupsCreated: number;
  playersMatched: number;
  playersCreated: number;
  membershipsCreated: number;
  seasonsCreated: number;
  leagueRoundsCreated: number;
  leagueScoresCreated: number;
  warnings: string[];
}
