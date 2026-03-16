# API

## Terminology

- **league_rounds** = event records (one per round/event).
- **league_scores** = event result records (one per player per event). `score_value` is the **points** outcome for that result (not raw golf score). Effective result = `COALESCE(score_override, score_value)`.
- **Standings** are based **only on effective points** (rounds_played, total_points). Ranking is by total_points. Money and settlement completion do not affect standings.
- **money_delta** on league_scores is for settlement requests / Venmo insert generation only. It may be null until settlement rules are implemented; it is not used in the standings view.

## Request flow: ingest → standings

1. **Valid JWT** — Client sends `Authorization: Bearer <JWT>` (Supabase Auth).
2. **POST** `/ingest-event-results` — Body: `group_id`, `round_date`, `scores[]` (and optional `source_app`, `external_event_id` for idempotency).
3. **league_rounds** — One row inserted (event record).
4. **league_scores** — One row per score inserted (event result: league_round_id, player_id, score_value, score_override, etc.). `money_delta` is left null unless supplied or derived by future settlement logic.
5. **season_standings** — View is computed on read from `league_rounds` and `league_scores` using **effective points only**. No net_winnings or money in standings.

## Hardening (ingest)

- **Idempotency** — When `source_app` and `external_event_id` are both set, the round is uniquely identified by `(group_id, source_app, external_event_id)`. A second POST with the same triple returns **200** with the existing `league_round_id` (no duplicate). Race conditions are handled by catching unique violation 23505 and returning the existing row.
- **Duplicate submissions** — Safely rejected by the above: no second insert, same id returned.
- **Player membership** — Every `player_id` in `scores` must be an active member of the group (`group_members` with `is_active = 1`). Otherwise **400** with `invalid_player_ids` listing the invalid ids.

---

## Ingest event results

**POST** `/ingest-event-results`

Creates one league round and its league scores (event results). Auth required (Bearer JWT).

**Request body**

```json
{
  "group_id": "string",
  "season_id": "string (optional)",
  "round_date": "YYYY-MM-DD",
  "scores_override": false,
  "source_app": "string (optional)",
  "external_event_id": "string (optional)",
  "scores": [
    { "player_id": "string", "score_value": 2, "score_override": null },
    { "player_id": "string", "result_type": "win" }
  ]
}
```

- For **points** mode (group’s `scoring_mode`): each score has `score_value` (points in allowed range, e.g. -10 to +10). Optional `score_override` with `override_actor` and `override_reason`.
- For **win_loss_override** mode: each score has `result_type`: `"win"`, `"loss"`, or `"tie"`; points are derived by the system.

- `score_override` takes precedence over `score_value` when set.
- `scores_override`: when true, stored as 1 on `league_rounds` (scores treated as overrides).
- **(group_id, source_app, external_event_id)** — When both `source_app` and `external_event_id` are set, the round is uniquely identified by this triple. Idempotent: a second POST with the same triple returns **200** with the existing `league_round_id` (no duplicate insert). Under race conditions, a unique constraint violation is handled by returning **200** with the existing row.
- **Player membership** — Every `player_id` in `scores` must be an active member of the group (`group_members` with `group_id` and `is_active = 1`). Otherwise **400** with `invalid_player_ids`.

### Domain rules (business logic)

- **Points vs raw scores** — Late Add stores game results (points), not raw golf scores. Each group has a `scoring_mode`:
  - **points**: `score_value` (or `score_override`) must be in the allowed points range (e.g. -10 to +10). Values that look like stroke scores (e.g. 72, 75) are rejected with **400** and `code: "raw_stroke_score_rejected"`. Out-of-range points return **400** and `code: "points_out_of_range"`.
  - **win_loss_override**: each score must include `result_type`: `"win"`, `"loss"`, or `"tie"`. The system derives points internally (e.g. win=1, loss=0, tie=0.5) and stores them in `score_value`; `result_type` is stored on `league_scores`.
