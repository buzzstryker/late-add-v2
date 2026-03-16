import { apiFetch } from './client';
import type { StandingRow } from '../types';

/**
 * Get standings by season (and optional group). Uses documented GET /get-standings.
 */
export async function getStandings(seasonId: string, groupId?: string): Promise<StandingRow[]> {
  const params = new URLSearchParams({ season_id: seasonId });
  if (groupId) params.set('group_id', groupId);
  const data = await apiFetch<{ standings: StandingRow[] }>(`/get-standings?${params.toString()}`);
  const list = data.standings ?? [];
  return list.map((row, i) => ({ ...row, rank: i + 1 }));
}
