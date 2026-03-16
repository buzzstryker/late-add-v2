import { apiFetch } from './client';
import type { PlayerMappingItem } from '../types';

/**
 * List unresolved player mapping items. Assumes GET /review/player-mapping or equivalent.
 */
export async function listPlayerMappingQueue(): Promise<PlayerMappingItem[]> {
  const data = await apiFetch<{ items?: PlayerMappingItem[]; data?: PlayerMappingItem[] }>('/review/player-mapping');
  return (data as { items?: PlayerMappingItem[] })?.items ?? (data as { data?: PlayerMappingItem[] })?.data ?? [];
}

/**
 * Resolve player mapping: link source identity to Late Add player. Assumes POST /review/player-mapping/:id/resolve.
 */
export async function resolvePlayerMapping(
  itemId: string,
  body: { player_id: string }
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/review/player-mapping/${itemId}/resolve`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
