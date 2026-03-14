export interface GamePoint {
  id: string;
  roundId: string;
  gameId: string | null; // null for legacy/manual points without a specific game
  playerId: string;
  holeNumber: number; // 1-18
  points: number;
  awardedDots: string[] | null; // Dot IDs awarded on this hole (junk games only)
  createdAt: string;
  updatedAt: string;
}

export interface GamePointInput {
  roundId: string;
  gameId?: string | null;
  playerId: string;
  holeNumber: number;
  points: number;
  awardedDots?: string[] | null;
}
