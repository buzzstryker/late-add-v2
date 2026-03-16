# Late Add v2 Admin UI

Standalone admin web app for Late Add v2: dashboard, events, round entry, round edit, attribution review, player mapping, and standings. Built with Vite + React + TypeScript + React Router.

- **Docs:** See the parent folder (this Late Add v2 directory) for product and API docs (README.md and linked .md files).
- **API:** Talks to **late-add-api** (Supabase Edge Functions). Set `VITE_LATE_ADD_API_URL` (e.g. `http://127.0.0.1:54321/functions/v1` for local Supabase).

## Run

```bash
npm install
cp .env.example .env   # optional; edit if API URL differs
npm run dev
```

Open http://localhost:3001. Use the nav for Dashboard, Events, Round entry, Standings, Attribution review, Player mapping.

## Build

```bash
npm run build
npm run preview   # serve dist/
```

## Auth

The app assumes a valid JWT is set for the API (e.g. via Supabase Auth). Token handling (login screen, token storage) can be wired in when the auth flow is defined.
