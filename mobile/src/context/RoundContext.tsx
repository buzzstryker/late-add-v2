import React, { createContext, useContext, useReducer, useCallback, useEffect, ReactNode } from 'react';
import { Round, RoundCreateInput, RoundStatus } from '../models/Round';
import { Score, ScoreCreateInput } from '../models/Score';
import { GamePoint, GamePointInput } from '../models/GamePoint';
import { BettingGame, BettingGameCreateInput } from '../models/BettingGame';
import { Course, HoleInfo } from '../models/Course';
import * as roundRepo from '../db/roundRepository';
import * as courseRepo from '../db/courseRepository';
import * as bettingGameRepo from '../db/bettingGameRepository';
import * as wolfChoiceRepo from '../db/wolfChoiceRepository';
import { WolfChoice, WolfChoiceInput } from '../db/wolfChoiceRepository';
import { getCourseHandicap, calculatePlayingHandicaps, calculateNetScore } from '../services/handicapService';
import { getHolesForRoundType, getHoleRange, splitHolesIntoNines, getActiveNineIndex } from '../services/roundService';
import { calculateGamePoints, isAutoCalculated } from '../services/betting/bettingService';
import { calculateWolfHolePoints, getWolfJunkTeammateIds } from '../services/betting/wolfCalculator';
import { WolfConfig } from '../models/BettingGame';
import { Player } from '../models/Player';
import { useSync } from './SyncContext';
import { usePlayers } from './PlayerContext';

// Re-export UI helpers so screens import from context layer, not services directly
export { getScoreLabel, getScoreColor, getCourseHandicap, getNetDoubleBogey } from '../services/handicapService';
export {
  getGameTypeDisplayName, getGameTypeDescription, getGameTypeIcon,
  isAutoCalculated, isManualCallout, isMainGame, isJunkGame, getDefaultConfig, AVAILABLE_DOTS,
  isBaseballCarryHole, hasBaseballCarryInto, getDotPointValue, getAutoAwardDots, getAutoAwardDotDisplayName,
  getHolesByPar, getGreenieWinnerOnHole, getGreenieCarryInfo, getSweepieInfo, getDynamicOuzelValue,
  getDynamicDotPointValue, calcDynamicDotPoints,
  getWolfForHole, getWolfHittingOrder,
} from '../services/betting/bettingService';
export type { GreenieRoundContext, GreenieCarryInfo, SweepieInfo } from '../services/betting/bettingService';

// Re-export wolf types and helpers for screens
export type { WolfChoice, WolfChoiceInput } from '../db/wolfChoiceRepository';
export { getWolfJunkTeammateIds } from '../services/betting/wolfCalculator';

// Re-export team helpers for screens
export {
  getTeamPairingForHole, getPlayerTeam, getTeammates, getSharedJunkPlayerIds,
  getTeamPeriodForHole, isTeamRotationBoundary,
} from '../services/teamService';

export type EnrichedRound = Round & { courseName?: string };

interface RoundState {
  activeRound: Round | null;
  activeCourse: Course | null;
  scores: Score[];
  gamePoints: GamePoint[];
  bettingGames: BettingGame[];
  wolfChoices: WolfChoice[];
  allRounds: EnrichedRound[];
  recentRounds: EnrichedRound[];
  activeRounds: EnrichedRound[];
  isLoading: boolean;
  error: string | null;
}

type RoundAction =
  | { type: 'SET_ACTIVE_ROUND'; payload: { round: Round; course: Course } }
  | { type: 'UPDATE_ROUND'; payload: Round }
  | { type: 'SET_SCORES'; payload: Score[] }
  | { type: 'UPSERT_SCORE'; payload: Score }
  | { type: 'SET_GAME_POINTS'; payload: GamePoint[] }
  | { type: 'UPSERT_GAME_POINT'; payload: GamePoint }
  | { type: 'SET_BETTING_GAMES'; payload: BettingGame[] }
  | { type: 'ADD_BETTING_GAME'; payload: BettingGame }
  | { type: 'REMOVE_BETTING_GAME'; payload: string }
  | { type: 'SET_WOLF_CHOICES'; payload: WolfChoice[] }
  | { type: 'UPSERT_WOLF_CHOICE'; payload: WolfChoice }
  | { type: 'CLEAR_ROUND' }
  | { type: 'SET_ALL_ROUNDS'; payload: EnrichedRound[] }
  | { type: 'SET_RECENT_ROUNDS'; payload: EnrichedRound[] }
  | { type: 'SET_ACTIVE_ROUNDS'; payload: EnrichedRound[] }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null };

