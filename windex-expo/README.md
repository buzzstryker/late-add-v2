# windex-expo

Expo app for Late Add Golf v2 — web (Vercel), iOS, and Android via Expo Go.

## Web deployment

- **Production:** https://windexgolf.com (Vercel, auto-deploys from `master`). `app.lateaddgolf.com` 308-redirects here for legacy bookmarks.
- **Vercel root directory:** `windex-expo/`
- **Build:** `npx expo export --platform web` → outputs to `dist/`
- **Deploy-skip trap:** `vercel.json`'s `ignoreCommand` (`git diff --quiet HEAD^ HEAD -- .`) only inspects the push's **HEAD commit**. A multi-commit push whose *last* commit doesn't touch `windex-expo/` (e.g. app fix followed by a root-level docs commit) gets **Canceled** and the app changes underneath never deploy — `vercel redeploy` re-runs the ignore command and cancels again. Keep app-code commits last in a push, or follow up with any commit that touches this directory.

## Authentication

Login uses **email OTP** (6-digit code). The screen is **single-step**: the email
and code fields are both visible from load.

1. User enters their email **and** the 6-digit code — typically the one already
   in their invite email — and taps **Sign In**
2. `supabase.auth.verifyOtp({ type: 'email' })` establishes the session
3. **Send me a code** is a secondary action for anyone without a code, or whose
   code has expired. It mints a NEW code, superseding any earlier one
4. No redirects, no magic links, no PKCE — works identically on web and mobile

> Until 2026-08-11 the code field was gated behind "Send Login Code", so the only
> route to it was to request a replacement code — which made the code in every
> invite email unusable. Do not reintroduce a conditional around the code field.

There is **no user-facing email/password flow.** `signInWithPassword` exists on
the auth context but no screen calls it; the login screen is OTP-only.

Only existing users can log in (`shouldCreateUser: false`). Player accounts are created by an admin via `windex-api/scripts/invite-players.mjs`.

### Auth architecture

- **AuthContext** (`contexts/AuthContext.tsx`): `onAuthStateChange` is the single source of truth for `signedIn` and `ready` state. Exposes `sendOtp`, `verifyOtp`, `signInWithPassword`, `signOut`.
- **Session storage**: `lib/authPersistence.ts` — uses `localStorage` on web, `expo-file-system` on native.
- **401 handling**: API calls that return 401 trigger automatic sign-out (with a 30-second grace period after fresh login to avoid stale in-flight requests).
- **Routing**: `_layout.tsx` redirects to `/login` when `signedIn=false` and to `/(tabs)/standings` when `signedIn=true`.

## Environment variables

Copy `.env.example` to `.env`:

```
EXPO_PUBLIC_SUPABASE_URL=https://ftmqzxykwcccocogkjhc.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_publishable_key
EXPO_PUBLIC_LATE_ADD_API_URL=https://ftmqzxykwcccocogkjhc.supabase.co/functions/v1
```

For Vercel, set these in the Vercel dashboard under Settings > Environment Variables.

## Development

```bash
cd windex-expo
npm install
npx expo start        # dev server (web + mobile)
npx expo start --web  # web only
```

### Mobile (Expo Go on iPhone / iPad)

```bash
npm run start:tunnel   # works from Windows PC to iOS device
```

Scan the QR code with the Camera app, opens in Expo Go.

**LAN alternative** (same Wi-Fi required):
```bash
npm run start:lan
```

### PWA / Add to Home Screen

The web deployment includes:
- `public/manifest.json` with PWA metadata
- `public/apple-touch-icon.png` (180x180) for iOS home screen icon
- `app/+html.tsx` with manifest and apple-touch-icon head tags

To get the app icon on iPhone: Safari > Share > Add to Home Screen.

## Supabase configuration

### Auth settings (pushed via `supabase config push`)
- **Site URL:** `https://windexgolf.com`
- **Redirect URLs:** `https://windexgolf.com`, `https://windexgolf.com/**`, `https://www.windexgolf.com`, `https://www.windexgolf.com/**`, `https://late-add-v2.vercel.app`, `https://late-add-v2.vercel.app/**` (the `late-add-v2.vercel.app` entries track the Vercel project name and will be revisited when the Vercel project is renamed)
- **OTP:** 6 digits, 1-hour expiry
- **Email template:** Custom OTP-only template (shows code, no magic link)

### Edge Functions
All Edge Functions are deployed with `--no-verify-jwt`. Functions handle auth internally via `getUser(token)`. See `windex-api/supabase/config.toml` for the full list.

## Project structure

```
windex-expo/
├── app/              # Expo Router screens (file-based routing)
│   ├── (tabs)/       # Tab screens: standings, rounds, history, etc.
│   ├── login.tsx     # OTP + password login
│   ├── _layout.tsx   # Root layout with auth routing
│   └── +html.tsx     # Custom HTML head (PWA, icons)
├── components/       # Shared UI components
├── contexts/         # AuthContext, GroupContext, DrawerContext
├── lib/              # API client, config, auth persistence
├── constants/        # Theme colors
├── hooks/            # Custom hooks
├── public/           # Static assets (manifest, icons)
└── assets/           # Images and fonts
```
