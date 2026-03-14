// ── Section ──

export interface Section {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SectionCreateInput {
  name: string;
}

// ── Group ──

export interface Group {
  id: string;
  name: string;
  logoUrl?: string;
  sectionId?: string;
  adminPlayerId?: string;
  seasonStartMonth: number; // 1-12
  createdAt: string;
  updatedAt: string;
}

export interface GroupCreateInput {
  name: string;
  logoUrl?: string;
  sectionId?: string;
  adminPlayerId?: string;
  seasonStartMonth: number;
}

// ── Group Member ──

export type GroupMemberRole = 'member' | 'admin';

export interface GroupMember {
  id: string;
  groupId: string;
  playerId: string;
  role: GroupMemberRole;
  isActive: boolean;
  joinedAt: string;
}

export interface GroupMemberCreateInput {
  groupId: string;
  playerId: string;
  role?: GroupMemberRole;
  isActive?: boolean;
}

// ── Season ──

export interface Season {
  id: string;
  groupId: string;
  startDate: string; // ISO date (YYYY-MM-DD)
  endDate: string;   // ISO date (YYYY-MM-DD)
  createdAt: string;
  updatedAt: string;
}

export interface SeasonCreateInput {
  groupId: string;
  startDate: string;
  endDate: string;
}

// ── League Round ──

export interface LeagueRound {
  id: string;
  groupId: string;
  seasonId?: string;
  roundId?: string;       // null for historical/imported rounds
  roundDate: string;      // ISO date
  submittedAt?: string;
  scoresOverride: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LeagueRoundCreateInput {
  groupId: string;
  seasonId?: string;
  roundId?: string;
  roundDate: string;
  submittedAt?: string;
  scoresOverride?: boolean;
}

// ── League Score ──

export interface LeagueScore {
  id: string;
  leagueRoundId: string;
  playerId: string;
  scoreValue: number | null;   // total game points for this round
  scoreOverride: number | null; // manual override
  createdAt: string;
  updatedAt: string;
}

export interface LeagueScoreCreateInput {
  leagueRoundId: string;
  playerId: string;
  scoreValue?: number | null;
  scoreOverride?: number | null;
}

/** Effective score: override wins if set, otherwise scoreValue */
export function getEffectiveLeagueScore(score: LeagueScore): number | null {
  return score.scoreOverride ?? score.scoreValue;
}

// ── Payout Config ──

export interface PayoutTier {
  id: string;
  groupId: string;
  tierIndex: number;
  config: Record<string, unknown>; // group-specific payout rules
  createdAt: string;
}

export interface PayoutTierCreateInput {
  groupId: string;
  tierIndex: number;
  config?: Record<string, unknown>;
}

// ── Standings (computed, not persisted) ──

export interface PlayerStanding {
  playerId: string;
  totalPoints: number;
  roundsPlayed: number;
  averagePoints: number;
  rank: number;
}

export interface SeasonStandings {
  seasonId: string;
  groupId: string;
  standings: PlayerStanding[];
}