const initialState: RoundState = {
  activeRound: null,
  activeCourse: null,
  scores: [],
  gamePoints: [],
  bettingGames: [],
  wolfChoices: [],
  allRounds: [],
  recentRounds: [],
  activeRounds: [],
  isLoading: false,
  error: null,
};

function roundReducer(state: RoundState, action: RoundAction): RoundState {
  switch (action.type) {
    case 'SET_ACTIVE_ROUND':
      return { ...state, activeRound: action.payload.round, activeCourse: action.payload.course, isLoading: false };
    case 'UPDATE_ROUND':
      return { ...state, activeRound: action.payload };
    case 'SET_SCORES':
      return { ...state, scores: action.payload };
    case 'UPSERT_SCORE': {
      const existing = state.scores.findIndex(
        (s) => s.roundId === action.payload.roundId &&
               s.playerId === action.payload.playerId &&
               s.holeNumber === action.payload.holeNumber
      );
      if (existing >= 0) {
        const updated = [...state.scores];
        updated[existing] = action.payload;
        return { ...state, scores: updated };
      }
      return { ...state, scores: [...state.scores, action.payload] };
    }
    case 'SET_GAME_POINTS':
      return { ...state, gamePoints: action.payload };
    case 'UPSERT_GAME_POINT': {
      const existingGP = state.gamePoints.findIndex(
        (gp) => gp.roundId === action.payload.roundId &&
                 gp.gameId === action.payload.gameId &&
                 gp.playerId === action.payload.playerId &&
                 gp.holeNumber === action.payload.holeNumber
      );
      if (existingGP >= 0) {
        const updatedGP = [...state.gamePoints];
        updatedGP[existingGP] = action.payload;
        return { ...state, gamePoints: updatedGP };
      }
      return { ...state, gamePoints: [...state.gamePoints, action.payload] };
    }
    case 'SET_BETTING_GAMES':
      return { ...state, bettingGames: action.payload };
    case 'ADD_BETTING_GAME':
      return { ...state, bettingGames: [...state.bettingGames, action.payload] };
    case 'REMOVE_BETTING_GAME':
      return { ...state, bettingGames: state.bettingGames.filter((g) => g.id !== action.payload) };
    case 'SET_WOLF_CHOICES':
      return { ...state, wolfChoices: action.payload };
    case 'UPSERT_WOLF_CHOICE': {
      const existingWC = state.wolfChoices.findIndex(
        (wc) => wc.roundId === action.payload.roundId &&
                 wc.gameId === action.payload.gameId &&
                 wc.holeNumber === action.payload.holeNumber
      );
      if (existingWC >= 0) {
        const updatedWC = [...state.wolfChoices];
        updatedWC[existingWC] = action.payload;
        return { ...state, wolfChoices: updatedWC };
      }
      return { ...state, wolfChoices: [...state.wolfChoices, action.payload] };
    }
    case 'CLEAR_ROUND':
      return { ...state, activeRound: null, activeCourse: null, scores: [], gamePoints: [], bettingGames: [], wolfChoices: [] };
    case 'SET_ALL_ROUNDS':
      return { ...state, allRounds: action.payload };
    case 'SET_RECENT_ROUNDS':
      return { ...state, recentRounds: action.payload };
    case 'SET_ACTIVE_ROUNDS':
      return { ...state, activeRounds: action.payload };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false };
    default:
      return state;
  }
}

