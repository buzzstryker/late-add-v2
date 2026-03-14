import React, { createContext, useContext, useReducer, useCallback, useMemo, useEffect, ReactNode } from 'react';
import {
  Group,
  GroupCreateInput,
  GroupMember,
  GroupMemberRole,
  Section,
  Season,
  SeasonCreateInput,
  LeagueRound,
  LeagueScore,
  PlayerStanding,
} from '../models/League';
import { Player } from '../models/Player';
import * as leagueRepo from '../db/leagueRepository';
import * as roundRepo from '../db/roundRepository';
import * as playerRepo from '../db/playerRepository';
import * as appConfigRepo from '../db/appConfigRepository';
import * as leagueService from '../services/leagueService';
import { PlayerStats, HeadToHeadEntry } from '../services/leagueService';
import * as settlementService from '../services/settlementService';
import { SettlementEntry, RoundSettlement } from '../services/settlementService';
import { EffectiveRole, getEffectiveRole, hasPermission } from '../services/authService';
import { usePlayers } from './PlayerContext';
import { useSync } from './SyncContext';
import {
  ImportStats,
  createEmptyIdMap,
  transformSections,
  transformGroups,
  matchAndTransformPlayers,
  transformSeasons,
  transformLeagueRounds,
  transformLeagueScores,
  GlideSectionRow,
  GlideGroupRow,
  GlideUserProfileRow,
  GlideSeasonRow,
  GlideRoundRow,
  GlideScoreRow,
} from '../services/glideImportService';

// ─── State ──────────────────────────────────────────────────────────────

interface SeasonWinner {
  playerId: string;
  netAmount: number;
}

export interface HomeGroupStandings {
  group: Group;
  season: Season;
  netPositions: Map<string, number>;
  /** Map of playerId → number of rounds played in current season */
  roundCounts: Map<string, number>;
  /** Map of playerId → display name */
  playerNames: Map<string, string>;
}

interface GroupPermissions {
  canEditGroup: boolean;
  canManageMembers: boolean;
  canDeleteGroup: boolean;
  canToggleRoles: boolean;
}

interface GroupState {
  groups: Group[];
  sections: Section[];
  activeGroup: Group | null;
  activeGroupMembers: GroupMember[];
  activeGroupSeasons: Season[];
  seasonWinners: Record<string, SeasonWinner>;
  currentPlayerRole: EffectiveRole | null;
  activeSeason: Season | null;
  seasonLeagueRounds: LeagueRound[];
  seasonStandings: PlayerStanding[];
  seasonScores: LeagueScore[];
  seasonNetPositions: Map<string, number>;
  homeGroupId: string | null;
  homeGroupStandings: HomeGroupStandings | null;
  isLoading: boolean;
  error: string | null;
}

type GroupAction =
  | { type: 'SET_GROUPS'; payload: Group[] }
  | { type: 'SET_SECTIONS'; payload: Section[] }
  | { type: 'SET_ACTIVE_GROUP'; payload: { group: Group; members: GroupMember[]; seasons: Season[]; seasonWinners: Record<string, SeasonWinner> } }
  | { type: 'CLEAR_ACTIVE_GROUP' }
  | { type: 'SET_SEASON_DATA'; payload: { season: Season; rounds: LeagueRound[]; standings: PlayerStanding[]; scores: LeagueScore[]; netPositions: Map<string, number> } }
  | { type: 'ADD_GROUP'; payload: Group }
  | { type: 'UPDATE_GROUP'; payload: Group }
  | { type: 'REMOVE_GROUP'; payload: string }
  | { type: 'SET_MEMBERS'; payload: GroupMember[] }
  | { type: 'SET_CURRENT_PLAYER_ROLE'; payload: EffectiveRole | null }
  | { type: 'SET_HOME_GROUP'; payload: { id: string | null; standings: HomeGroupStandings | null } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null };

