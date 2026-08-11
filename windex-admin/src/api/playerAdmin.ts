import { apiFetch, ApiError, getAuthToken, writeHeaders } from './client';

const SUPABASE_URL = (
  typeof import.meta.env !== 'undefined' && import.meta.env.VITE_LATE_ADD_API_URL
    ? import.meta.env.VITE_LATE_ADD_API_URL
    : 'https://ftmqzxykwcccocogkjhc.supabase.co/functions/v1'
).replace(/\/functions\/v1\/?$/, '');

const ANON_KEY =
  typeof import.meta.env !== 'undefined' && import.meta.env.VITE_SUPABASE_ANON_KEY
    ? import.meta.env.VITE_SUPABASE_ANON_KEY
    : null;

function headers(extra?: Record<string, string>): Record<string, string> {
  const token = getAuthToken() ?? ANON_KEY;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(ANON_KEY ? { apikey: ANON_KEY } : {}),
    ...extra,
  };
}

export interface PlayerDetail {
  id: string;
  display_name: string;
  full_name: string | null;
  email: string | null;
  venmo_handle: string | null;
  photo_url: string | null;
  is_active: number;
  /**
   * Non-null = player retired/resigned at this time (migration 029).
   * Single-axis retirement: is_active stays 1 so history/standings keep
   * showing them; only operational lists filter on retired_at.
   */
  retired_at: string | null;
  /**
   * auth.users.id link. NULL = player exists but has no auth account yet
   * (i.e., eligible for an OTP invite via the send-invite Edge Function).
   */
  user_id: string | null;
  /**
   * Global spectator ("Heckler", migration 055). Views everything and posts in
   * chat, but holds ZERO group_members rows and never competes.
   *
   * boolean, NOT the smallint used by is_active / is_super_admin — those are
   * Glide-import legacy and are not being propagated. Never write 1/0 here.
   *
   * Writable only by a super admin: enforce_players_privileged_columns() pins
   * it and raises 42501 for anyone else, in BOTH directions.
   */
  is_heckler: boolean;
}

/** Every column PlayerDetail needs. One constant so a new field can't be added
 *  to the interface but forgotten in one of the two queries that build it. */
const PLAYER_SELECT =
  'id,display_name,full_name,email,venmo_handle,photo_url,is_active,retired_at,user_id,is_heckler';

/**
 * Sentinel group id for the "Unaffiliated / Hecklers" pseudo-option in the
 * Players page group dropdown. Not a real group — `listPlayersWithMembership`
 * branches on it and queries players directly. Prefixed with `__` so it can
 * never collide with a real 20-char group id.
 */
export const UNAFFILIATED_GROUP_ID = '__unaffiliated__';

export interface GroupMembership {
  id: string;
  group_id: string;
  player_id: string;
  role: string;
  is_active: number;
}

export interface PlayerWithMembership extends PlayerDetail {
  /**
   * NULL for rows returned under the UNAFFILIATED_GROUP_ID pseudo-option —
   * those players have no group_members row by definition (hecklers always,
   * and any player who simply isn't in a group yet).
   *
   * Deliberately `| null` rather than optional-and-ignored: it makes the
   * compiler flag every `.membership.<x>` dereference, which is how the
   * unconditional updateMembership() call in Players.tsx was caught instead of
   * throwing at runtime for a heckler.
   */
  membership: GroupMembership | null;
}

/**
 * List every player in the table — used by the Create Group admin picker.
 * RLS (`players_select` in migration 015) is `USING (true)` for authenticated
 * users, so any signed-in admin can read this. Sorted by display_name.
 * Retired players (migration 029) are excluded — they can't be added to a
 * group until unretired from the Players page.
 */
