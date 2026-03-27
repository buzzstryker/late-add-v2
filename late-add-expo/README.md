# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

### iPad / iPhone app: real Late Add data (not the browser)

**Use this after the web admin works.** Team sequence: test **`late-add-admin/`** first, then the same API on device here (see repo root [README.md](../../README.md) → **Recommended testing order**).

After sign-in, the **Standings** tab loads **live** groups, seasons, and points from your Late Add API (same as the admin site).

1. Copy **`late-add-expo/.env.example`** to **`.env`** in `late-add-expo`.
2. Set **`EXPO_PUBLIC_LATE_ADD_API_URL`** to your Edge Functions base, e.g.  
   `https://YOUR_PROJECT.supabase.co/functions/v1`  
   **Important:** If Supabase runs on your PC, the iPad cannot use `127.0.0.1`. Use your PC’s **LAN IP** (e.g. `http://192.168.1.50:54321/functions/v1`) and ensure the firewall allows it—or use a **hosted** Supabase project.
3. **`EXPO_PUBLIC_SUPABASE_URL`** + **`EXPO_PUBLIC_SUPABASE_ANON_KEY`** in `.env` so you can **sign in with email and password** (recommended). In Supabase: **Authentication → Users → Add user** (email + password) for an account that can call your API.

#### Where do I get a JWT? (only if you paste token instead of email)

Supabase does **not** show user JWTs in the dashboard. You get **`access_token`** when Auth signs someone in:

1. **Easiest:** Use **email & password** on the Late Add app—no JWT to copy.
2. **Password grant (curl / Postman):** Replace project URL, anon key, email, password:

   ```bash
   curl -s -X POST "https://YOUR_PROJECT_REF.supabase.co/auth/v1/token?grant_type=password" \
     -H "apikey: YOUR_ANON_OR_PUBLISHABLE_KEY" \
     -H "Content-Type: application/json" \
     -d "{\"email\":\"you@example.com\",\"password\":\"your-password\"}"
   ```

   Copy the **`access_token`** value from the JSON (long string starting with `eyJ…`). Paste that into the app or into Late Add admin’s JWT field.

3. **Late Add admin:** If you already pasted a JWT there, it’s the same kind of token—you can paste the same value into the mobile app.
4. `npm run start:tunnel` (or `start:lan`), open in **Expo Go** on the iPad.

**Metro error resolving `@supabase/auth-js`:** From `late-add-expo`, run `npx expo start -c` (clear cache). The project includes `metro.config.js` that disables package `exports` resolution for compatibility with Supabase. Always start Expo from **`late-add-expo`** (or use `npm run start:tunnel` from the repo root).

**AsyncStorage / “Native module is null, cannot access legacy storage”:** Sign-in no longer uses `@react-native-async-storage/async-storage`. Sessions and pasted JWTs are stored with **`expo-file-system`** on iOS/Android and **`localStorage`** on web (`lib/authPersistence.ts`).

---

### Expo Go from a Windows PC (iPhone / iPad)

Your phone or iPad does **not** need Xcode or Android Studio. Use **Expo Go** from the App Store / Play Store.

**Option A — Tunnel (works best from PC)**  
PC and tablet often can’t see each other on Wi‑Fi (guest Wi‑Fi, firewall, VPN). Tunnel fixes that:

```bash
npm run start:tunnel
```

1. If prompted, sign in: `npx expo login` (free Expo account).
2. Wait until the terminal shows a QR code / URL.
3. On **iPad**: Camera app → scan QR → open in **Expo Go**.  
   Or open **Expo Go** → “Enter URL manually” and paste the `exp://…` URL from the terminal.

**Option B — Same Wi‑Fi (LAN)**  
If PC and iPad are on the **same** home Wi‑Fi (not guest / isolated):

```bash
npm run start:lan
```

If it still won’t load:

1. **Windows Firewall**: Settings → Privacy & security → Windows Security → Firewall → “Allow an app” → allow **Node.js** on **Private** networks. Or temporarily turn off the firewall to test.
2. **Correct PC IP**: In PowerShell run `ipconfig`, find your Wi‑Fi **IPv4** (e.g. `192.168.1.50`). In Expo Go, try **Enter URL manually**: `exp://YOUR_IP:8081` (port may differ; use what the terminal prints).

**Expo Go version**  
Install the latest **Expo Go** from the store so it matches this project’s Expo SDK.

---

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