const initialState: GroupState = {
  groups: [],
  sections: [],
  activeGroup: null,
  activeGroupMembers: [],
  activeGroupSeasons: [],
  seasonWinners: {},
  currentPlayerRole: null,
  activeSeason: null,
  seasonLeagueRounds: [],
  seasonStandings: [],
  seasonScores: [],
  seasonNetPositions: new Map(),
  homeGroupId: null,
  homeGroupStandings: null,
  isLoading: false,
  error: null,
};

function groupReducer(state: GroupState, action: GroupAction): GroupState {
  switch (action.type) {
    case 'SET_GROUPS':
      return { ...state, groups: action.payload, isLoading: false };
    case 'SET_SECTIONS':
      return { ...state, sections: action.payload };
    case 'SET_ACTIVE_GROUP':
      return {
        ...state,
        activeGroup: action.payload.group,
        activeGroupMembers: action.payload.members,
        activeGroupSeasons: action.payload.seasons,
        seasonWinners: action.payload.seasonWinners,
        isLoading: false,
      };
    case 'CLEAR_ACTIVE_GROUP':
      return {
        ...state,
        activeGroup: null,
        activeGroupMembers: [],
        activeGroupSeasons: [],
        seasonWinners: {},
        currentPlayerRole: null,
        activeSeason: null,
        seasonLeagueRounds: [],
        seasonStandings: [],
        seasonScores: [],
        seasonNetPositions: new Map(),
      };
    case 'SET_SEASON_DATA':
      return {
        ...state,
        activeSeason: action.payload.season,
        seasonLeagueRounds: action.payload.rounds,
        seasonStandings: action.payload.standings,
        seasonScores: action.payload.scores,
        seasonNetPositions: action.payload.netPositions,
        isLoading: false,
      };
    case 'ADD_GROUP':
      return { ...state, groups: [...state.groups, action.payload] };
    case 'UPDATE_GROUP':
      return {
        ...state,
        groups: state.groups.map((g) => (g.id === action.payload.id ? action.payload : g)),
        activeGroup: state.activeGroup?.id === action.payload.id ? action.payload : state.activeGroup,
      };
    case 'REMOVE_GROUP':
      return {
        ...state,
        groups: state.groups.filter((g) => g.id !== action.payload),
        activeGroup: state.activeGroup?.id === action.payload ? null : state.activeGroup,
      };
    case 'SET_MEMBERS':
      return { ...state, activeGroupMembers: action.payload };
    case 'SET_CURRENT_PLAYER_ROLE':
      return { ...state, currentPlayerRole: action.payload };
    case 'SET_HOME_GROUP':
      return { ...state, homeGroupId: action.payload.id, homeGroupStandings: action.payload.standings };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false };
    default:
      return state;
  }
}

// ─── Context Type ───────────────────────────────────────────────────────

interface GroupContextType {
  state: GroupState;
  permissions: GroupPermissions;
  // Load
  loadGroups: () => Promise<void>;
  loadSections: () => Promise<void>;
  loadGroupDetail: (groupId: string) => Promise<void>;
  loadSeasonData: (seasonId: string) => Promise<void>;
  // Group CRUD
  createGroup: (input: GroupCreateInput) => Promise<Group>;
  updateGroup: (id: string, updates: Partial<GroupCreateInput>) => Promise<Group | null>;
  deleteGroup: (id: string) => Promise<void>;
  // Membership
  addMember: (groupId: string, playerId: string, role?: GroupMemberRole) => Promise<void>;
  removeMember: (groupId: string, playerId: string) => Promise<void>;
  updateMemberRole: (memberId: string, role: GroupMemberRole) => Promise<void>;
  // Seasons
  createSeason: (input: SeasonCreateInput) => Promise<Season>;
  // League Rounds
  submitRoundToLeague: (roundId: string, groupId: string) => Promise<void>;
  // Standings
  getSeasonStandings: (seasonId: string) => Promise<PlayerStanding[]>;
  // Settlement
  getRoundSettlement: (roundId: string) => Promise<RoundSettlement>;
  getQuickPayoutForRound: (roundScores: LeagueScore[], scoresOverride: boolean) => SettlementEntry[];
  // Player stats
  getPlayerStats: (playerId: string) => Promise<PlayerStats>;
  getHeadToHead: (playerId: string) => HeadToHeadEntry[];
  // Player groups
  getPlayerGroups: (playerId: string) => Promise<Group[]>;
  // Home group standings
  loadHomeGroupStandings: () => Promise<void>;
  setHomeGroup: (groupId: string | null) => Promise<void>;
  // Orphaned score reassignment
  getOrphanedScores: () => Promise<{ playerId: string; scoreCount: number }[]>;
  reassignScores: (fromPlayerId: string, toPlayerId: string) => Promise<{ reassigned: number; conflicts: number }>;
  // Glide import
  importGlideData: (data: {
    sections: GlideSectionRow[];
    groups: GlideGroupRow[];
    profiles: GlideUserProfileRow[];
    seasons: GlideSeasonRow[];
    rounds: GlideRoundRow[];
    scores: GlideScoreRow[];
  }) => Promise<ImportStats>;
  // Clear + re-import
  clearAndReimportGlideData: (data: {
    sections: GlideSectionRow[];
    groups: GlideGroupRow[];
    profiles: GlideUserProfileRow[];
    seasons: GlideSeasonRow[];
    rounds: GlideRoundRow[];
    scores: GlideScoreRow[];
  }) => Promise<ImportStats>;
}

