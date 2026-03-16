# Late Add v2 — UI Architecture

Front-end structure for the Late Add admin UI. For screens and flows see [Screen Map](./Late_Add_V2_Screen_Map.md); for API contract see [API Spec](./Late_Add_V2_API_Spec.md) and [late-add-api/docs/](./late-add-api/docs/).

---

## 1. UI Goals

- **Admin-focused interface** — For league/competition admins who manage groups, seasons, events, and standings.
- **Manage groups, seasons, events, standings** — Create and edit groups and seasons; view and manage events (rounds); view points-only standings.
- **Three ways events enter** — (1) **API ingestion** from external apps (Scorekeeper, 18Birdies, etc.); (2) **Manual round entry** as a first-class workflow; (3) **Round edit / override** to correct bad ingests or adjust results. All converge into the same canonical event/result model in the backend.
- **Resolve attribution conflicts** — Surface events that cannot be assigned cleanly to group/season; support resolution (choose canonical, merge, or reject).
- **Resolve player mapping** — Map source-player identities to canonical Late Add players.
- **Operational, not passive** — The UI supports active round creation and correction, not only review of ingested data.

---

## 2. Application Structure

Main UI areas (aligned with [Screen Map](./Late_Add_V2_Screen_Map.md)):

| Area | Purpose |
|------|---------|
| **Dashboard** | Operational snapshot: recent events (ingested + manual), pending attribution and player mapping counts, standings shortcut; Recent Events table; Attention Required links. |
| **Events** | Audit trail for all events; filterable/sortable list; event detail with links to edit, attribution review, player mapping. |
| **Round entry** | Manual creation of a round (group, season, date, players, scores); first-class flow at e.g. `/events/new`. |
| **Round edit / override** | Correct or override an existing round; entry from event detail; route e.g. `/events/:eventId/edit`. |
| **Attribution review** | Queue of unresolved attribution items; list + detail; admin selects group/season and submits resolution. |
| **Player mapping** | Queue of unmapped source players; list + detail; admin maps to Late Add player and confirms. |
| **Standings** | Group + Season selectors; read-only points-only standings from API. |
| **Groups** | List and manage groups (and sections if used). |
| **Seasons** | List and manage seasons per group. |
| **Admin settings** | Auth, profile, app-level settings. |

---

## 3. Routing Model

| Route | Purpose |
|-------|---------|
| `/dashboard` | Home / dashboard. |
| `/events` | Events list (optional query: group, season, source, status). |
| `/events/new` | Manual round entry. |
| `/events/:eventId` | Event detail. |
| `/events/:eventId/edit` | Round edit / override. |
| `/review/attribution` | Attribution conflict queue and resolution. |
| `/review/player-mapping` | Player mapping queue and resolution. |
| `/standings` | Standings (Group + Season selectors in UI; optional `/standings/:groupId`, `/standings/:groupId/:seasonId`). |
| `/groups` | Groups list. |
| `/groups/:groupId` | Group detail. |
| `/seasons/:seasonId` | Season detail (if needed). |
| `/admin` or `/settings` | Admin / app settings. |

Auth (sign-in) is a separate flow (e.g. `/login`) before the above.

---

## 4. API Interaction

| Need | API usage |
|------|-----------|
| **Ingest events** | POST event results (group_id, round_date, scores[], optional source_app, external_event_id). Handle validation errors and duplicate responses. |
| **Manual round creation** | Same canonical path as ingest (e.g. POST with source_app = "manual" or equivalent); no separate backend model. |
| **Update / override round** | Use backend-supported update endpoint(s) for event metadata and/or results; document any override/reason field if present. |
| **Retrieve standings** | GET standings by group/season; display as returned; no client-side aggregation. |
| **Retrieve groups, seasons, events** | GET list/detail for groups, seasons, league_rounds (events); use for lists, detail views, filters. |
| **Resolve attribution** | Use API endpoints for attribution resolution (accept/reject/merge) per late-add-api contract. |
| **Resolve player mappings** | Map external player identifiers to Late Add player_id via supported API; refresh queues after resolution. |

All calls use **Bearer JWT** (Supabase Auth). Full contract in [late-add-api/docs/](./late-add-api/docs/).

---

## 5. Data Flow

```
UI → API → Canonical Event → Attribution → Results → Points → Standings
```

- **UI** submits or inspects data only via the API. Manual entry and ingested rounds both produce the same canonical event/result model.
- **API** validates and persists; recalculates standings and downstream effects. Round edit/override flows through the API; the client does not simulate recalculation.
- **Standings** are always derived on the backend; the UI never computes them locally.

---

## 6. State Management

| Layer | Description |
|-------|-------------|
| **Server state** | Data from the API: events, groups, seasons, standings, attribution queue, player-mapping queue. Cache and invalidate/refetch after mutations. |
| **UI state** | Filters, selections, modal open/closed, form dirty state. Keep separate from server state. |
| **Review queues** | Attribution and player-mapping lists as server-state; refetch after resolution so queues stay accurate. |

---

## 7. Error Handling

| Error type | How to surface |
|------------|-----------------|
| **Ingestion validation errors** | Field-level or request-level messages from API; allow correction and retry. |
| **Duplicate events** | Clear message; link to Attribution Review or event detail. |
| **Unresolved attribution** | Dashboard and Attribution Review: count and list; link to resolution. |
| **Unresolved player mappings** | Dashboard and Player Mapping: list unmapped players; warn when standings might be affected. |

Use a shared error state component and consistent messaging.

---

## 8. UI Principles

- **Fast admin workflows** — Minimize steps for common tasks (e.g. manual entry → event detail, or resolve one attribution item).
- **Minimal clicks for attribution resolution** — Dedicated queue with short flows to accept/merge/reject.
- **Standings always from backend** — Never compute standings in the front end.
- **Manual entry is first-class** — Same visibility and treatment as API-ingested events; no hidden or second-class flows.
- **Round edit/override is correction** — Treat as audit-friendly correction; backend owns downstream effects.

---

## 9. Shared UI Requirements

- **Routing** — Clear routes per section above; e.g. `/dashboard`, `/events`, `/events/new`, `/events/:eventId`, `/events/:eventId/edit`, `/review/attribution`, `/review/player-mapping`, `/standings`.
- **Shared components** — Page header, status badge, data table, filter bar, empty state, error state, loading spinner/skeleton, confirmation toast/banner, form section, player/result row editor for round entry and edit where useful.
- **Status design** — Normalize status across screens: processed, pending attribution, pending player mapping, validation error, duplicate/ignored. Use one shared status badge component.
- **Navigation** — Dashboard links to Events, Attribution Review, Player Mapping, Standings; Events links to event detail and Round Entry; event detail links to Edit/Override and review flows; Standings and Round Entry in primary nav.
- **Styling** — Clean, minimal, operational; readability and scanning over novelty; consistent over flashy.

---

## References

- [README](./README.md) — Overview, terminology.
- [Screen Map](./Late_Add_V2_Screen_Map.md) — Screens and flows.
- [API Spec](./Late_Add_V2_API_Spec.md) — Endpoints and shapes.
- [Data Model](./Late_Add_V2_Data_Model.md) — Entities and schema.