- **Event structure** — A season belongs to exactly one group. If `season_id` is provided, it must belong to the same `group_id`; otherwise **400** and `code: "season_group_mismatch"`.
- **Override** — When `score_override` is set for a score, `override_actor` and `override_reason` are required; the server sets `override_at`. Otherwise **400** and `code: "override_metadata_required"`.
- **Standings** — Standings derive from event results (`league_rounds` + `league_scores`); effective score is `COALESCE(score_override, score_value)`. Only points matter for standings. Money and settlement state do not affect standings. Not from settlements.
- **Multi-group** — A result belongs to exactly one group. A player may belong to multiple groups; each submission is for one group only.

**Response**

- **200**: Idempotent: event already exists for this (group_id, source_app, external_event_id). `{ "id": "<uuid>", "league_round_id": "<uuid>" }`
- **201**: Created. `{ "id": "<uuid>", "league_round_id": "<uuid>" }`
- **400**: Invalid body, missing required fields, or one or more `player_id`s are not active members of the group. Body: `{ "error": "...", "invalid_player_ids": ["id1", ...] }` when membership fails.
- **401**: Missing or invalid authorization.
- **500**: Insert failed (e.g. RLS or constraint).

## Get standings (minimal read)

**GET** `/get-standings?season_id=<uuid>`  
Optional: `&group_id=<uuid>`

Minimal read endpoint for standings by season (and optionally by group). Returns rows from the `season_standings` view. Auth required (Bearer JWT). RLS on underlying tables limits rows to the caller’s data.

**Response**

- **200**: `{ "standings": [ { "season_id", "group_id", "player_id", "rounds_played", "total_points" }, ... ] }`  
  Sorted by `total_points` descending.
- **400**: Missing `season_id`.
- **401**: Missing or invalid authorization.
- **500**: Query failed.

---

## Standings view (direct)

You can also query the `season_standings` view via PostgREST or SQL for per-season, per-player aggregates:

- `season_id`, `group_id`, `player_id`
- `rounds_played`
- `total_points` (sum of effective **points** only: `score_override ?? score_value`)

Standings do not include `money_delta` or net_winnings. RLS on underlying tables applies.

## Settlement readiness (money_delta)

`league_scores.money_delta` is a nullable numeric column reserved for settlement logic. It is intended for settlement requests and Venmo insert generation only. It is not populated by ingest and **is not used in standings**; standings remain **points-only** (rounds_played, total_points).

**Payout config (group-level):** `groups.dollars_per_point` — `DOUBLE PRECISION NULL`, with `CHECK (dollars_per_point IS NULL OR dollars_per_point >= 0)`. NULL = payout not configured (function returns `computed: false`, no write). 0 or positive = dollars per point of deviation from the round mean (zero-sum formula).

**Formula:** effective_points = COALESCE(score_override, score_value); round_mean = average(effective_points) over the round’s league_scores; money_delta = (effective_points − round_mean) × dollars_per_point. Values are rounded to 2 decimal places; a deterministic residual adjustment is applied so the round remains zero-sum (see [payout-configuration-design.md](./payout-configuration-design.md)).

**Calculation flow:** POST `/compute-money-deltas` with `league_round_id` loads the round’s group, reads `groups.dollars_per_point`, and if set computes and writes only `league_scores.money_delta` for that round. No settlements table.

### Compute money deltas

**POST** `/compute-money-deltas`

Round-scoped: computes and writes `league_scores.money_delta` for one round only. Does not change standings or any other columns. Idempotent: re-run overwrites money_delta for that round.

**Request body**

```json
{ "league_round_id": "<uuid>" }
```

**Auth:** Bearer JWT. Same RLS as ingest/get-standings; caller must have access to the round (e.g. league_rounds owned by user).

**Response**

- **200** — Success.
  - If payout config is **not** set (`groups.dollars_per_point` NULL): `{ "league_round_id": "<uuid>", "computed": false, "reason": "no_payout_config", "message": "..." }`. No rows updated; `money_delta` remains NULL. Distinguishes “not computed yet” from “computed to zero”.
  - If payout is configured and computation ran: `{ "league_round_id": "<uuid>", "computed": true, "updated": N }` (N = count of league_scores updated). Sum of money_delta for the round is zero (zero-sum); values rounded to 2 decimals with residual applied to one row (see design doc).
