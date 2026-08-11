// POST /send-invite — Super-admin only.
//
// First-invite path for a player whose row exists with no auth.users link
// (`players.user_id IS NULL`). Sibling of send-invite-again (re-invite path)
// and invite-player (combined create-player-and-invite path).
//
// Two-email onboarding model (2026-05-18). THIS function sends Email 1 only:
//
//   Email 1 (admin-triggered welcome) — this function.
//     admin.auth.admin.inviteUserByEmail(email) creates the auth.users row
//     AND sends the [auth.email.template.invite] "Invite user" email. That
//     template body is URL-free welcome text (no {{ .ConfirmationURL }}, no
//     clickable link) — Supabase still mints a confirmation token server-
//     side, but with no URL in the body, email-security scanners and iOS
//     Mail prefetchers have nothing to passively consume (residual,
//     recoverable phantom-confirmation risk accepted by Buzz). The invited
//     user is created UNCONFIRMED (email_confirmed_at NULL, invited_at set);
//     no code or token is surfaced to the recipient.
//
//   Email 2 (player-triggered code) — NOT this function.
//     The player visits windexgolf.com and clicks "Send Login Code", which
//     calls signInWithOtp → the code-only [auth.email.template.magic_link]
//     template → 6-digit code (standard 1-hour expiry, fine because they
//     just requested it). verifyOtp confirms the account on first sign-in,
//     setting email_confirmed_at / last_sign_in_at.
//
// This replaces the 2026-05-14 createUser + signInWithOtp two-step, which
// emailed the 6-digit code at INVITE time — so the 1-hour OTP expiry began
// ticking before the player ever looked, and they routinely hit an expired
// code. Decoupling welcome (Email 1) from code (Email 2, self-served on
// demand) removes that expiry pressure.
//
// inviteUserByEmail creates the auth.users row itself, so createUser is NOT
// called: GoTrue rejects inviteUserByEmail for an already-existing user
// (HTTP 422 — see Project_Context 2026-05-14 note), and the existing-auth-
// by-email precheck below already handles the "row exists" case.
//
// MIGRATION 056 CHANGED WHAT A SUCCESSFUL INVITE LOOKS LIKE.
// Linking no longer happens at auth.users INSERT; it happens when the invitee
// CONFIRMS their email. So after a successful invite from this function,
// players.user_id is still NULL and that is correct, not a failure:
//
//     invited_at  means INVITED   (this function's job)
//     user_id     means LINKED    (happens later, when they enter their code)
//
// Two consequences, both handled below:
//   * The existing-auth branch is now split on confirmation. An UNCONFIRMED
//     pre-existing account is NOT linked — it is one of the three link sites
//     056 had to close, and gating only the DB trigger would have left this
//     one as an equivalent hole reachable from the admin UI.
//   * The post-invite assertion no longer treats "not linked" as a failure.
//
// Auth: handler-side getUser(token) + am_i_super_admin() RPC. Deployed with
// verify_jwt = false (matches every other function in this project — see
// config.toml).
//
// Request body (JSON):
//   { "player_id": "..." }
//
// Pipeline:
//   1. Super-admin gate.
//   2. Load player by id. 404 if not found.
//   3. Reject if player.user_id IS NOT NULL → 409 "already linked".
//   4. Reject if email is null/empty/invalid → 400.
//   5. Check for an existing auth.users row by email.
//      a. Found AND CONFIRMED → manually link the player row, no email sent
//         (avoids a pointless re-email AND the inviteUserByEmail
//         422-on-existing-user error). already_had_auth=true.
//      b. Found but UNCONFIRMED → do NOT link. Mail a fresh sign-in code and
//         leave the row pending. blocked_unconfirmed=true. Self-heals: the
//         code lands in the real person's inbox, and confirming links the row.
//      c. Not found → inviteUserByEmail: one atomic call that creates the auth
//         row and sends the welcome email (which now carries the code itself).
//   6. Re-read the players row AND re-check GoTrue, asserting that an auth user
//      now exists. "Not linked" is the normal, correct outcome of a fresh
//      invite under 056 and is no longer warned about.
//
// Responses:
//   200 { ok: true, invite_sent, already_had_auth, blocked_unconfirmed,
//         invited, linked, player, warning? }
//   400 { error: "..." }       — missing/invalid email, malformed body
//   401 { error: "Unauthorized" }
//   403 { error: "Super admin only" }
//   404 { error: "Player not found" }
//   409 { error: "Player already linked to an auth user", user_id }
//   500 { error: "..." }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type PlayerRow = {
  id: string;
  display_name: string;
  email: string | null;
  user_id: string | null;
};

/**
 * An auth user that already owns the address, plus WHETHER THEY HAVE CONFIRMED
 * IT. The confirmation flag is the whole point (migration 056): an unconfirmed
 * account proves nothing about who controls the inbox, so it must never be
 * linked to a player row.
 */
type ExistingAuthUser = { id: string; emailConfirmed: boolean };

