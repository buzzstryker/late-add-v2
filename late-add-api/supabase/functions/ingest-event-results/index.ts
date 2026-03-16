// Ingest event results: create a league_round and league_scores from POST body.
// Auth required; RLS enforces group/ownership.
// Domain rules: scoring_mode (points vs win_loss_override), season-group match, override metadata.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const POINTS_MIN = -10;
const POINTS_MAX = 10;
const STROKE_LIKE_MIN = 20;
const STROKE_LIKE_MAX = 130;

const WIN_POINTS = 1;
const LOSS_POINTS = 0;
const TIE_POINTS = 0.5;

interface ScoreInput {
  player_id: string;
  score_value?: number | null;
  score_override?: number | null;
  result_type?: "win" | "loss" | "tie" | null;
  override_actor?: string | null;
  override_reason?: string | null;
}

interface IngestBody {
  group_id: string;
  season_id?: string | null;
  round_date: string;
  scores_override?: boolean;
  source_app?: string | null;
  external_event_id?: string | null;
  scores: ScoreInput[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing authorization" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { group_id, season_id, round_date, scores_override, source_app, external_event_id, scores } = body;
  if (!group_id || !round_date || !Array.isArray(scores) || scores.length === 0) {
    return new Response(
      JSON.stringify({ error: "group_id, round_date, and non-empty scores required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  const hasExternalId = source_app != null && source_app !== "" && external_event_id != null && external_event_id !== "";

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return new Response(JSON.stringify({ error: "Missing Bearer token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: user, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user?.user?.id) {
    return new Response(
      JSON.stringify({ error: "Unauthorized", msg: userError?.message ?? "Invalid JWT" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Fetch group (scoring_mode)
  const { data: groupRow, error: groupErr } = await supabase
    .from("groups")
    .select("id, scoring_mode")
    .eq("id", group_id)
    .maybeSingle();
  if (groupErr || !groupRow) {
    return new Response(
      JSON.stringify({ error: "Group not found or access denied" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  const scoringMode = (groupRow as { scoring_mode?: string }).scoring_mode ?? "points";

  // Event structure: if season_id provided, season must belong to this group
  if (season_id) {
    const { data: seasonRow } = await supabase
      .from("seasons")
      .select("id, group_id")
      .eq("id", season_id)
      .maybeSingle();
    if (!seasonRow || (seasonRow as { group_id: string }).group_id !== group_id) {
      return new Response(
        JSON.stringify({
          error: "season_id must belong to the same group",
          code: "season_group_mismatch",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // Membership: all score player_ids must be active members of the group
  const { data: members } = await supabase
    .from("group_members")
    .select("player_id")
    .eq("group_id", group_id)
    .eq("is_active", 1);
  const allowedPlayerIds = new Set((members ?? []).map((m) => m.player_id));
  const submittedPlayerIds = [...new Set(scores.map((s) => s.player_id))];
  const invalidPlayerIds = submittedPlayerIds.filter((id) => !allowedPlayerIds.has(id));
  if (invalidPlayerIds.length > 0) {
    return new Response(
      JSON.stringify({
        error: "All player_ids must be active members of the group",
        invalid_player_ids: invalidPlayerIds,
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const now = new Date().toISOString();

  // Build normalized score rows (score_value, score_override, result_type, override_actor, override_reason, override_at)
  type ScoreRow = {
    id: string;
    league_round_id: string;
    player_id: string;
    score_value: number | null;
    score_override: number | null;
    result_type: string | null;
    override_actor: string | null;
    override_reason: string | null;
    override_at: string | null;
    created_at: string;
    updated_at: string;
  };

  let scoreRows: ScoreRow[];

  if (scoringMode === "win_loss_override") {
    const validResultTypes = new Set(["win", "loss", "tie"]);
    for (const s of scores) {
      const rt = s.result_type ?? null;
      if (rt === null || !validResultTypes.has(rt)) {
        return new Response(
          JSON.stringify({
            error: "win_loss_override mode requires result_type (win, loss, or tie) for each score",
            code: "invalid_result_type",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    scoreRows = scores.map((s) => {
      const rt = (s.result_type ?? "loss") as "win" | "loss" | "tie";
      const points = rt === "win" ? WIN_POINTS : rt === "tie" ? TIE_POINTS : LOSS_POINTS;
      const hasOverride = s.score_override != null;
      return {
        id: crypto.randomUUID(),
        league_round_id: "", // set below
        player_id: s.player_id,
        score_value: points,
        score_override: s.score_override ?? null,
        result_type: rt,
        override_actor: hasOverride ? (s.override_actor ?? null) : null,
        override_reason: hasOverride ? (s.override_reason ?? null) : null,
        override_at: hasOverride ? now : null,
        created_at: now,
        updated_at: now,
      };
    });
    for (const row of scoreRows) {
      if ((row.score_override != null && (!row.override_actor || !row.override_reason)) ||
          (row.override_actor != null && row.score_override == null)) {
        return new Response(
          JSON.stringify({
            error: "When score_override is set, override_actor and override_reason are required",
            code: "override_metadata_required",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
  } else {
    // points mode: reject raw golf scores (stroke-like) and enforce points range
    for (const s of scores) {
      const effective = s.score_override != null ? s.score_override : s.score_value;
      if (effective == null || typeof effective !== "number") {
        return new Response(
          JSON.stringify({ error: "points mode requires a numeric score_value (or score_override) per player", code: "points_value_required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (effective >= STROKE_LIKE_MIN && effective <= STROKE_LIKE_MAX) {
        return new Response(
          JSON.stringify({
            error: "points mode does not accept raw golf scores (stroke scores); use points in the allowed range",
            code: "raw_stroke_score_rejected",
            value: effective,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (effective < POINTS_MIN || effective > POINTS_MAX) {
        return new Response(
          JSON.stringify({
            error: `points mode requires values between ${POINTS_MIN} and ${POINTS_MAX}`,
            code: "points_out_of_range",
            value: effective,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const hasOverride = s.score_override != null;
      if (hasOverride && (!s.override_actor || !s.override_reason)) {
        return new Response(
          JSON.stringify({
            error: "When score_override is set, override_actor and override_reason are required",
            code: "override_metadata_required",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    scoreRows = scores.map((s) => {
      const hasOverride = s.score_override != null;
      const scoreVal = typeof s.score_value === "number" ? s.score_value : (s.score_override ?? null);
      return {
        id: crypto.randomUUID(),
        league_round_id: "",
        player_id: s.player_id,
        score_value: scoreVal,
        score_override: s.score_override ?? null,
        result_type: null,
        override_actor: hasOverride ? (s.override_actor ?? null) : null,
        override_reason: hasOverride ? (s.override_reason ?? null) : null,
        override_at: hasOverride ? now : null,
        created_at: now,
        updated_at: now,
      };
    });
  }

  let leagueRoundId: string;

  if (hasExternalId) {
    const { data: existing } = await supabase
      .from("league_rounds")
      .select("id")
      .eq("group_id", group_id)
      .eq("source_app", source_app!)
      .eq("external_event_id", external_event_id!)
      .maybeSingle();
    if (existing?.id) {
      return new Response(
        JSON.stringify({ id: existing.id, league_round_id: existing.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  leagueRoundId = crypto.randomUUID();
  for (const r of scoreRows) {
    r.league_round_id = leagueRoundId;
  }

  const { error: roundError } = await supabase.from("league_rounds").insert({
    id: leagueRoundId,
    user_id: user.user.id,
    group_id,
    season_id: season_id || null,
    round_date,
    submitted_at: now,
    scores_override: scores_override ? 1 : 0,
    source_app: source_app || null,
    external_event_id: external_event_id || null,
    created_at: now,
    updated_at: now,
  });

  if (roundError) {
    if (hasExternalId && roundError.code === "23505") {
      const { data: existing } = await supabase
        .from("league_rounds")
        .select("id")
        .eq("group_id", group_id)
        .eq("source_app", source_app!)
        .eq("external_event_id", external_event_id!)
        .maybeSingle();
      if (existing?.id) {
        return new Response(
          JSON.stringify({ id: existing.id, league_round_id: existing.id }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    return new Response(
      JSON.stringify({ error: "Failed to create league round", details: roundError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const insertRows = scoreRows.map((r) => ({
    id: r.id,
    league_round_id: r.league_round_id,
    player_id: r.player_id,
    score_value: r.score_value,
    score_override: r.score_override,
    result_type: r.result_type,
    override_actor: r.override_actor,
    override_reason: r.override_reason,
    override_at: r.override_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  const { error: scoresError } = await supabase.from("league_scores").insert(insertRows);

  if (scoresError) {
    return new Response(
      JSON.stringify({ error: "Failed to create league scores", details: scoresError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ id: leagueRoundId, league_round_id: leagueRoundId }),
    { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
