/** Event (league_round) as returned by API or list. */
export interface EventSummary {
  id: string;
  external_event_id?: string | null;
  source_app?: string | null;
  round_date: string;
  group_id: string;
  group_name?: string;
  season_id?: string | null;
  season_name?: string | null;
  status: EventStatus;
  created_at: string;
  updated_at?: string;
}

export type EventStatus =
  | 'processed'
  | 'pending_attribution'
  | 'pending_player_mapping'
  | 'validation_error'
  | 'duplicate_ignored';

/** Event detail including results (league_scores). */
export interface EventDetail extends EventSummary {
  results?: EventResult[];
  attribution_status?: string;
  validation_errors?: string[];
  mapping_issues?: string[];
}

export interface EventResult {
  player_id: string;
  player_name?: string;
  score_value: number;
  score_override?: number | null;
  result_type?: 'win' | 'loss' | 'tie' | null;
}

/** Standings row from get-standings. */
export interface StandingRow {
  season_id: string;
  group_id: string;
  player_id: string;
  player_name?: string;
  rounds_played: number;
  total_points: number;
  rank?: number;
}

/** Group (league unit). */
export interface Group {
  id: string;
  name: string;
  section_id?: string | null;
}

/** Season. */
export interface Season {
  id: string;
  group_id: string;
  name?: string;
  start_date: string;
  end_date: string;
}

/** Attribution review item. */
export interface AttributionItem {
  id: string;
  event_id: string;
  source_app?: string | null;
  round_date: string;
  status: string;
  candidate_groups?: Group[];
  candidate_seasons?: Season[];
  event_metadata?: Record<string, unknown>;
  results?: EventResult[];
}

/** Player mapping item (unmapped source player). */
export interface PlayerMappingItem {
  id: string;
  source_player_name: string;
  source_app?: string | null;
  related_event_id?: string;
  related_event_date?: string;
  status: string;
  candidate_players?: { id: string; name: string }[];
}

/** Ingest request body (manual or API). */
export interface IngestEventRequest {
  group_id: string;
  season_id?: string | null;
  round_date: string;
  source_app?: string | null;
  external_event_id?: string | null;
  scores: { player_id: string; score_value?: number; result_type?: 'win' | 'loss' | 'tie' }[];
}
