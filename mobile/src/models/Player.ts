export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  nickname?: string;
  gender: 'M' | 'F';
  handicapIndex: number; // USGA Handicap Index (e.g., 16.9)
  ghinNumber?: string;
  email?: string;
  phone?: string;
  venmoHandle?: string;
  createdAt: string; // ISO date
  updatedAt: string;
}

export interface PlayerCreateInput {
  firstName: string;
  lastName: string;
  nickname?: string;
  gender: 'M' | 'F';
  handicapIndex: number;
  ghinNumber?: string;
  email?: string;
  phone?: string;
  venmoHandle?: string;
}

export function getPlayerDisplayName(player: Player): string {
  return player.nickname || `${player.firstName} ${player.lastName}`;
}
