/**
 * Full happy-path integration test: seed user → auth → ingest → assert DB and standings.
 * Requires: supabase start, supabase db reset, supabase functions serve.
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (from `supabase start` output).
 * Loads .env from project root if dotenv is installed.
 */
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dotenv = await import("dotenv");
  dotenv.config({ path: join(__dirname, "..", ".env") });
} catch { /* optional */ }

const BASE = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FUNCTIONS = `${BASE}/functions/v1`;

const GROUP_ID = "group-seed-001";
const SEASON_ID = "season-seed-001";
const EXTERNAL_EVENT_ID = "integration-test-event-001";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  if (!ANON || !SERVICE_ROLE) {
    console.error("");
    console.error("Missing SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY.");
    console.error("");
    console.error("1. From the late-add-api folder, run:  supabase start");
    console.error("2. In the output, copy the values for:");
    console.error("   - anon key");
    console.error("   - service_role key");
    console.error("3. Create a file named .env in the late-add-api folder with (one per line, no line breaks inside a value):");
    console.error("   SUPABASE_URL=http://127.0.0.1:54321");
    console.error("   SUPABASE_ANON_KEY=<paste anon key here>");
    console.error("   SUPABASE_SERVICE_ROLE_KEY=<paste service_role key here>");
    console.error("4. For compute-money-deltas: copy these vars into supabase/functions/.env (see supabase/functions/.env.example) so the function has SUPABASE_SERVICE_ROLE_KEY when you run 'supabase functions serve'.");
    console.error("5. Run:  supabase functions serve  (then in another terminal)  npm run test:integration");
    console.error("");
    process.exit(1);
  }

  if (!BASE.includes("127.0.0.1") && !BASE.includes("localhost")) {
    console.warn("Warning: SUPABASE_URL is not local (127.0.0.1/localhost). For local tests use URL and keys from 'supabase start'.");
  }

  const anon = createClient(BASE, ANON);
  const admin = createClient(BASE, SERVICE_ROLE, { auth: { persistSession: false } });

  console.log("1. Sign in as test user…");
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
    email: "test@lateadd.local",
    password: "testpass123",
  });
  if (signInErr) {
    console.error("Sign-in failed:", signInErr.message);
    console.error("Run: supabase db reset (to apply migrations + seed).");
    process.exit(1);
  }
  const token = signIn.session.access_token;

  const ingestBody = {
    group_id: GROUP_ID,
    season_id: SEASON_ID,
    round_date: "2025-06-15",
    source_app: "integration-test",
    external_event_id: EXTERNAL_EVENT_ID,
    scores: [
      { player_id: "player-1", score_value: 2 },
      { player_id: "player-2", score_value: -1 },
    ],
  };

  console.log("2. POST ingest-event-results (first time)…");
  const r1 = await fetch(`${FUNCTIONS}/ingest-event-results`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(ingestBody),
  });
  const body1 = await r1.json().catch(() => ({}));
  assert(
    (r1.status === 201 || r1.status === 200) && body1.league_round_id,
    `Expected 201 or 200 with league_round_id, got ${r1.status}: ${JSON.stringify(body1)}`
  );
  const leagueRoundId = body1.league_round_id;
  console.log("   League round:", leagueRoundId, r1.status === 201 ? "(created)" : "(already existed)");

  console.log("3. Assert one league_rounds row…");
  const { data: rounds, error: roundsErr } = await admin.from("league_rounds").select("id").eq("group_id", GROUP_ID);
  if (roundsErr) {
    throw new Error(`league_rounds query failed: ${roundsErr.message}. Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env are from the same local 'supabase start' output.`);
  }
  if (!Array.isArray(rounds) || rounds.length === 0) {
    const hint = BASE.includes("127.0.0.1") || BASE.includes("localhost") ? "" : " For local tests, set SUPABASE_URL=http://127.0.0.1:54321 and use anon + service_role keys from 'supabase start'.";
    throw new Error(`Expected 1 league_rounds row, got ${rounds?.length ?? 0}. The function wrote to one instance but the test may be reading from another. Use SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY all from the same 'supabase start' output.${hint}`);
  }
  assert(rounds.length === 1, `Expected exactly 1 league_rounds row, got ${rounds.length}`);

  console.log("4. Assert two league_scores rows…");
  const { data: scores } = await admin.from("league_scores").select("player_id, score_value").eq("league_round_id", leagueRoundId);
  assert(Array.isArray(scores) && scores.length === 2, `Expected 2 league_scores rows, got ${scores?.length ?? 0}`);
  const byPlayer = Object.fromEntries(scores.map((s) => [s.player_id, s.score_value]));
  assert(byPlayer["player-1"] === 2 && byPlayer["player-2"] === -1, "Score values must be 2 and -1 (points mode)");

  console.log("5. GET get-standings and assert rounds_played and total_points…");
  const rStandings = await fetch(
    `${FUNCTIONS}/get-standings?season_id=${SEASON_ID}&group_id=${GROUP_ID}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  assert(rStandings.status === 200, `get-standings expected 200, got ${rStandings.status}`);
  const { standings } = await rStandings.json();
  assert(Array.isArray(standings) && standings.length === 2, `Expected 2 standings rows, got ${standings?.length ?? 0}`);
  const pts = standings.map((s) => ({ player_id: s.player_id, rounds_played: s.rounds_played, total_points: s.total_points }));
  assert(pts.every((p) => p.rounds_played === 1), "Each player should have rounds_played = 1");
  const totalSet = new Set(pts.map((p) => p.total_points));
  assert(totalSet.has(2) && totalSet.has(-1), "total_points should be 2 and -1 (standings from event results)");

  console.log("6. Idempotency: POST same (source_app + external_event_id) again → 200…");
  const r2 = await fetch(`${FUNCTIONS}/ingest-event-results`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(ingestBody),
  });
  const body2 = await r2.json().catch(() => ({}));
  assert(r2.status === 200, `Idempotent request expected 200, got ${r2.status}: ${JSON.stringify(body2)}`);
  assert(body2.league_round_id === leagueRoundId, "Must return same league_round_id");

  console.log("7. POST compute-money-deltas → 200, computed: false (no_payout_config)…");
  const rMoney = await fetch(`${FUNCTIONS}/compute-money-deltas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ league_round_id: leagueRoundId }),
  });
  assert(rMoney.status === 200, `compute-money-deltas expected 200, got ${rMoney.status}`);
  const bodyMoney = await rMoney.json().catch(() => ({}));
  assert(bodyMoney.computed === false && bodyMoney.reason === "no_payout_config", `Expected computed: false, reason: no_payout_config, got ${JSON.stringify(bodyMoney)}`);
  assert(bodyMoney.league_round_id === leagueRoundId, "Response must include same league_round_id");
  const { data: scoresAfter } = await admin.from("league_scores").select("money_delta").eq("league_round_id", leagueRoundId);
  assert(scoresAfter?.every((s) => s.money_delta == null), "money_delta must remain NULL when no payout config");

  console.log("8. Set group dollars_per_point = 2, then compute-money-deltas → computed: true…");
  const { error: groupUpErr } = await admin.from("groups").update({ dollars_per_point: 2 }).eq("id", GROUP_ID);
  assert(!groupUpErr, `Failed to set dollars_per_point: ${groupUpErr?.message}`);
  const rCompute = await fetch(`${FUNCTIONS}/compute-money-deltas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ league_round_id: leagueRoundId }),
  });
  const bodyComputeRaw = await rCompute.json().catch(() => ({}));
  assert(rCompute.status === 200, `compute-money-deltas expected 200, got ${rCompute.status}: ${JSON.stringify(bodyComputeRaw)}`);
  assert(bodyComputeRaw.computed === true && bodyComputeRaw.updated === 2, `Expected computed: true, updated: 2, got ${JSON.stringify(bodyComputeRaw)}`);

  console.log("9. Assert money_delta zero-sum and values (points 2, -1 → mean 0.5 → deltas 3, -3)…");
  const { data: scoresWithMoney } = await admin.from("league_scores").select("player_id, money_delta").eq("league_round_id", leagueRoundId);
  const sumDelta = scoresWithMoney?.reduce((s, r) => s + (r.money_delta ?? 0), 0) ?? NaN;
  assert(sumDelta === 0, `money_delta must sum to 0, got ${sumDelta}`);
  const deltasByPlayer = Object.fromEntries((scoresWithMoney ?? []).map((s) => [s.player_id, s.money_delta]));
  assert(deltasByPlayer["player-1"] === 3 && deltasByPlayer["player-2"] === -3, `Expected player-1=3, player-2=-3, got ${JSON.stringify(deltasByPlayer)}`);

  console.log("9b. generate-payment-requests (two-player, one request)…");
  const rGen = await fetch(`${FUNCTIONS}/generate-payment-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ league_round_id: leagueRoundId }),
  });
  assert(rGen.status === 200, `generate-payment-requests expected 200, got ${rGen.status}: ${JSON.stringify(await rGen.json().catch(() => ({})))}`);
  const bodyGen = await rGen.json().catch(() => ({}));
  assert(bodyGen.league_round_id === leagueRoundId && Array.isArray(bodyGen.requests), "Response must include league_round_id and requests");
  assert(bodyGen.requests.length === 1, `Expected 1 request, got ${bodyGen.requests.length}`);
  assert(bodyGen.requests[0].from_player_id === "player-2" && bodyGen.requests[0].to_player_id === "player-1" && bodyGen.requests[0].amount_cents === 300, `Expected player-2 -> player-1 300 cents, got ${JSON.stringify(bodyGen.requests[0])}`);

  console.log("9c. generate-payment-requests deterministic (repeat same output)…");
  const rGen2 = await fetch(`${FUNCTIONS}/generate-payment-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ league_round_id: leagueRoundId }),
  });
  const bodyGen2 = await rGen2.json().catch(() => ({}));
  assert(JSON.stringify(bodyGen.requests) === JSON.stringify(bodyGen2.requests), "Repeat call must return same requests");

  console.log("10. Rerun compute-money-deltas (idempotent) → same deltas…");
  const rRerun = await fetch(`${FUNCTIONS}/compute-money-deltas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ league_round_id: leagueRoundId }),
  });
  assert(rRerun.status === 200, `rerun expected 200, got ${rRerun.status}`);
  const { data: scoresRerun } = await admin.from("league_scores").select("player_id, money_delta").eq("league_round_id", leagueRoundId);
  const deltasRerun = Object.fromEntries((scoresRerun ?? []).map((s) => [s.player_id, s.money_delta]));
  assert(deltasRerun["player-1"] === 3 && deltasRerun["player-2"] === -3, `After rerun expected 3 and -3, got ${JSON.stringify(deltasRerun)}`);

  console.log("11. Override player-1 score to 1, recompute → new deltas (1, -1 mean 0 → 2, -2)…");
  const { data: scoreRows } = await admin.from("league_scores").select("id").eq("league_round_id", leagueRoundId).eq("player_id", "player-1");
  assert(scoreRows?.length === 1, "Need one league_scores row for player-1");
  await admin.from("league_scores").update({ score_override: 1 }).eq("id", scoreRows[0].id);
  const rOverride = await fetch(`${FUNCTIONS}/compute-money-deltas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ league_round_id: leagueRoundId }),
  });
  assert(rOverride.status === 200, `compute after override expected 200, got ${rOverride.status}`);
  const { data: scoresOverride } = await admin.from("league_scores").select("player_id, money_delta").eq("league_round_id", leagueRoundId);
  const deltasOverride = Object.fromEntries((scoresOverride ?? []).map((s) => [s.player_id, s.money_delta]));
  assert(deltasOverride["player-1"] === 2 && deltasOverride["player-2"] === -2, `After override expected 2 and -2, got ${JSON.stringify(deltasOverride)}`);
  const sumOverride = scoresOverride?.reduce((s, r) => s + (r.money_delta ?? 0), 0) ?? NaN;
  assert(sumOverride === 0, "Zero-sum must hold after override recompute");

  console.log("12. Ingest second round (same points 0,0), compute → all money_delta 0…");
  const rIngest2 = await fetch(`${FUNCTIONS}/ingest-event-results`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      group_id: GROUP_ID,
      season_id: SEASON_ID,
      round_date: "2025-06-16",
      source_app: "integration-test",
      external_event_id: "integration-test-event-002",
      scores: [
        { player_id: "player-1", score_value: 0 },
        { player_id: "player-2", score_value: 0 },
      ],
    }),
  });
  const bodyIngest2 = await rIngest2.json().catch(() => ({}));
  assert((rIngest2.status === 201 || rIngest2.status === 200) && bodyIngest2.league_round_id, `Second ingest failed: ${rIngest2.status} ${JSON.stringify(bodyIngest2)}`);
  const roundId2 = bodyIngest2.league_round_id;
  const rCompute2 = await fetch(`${FUNCTIONS}/compute-money-deltas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ league_round_id: roundId2 }),
  });
  assert(rCompute2.status === 200, `compute round 2 expected 200, got ${rCompute2.status}`);
  const { data: scoresRound2 } = await admin.from("league_scores").select("money_delta").eq("league_round_id", roundId2);
  assert(scoresRound2?.every((s) => s.money_delta === 0), `All same points must yield money_delta 0, got ${JSON.stringify(scoresRound2)}`);

  console.log("12b. generate-payment-requests all zero deltas → empty requests…");
  const rGenZero = await fetch(`${FUNCTIONS}/generate-payment-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ league_round_id: roundId2 }),
  });
  assert(rGenZero.status === 200, `generate-payment-requests (all zeros) expected 200, got ${rGenZero.status}`);
  const bodyGenZero = await rGenZero.json().catch(() => ({}));
  assert(Array.isArray(bodyGenZero.requests) && bodyGenZero.requests.length === 0, "All zero deltas must yield empty requests");

  console.log("12c. generate-payment-requests before compute (NULL money_delta) → 400…");
  const rIngest3 = await fetch(`${FUNCTIONS}/ingest-event-results`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      group_id: GROUP_ID,
      season_id: SEASON_ID,
      round_date: "2025-06-17",
      source_app: "integration-test",
      external_event_id: "integration-test-event-003",
      scores: [
        { player_id: "player-1", score_value: 1 },
        { player_id: "player-2", score_value: -1 },
      ],
    }),
  });
  const bodyIngest3 = await rIngest3.json().catch(() => ({}));
  const roundId3 = bodyIngest3.league_round_id;
  if (roundId3) {
    const rGenNull = await fetch(`${FUNCTIONS}/generate-payment-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ league_round_id: roundId3 }),
    });
    assert(rGenNull.status === 400, `generate-payment-requests (NULL money_delta) expected 400, got ${rGenNull.status}`);
    const bodyGenNull = await rGenNull.json().catch(() => ({}));
    assert(bodyGenNull.code === "money_delta_not_computed", `Expected code money_delta_not_computed, got ${bodyGenNull.code}`);
  }

  console.log("13. Reject invalid player_id → 400 invalid_player_ids…");
  const r3 = await fetch(`${FUNCTIONS}/ingest-event-results`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      group_id: GROUP_ID,
      round_date: "2025-06-16",
      scores: [
        { player_id: "player-1", score_value: 0 },
        { player_id: "non-member-player", score_value: 1 },
      ],
    }),
  });
  assert(r3.status === 400, `Invalid player expected 400, got ${r3.status}`);
  const body3 = await r3.json().catch(() => ({}));
  assert(
    Array.isArray(body3.invalid_player_ids) && body3.invalid_player_ids.includes("non-member-player"),
    "Response must include invalid_player_ids with non-member-player"
  );

  console.log("\nAll integration checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