interface RoundContextType {
  state: RoundState;
  createRound: (input: RoundCreateInput, players: Player[]) => Promise<Round>;
  loadRound: (roundId: string) => Promise<void>;
  loadAllRounds: () => Promise<void>;
  loadRecentRounds: (limit?: number) => Promise<void>;
  loadActiveRounds: () => Promise<void>;
  startRound: () => Promise<void>;
  completeRound: () => Promise<void>;
  deleteRound: () => Promise<void>;
  deleteRoundById: (id: string) => Promise<void>;
  recordScore: (input: ScoreCreateInput) => Promise<Score>;
  recordGamePoint: (input: GamePointInput) => Promise<GamePoint>;
  createBettingGame: (input: BettingGameCreateInput) => Promise<BettingGame>;
  removeBettingGame: (gameId: string) => Promise<void>;
  advanceHole: () => Promise<void>;
  goToHole: (holeNumber: number) => Promise<void>;
  getHoleInfo: (holeNumber: number) => HoleInfo | undefined;
  getPlayerStrokes: (playerId: string, holeNumber: number) => number;
  recordWolfChoice: (input: WolfChoiceInput) => Promise<void>;
  getWolfChoiceForHole: (gameId: string, holeNumber: number) => WolfChoice | undefined;
  roundHoles: HoleInfo[];
  splitNines: { label: string; holes: HoleInfo[] }[];
  activeNineIndex: number;
  getLastTeeSelections: (courseId: string, playerIds: string[]) => Promise<Record<string, string>>;
  /** True when the current device user is the app owner (super_admin). Controls round deletion. */
  isAppOwner: boolean;
}

const RoundContext = createContext<RoundContextType | undefined>(undefined);