export async function listAllPlayers(): Promise<PlayerDetail[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/players?retired_at=is.null&select=${PLAYER_SELECT}&order=display_name.asc`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`Failed to fetch players: ${res.status}`);
  return res.json();
}

/**
 * Members of a group joined to their player record. `opts.retired` selects
 * which retirement bucket (migration 029): default/false = operational view
 * (retired_at IS NULL); true = the Retired tab (retired_at IS NOT NULL).
 * The retirement filter is applied on the players query, so a member whose
 * player is in the other bucket is naturally dropped from the result.
 */
export async function listPlayersWithMembership(
  groupId: string,
  opts?: { retired?: boolean }
): Promise<PlayerWithMembership[]> {
  const retiredFilter = opts?.retired ? '&retired_at=not.is.null' : '&retired_at=is.null';

  // ── "Unaffiliated / Hecklers" pseudo-option ──────────────────────────────
  // Players with ZERO group_members rows. The membership-first path below
  // returns [] at the `members.length === 0` guard before it ever queries
  // players, so these rows are unreachable through it — hence a separate
  // branch rather than a tweak to the existing one, which stays untouched for
  // real groups.
  //
  // PostgREST cannot express "no rows in a child table" directly, so this is
  // two round trips: every membership's player_id, then every player NOT in
  // that set. `not.in.()` with an empty list is a syntax error, so the empty
  // case is handled by dropping the filter entirely.
  if (groupId === UNAFFILIATED_GROUP_ID) {
    const gmRes = await fetch(
      `${SUPABASE_URL}/rest/v1/group_members?select=player_id`,
      { headers: headers() }
    );
    if (!gmRes.ok) throw new Error(`Failed to fetch memberships: ${gmRes.status}`);
    const gmRows: { player_id: string }[] = await gmRes.json();
    const memberIds = Array.from(new Set(gmRows.map((r) => r.player_id)));

    const notIn = memberIds.length > 0
      ? `&id=not.in.(${memberIds.map((id) => `"${id}"`).join(',')})`
      : '';
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/players?select=${PLAYER_SELECT}${retiredFilter}${notIn}&order=display_name.asc`,
      { headers: headers() }
    );
    if (!res.ok) throw new Error(`Failed to fetch players: ${res.status}`);
    const rows: PlayerDetail[] = await res.json();
    return rows.map((p) => ({ ...p, membership: null }));
  }

  // ── Real group: membership-first, unchanged ──────────────────────────────
  // Fetch group_members for this group
  const membersRes = await fetch(
    `${SUPABASE_URL}/rest/v1/group_members?group_id=eq.${encodeURIComponent(groupId)}&select=id,group_id,player_id,role,is_active`,
    { headers: headers() }
  );
  if (!membersRes.ok) throw new Error(`Failed to fetch members: ${membersRes.status}`);
  const members: GroupMembership[] = await membersRes.json();

  if (members.length === 0) return [];

  // Fetch player details for all member player_ids
  const playerIds = members.map((m) => m.player_id);
  const inList = playerIds.map((id) => `"${id}"`).join(',');
  const playersRes = await fetch(
    `${SUPABASE_URL}/rest/v1/players?id=in.(${inList})${retiredFilter}&select=${PLAYER_SELECT}`,
    { headers: headers() }
  );
  if (!playersRes.ok) throw new Error(`Failed to fetch players: ${playersRes.status}`);
  const players: PlayerDetail[] = await playersRes.json();

  const playerMap = new Map(players.map((p) => [p.id, p]));

  return members
    .map((m): PlayerWithMembership | null => {
      const p = playerMap.get(m.player_id);
      if (!p) return null;
      return { ...p, membership: m };
    })
    .filter((x): x is PlayerWithMembership => x !== null)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

/**
 * PATCH a players row by id. Permissions are enforced by RLS
 * (`players_update` in migration 015): super admin can update any row,
 * the owning auth user can update their own. The previous client-side
 * `user_id=eq.<currentUserId>` filter was redundant defense that became
 * harmful after migration 020 made `user_id` nullable — pending players
 * with `user_id IS NULL` would silently fail to update.
 */
export async function updatePlayer(
  playerId: string,
  updates: Partial<Pick<PlayerDetail,
    'display_name' | 'full_name' | 'email' | 'venmo_handle' | 'is_active' | 'retired_at' | 'is_heckler'>>
): Promise<void> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/players?id=eq.${encodeURIComponent(playerId)}`,
    {
      method: 'PATCH',
      // return=representation (not minimal) so we can detect a 0-row update.
      // writeHeaders requires a live session — no silent anon fallback.
      headers: writeHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update player: ${res.status} ${text}`);
  }
  // A PATCH that matches 0 rows (RLS-filtered or id not found) returns 200 with
  // an empty array. Surface it instead of reporting a false "Saved". This guard
  // is the load-bearing one — keep it.
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Nothing was saved — the player was not found or you do not have permission to edit it.');
  }

  // DELIBERATELY NOT DONE: a per-field read-back assertion comparing `updates`
  // against rows[0]. It was added when is_heckler landed, on the theory that a
  // key missing from this function's type union would be dropped silently and
  // still return 200. Tested against live and removed, because:
  //
  //   1. PostgREST does NOT silently drop unknown columns — it rejects the whole
  //      request with 400 PGRST204 ("Could not find the 'x' column of 'players'
  //      in the schema cache"), which the !res.ok branch above already surfaces.
  //      The hazard it guarded against cannot occur.
  //   2. It broke a real call site. handleConfirmRetire sends
  //      new Date().toISOString() ("...435Z"); PostgREST re-serializes timestamptz
  //      as "...435+00:00". Strict comparison never matches, so every retire threw
  //      "did not take: retired_at" on a write that had actually succeeded — and
  //      the modal stayed open showing failure, inviting a duplicate retry.
  //   3. Its only remaining value would be catching silent coercion, which this
  //      schema deliberately never does: the migration 054/055 trigger RAISEs
  //      EXCEPTION on a disallowed column write rather than coercing it back.
  //
  // The type union on `updates` is what actually prevents the is_heckler class of
  // bug — a forgotten key is a compile error, not a runtime surprise.
}

