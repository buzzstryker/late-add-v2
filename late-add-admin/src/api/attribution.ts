import { apiFetch } from './client';
import type { AttributionItem } from '../types';

/**
 * List unresolved attribution items. Assumes GET /review/attribution or equivalent.
 */
export async function listAttributionQueue(): Promise<AttributionItem[]> {
  const data = await apiFetch<{ items?: AttributionItem[]; data?: AttributionItem[] }>('/review/attribution');
  return (data as { items?: AttributionItem[] })?.items ?? (data as { data?: AttributionItem[] })?.data ?? [];
}

/**
 * Resolve attribution: assign event to group/season. Assumes POST /review/attribution/:id/resolve or equivalent.
 */
export async function resolveAttribution(
  itemId: string,
  body: { group_id: string; season_id?: string | null }
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/review/attribution/${itemId}/resolve`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