/**
 * Is this the per-address send throttle rather than a real send failure?
 *
 * GoTrue rate-limits repeat emails to the same address (smtp_max_frequency,
 * currently 60s) and answers 429 with error_code `over_email_send_rate_limit`
 * and "For security purposes, you can only request this after N seconds."
 * That is a WAIT, not a failure — the gate has already done its job and the
 * players row is correctly pending either way. Reporting it as a 500 saying
 * "re-sending the sign-in code failed" reads as though the mechanism is broken
 * and trains an admin to distrust a flow that is working. Observed live
 * 2026-08-11: a second Send Invite click 14s after a successful one.
 *
 * Matched on ERROR CODE, never on HTTP status: a genuine SMTP outage is also an
 * error here and MUST still surface loudly.
 */
function isEmailSendThrottled(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  if (code === "over_email_send_rate_limit") return true;
  // Belt and braces. This toolchain has no type-checker (Deno is not installed
  // and `functions deploy` strips types), so if a supabase-js upgrade stops
  // populating .code we would silently fall back to reporting a 500. The regex
  // is deliberately narrow — it matches only GoTrue's throttle wording, not
  // errors in general.
  const msg = (e as { message?: string } | null)?.message ?? "";
  return /you can only request this after/i.test(msg);
}

async function findExistingAuthUser(
  admin: SupabaseClient,
  email: string,
): Promise<ExistingAuthUser | null> {
  // Mirrors invite-player. listUsers paginates; safe for our scale.
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Failed to list auth users: ${error.message}`);
    const hit = data?.users?.find((u) => u.email?.toLowerCase() === email);
    if (hit) return { id: hit.id, emailConfirmed: !!hit.email_confirmed_at };
    if (!data?.users || data.users.length < perPage) return null;
    page++;
    if (page > 50) return null; // safety bound (10k users)
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization" }, 401);
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Missing Bearer token" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Caller-context client (anon key + caller's JWT). RLS-respecting.
  const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userInfo, error: userError } = await callerClient.auth.getUser(token);
  if (userError || !userInfo?.user?.id) {
    return json({ error: "Unauthorized", msg: userError?.message ?? "Invalid JWT" }, 401);
  }

  // Super-admin gate via SQL helper from migration 014.
  const { data: isSuper, error: gateError } = await callerClient.rpc("am_i_super_admin");
  if (gateError) return json({ error: "Permission check failed", details: gateError.message }, 500);
  if (isSuper !== true) return json({ error: "Super admin only" }, 403);

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: { player_id?: unknown };
  try {
    body = await req.json() as { player_id?: unknown };
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body.player_id !== "string" || body.player_id.trim() === "") {
    return json({ error: "player_id is required" }, 400);
  }
  const playerId = body.player_id.trim();

  // Service-role client for the writes (bypasses RLS).
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Load player ──────────────────────────────────────────────────────────
  const { data: player, error: pErr } = await admin
    .from("players")
    .select("id, display_name, email, user_id")
    .eq("id", playerId)
    .maybeSingle();
  if (pErr) return json({ error: "Player lookup failed", details: pErr.message }, 500);
  if (!player) return json({ error: "Player not found" }, 404);
  const playerRow = player as PlayerRow;

  // ── Pre-flight checks ────────────────────────────────────────────────────
  if (playerRow.user_id) {
    return json({
      error: "Player is already linked to an auth user",
      user_id: playerRow.user_id,
    }, 409);
  }
  const email = playerRow.email?.trim().toLowerCase() ?? "";
  if (!email) {
    return json({ error: "Player has no email — add one before inviting" }, 400);
  }
  if (!EMAIL_RE.test(email)) {
    return json({ error: `Player email '${playerRow.email}' is invalid` }, 400);
  }

  // ── Find existing auth user, else inviteUserByEmail ──────────────────────
  let existingAuth: ExistingAuthUser | null = null;
  try {
    existingAuth = await findExistingAuthUser(admin, email);
  } catch (err) {
    return json({
      error: "Auth user lookup failed",
      details: err instanceof Error ? err.message : String(err),
    }, 500);
  }

  let invite_sent = false;
  let already_had_auth = false;
  let blocked_unconfirmed = false;
  let send_throttled = false;
  let warning: string | null = null;

  if (existingAuth && existingAuth.emailConfirmed) {
    // A CONFIRMED account already owns this address, which proves the person
    // controls the inbox. Link directly rather than re-emailing someone who can
    // already sign in. Matches the prior magic-link flow's behavior.
    already_had_auth = true;
    const { error: linkErr } = await admin
      .from("players")
      .update({ user_id: existingAuth.id, updated_at: new Date().toISOString() })
      .eq("id", playerId)
      .is("user_id", null); // race-safe: only link if still unlinked
    if (linkErr) {
      return json({
        error: "Failed to link existing auth user",
        details: linkErr.message,
      }, 500);
    }
  } else if (existingAuth) {
    // An UNCONFIRMED account already owns this address. DO NOT LINK.
    //
    // This is the second of the three link sites migration 056 had to close.
    // Gating only the database trigger would have left this branch as a fully
    // equivalent hole, reachable by a super admin clicking Send Invite: it
    // linked on the mere existence of an auth row, with no confirmation check,
    // exactly like the old AFTER INSERT trigger.
    //
    // Instead, mail a fresh sign-in code and leave the player row pending. The
    // code goes to the address on the players row -- the REAL person's inbox,
    // never the squatter's -- so this self-heals: they enter the code, GoTrue
    // confirms the account, and link_player_on_email_confirm (056) links the
    // row at that moment. An admin needs no SQL to recover a squatted address.
    already_had_auth = true;
    blocked_unconfirmed = true;
    const { error: otpErr } = await admin.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: undefined },
    });
    if (otpErr && isEmailSendThrottled(otpErr)) {
      // A code went out moments ago. The gate still did its job — the row is
      // pending and unlinked — so this is a 200 with a "wait" note, not a 500.
      send_throttled = true;
    } else if (otpErr) {
      return json({
        error: "An unconfirmed account already exists for this address, and re-sending the sign-in code failed",
        details: otpErr.message,
      }, 500);
    } else {
      invite_sent = true;
    }
  } else {
    // Single atomic call: inviteUserByEmail creates the auth.users row AND
    // sends the "Invite user" welcome email — which since 2026-08-10 carries
    // the 6-digit code itself plus standing instructions for requesting a
    // fresh one. The row is created UNCONFIRMED, so under migration 056 NO
    // link happens here; link_player_on_email_confirm fires later, when the
    // invitee redeems that code.
    //
    // No createUser — GoTrue rejects inviteUserByEmail for an already-existing
    // user (422), and both existing-auth branches above already handled the
    // "row exists" case (confirmed → link, unconfirmed → re-send code, no link).
    // display_name is passed as user metadata for parity with the old
    // createUser; redirectTo is intentionally omitted so nothing can
    // re-introduce a confirmation URL into the email body.
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { display_name: playerRow.display_name },
    });
    if (inviteErr) {
      // Atomic failure: GoTrue did not create the row (or it pre-existed and
      // slipped past the precheck via a race). No partial state to clean up
      // — nothing was emailed; surface the error.
      return json({
        error: "inviteUserByEmail failed",
        details: inviteErr.message,
      }, 500);
    }
    invite_sent = true;
  }

  // ── Confirm the outcome ──────────────────────────────────────────────────
  // REWORKED for migration 056. The old assertion was
  //     if (invite_sent && !linked) warn
  // which was right when linking happened at auth.users INSERT: an invite that
  // did not immediately link meant something was wrong. Under confirm-time
  // linking a fresh invite NEVER links -- the player stays pending until they
  // enter their code -- so that check would now fire a scary warning on every
  // single successful invite and train the admin to ignore warnings.
  //
  // The invariant actually worth asserting is that an auth user now exists for
  // this address. So re-read BOTH sides: the players row (for the response) and
  // GoTrue (to prove the invite did something).
  const { data: post, error: postErr } = await admin
    .from("players")
    .select("id, display_name, email, user_id")
    .eq("id", playerId)
    .maybeSingle();
  if (postErr) {
    return json({ error: "Post-invite re-read failed", details: postErr.message }, 500);
  }
  const linked = !!(post && (post as PlayerRow).user_id);

  let authNow: ExistingAuthUser | null = null;
  try {
    authNow = await findExistingAuthUser(admin, email);
  } catch {
    // Best effort -- a lookup failure here must not turn a successful invite
    // into a 500. It only costs us the assertion below.
    authNow = null;
  }

  if (!authNow) {
    warning =
      "Reported success, but no auth user exists for this address afterwards. " +
      "Nothing was created — retry, and check the Edge Function logs.";
  } else if (already_had_auth && !blocked_unconfirmed && !linked) {
    // A CONFIRMED account exists and we ran the explicit UPDATE, so the row
    // should be linked. If it isn't, the `.is("user_id", null)` guard matched
    // nothing — usually an email casing/whitespace mismatch.
    warning =
      "A confirmed account already exists for this address, but the player row " +
      "did not link. Verify players.email matches the auth email exactly.";
  } else if (blocked_unconfirmed && send_throttled) {
    warning =
      "An unconfirmed account already existed for this address, so the player " +
      "was deliberately NOT linked to it. A sign-in code was already sent moments " +
      "ago — wait a minute before requesting another. The row links automatically " +
      "once they enter it.";
  } else if (blocked_unconfirmed) {
    warning =
      "An unconfirmed account already existed for this address, so the player " +
      "was deliberately NOT linked to it. A fresh sign-in code has been emailed; " +
      "the row links automatically once they enter it.";
  }

  return json({
    ok: true,
    invite_sent,
    already_had_auth,
    blocked_unconfirmed,
    send_throttled,
    // invited = "an invitation exists for this address", which under 056 is the
    // state the admin UI keys its pill on. Distinct from `linked`.
    invited: invite_sent || already_had_auth,
    linked,
    player: post ?? playerRow,
    ...(warning ? { warning } : {}),
  }, 200);
});
