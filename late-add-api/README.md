# late-add-api

API for Late Add Golf v2: groups, seasons, league rounds, scores, and standings. Backed by Supabase (Postgres, Auth, Edge Functions).

## Prerequisites

- Node 18+
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- A Supabase project (create at supabase.com)

## Setup

1. From the Late Add v2 directory, go into the API folder and install:

   ```bash
   cd late-add-api
   npm install
   ```

2. Link Supabase project and run migrations:

   ```bash
   cp .env.example .env
   # Edit .env: SUPABASE_URL, SUPABASE_ANON_KEY (SERVICE_ROLE_KEY for admin if needed)
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

## Run locally

**Order matters:** start the local stack first so the functions runtime gets local keys (not a linked remote project).

```bash
supabase start
supabase db reset   # apply migrations + seed (test user + section, group, season, 2 players)
supabase functions serve
```

- API base: `http://127.0.0.1:54321/functions/v1/` (or see `supabase start` output).
- Seed user: `test@lateadd.local` / `testpass123` (for integration tests).

**If you see "Invalid JWT" (401) when running tests:** the runtime may be using a *linked* remote project’s keys instead of local. For local-only testing, unlink then restart:

```bash
supabase unlink
supabase start
supabase db reset
supabase functions serve
```

Then run `npm run test:integration` again. `supabase/config.toml` sets `verify_jwt = false` for the two functions so verification happens in code with the same env as your test client.

## Tests

**Smoke (no Supabase required):** request validation and auth checks

```bash
npm run test:local
```

**Integration (full happy path):** requires local Supabase + functions running. Uses seed user and asserts ingest → league_rounds, league_scores, season_standings, idempotency, and invalid-player rejection.

**Domain rules:** `npm run test:domain` — asserts business rules: points vs raw scores, season-group match, membership, idempotency, override metadata, win_loss_override, multi-group, standings from event results.

1. From project root: `supabase start`, then `supabase db reset`, then `supabase functions serve`.
2. Copy `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from the `supabase start` output into `.env` (or export them).
3. Run:

```bash
npm install
npm run test:integration
```

## Deploy

```bash
supabase db push
supabase functions deploy
```

## Docs

- Schema and bootstrap: `docs/`
- Parent Late Add v2 directory: `../` (bootstrap plan, data model, API spec at root)
