export type BettingGameType =
  | 'nassau'
  | 'skins'
  | 'baseball_3man'
  | 'baseball_4man'
  | 'wolf'
  | 'stableford'
  | 'bingo_bango_bongo'
  | 'dots'
  | 'team_match'
  | 'custom';

export interface BettingGame {
  id: string;
  roundId: string;
  type: BettingGameType;
  name: string;
  stakes: number; // Base unit amount (e.g., $2 per point)
  useNetScores: boolean;
  config: Record<string, unknown>; // Game-specific configuration
  createdAt: string;
}

export interface BettingGameCreateInput {
  roundId: string;
  type: BettingGameType;
  name: string;
  stakes?: number;
  useNetScores?: boolean;
  config?: Record<string, unknown>;
}

/** Nassau-specific config */
export interface NassauConfig {
  frontNineStake: number;
  backNineStake: number;
  overallStake: number;
  autoPresses: boolean;
  pressAfterDown: number; // Auto-press when down by N holes
}

/** Skins-specific config */
export interface SkinsConfig {
  carryOver: boolean; // Carry over ties to next hole
  perSkinValue: number;
}

/** Wolf-specific config */
export interface WolfConfig {
  playerOrder: string[]; // Player IDs in wolf rotation order
  teamPoints: number; // Points for team play (default 2)
  loneWolfPoints: number; // Points for lone wolf (default 4)
  wolfHitsFirst: boolean; // true = wolf tees off first; false (default) = wolf tees off last
  loneWolfJunk3x: boolean; // true = lone wolf gets 3× junk points
  sharedJunk: boolean; // true = wolf team shares junk dots
}

/** Stableford-specific config */
export interface StablefordConfig {
  useModifiedStableford: boolean; // Standard vs modified scoring
  // Standard Stableford: albatross=5, eagle=4, birdie=3, par=2, bogey=1, double+=0
}

/** Baseball-specific config (3-man and 4-man) */
export interface BaseballConfig {
  // No user-configurable options — carryover is always on, net scores always used.
}

/** Dots/Junk-specific config */
export interface DotsConfig {
  activeDots: string[]; // Which dot types are enabled
  pointsPerDot: number; // How many points each dot is worth (default 1)
  junkMultiplier: number; // Relative value vs main games: 0.5, 1, or 2 (default 1)
}

/** Team Match config — team pairings/rotation/format live on Round.teamConfig */
export interface TeamMatchConfig {
  pointsPerHoleWon: number; // Points each winning-team player earns per hole (default 1)
  // For low_vs_low_high_vs_high format: independent point values per sub-match
  lowMatchPoints?: number;  // Points for winning the low net vs low net sub-bet
  highMatchPoints?: number; // Points for winning the high net vs high net sub-bet
}

/** Result for a single player in a betting game */
export interface BettingResult {
  playerId: string;
  gameId: string;
  netAmount: number; // Positive = winnings, negative = losses
  details: string; // Human-readable breakdown
}