export async function updateMembership(
  membershipId: string,
  updates: Partial<Pick<GroupMembership, 'role' | 'is_active'>>
): Promise<void> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/group_members?id=eq.${encodeURIComponent(membershipId)}`,
    {
      method: 'PATCH',
      headers: writeHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify(updates),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update membership: ${res.status} ${text}`);
  }
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Nothing was saved — the membership was not found or you do not have permission to edit it.');
  }
}

// =============================================================================
// admin-update-user-email Edge Function
// =============================================================================

export interface AdminUpdateUserEmailResponse {
  ok: true;
  user_id: string;
  email: string;
  /** Number of players rows whose email mirror was synced (a user can have several). */
  players_synced: number;
}

/**
 * POST /admin-update-user-email — super-admin only (gated server-side via the
 * am_i_super_admin() RPC). Changes the TARGET player's auth login identity
 * (auth.users.email, email_confirm:true so it's immediate) and syncs
 * players.email across every row for that auth user. Use this — NOT a plain
 * players.email PATCH — whenever a LINKED player's email changes, because the
 * email is their OTP login identity.
 *
 * Surfaces the function's real errors. The shared apiFetch rewrites any 404
 * into a generic "endpoint not implemented" message, so we recover the
 * function's true error (e.g. "Player not found") from the parsed body.
 */
export async function adminUpdateUserEmail(
  playerId: string,
  email: string
): Promise<AdminUpdateUserEmailResponse> {
  try {
    return await apiFetch<AdminUpdateUserEmailResponse>('/admin-update-user-email', {
      method: 'POST',
      body: JSON.stringify({ player_id: playerId, email }),
    });
  } catch (e) {
    if (e instanceof ApiError) {
      const real = (e.body as { error?: string } | undefined)?.error;
      if (real) throw new ApiError(e.status, real, e.body, e.path);
    }
    throw e;
  }
}

// =============================================================================
// invite-player Edge Function
// =============================================================================

export interface GroupAssignment {
  group_id: string;
  role: 'admin' | 'member';
}

export interface InvitePlayerInput {
  display_name: string;
  email: string;
  send_invite: boolean;
  /** REQUIRED, may be empty. invite-player validates Array.isArray() before
   *  anything else — omitting the key is a 400, not a default. */
  group_assignments: GroupAssignment[];
  /** Global spectator (migration 055). Requires group_assignments: []. */
  is_heckler?: boolean;
}

export interface InvitePlayerResponse {
  player: {
    id: string;
    display_name: string;
    email: string | null;
    user_id: string | null;
    is_active: number;
    is_heckler: boolean;
  };
  groups_assigned: number;
  invite_sent: boolean;
  already_had_auth: boolean;
  /**
   * True when an UNCONFIRMED auth account already owned this address, so the
   * new player was DELIBERATELY not linked to it (migration 056). A code is
   * emailed instead; the row links when they confirm. The intended outcome.
   */
  blocked_unconfirmed: boolean;
  /** True when the code could not be re-sent because GoTrue's 60s per-address throttle was open. Not an error. */
  send_throttled: boolean;
  /** An invitation now exists for this address. This — never `linked` — is the invited state. */
  invited: boolean;
  /** True only once a CONFIRMED human owns the row. A fresh invite leaves this false, correctly. */
  linked: boolean;
  /**
   * Server-composed note when the outcome needs explaining. MUST be surfaced:
   * on 2026-08-11 a correct deliberate-non-link reported as a plain "Invite
   * sent" because this field existed on the response and the UI ignored it.
   */
  warning?: string;
}

export class DuplicatePlayerEmailError extends Error {
  constructor(public existingPlayerId: string) {
    super('Player with this email already exists');
    this.name = 'DuplicatePlayerEmailError';
  }
}