const GroupContext = createContext<GroupContextType | undefined>(undefined);

// ─── Provider ───────────────────────────────────────────────────────────

export function GroupProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(groupReducer, initialState);
  const { ownerPlayerId } = usePlayers();
  const { state: syncState } = useSync();

  // Reload groups (and active group detail) when sync pulls new data
  useEffect(() => {
    if (syncState.lastPullCompletedAt > 0) {
      loadGroups();
      // Also reload the active group detail so seasons/members/standings refresh
      if (state.activeGroup?.id) {
        loadGroupDetail(state.activeGroup.id);
      }
      // Also reload active season data if viewing a season
      if (state.activeSeason?.id) {
        loadSeasonData(state.activeSeason.id);
      }
    }
  }, [syncState.lastPullCompletedAt]);

  // ─── Permissions (computed from currentPlayerRole) ────────────────

  const permissions = useMemo<GroupPermissions>(() => ({
    canEditGroup: hasPermission(state.currentPlayerRole, 'edit_group'),
    canManageMembers: hasPermission(state.currentPlayerRole, 'manage_members'),
    canDeleteGroup: hasPermission(state.currentPlayerRole, 'delete_group'),
    canToggleRoles: hasPermission(state.currentPlayerRole, 'toggle_roles'),
  }), [state.currentPlayerRole]);

  // ─── Load ─────────────────────────────────────────────────────────

  const loadGroups = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const groups = await leagueRepo.getAllGroups();
      dispatch({ type: 'SET_GROUPS', payload: groups });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: 'Failed to load groups' });
    }
  }, []);

  const loadSections = useCallback(async () => {
    try {
      const sections = await leagueRepo.getAllSections();
      dispatch({ type: 'SET_SECTIONS', payload: sections });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: 'Failed to load sections' });
    }
  }, []);

  const loadGroupDetail = useCallback(async (groupId: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const group = await leagueRepo.getGroupById(groupId);
      if (!group) {
        dispatch({ type: 'SET_ERROR', payload: 'Group not found' });
        return;
      }
      const members = await leagueRepo.getGroupMembers(groupId);
      const seasons = await leagueRepo.getSeasonsForGroup(groupId);

      // Compute season winners
      const seasonWinners: Record<string, SeasonWinner> = {};
      for (const season of seasons) {
        try {
          const scores = await leagueRepo.getLeagueScoresForSeason(season.id);
          if (scores.length === 0) continue;
          const rounds = await leagueRepo.getLeagueRoundsForSeason(season.id);
          const nets = leagueService.calculateSeasonNetPositions(scores, rounds);

          let topPlayer = '';
          let topAmount = -Infinity;
          for (const [playerId, net] of nets) {
            if (net > topAmount) {
              topPlayer = playerId;
              topAmount = net;
            }
          }
          if (topPlayer) {
            seasonWinners[season.id] = { playerId: topPlayer, netAmount: topAmount };
          }
        } catch {
          // Ignore errors for individual seasons
        }
      }

      dispatch({
        type: 'SET_ACTIVE_GROUP',
        payload: { group, members, seasons, seasonWinners },
      });

      // Compute current player's effective role in this group
      const currentMembership = ownerPlayerId
        ? members.find((m) => m.playerId === ownerPlayerId)
        : null;
      const memberRole = currentMembership ? currentMembership.role : null;
      const effectiveRole = getEffectiveRole(ownerPlayerId, ownerPlayerId, memberRole);
      dispatch({ type: 'SET_CURRENT_PLAYER_ROLE', payload: effectiveRole });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: 'Failed to load group detail' });
    }
  }, [ownerPlayerId]);

  const loadSeasonData = useCallback(async (seasonId: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const season = await leagueRepo.getSeasonById(seasonId);
      if (!season) {
        dispatch({ type: 'SET_ERROR', payload: 'Season not found' });
        return;
      }
      const rounds = await leagueRepo.getLeagueRoundsForSeason(seasonId);
      const scores = await leagueRepo.getLeagueScoresForSeason(seasonId);

      // Include all active group members in standings (even those with 0 rounds)
      const groupMembers = await leagueRepo.getActiveGroupMembers(season.groupId);
      const memberIds = groupMembers.map((m) => m.playerId);

      const standings = leagueService.calculateStandings(scores, memberIds);
      const netPositions = leagueService.calculateSeasonNetPositions(scores, rounds);

      // Add 0-net entries for group members who have no scores yet
      for (const memberId of memberIds) {
        if (!netPositions.has(memberId)) {
          netPositions.set(memberId, 0);
        }
      }

      dispatch({
        type: 'SET_SEASON_DATA',
        payload: { season, rounds, standings, scores, netPositions },
      });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: 'Failed to load season data' });
    }
  }, []);

  // ─── Group CRUD ───────────────────────────────────────────────────

  const createGroupFn = useCallback(async (input: GroupCreateInput) => {
    const group = await leagueRepo.createGroup(input);
    dispatch({ type: 'ADD_GROUP', payload: group });
    return group;
  }, []);

  const updateGroupFn = useCallback(async (id: string, updates: Partial<GroupCreateInput>) => {
    const group = await leagueRepo.updateGroup(id, updates);
    if (group) {
      dispatch({ type: 'UPDATE_GROUP', payload: group });
    }
    return group;
  }, []);

  const deleteGroupFn = useCallback(async (id: string) => {
    await leagueRepo.deleteGroup(id);
    dispatch({ type: 'REMOVE_GROUP', payload: id });
  }, []);

  // ─── Membership ───────────────────────────────────────────────────

  const addMember = useCallback(async (groupId: string, playerId: string, role?: GroupMemberRole) => {
    await leagueRepo.addGroupMember({ groupId, playerId, role });
    // Refresh members
    const members = await leagueRepo.getGroupMembers(groupId);
    dispatch({ type: 'SET_MEMBERS', payload: members });
  }, []);

  const removeMember = useCallback(async (groupId: string, playerId: string) => {
    await leagueRepo.removeGroupMember(groupId, playerId);
    const members = await leagueRepo.getGroupMembers(groupId);
    dispatch({ type: 'SET_MEMBERS', payload: members });
  }, []);

  const updateMemberRole = useCallback(async (memberId: string, role: GroupMemberRole) => {
    await leagueRepo.updateGroupMember(memberId, { role });
    // Members will be refreshed on next loadGroupDetail
  }, []);

  // ─── Seasons ──────────────────────────────────────────────────────

  const createSeasonFn = useCallback(async (input: SeasonCreateInput) => {
    const season = await leagueRepo.createSeason(input);
    return season;
  }, []);

  // ─── League Rounds ────────────────────────────────────────────────

  /**
   * Submit a completed Scorekeeper round to a league group.
   * Summarizes game points into per-player totals and creates league records.
   */
  const submitRoundToLeague = useCallback(async (roundId: string, groupId: string) => {
    // Check if already submitted
    const existing = await leagueRepo.getLeagueRoundByRoundId(roundId);
    if (existing) {
      throw new Error('This round has already been submitted to a league');
    }

    // Get the Scorekeeper round data
    const round = await roundRepo.getRoundById(roundId);
    if (!round) throw new Error('Round not found');

    // Get game points for the round
    const gamePoints = await roundRepo.getGamePointsForRound(roundId);
    const playerIds = round.players.map((p) => p.playerId);

    // Summarize points per player
    const pointTotals = leagueService.summarizeRoundPoints(gamePoints, playerIds);

    // Find the appropriate season
    const seasons = await leagueRepo.getSeasonsForGroup(groupId);
    const matchedSeason = leagueService.findSeasonForDate(seasons, round.date);

    // Create the league round
    const leagueRound = await leagueRepo.createLeagueRound({
      groupId,
      seasonId: matchedSeason?.id,
      roundId,
      roundDate: round.date,
      submittedAt: new Date().toISOString(),
    });

    // Create league scores for each player
    for (const [playerId, totalPoints] of pointTotals) {
      await leagueRepo.upsertLeagueScore({
        leagueRoundId: leagueRound.id,
        playerId,
        scoreValue: totalPoints,
      });
    }
  }, []);

  // ─── Standings ────────────────────────────────────────────────────

  const getSeasonStandings = useCallback(async (seasonId: string): Promise<PlayerStanding[]> => {
    const scores = await leagueRepo.getLeagueScoresForSeason(seasonId);
    return leagueService.calculateStandings(scores);
  }, []);

  // ─── Settlement ─────────────────────────────────────────────────

  const getRoundSettlement = useCallback(async (leagueRoundId: string): Promise<RoundSettlement> => {
    const round = await leagueRepo.getLeagueRoundById(leagueRoundId);
    if (!round) throw new Error('League round not found');
    const scores = await leagueRepo.getLeagueScoresForRound(leagueRoundId);
    return settlementService.calculateRoundSettlement(
      scores,
      round.scoresOverride,
      round.id,
      round.groupId,
      round.roundDate,
    );
  }, []);

  const getQuickPayoutForRound = useCallback((
    roundScores: LeagueScore[],
    scoresOverride: boolean,
  ): SettlementEntry[] => {
    const roundNets = leagueService.getRoundNetAmounts(roundScores, scoresOverride);
    return settlementService.buildSettlementEntries(roundNets);
  }, []);

  // ─── Player Stats ──────────────────────────────────────────────

  const getPlayerStatsFn = useCallback(async (playerId: string): Promise<PlayerStats> => {
    const groupId = state.activeGroup?.id;
    if (!groupId) throw new Error('No active group');

    // Season data from context state
    const seasonScores = state.seasonScores;
    const seasonRounds = state.seasonLeagueRounds;

    // Lifetime data: all scores + rounds for this player in this group
    const lifetimeScores = await leagueRepo.getPlayerScoresForGroup(playerId, groupId);
    const lifetimeRounds = await leagueRepo.getLeagueRoundsForGroup(groupId);

    return leagueService.calculatePlayerStats(
      playerId,
      seasonScores,
      seasonRounds,
      lifetimeScores,
      lifetimeRounds,
    );
  }, [state.activeGroup?.id, state.seasonScores, state.seasonLeagueRounds]);

  // ─── Head-to-Head ─────────────────────────────────────────────────

  const getHeadToHeadFn = useCallback((playerId: string): HeadToHeadEntry[] => {
    return leagueService.calculateHeadToHead(
      playerId,
      state.seasonScores,
      state.seasonLeagueRounds,
    );
  }, [state.seasonScores, state.seasonLeagueRounds]);

  // ─── Player Groups ────────────────────────────────────────────────

  const getPlayerGroups = useCallback(async (playerId: string): Promise<Group[]> => {
    return leagueRepo.getPlayerGroups(playerId);
  }, []);

  // ─── Home Group Standings ──────────────────────────────────────────

  const loadHomeGroupStandings = useCallback(async () => {
    try {
      let groupId = await appConfigRepo.getHomeGroupId();

      // Auto-pick first group if none set
      if (!groupId) {
        // Try the owner's groups first, then fall back to any available group
        let candidateGroups: Group[] = [];
        if (ownerPlayerId) {
          candidateGroups = await leagueRepo.getPlayerGroups(ownerPlayerId);
        }
        if (candidateGroups.length === 0) {
          candidateGroups = await leagueRepo.getAllGroups();
        }

        if (candidateGroups.length > 0) {
          groupId = candidateGroups[0].id;
          await appConfigRepo.setHomeGroupId(groupId);
        }
      }

      if (!groupId) {
        dispatch({ type: 'SET_HOME_GROUP', payload: { id: null, standings: null } });
        return;
      }

      const group = await leagueRepo.getGroupById(groupId);
      if (!group) {
        dispatch({ type: 'SET_HOME_GROUP', payload: { id: groupId, standings: null } });
        return;
      }

      const seasons = await leagueRepo.getSeasonsForGroup(groupId);
      const today = new Date().toISOString().split('T')[0];
      const currentSeason = leagueService.findSeasonForDate(seasons, today);

      if (!currentSeason) {
        dispatch({ type: 'SET_HOME_GROUP', payload: { id: groupId, standings: null } });
        return;
      }

      const scores = await leagueRepo.getLeagueScoresForSeason(currentSeason.id);
      const rounds = await leagueRepo.getLeagueRoundsForSeason(currentSeason.id);
      const netPositions = leagueService.calculateSeasonNetPositions(scores, rounds);

      // Clean up phantom owner membership left by removed auto-add logic:
      // If the owner is in this group but has zero scores across ALL group rounds,
      // they were phantom-added and should be removed.
      if (ownerPlayerId) {
        const isMember = await leagueRepo.isPlayerInGroup(groupId, ownerPlayerId);
        if (isMember) {
          const ownerGroupScores = await leagueRepo.getPlayerScoresForGroup(ownerPlayerId, groupId);
          if (ownerGroupScores.length === 0) {
            await leagueRepo.removeGroupMember(groupId, ownerPlayerId);
          }
        }
      }

      // Include all active group members (even those with 0 rounds in current season)
      const groupMembers = await leagueRepo.getActiveGroupMembers(groupId);
      for (const member of groupMembers) {
        if (!netPositions.has(member.playerId)) {
          netPositions.set(member.playerId, 0);
        }
      }

      // Count rounds per player from scores
      const roundCounts = new Map<string, number>();
      for (const [playerId] of netPositions) {
        roundCounts.set(playerId, 0);
      }
      // Each score has a leagueRoundId — count distinct rounds per player
      const playerRoundSets = new Map<string, Set<string>>();
      for (const score of scores) {
        if (!playerRoundSets.has(score.playerId)) {
          playerRoundSets.set(score.playerId, new Set());
        }
        playerRoundSets.get(score.playerId)!.add(score.leagueRoundId);
      }
      for (const [playerId, roundSet] of playerRoundSets) {
        roundCounts.set(playerId, roundSet.size);
      }

      // Resolve player display names
      const playerNames = new Map<string, string>();
      const allPlayers = await playerRepo.getAllPlayers();
      for (const [playerId] of netPositions) {
        const player = allPlayers.find((p) => p.id === playerId);
        playerNames.set(playerId, player?.nickname || player?.firstName || 'Unknown');
      }

      dispatch({
        type: 'SET_HOME_GROUP',
        payload: {
          id: groupId,
          standings: { group, season: currentSeason, netPositions, roundCounts, playerNames },
        },
      });
    } catch (err) {
      // Silently fail — home screen shows empty standings
      dispatch({ type: 'SET_HOME_GROUP', payload: { id: null, standings: null } });
    }
  }, [ownerPlayerId]);

  const setHomeGroup = useCallback(async (groupId: string | null) => {
    await appConfigRepo.setHomeGroupId(groupId);
    // Reload standings for the new group
    if (groupId) {
      dispatch({ type: 'SET_HOME_GROUP', payload: { id: groupId, standings: state.homeGroupStandings } });
    } else {
      dispatch({ type: 'SET_HOME_GROUP', payload: { id: null, standings: null } });
    }
    // Trigger a full reload
    await loadHomeGroupStandings();
  }, [loadHomeGroupStandings, state.homeGroupStandings]);

  // ─── Orphaned Score Reassignment ─────────────────────────────────

  const getOrphanedScores = useCallback(async () => {
    return leagueRepo.getOrphanedScoreInfo();
  }, []);

  const reassignScores = useCallback(async (fromPlayerId: string, toPlayerId: string) => {
    const result = await leagueRepo.reassignLeagueScores(fromPlayerId, toPlayerId);
    // Reload standings after reassignment
    if (result.reassigned > 0) {
      await loadHomeGroupStandings();
      if (state.activeSeason?.id) {
        await loadSeasonData(state.activeSeason.id);
      }
    }
    return result;
  }, [loadHomeGroupStandings, state.activeSeason?.id]);

  // ─── Glide Import ─────────────────────────────────────────────────

  const importGlideData = useCallback(async (data: {
    sections: GlideSectionRow[];
    groups: GlideGroupRow[];
    profiles: GlideUserProfileRow[];
    seasons: GlideSeasonRow[];
    rounds: GlideRoundRow[];
    scores: GlideScoreRow[];
  }): Promise<ImportStats> => {
    const stats: ImportStats = {
      sectionsCreated: 0,
      groupsCreated: 0,
      playersMatched: 0,
      playersCreated: 0,
      membershipsCreated: 0,
      seasonsCreated: 0,
      leagueRoundsCreated: 0,
      leagueScoresCreated: 0,
      warnings: [],
    };

    const idMap = createEmptyIdMap();

    // 1. Import sections
    const sectionInputs = transformSections(data.sections);
    for (const { glideRowId, input } of sectionInputs) {
      const section = await leagueRepo.createSection(input);
      idMap.sections.set(glideRowId, section.id);
      stats.sectionsCreated++;
    }

    // 2. Match/create players (need players before groups for admin FK)
    const existingPlayers = await playerRepo.getAllPlayers();
    const playerResult = matchAndTransformPlayers(data.profiles, existingPlayers, idMap);

    // Map matched players
    for (const [glideRowId, playerId] of playerResult.matches) {
      idMap.players.set(glideRowId, playerId);
      stats.playersMatched++;
    }

    // Create new players
    for (const { glideRowId, input } of playerResult.newPlayers) {
      const player = await playerRepo.createPlayer(input);
      idMap.players.set(glideRowId, player.id);

      // Also map any duplicate Glide rows for same email
      for (const profile of data.profiles) {
        if (
          profile.email &&
          input.email &&
          profile.email.toLowerCase() === input.email.toLowerCase() &&
          !idMap.players.has(profile.rowId)
        ) {
          idMap.players.set(profile.rowId, player.id);
        }
      }
      stats.playersCreated++;
    }

    // Update venmo handles on matched players
    for (const [playerId, venmoHandle] of playerResult.venmoUpdates) {
      await playerRepo.updatePlayer(playerId, { venmoHandle });
    }

    // 3. Import groups (depends on sections + players for admin)
    const groupInputs = transformGroups(data.groups, idMap);
    for (const { glideRowId, input } of groupInputs) {
      const group = await leagueRepo.createGroup(input);
      idMap.groups.set(glideRowId, group.id);
      stats.groupsCreated++;
    }

    // 4. Create group memberships
    // Re-run matchAndTransformPlayers now that groups are in the idMap
    const memberResult = matchAndTransformPlayers(data.profiles, existingPlayers, idMap);
    for (const { glideRowId, input } of memberResult.memberships) {
      // Resolve the player ID from the profile's Glide row ID
      const playerId = idMap.players.get(glideRowId);
      if (!playerId || !input.groupId) continue;

      try {
        await leagueRepo.addGroupMember({
          ...input,
          playerId,
        });
        stats.membershipsCreated++;
      } catch (err) {
        // Likely a UNIQUE constraint violation (duplicate membership)
        stats.warnings.push(`Duplicate membership skipped for player ${playerId} in group ${input.groupId}`);
      }
    }

    // 5. Import seasons
    const seasonInputs = transformSeasons(data.seasons, idMap);
    for (const { glideRowId, input } of seasonInputs) {
      if (!input.groupId) {
        stats.warnings.push(`Season ${glideRowId} has no valid group mapping`);
        continue;
      }
      const season = await leagueRepo.createSeason(input);
      idMap.seasons.set(glideRowId, season.id);
      stats.seasonsCreated++;
    }

    // 6. Import league rounds (needs seasons for auto-assignment)
    const allSeasons: Season[] = [];
    for (const seasonId of idMap.seasons.values()) {
      const season = await leagueRepo.getSeasonById(seasonId);
      if (season) allSeasons.push(season);
    }

    const roundInputs = transformLeagueRounds(data.rounds, allSeasons, idMap);
    for (const { glideRowId, input } of roundInputs) {
      if (!input.groupId) {
        stats.warnings.push(`Round ${glideRowId} has no valid group mapping`);
        continue;
      }
      const lr = await leagueRepo.createLeagueRound(input);
      idMap.leagueRounds.set(glideRowId, lr.id);
      stats.leagueRoundsCreated++;
    }

    // 7. Import league scores
    const scoreInputs = transformLeagueScores(data.scores, idMap);
    for (const { input } of scoreInputs) {
      await leagueRepo.upsertLeagueScore(input);
      stats.leagueScoresCreated++;
    }

    // Refresh groups in state
    await loadGroups();

    return stats;
  }, [loadGroups]);

  // ─── Clear + Re-import ──────────────────────────────────────────────

  const clearAndReimportGlideData = useCallback(async (data: {
    sections: GlideSectionRow[];
    groups: GlideGroupRow[];
    profiles: GlideUserProfileRow[];
    seasons: GlideSeasonRow[];
    rounds: GlideRoundRow[];
    scores: GlideScoreRow[];
  }): Promise<ImportStats> => {
    // 1. Clear all league data
    await leagueRepo.clearAllLeagueData();

    // 2. Clear home group ID (old group IDs are gone)
    await appConfigRepo.setHomeGroupId(null);
    dispatch({ type: 'SET_HOME_GROUP', payload: { id: null, standings: null } });
    dispatch({ type: 'CLEAR_ACTIVE_GROUP' });

    // 3. Run fresh import
    const stats = await importGlideData(data);

    // 4. Reload home standings (auto-pick will kick in)
    await loadHomeGroupStandings();

    return stats;
  }, [importGlideData, loadHomeGroupStandings]);

  return (
    <GroupContext.Provider
      value={{
        state,
        permissions,
        loadGroups,
        loadSections,
        loadGroupDetail,
        loadSeasonData,
        createGroup: createGroupFn,
        updateGroup: updateGroupFn,
        deleteGroup: deleteGroupFn,
        addMember,
        removeMember,
        updateMemberRole,
        createSeason: createSeasonFn,
        submitRoundToLeague,
        getSeasonStandings,
        getRoundSettlement,
        getQuickPayoutForRound,
        getPlayerStats: getPlayerStatsFn,
        getHeadToHead: getHeadToHeadFn,
        getPlayerGroups,
        loadHomeGroupStandings,
        setHomeGroup,
        getOrphanedScores,
        reassignScores,
        importGlideData,
        clearAndReimportGlideData,
      }}
    >
      {children}
    </GroupContext.Provider>
  );
}

export function useGroups() {
  const context = useContext(GroupContext);
  if (!context) throw new Error('useGroups must be used within GroupProvider');
  return context;
}
