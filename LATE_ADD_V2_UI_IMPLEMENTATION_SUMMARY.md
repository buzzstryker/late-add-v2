# Late Add v2 Admin UI — Implementation Summary

Summary of the first usable admin UI in **`late-add-admin/`** (Vite + React) in this directory. No backend or Scorekeeper app code was changed.

---

## 1. Routes added

| Route | Purpose |
|-------|---------|
| `/` | Redirects to `/dashboard`. |
| `/dashboard` | Operational snapshot: summary cards, recent events table, Attention Required (attribution + player mapping links). |
| `/events` | Events list with filters (source_app, status, group_id, from_date, to_date). |
| `/events/new` | Manual round entry form. |
| `/events/:eventId` | Event detail: source metadata, status, results, links to edit and review flows. |
| `/events/:eventId/edit` | Round edit / override form. |
| `/review/attribution` | Attribution review queue and resolution (select group/season, submit). |
| `/review/player-mapping` | Player mapping queue and resolution (select Late Add player, confirm). |
| `/standings` | Group + Season selectors; standings table (read-only from API). |

---

## 2. Components added

- **Layout** — Nav bar (Dashboard, Events, Round entry, Standings, Attribution review, Player mapping) + outlet.
- **PageHeader** — Title, optional subtitle, optional action slot.
- **StatusBadge** — Normalized status (processed, pending_attribution, pending_player_mapping, validation_error, duplicate_ignored).
- **DataTable** — Generic table with columns (key, label, optional render), row click optional.
- **FilterBar** — Wrapper for filter controls.
- **EmptyState** — Message + optional action.
- **ErrorState** — Message + optional Retry.
- **LoadingSpinner** — Centered spinner.
- **ConfirmToast** — Temporary success toast.
- **FormSection** — Optional title + children for forms.

---

## 3. Forms added

- **Round entry** (`/events/new`) — Group (required), Season (optional), Event name (optional), Played date (required), Source app fixed as `manual`, dynamic list of player_id + score_value; submit calls `POST /ingest-event-results`.
- **Round edit** (`/events/:eventId/edit`) — Played date, Season ID, results table (score_value, score_override); submit calls `PATCH /events/:eventId` (see backend gaps).
- **Attribution resolution** — Inline on Attribution Review: Group ID (required), Season ID (optional); submit calls `POST /review/attribution/:id/resolve`.
- **Player mapping resolution** — Inline on Player Mapping: Late Add player ID (required), optional suggestions; submit calls `POST /review/player-mapping/:id/resolve`.

---

## 4. API assumptions

- **Base URL** — From `VITE_LATE_ADD_API_URL` (default `http://127.0.0.1:54321/functions/v1`). All requests use `Authorization: Bearer <JWT>` when token is set (see `api/client.ts`).
- **Documented and used**  
  - `POST /ingest-event-results` — Used for manual round entry and matches late-add-api contract.  
  - `GET /get-standings?season_id=&group_id=` — Used for Standings screen.
- **Assumed for UI to work** (may not exist yet in late-add-api):  
  - `GET /events` — List events (query: group_id, season_id, source_app, status, from_date, to_date).  
  - `GET /events/:eventId` — Event detail with results.  
  - `GET /groups` — List groups.  
  - `GET /seasons` or `GET /seasons?group_id=` — List seasons.  
  - `GET /review/attribution` — List unresolved attribution items.  
  - `POST /review/attribution/:id/resolve` — Body: `{ group_id, season_id? }`.  
  - `GET /review/player-mapping` — List unresolved player mapping items.  
  - `POST /review/player-mapping/:id/resolve` — Body: `{ player_id }`.  
  - `PATCH /events/:eventId` — Update event metadata and/or results (see backend gaps).

If list/detail/review endpoints are missing, the UI will show empty lists or errors until late-add-api adds them (or exposes equivalent data via PostgREST).

---

## 5. Backend gaps that block or weaken the UI

- **Events list and event detail** — If `GET /events` and `GET /events/:eventId` are not implemented, the Dashboard “Recent events” and the Events screen cannot show data. The UI composes from these; no client-side fallback.
- **Groups and seasons list** — If `GET /groups` and `GET /seasons` are missing, Standings and Round entry cannot populate group/season selectors; Round entry would be blocked.
- **Attribution review** — If `GET /review/attribution` and `POST /review/attribution/:id/resolve` do not exist, the Attribution Review screen stays empty and resolution is impossible.
- **Player mapping** — If `GET /review/player-mapping` and `POST /review/player-mapping/:id/resolve` do not exist, the Player Mapping screen stays empty and mapping is impossible.
- **Round update** — If `PATCH /events/:eventId` (or equivalent) is not implemented, Round edit will fail on save. The UI does not invent an alternative; the backend should define the update contract (allowed fields, validation, audit if any).

Recommendation: Add the above endpoints (or equivalent PostgREST usage) in late-add-api and document them in `docs/api.md`. The admin UI is built to call these paths and body shapes.

---

## 6. Documentation updates

- **Late_Add_V2_Screen_Map.md** — Updated to state three ways events enter (API ingestion, manual entry, round edit/override); added Dashboard, Events, Event detail, Round entry, Round edit, Attribution review, Player mapping, Standings; normalized status values; added flows.
- **Late_Add_V2_UI_Architecture.md** — Updated UI goals (manual entry and round override as first-class); application structure and routing; API interaction (manual creation, update); shared UI requirements and status design.
- **README.md** (this directory) — Noted that the first usable admin UI lives in `late-add-admin/` and supports API ingestion, manual round entry, and round edit/override.

---

## 7. Where the code lives

- **App and routing:** `late-add-admin/src/App.tsx`, `main.tsx`, `components/Layout.tsx`
- **Pages:** `late-add-admin/src/pages/` (Dashboard, Events, EventDetail, RoundEntry, RoundEdit, AttributionReview, PlayerMapping, Standings)
- **API:** `late-add-admin/src/api/` (client, events, standings, groups, attribution, playerMapping)
- **Types:** `late-add-admin/src/types/index.ts`
- **Shared components:** `late-add-admin/src/components/`

To run: `cd late-add-admin && npm install && npm run dev` (see `late-add-admin/README.md`).
