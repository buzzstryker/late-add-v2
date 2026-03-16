import { apiFetch } from './client';
import type { Group, Season } from '../types';

/**
 * List groups. Assumes GET /groups or PostgREST; if missing, document as backend gap.
 */
export async function listGroups(): Promise<Group[]> {
  const data = await apiFetch<{ groups?: Group[]; data?: Group[] }>('/groups');
  return (data as { groups?: Group[] })?.groups ?? (data as { data?: Group[] })?.data ?? [];
}

/**
 * List seasons (optionally for a group). Assumes GET /seasons?group_id= or /groups/:id/seasons.
 */
export async function listSeasons(groupId?: string): Promise<Season[]> {
  const path = groupId ? `/seasons?group_id=${encodeURIComponent(groupId)}` : '/seasons';
  const data = await apiFetch<{ seasons?: Season[]; data?: Season[] }>(path);
  return (data as { seasons?: Season[] })?.seasons ?? (data as { data?: Season[] })?.data ?? [];
}
