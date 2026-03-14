export interface Score {
  id: string;
  roundId: string;
  playerId: string;
  holeNumber: number; // 1-18
  grossScore: number;
  netScore: number; // grossScore - strokesReceived on this hole
  putts?: number;
  fairwayHit?: boolean; // null for par 3s
  greenInRegulation?: boolean;
  penalties?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScoreCreateInput {
  roundId: string;
  playerId: string;
  holeNumber: number;
  grossScore: number;
  putts?: number;
  fairwayHit?: boolean;
  greenInRegulation?: boolean;
  penalties?: number;
}

/** Running totals for a player in a round */
export interface PlayerRoundSummary {
  playerId: string;
  totalGross: number;
  totalNet: number;
  frontNineGross: number;
  frontNineNet: number;
  backNineGross: number;
  backNineNet: number;
  holesPlayed: number;
  toPar: number; // gross relative to par
  toParNet: number; // net relative to par
}