export function RoundProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(roundReducer, initialState);
  const { state: syncState } = useSync();
  const { ownerPlayerId } = usePlayers();
  const appOwner = ownerPlayerId != null;

  // Reload round lists when sync pulls new data
  useEffect(() => {
    if (syncState.lastPullCompletedAt > 0) {
      loadRecentRounds();
    }
  }, [syncState.lastPullCompletedAt]);

  const createRound = useCallback(async (input: RoundCreateInput, players: Player[]) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const round = await roundRepo.createRound(input);
      const course = await courseRepo.getCourseById(input.courseId);
      if (!course) throw new Error('Course not found');

      // Calculate handicaps for each player
      const playerHandicaps = input.players.map((rp) => {
        const player = players.find((p) => p.id === rp.playerId);
        const teeBox = course.teeBoxes.find((t) => t.id === rp.teeBoxId);
        if (!player || !teeBox) throw new Error('Player or tee box not found');
        return {
          playerId: rp.playerId,
          courseHandicap: getCourseHandicap(player.handicapIndex, teeBox),
        };
      });

      const playingHandicaps = calculatePlayingHandicaps(playerHandicaps, input.handicapMode || 'full');
      await roundRepo.updateRoundPlayerHandicaps(round.id, playingHandicaps);

      const updatedRound = await roundRepo.getRoundById(round.id);
      dispatch({ type: 'SET_ACTIVE_ROUND', payload: { round: updatedRound!, course } });
      return updatedRound!;
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err.message || 'Failed to create round' });
      throw err;
    }
  }, []);

  const loadRound = useCallback(async (roundId: string) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const round = await roundRepo.getRoundById(roundId);
      if (!round) throw new Error('Round not found');
      const course = await courseRepo.getCourseById(round.courseId);
      if (!course) throw new Error('Course not found');
      const [scores, gamePoints, bettingGames] = await Promise.all([
        roundRepo.getScoresForRound(roundId),
        roundRepo.getGamePointsForRound(roundId),
        bettingGameRepo.getBettingGamesForRound(roundId),
      ]);
      // Load wolf choices for all wolf games
      const wolfGames = bettingGames.filter((g) => g.type === 'wolf');
      let allWolfChoices: WolfChoice[] = [];
      for (const wg of wolfGames) {
        const choices = await wolfChoiceRepo.getWolfChoicesForRound(roundId, wg.id);
        allWolfChoices = allWolfChoices.concat(choices);
      }

      dispatch({ type: 'SET_ACTIVE_ROUND', payload: { round, course } });
      dispatch({ type: 'SET_SCORES', payload: scores });
      dispatch({ type: 'SET_GAME_POINTS', payload: gamePoints });
      dispatch({ type: 'SET_BETTING_GAMES', payload: bettingGames });
      dispatch({ type: 'SET_WOLF_CHOICES', payload: allWolfChoices });
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err.message || 'Failed to load round' });
    }
  }, []);

  const enrichRounds = useCallback(async (rounds: Round[]): Promise<EnrichedRound[]> => {
    return Promise.all(
      rounds.map(async (r) => {
        const course = await courseRepo.getCourseById(r.courseId);
        return { ...r, courseName: course?.name };
      })
    );
  }, []);

  const loadAllRounds = useCallback(async () => {
    try {
      const rounds = await roundRepo.getAllRounds();
      dispatch({ type: 'SET_ALL_ROUNDS', payload: await enrichRounds(rounds) });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: 'Failed to load rounds' });
    }
  }, [enrichRounds]);

  const loadRecentRounds = useCallback(async (limit: number = 5) => {
    try {
      const [recent, active] = await Promise.all([
        roundRepo.getRecentRounds(limit),
        roundRepo.getActiveRounds(),
      ]);
      dispatch({ type: 'SET_RECENT_ROUNDS', payload: await enrichRounds(recent) });
      dispatch({ type: 'SET_ACTIVE_ROUNDS', payload: await enrichRounds(active) });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: 'Failed to load recent rounds' });
    }
  }, [enrichRounds]);

  const loadActiveRounds = useCallback(async () => {
    try {
      const active = await roundRepo.getActiveRounds();
      dispatch({ type: 'SET_ACTIVE_ROUNDS', payload: await enrichRounds(active) });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', payload: 'Failed to load active rounds' });
    }
  }, [enrichRounds]);

  const startRound = useCallback(async () => {
    if (!state.activeRound) return;
    const { start } = getHoleRange(state.activeRound.roundType);
    await roundRepo.updateCurrentHole(state.activeRound.id, start);
    await roundRepo.updateRoundStatus(state.activeRound.id, 'in_progress');
    const updated = await roundRepo.getRoundById(state.activeRound.id);
    if (updated) dispatch({ type: 'UPDATE_ROUND', payload: updated });
  }, [state.activeRound]);

  const completeRound = useCallback(async () => {
    if (!state.activeRound) return;
    await roundRepo.updateRoundStatus(state.activeRound.id, 'completed');
    const updated = await roundRepo.getRoundById(state.activeRound.id);
    if (updated) dispatch({ type: 'UPDATE_ROUND', payload: updated });
  }, [state.activeRound]);

  const deleteRound = useCallback(async () => {
    if (!state.activeRound) return;
    // Only app owner (super_admin) can delete rounds
    if (!appOwner) return;
    await roundRepo.deleteRound(state.activeRound.id);
    dispatch({ type: 'CLEAR_ROUND' });
  }, [state.activeRound, appOwner]);

  const deleteRoundById = useCallback(async (id: string) => {
    // Only app owner (super_admin) can delete rounds
    if (!appOwner) return;
    await roundRepo.deleteRound(id);
    dispatch({ type: 'SET_ALL_ROUNDS', payload: state.allRounds.filter((r) => r.id !== id) });
    dispatch({ type: 'SET_RECENT_ROUNDS', payload: state.recentRounds.filter((r) => r.id !== id) });
    dispatch({ type: 'SET_ACTIVE_ROUNDS', payload: state.activeRounds.filter((r) => r.id !== id) });
  }, [state.allRounds, state.recentRounds, state.activeRounds, appOwner]);

  // Derive the effective playing handicap for a player, using the round's
  // handicap mode and the stored courseHandicap. For 'full' mode the player
  // uses their full courseHandicap; for 'spin_off_low' the stored
  // playingHandicap (differential from the lowest) is used.
  const getEffectiveHandicap = useCallback((roundPlayer: { courseHandicap: number; playingHandicap: number }) => {
    if (!state.activeRound) return roundPlayer.playingHandicap;
    return state.activeRound.handicapMode === 'full'
      ? roundPlayer.courseHandicap
      : roundPlayer.playingHandicap;
  }, [state.activeRound]);

  const recordScore = useCallback(async (input: ScoreCreateInput) => {
    if (!state.activeRound || !state.activeCourse) throw new Error('No active round');

    const roundPlayer = state.activeRound.players.find((p) => p.playerId === input.playerId);
    if (!roundPlayer) throw new Error('Player not in round');

    const hole = state.activeCourse.holes.find((h) => h.holeNumber === input.holeNumber);
    if (!hole) throw new Error('Hole not found');

    const effectiveHdcp = getEffectiveHandicap(roundPlayer);
    const netScore = calculateNetScore(input.grossScore, effectiveHdcp, hole.strokeIndex);
    const score = await roundRepo.upsertScore(input, netScore);
    dispatch({ type: 'UPSERT_SCORE', payload: score });

    // Read fresh scores from DB to avoid stale React state when multiple
    // scores are recorded in the same render cycle (voice scoring, rapid taps).
    const updatedScores = await roundRepo.getScoresForRound(state.activeRound.id);

    // Auto-calculate game points for auto-calculated betting games
    const autoGames = state.bettingGames.filter((g) => isAutoCalculated(g.type));
    if (autoGames.length > 0) {
      const playerIds = state.activeRound.players.map((p) => p.playerId);
      const holeNumbers = getHolesForRoundType(state.activeCourse.holes, state.activeRound.roundType)
        .map((h) => h.holeNumber);

      for (const game of autoGames) {
        const pointInputs = calculateGamePoints(
          game, input.holeNumber, updatedScores, playerIds, holeNumbers,
          state.activeRound?.teamConfig,
        );
        for (const gpInput of pointInputs) {
          const gp = await roundRepo.upsertGamePoint(gpInput);
          dispatch({ type: 'UPSERT_GAME_POINT', payload: gp });
        }
      }
    }

    // Recalculate wolf points if a choice exists for this hole
    const wolfGames = state.bettingGames.filter((g) => g.type === 'wolf');
    for (const wolfGame of wolfGames) {
      const choice = state.wolfChoices.find(
        (c) => c.gameId === wolfGame.id && c.holeNumber === input.holeNumber,
      );
      if (choice) {
        const wolfConfig = wolfGame.config as unknown as WolfConfig;
        const holeScores = updatedScores.filter((s) => s.holeNumber === input.holeNumber);
        const wolfPointInputs = calculateWolfHolePoints(
          state.activeRound.id, wolfGame.id, input.holeNumber,
          holeScores, choice, wolfConfig.teamPoints ?? 2,
        );
        for (const gpInput of wolfPointInputs) {
          const gp = await roundRepo.upsertGamePoint(gpInput);
          dispatch({ type: 'UPSERT_GAME_POINT', payload: gp });
        }
      }
    }

    return score;
  }, [state.activeRound, state.activeCourse, state.bettingGames, state.wolfChoices, getEffectiveHandicap]);

  const recordGamePoint = useCallback(async (input: GamePointInput) => {
    if (!state.activeRound) throw new Error('No active round');
    const gp = await roundRepo.upsertGamePoint(input);
    dispatch({ type: 'UPSERT_GAME_POINT', payload: gp });
    return gp;
  }, [state.activeRound]);

  /** Store a wolf partner/lone choice and auto-calculate wolf points from current scores. */
  const recordWolfChoice = useCallback(async (input: WolfChoiceInput) => {
    if (!state.activeRound) throw new Error('No active round');

    // Persist the choice
    const choice = await wolfChoiceRepo.upsertWolfChoice(input);
    dispatch({ type: 'UPSERT_WOLF_CHOICE', payload: choice });

    // Find the wolf game and calculate points with current scores
    const wolfGame = state.bettingGames.find((g) => g.id === input.gameId);
    if (!wolfGame || wolfGame.type !== 'wolf') return;

    const config = wolfGame.config as unknown as WolfConfig;
    const teamPoints = config.teamPoints ?? 2;
    const holeScores = state.scores.filter((s) => s.holeNumber === input.holeNumber);

    const pointInputs = calculateWolfHolePoints(
      input.roundId, input.gameId, input.holeNumber, holeScores, choice, teamPoints,
    );
    for (const gpInput of pointInputs) {
      const gp = await roundRepo.upsertGamePoint(gpInput);
      dispatch({ type: 'UPSERT_GAME_POINT', payload: gp });
    }
  }, [state.activeRound, state.bettingGames, state.scores]);

  /** Look up the wolf choice for a given game + hole from React state (no DB hit). */
  const getWolfChoiceForHole = useCallback((gameId: string, holeNumber: number) => {
    return state.wolfChoices.find(
      (wc) => wc.gameId === gameId && wc.holeNumber === holeNumber,
    );
  }, [state.wolfChoices]);

  const createBettingGame = useCallback(async (input: BettingGameCreateInput) => {
    const game = await bettingGameRepo.createBettingGame(input);
    dispatch({ type: 'ADD_BETTING_GAME', payload: game });
    return game;
  }, []);

  const removeBettingGame = useCallback(async (gameId: string) => {
    await bettingGameRepo.deleteBettingGame(gameId);
    dispatch({ type: 'REMOVE_BETTING_GAME', payload: gameId });
  }, []);

  const roundHoles = React.useMemo(() => {
    if (!state.activeCourse || !state.activeRound) return [];
    return getHolesForRoundType(state.activeCourse.holes, state.activeRound.roundType);
  }, [state.activeCourse, state.activeRound]);

  const splitNines = React.useMemo(() => {
    if (!state.activeCourse || !state.activeRound) return [];
    return splitHolesIntoNines(state.activeCourse.holes, state.activeRound.roundType);
  }, [state.activeCourse, state.activeRound]);

  const activeNineIndex = React.useMemo(() => {
    if (!state.activeRound) return 0;
    return getActiveNineIndex(
      state.activeRound.currentHole,
      state.activeRound.roundType,
      state.scores,
      state.activeRound.players.length
    );
  }, [state.activeRound, state.scores]);

  const advanceHole = useCallback(async () => {
    if (!state.activeRound) return;
    const { end } = getHoleRange(state.activeRound.roundType);
    const nextHole = Math.min(state.activeRound.currentHole + 1, end);
    await roundRepo.updateCurrentHole(state.activeRound.id, nextHole);
    const updated = await roundRepo.getRoundById(state.activeRound.id);
    if (updated) dispatch({ type: 'UPDATE_ROUND', payload: updated });
  }, [state.activeRound]);

  const goToHole = useCallback(async (holeNumber: number) => {
    if (!state.activeRound) return;
    const { start, end } = getHoleRange(state.activeRound.roundType);
    const clamped = Math.max(start, Math.min(end, holeNumber));
    await roundRepo.updateCurrentHole(state.activeRound.id, clamped);
    const updated = await roundRepo.getRoundById(state.activeRound.id);
    if (updated) dispatch({ type: 'UPDATE_ROUND', payload: updated });
  }, [state.activeRound]);

  const getHoleInfo = useCallback((holeNumber: number) => {
    return state.activeCourse?.holes.find((h) => h.holeNumber === holeNumber);
  }, [state.activeCourse]);

  const getPlayerStrokes = useCallback((playerId: string, holeNumber: number) => {
    if (!state.activeRound || !state.activeCourse) return 0;
    const roundPlayer = state.activeRound.players.find((p) => p.playerId === playerId);
    const hole = state.activeCourse.holes.find((h) => h.holeNumber === holeNumber);
    if (!roundPlayer || !hole) return 0;

    const { getStrokesOnHole } = require('../services/handicapService');
    const effectiveHdcp = getEffectiveHandicap(roundPlayer);
    return getStrokesOnHole(effectiveHdcp, hole.strokeIndex);
  }, [state.activeRound, state.activeCourse, getEffectiveHandicap]);

  const getLastTeeSelections = useCallback(async (courseId: string, playerIds: string[]) => {
    return roundRepo.getLastTeeSelections(courseId, playerIds);
  }, []);

  return (
    <RoundContext.Provider
      value={{
        state,
        createRound,
        loadRound,
        loadAllRounds,
        loadRecentRounds,
        loadActiveRounds,
        startRound,
        completeRound,
        deleteRound,
        deleteRoundById,
        recordScore,
        recordGamePoint,
        recordWolfChoice,
        getWolfChoiceForHole,
        createBettingGame,
        removeBettingGame,
        advanceHole,
        goToHole,
        getHoleInfo,
        getPlayerStrokes,
        roundHoles,
        splitNines,
        activeNineIndex,
        getLastTeeSelections,
        isAppOwner: appOwner,
      }}
    >
      {children}
    </RoundContext.Provider>
  );
}

export function useRound() {
  const context = useContext(RoundContext);
  if (!context) throw new Error('useRound must be used within RoundProvider');
  return context;
}
