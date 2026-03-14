/**
 * Team types for rounds played with team pairings within a foursome.
 *
 * Teams affect scoring — individual net scores are combined into team scores
 * that drive betting game results (e.g., team Nassau).
 */

/** Which team a player belongs to */
export type TeamId = 'A' | 'B';

/** When teams rotate during a round */
export type TeamRotation = 'full_18' | 'halves' | 'thirds';

/** How individual net scores combine into a team score */
export type TeamScoringFormat =
  | 'two_net_low_combined'       // Sum both teammates' net scores; lower team total wins
  | 'one_net_low_tiebreaker'     // Lower of two nets counts; second player's net breaks ties
  | 'net_high_and_low'           // Sum of team's best net + worst net; lower total wins
  | 'low_vs_low_high_vs_high';   // Two sub-bets: best net vs best net, worst net vs worst net

/** A team pairing: which players are on Team A vs Team B */
export interface TeamPairing {
  teamA: string[];  // Player IDs (usually 2, or 1 for lone wolf)
  teamB: string[];  // Player IDs (usually 2, or 3 for 1v3)
}

/** A period defines a hole range and the team pairing for that range */
export interface TeamPeriod {
  startHole: number;  // inclusive
  endHole: number;    // inclusive
  pairing: TeamPairing;
}

/** Top-level team configuration stored on the Round */
export interface TeamConfig {
  rotation: TeamRotation;
  scoringFormat: TeamScoringFormat;
  periods: TeamPeriod[];
  sharedJunk: boolean;  // true = teammates share dots/junk points
}
