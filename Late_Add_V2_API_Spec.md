# Late Add v2 — API Spec

Endpoints, request/response shapes, auth, and errors for late-add-api. Full contract, validation rules, and error codes: [late-add-api/docs/api.md](./late-add-api/docs/api.md). For terms (Group, Season, Event, Result, Standings, Source app, Attribution) see [README — Terminology](./README.md#terminology).

---

## Base URL and auth

- **Base:** `https://<project>.supabase.co/functions/v1` (or local: `http://127.0.0.1:54321/functions/v1`).
- **Auth:** Bearer JWT (Supabase Auth). All endpoints require a valid token; RLS and ownership checks apply.

## Endpoints (summary)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/ingest-event-results` | Create one league round and league_scores (event results). Body: `group_id`, `round_date`, `scores[]`; optional `season_id`, `source_app`, `external_event_id` for idempotency. |
| GET | `/get-standings` | Read season standings. Query: `season_id`, optional `group_id`. Returns points-only (rounds_played, total_points). |
| POST | `/compute-money-deltas` | Round-scoped: compute and write `league_scores.money_delta` for one round from group payout config (`groups.dollars_per_point`). Body: `league_round_id`. No-op if config not set. |
| POST | `/generate-payment-requests` | Round-scoped: read `money_delta` for one round, return minimal payer→payee requests (amount_cents). Body: `league_round_id`. Does not persist; Late Add does not track payment completion. |

Details (request/response shapes, validation, error codes): see **late-add-api/** in this directory: [docs/api.md](./late-add-api/docs/api.md), [payout-configuration-design.md](./late-add-api/docs/payout-configuration-design.md), [settlement-calculation-design.md](./late-add-api/docs/settlement-calculation-design.md).

## Types (request / response)

- Ingest: `scores[]` with `player_id`, `score_value` (points) or `result_type` (win/loss/tie); optional `score_override` with override metadata.
- Standings: `{ standings: [ { season_id, group_id, player_id, rounds_played, total_points } ] }`.
- Payment requests: `{ league_round_id, requests: [ { from_player_id, to_player_id, amount_cents } ] }`.

## References

- [Master Spec](./Late_Add_V2_Master_Spec.md)
- [Data Model](./Late_Add_V2_Data_Model.md)
- [bootstrap-late-add-api.md](./bootstrap-late-add-api.md) (first endpoints)
- [late-add-api/docs/](./late-add-api/docs/) — full API contract, settlement and payout design, backlog
