import { TeamConfig } from './Team';

export type RoundStatus = 'setup' | 'in_progress' | 'completed' | 'abandoned';
export type RoundType = 'full_18' | 'front_9' | 'back_9';
export type HandicapMode = 'full' | 'spin_off_low';

export interface RoundPlayer {
  playerId: string;
  teeBoxId: string;
  courseHandicap: number; // Calculated from index + tee box
  playingHandicap: number; // Strokes used for allocation (full CH or spun-off)
  strokesReceived: number; // Same as playingHandicap
}

export interface Round {
  id: string;
  courseId: string;
  roundType: RoundType;
  handicapMode: HandicapMode;
  status: RoundStatus;
  date: string; // ISO date
  players: RoundPlayer[];
  bettingGameIds: string[];
  roundCode?: string; // 6-char code for multi-device join
  currentHole: number; // Track which hole is active
  startTime?: string;
  endTime?: string;
  notes?: string;
  teamConfig?: TeamConfig; // null/undefined = individual play (backward compatible)
  createdAt: string;
  updatedAt: string;
}

export interface RoundCreateInput {
  courseId: string;
  roundType: RoundType;
  handicapMode?: HandicapMode; // Defaults to 'full'
  players: Omit<RoundPlayer, 'courseHandicap' | 'playingHandicap' | 'strokesReceived'>[];
  bettingGameIds?: string[];
  teamConfig?: TeamConfig; // Optional team configuration
}