- **400** — Missing or invalid `league_round_id` (e.g. `code: "missing_league_round_id"`).
- **401** — Missing or invalid authorization.
- **404** — Round not found or access denied (`code: "round_not_found"`).
- **500** — Load or update failed.

### Generate payment requests

**POST** `/generate-payment-requests`

Round-scoped: reads `league_scores.money_delta` for one round and returns the minimal set of payer → payee requests. **Does not write to the database**; requests are generated on demand and not stored. Late Add does not track payment completion or maintain a settlement ledger.

**Request body**

```json
{ "league_round_id": "<uuid>" }
```

**Auth:** Bearer JWT. Same access pattern as compute-money-deltas; caller must have access to the round.

**Read path:** Loads the target `league_rounds` row (with existing auth/RLS behavior) and `league_scores` for that round. Requires `money_delta` to be non-null for all score rows (i.e. compute-money-deltas must have been run for the round).

**Validation**

- `money_delta` is converted to integer cents (`Math.round(money_delta * 100)`) before matching.
- The round must be **zero-sum in cents** (sum of rounded cents = 0). If not, returns **400** with `code: "round_not_zero_sum"`.
- If any `money_delta` is null, returns **400** with `code: "money_delta_not_computed"`.

**Matching:** Positive balances are payees, negative are payers. A deterministic greedy algorithm produces the minimal practical set of requests: sort by absolute amount descending, then `player_id` ascending as tie-breaker; match payers to payees in that order.

**Response (200)**

```json
{
  "league_round_id": "<uuid>",
  "requests": [
    { "from_player_id": "<payer>", "to_player_id": "<payee>", "amount_cents": 300 }
  ]
}
```

- **All zero deltas** → `requests: []`.
- **One player only** → `requests: []`.

**Errors**

- **400** — Missing `league_round_id` (`code: "missing_league_round_id"`), or `money_delta` not computed (`code: "money_delta_not_computed"`), or round not zero-sum in cents (`code: "round_not_zero_sum"`).
- **401** — Missing or invalid authorization.
- **404** — Round not found or access denied (`code: "round_not_found"`).
- **500** — Load failed.

---

## Local seed and integration test

Deterministic seed data is in `supabase/seed.sql`: one section, one group, one season, two players (`player-1`, `player-2`) as active group members, and one test user `test@lateadd.local` / `testpass123`. Applied with `supabase db reset`.

The integration test (`npm run test:integration`) signs in as that user, POSTs a valid ingest with `source_app` and `external_event_id`, then asserts:

- One `league_rounds` row and two `league_scores` rows (via service role).
- GET `get-standings` returns correct `rounds_played` and `total_points` for the season.
- Idempotent repeat POST returns 200 with the same `league_round_id`.
- compute-money-deltas: no config → computed: false; with config → computed: true, zero-sum, rerun idempotent, override recompute, all same points → all zero.
- generate-payment-requests: two-player one request, deterministic repeat, all zero deltas → empty requests, NULL money_delta → 400.
- POST with a non-member `player_id` returns 400 with `invalid_player_ids`.

Requires `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from `supabase start` output (set in `.env` or environment).

**Domain rule tests** (`npm run test:domain`) assert core business rules using the same seed and env:

- Valid points ingest; reject raw stroke scores (e.g. 72, 75) and out-of-range points in points mode.
- Event structure: reject `season_id` that belongs to another group.
- Membership: reject non-member players with `invalid_player_ids`.
- Idempotency: same `external_event_id` twice returns 200 and no duplicate rows.
- Override: require `override_actor` and `override_reason` when `score_override` is set; standings use effective result.
- win_loss_override: `result_type` win/loss/tie; system derives points; standings from event results.
- Multi-group: one result per group; player can be in multiple groups; no cross-group ambiguity in standings.
- Payout: no config (dollars_per_point NULL) → computed: false; with config → computed: true, zero-sum; standings remain points-only.
- Payment requests: generate-payment-requests reads money_delta, validates zero-sum in cents, returns minimal payer→payee list; not persisted; Late Add does not track payment completion.