/**
 * Calls POST /invite-player. Translates the 409 duplicate-email response
 * into a typed DuplicatePlayerEmailError so the UI can offer "view existing
 * player" without parsing strings.
 */
export async function invitePlayer(input: InvitePlayerInput): Promise<InvitePlayerResponse> {
  try {
    return await apiFetch<InvitePlayerResponse>('/invite-player', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      const body = e.body as { existing_player_id?: string } | undefined;
      if (body?.existing_player_id) throw new DuplicatePlayerEmailError(body.existing_player_id);
    }
    throw e;
  }
}

// =============================================================================
// send-invite Edge Function
// =============================================================================

export interface SendInviteResponse {
  ok: true;
  /** True if an invite email was sent. False when the auth user already existed and we just linked. */
  invite_sent: boolean;
  /** True if the email already had an auth.users row before this call. */
  already_had_auth: boolean;
  /**
   * True when an UNCONFIRMED auth account already owned this address, so the
   * player was DELIBERATELY not linked to it (migration 056). A code is emailed
   * instead; the row links when they confirm. Not an error — the intended
   * outcome, and the squat defence.
   */
  blocked_unconfirmed: boolean;
  /**
   * True when the code could not be re-sent because GoTrue's per-address
   * throttle (60s) was still open. Also not an error: the gate ran, the row is
   * correctly pending, and a code from moments ago is already in the inbox.
   */
  send_throttled: boolean;
  /** An invitation now exists for this address. This — never `linked` — is the invited state. */
  invited: boolean;
  /**
   * True if players.user_id is populated after the call, i.e. a CONFIRMED
   * human owns the row. Since migration 056 a fresh invite leaves this FALSE
   * and that is correct: linking happens on email confirmation, not on invite.
   * Do not read it as "did the invite work".
   */
  linked: boolean;
  /** Precise server-composed note when the outcome needs explaining. Prefer it over reconstructing a message client-side. */
  warning?: string;
  player: {
    id: string;
    display_name: string;
    email: string | null;
    user_id: string | null;
  };
}

export class PlayerAlreadyLinkedError extends Error {
  constructor(public userId: string) {
    super('Player is already linked to an auth user');
    this.name = 'PlayerAlreadyLinkedError';
  }
}

/**
 * POST /send-invite — sends an OTP invite for an existing player that has no
 * auth.users row. Super-admin gated server-side. Translates the 409
 * already-linked response into a typed error so the UI can prompt for a refresh.
 */
export async function sendInvite(playerId: string): Promise<SendInviteResponse> {
  try {
    return await apiFetch<SendInviteResponse>('/send-invite', {
      method: 'POST',
      body: JSON.stringify({ player_id: playerId }),
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      const body = e.body as { user_id?: string } | undefined;
      if (body?.user_id) throw new PlayerAlreadyLinkedError(body.user_id);
    }
    throw e;
  }
}

// =============================================================================
// Player auth status (migration 027)
// =============================================================================

/**
 * Per-player onboarding state row returned by the `get_players_auth_status()`
 * RPC. The RPC joins `players` to `auth.users` server-side (super-admin
 * gated) so the UI can decide which affordance to render per row without
 * needing direct access to the auth schema.
 */
export interface PlayerAuthStatus {
  player_id: string;
  has_signed_in: boolean;
  /**
   * An invitation exists for this player (migration 056). Derived SERVER-SIDE
   * as `invited_at IS NOT NULL OR confirmation_sent_at IS NOT NULL` — do not
   * reconstruct it from `invited_at` out here, because the dominant invite
   * path (invite-player's createUser + signInWithOtp) never sets invited_at
   * and only ever sets confirmation_sent_at.
   *
   * This, never players.user_id, is what "invited" means. user_id means LINKED
   * — a confirmed human owns the row — and is NULL for every pending invitee.
   */
  has_been_invited: boolean;
  invited_at: string | null;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
}

/**
 * Calls the `get_players_auth_status()` RPC from migration 027. Returns a
 * Map keyed by player_id for O(1) lookup from the row-render path. Returns
 * an empty Map if the caller isn't a super admin (the RPC gates internally).
 */
export async function getPlayersAuthStatus(): Promise<Map<string, PlayerAuthStatus>> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/get_players_auth_status`,
    {
      method: 'POST',
      headers: headers(),
      body: '{}',
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`get_players_auth_status failed (${res.status}): ${text}`);
  }
  const rows: PlayerAuthStatus[] = await res.json();
  return new Map(rows.map((r) => [r.player_id, r]));
}
