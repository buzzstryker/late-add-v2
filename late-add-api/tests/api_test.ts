// Local API tests. Run with: deno test tests/api_test.ts --allow-net
// Requires local Supabase: supabase start

const BASE = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const FUNCTIONS = `${BASE}/functions/v1`;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(cond ? `  OK   ${name}` : `  FAIL ${name}` + (detail ? ` — ${detail}` : ""));
  return cond;
}

async function runTests() {
  console.log("Late Add backend — local API tests\n");
  let passed = 0;
  let failed = 0;

  // GET get-standings: missing season_id → 400
  try {
    const r1 = await fetch(`${FUNCTIONS}/get-standings`, { method: "GET" });
    const b1 = await r1.json().catch(() => ({}));
    if (ok("get-standings without season_id → 400", r1.status === 400, `got ${r1.status}`)) passed++; else failed++;
  } catch (e) {
    if (ok("get-standings (reachable)", false, String(e))) passed++; else failed++;
  }

  // GET get-standings: with season_id but no auth → 401
  try {
    const r2 = await fetch(`${FUNCTIONS}/get-standings?season_id=00000000-0000-0000-0000-000000000001`, { method: "GET" });
    if (ok("get-standings without auth → 401", r2.status === 401, `got ${r2.status}`)) passed++; else failed++;
  } catch (e) {
    if (ok("get-standings auth check (reachable)", false, String(e))) passed++; else failed++;
  }

  // POST ingest-event-results: no body → 400
  try {
    const r3 = await fetch(`${FUNCTIONS}/ingest-event-results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const b3 = await r3.json().catch(() => ({}));
    const hasError = r3.status === 400 && (b3?.error != null || r3.status === 400);
    if (ok("ingest-event-results empty body → 400", r3.status === 400, `got ${r3.status}`)) passed++; else failed++;
  } catch (e) {
    if (ok("ingest-event-results (reachable)", false, String(e))) passed++; else failed++;
  }

  // POST ingest-event-results: invalid body (missing group_id, round_date, scores) → 400
  try {
    const r4 = await fetch(`${FUNCTIONS}/ingest-event-results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_id: "g1" }),
    });
    if (ok("ingest-event-results invalid body → 400", r4.status === 400, `got ${r4.status}`)) passed++; else failed++;
  } catch (e) {
    if (ok("ingest-event-results validation (reachable)", false, String(e))) passed++; else failed++;
  }

  console.log("\n" + (failed === 0 ? "All checks passed." : `${failed} check(s) failed.`));
  Deno.exit(failed > 0 ? 1 : 0);
}

runTests();
