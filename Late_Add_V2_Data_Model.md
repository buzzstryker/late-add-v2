# Late Add v2 — Data Model

Entities and schema summary. Implemented in **late-add-api/** (Supabase/Postgres). Full schema lives in that repo’s migrations. For standard terms (**Group**, **Season**, **Event**, **Result**, **Standings**, **Source app**, **Attribution**) see [README — Terminology](./README.md#terminology).

---

## Entities

| Entity | Description |
|--------|-------------|
| **Section** | Optional parent for groups (e.g. organization). |
| **Group** | League/competition unit. Has name, optional section, optional logo; has `scoring_mode` (points vs win_loss_override) and optional `dollars_per_point` for payout. Owned by a user (user_id). |
| **Group member** | Membership of a player in a group (player_id, role, is_active). |
| **Season** | Time-bounded window for a group (start_date, end_date). Standings are per season. |
| **League round (event)** | One round/event. Has group_id, optional season_id, round_date; optional source_app and external_event_id for idempotency and attribution. Owned by a user (user_id). |
| **League score (result)** | One player’s result for an event. player_id, score_value, optional score_override; optional result_type (win/loss/tie). Optional money_delta (for settlement; not used in standings). |
| **Season standings** | View: per season and player, rounds_played and total_points (effective points only). No money. |

## Relationships

- Section → Groups (optional).
- Group → Group members, Seasons, League rounds.
- Season → League rounds (optional link).
- League round → League scores (one per player in the round).

## Schema (physical)

Implemented in **late-add-api/** in this directory: `sections`, `groups`, `group_members`, `seasons`, `league_rounds`, `league_scores`; `season_standings` view; RLS on all tables. See [late-add-api/supabase/migrations/](./late-add-api/supabase/migrations/) and [late-add-api/docs/api.md](./late-add-api/docs/api.md) for column-level detail.

## Sync and ownership

- Data is owned by the authenticated user (e.g. league_rounds.user_id, groups.user_id). RLS enforces access. No multi-tenant sync model in the current design.
- Round-level actions currently authorize by round ownership; see [BACKLOG.md](./BACKLOG.md) for a possible future move to group-based permissions.

## References

- [README.md](./README.md)
- [API Spec](./Late_Add_V2_API_Spec.md)
- [bootstrap-late-add-api.md](./bootstrap-late-add-api.md)
- [late-add-api/](./late-add-api/): migrations, [docs/api.md](./late-add-api/docs/api.md)
