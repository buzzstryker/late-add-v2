# Late Add v2 — Screen Map

Screens and flows for the Late Add app. For terminology (Group, Season, Event, Result, Standings, Source app) see [README — Terminology](./README.md#terminology). For UI structure and routing see [UI Architecture](./Late_Add_V2_UI_Architecture.md).

---

## Product scope: three ways events enter the system

Late Add v2 supports events (rounds) from three paths. All converge into the same canonical event/result model in the backend; the UI does not maintain separate "manual-only" logic beyond source labeling and input workflow.

| Source | Description |
|--------|-------------|
| **API ingestion** | External apps (e.g. Scorekeeper, 18Birdies) POST event results to the Late Add API. Events appear in the system with `source_app` and optional `external_event_id` for attribution and idempotency. |
| **Manual round entry** | Admins create a round/event directly in the UI when no external app supplied results or when direct entry is faster. Treated as a first-class workflow; submitted to the same backend path as ingestion (e.g. manual as `source_app`). |
| **Round edit / override** | Admins correct bad ingests, adjust entered rounds, and override round details or results. Changes flow through the backend; standings and recalculation remain backend responsibilities. |

---

## App entry and navigation

- **Dashboard** — Top-level entry; summary cards and recent events; links to Events, Attribution Review, Player Mapping, Standings.
- **Primary nav** — Dashboard, Events, Round Entry (e.g. Events → New), Standings, Review (Attribution, Player Mapping), Settings if needed.
- **Event-centric** — Event detail links to Edit/Override, Attribution Review, and Player Mapping where relevant.

---

## Screens (implemented / target)

| Screen | Purpose |
|--------|---------|
| **Auth / sign-in** | Supabase Auth; obtain JWT for API calls. |
| **Dashboard** | Operational snapshot: recent events (ingested + manual), pending attribution count, pending player mapping count, standings summary; Recent Events table; Attention Required section with links to review queues. |
| **Events** | Audit trail for all rounds/events (API-ingested and manual). Filterable/sortable list; columns: internal id, external id, source app, played date, group, season, status, received/created timestamp. Event detail: source metadata, processing status, players/results, attribution status, validation/mapping issues; links to attribution review, player mapping, edit/override. |
| **Event detail** | Single event: metadata, results, status, links to edit and review flows. |
| **Round entry (events/new)** | Manual round creation. Form: group, season, event name, played date, source_app = manual, players, scores. First-class workflow; submits to canonical backend event creation. |
| **Round edit / override** | Correction of existing round. Entry from event detail; route e.g. `/events/:eventId/edit`. Edit event metadata, players, scores per backend contract; optional override reason if supported. |
| **Attribution review** | Queue of events with unresolved attribution; list + detail; admin chooses correct group/season and submits resolution. |
| **Player mapping** | Queue of unmapped source players; list + detail; admin maps to existing Late Add player and confirms. |
| **Standings** | Group + Season selectors; points-only table (player, rounds_played, total_points, rank); read-only from API; optional player drilldown. |
| **Groups** | List and manage groups (and sections if used). |
| **Seasons** | List and manage seasons per group. |
| **Payout config** | Group-level payout (e.g. dollars_per_point) if exposed. |
| **Payment requests** | For a round: compute-money-deltas then generate-payment-requests; display payer→payee list. |

---

## Status values (normalized across UI)

- **processed** — Event fully processed and attributed.
- **pending attribution** — Awaiting admin resolution of group/season (or duplicate) attribution.
- **pending player mapping** — One or more source players not yet mapped to Late Add players.
- **validation error** — Ingestion or update failed validation; needs correction.
- **duplicate / ignored** — Treated as duplicate by backend (e.g. same source_app + external_event_id).

---

## Flows

- **Ingest → inspect** — Events list and event detail show all events; filters by source, status, group, date.
- **Manual entry** — Events → New Round → fill form → submit → redirect to event detail or events list.
- **Correct round** — Event detail → Edit/Override → change fields → save → back to event detail; backend recalculates standings.
- **Resolve attribution** — Dashboard or Events → Attribution Review → select item → choose group/season → submit → item removed from queue.
- **Resolve player mapping** — Dashboard or Events → Player Mapping → select unmapped player → choose Late Add player → confirm → removed from queue.
- **View standings** — Standings → select Group + Season → display API response; no client-side calculation.

---

## References

- [README.md](./README.md)
- [UI Architecture](./Late_Add_V2_UI_Architecture.md)
- [API Spec](./Late_Add_V2_API_Spec.md)
