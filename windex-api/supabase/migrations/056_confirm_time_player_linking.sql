-- Confirm-time player linking. Closes the pending-player squat.
--
-- THE HOLE
-- --------
-- link_player_on_auth_signup() (migration 020) fires AFTER INSERT ON auth.users
-- and links a pending players row on a case-insensitive email match with NO
-- confirmation check. disable_signup is false and the anon key ships in the
-- client bundle, so anyone can POST /auth/v1/signup with a league member's
-- email address, create an unconfirmed auth user, and have the trigger re-point
-- that member's pending players row at the stranger's auth id.
--
-- The stranger gains NOTHING readable: they never control the victim's inbox,
-- so they never confirm, never hold a session, and every RLS policy keyed on
-- user_id = auth.uid() still refuses them. The damage is denial of onboarding
-- plus admin misreporting:
--   * send-invite returns 409 "already linked to an auth user"
--   * windex-admin hides the Send Invite button entirely (it renders only when
--     user_id IS NULL), so the row reads as a normal "Invited" and offers no
--     affordance — invisible by omission
-- Demonstrated live 2026-08-09, and reproduced incidentally on 2026-08-10 when
-- a test invite linked an unconfirmed user inside GoTrue's INSERT transaction.
--
-- THE FIX
-- -------
-- Link on CONFIRMATION instead of on INSERT. The through-line this migration
-- establishes, and which every consumer is re-keyed onto:
--
--     invited_at  means INVITED        (an email went out)
--     user_id     means LINKED         (a confirmed human owns this row)
--
-- Nothing conflates them again. Until this migration, user_id was doing both
-- jobs, and that overload IS the vulnerability.
--
-- TWO TRIGGERS, ONE FUNCTION
-- --------------------------
-- Dropping the INSERT trigger outright would be wrong: a user born confirmed
-- (createUser({email_confirm:true}), or updateUserById({email_confirm:true}) on
-- a fresh row) never produces a NULL -> timestamp UPDATE and would never link.
-- So:
--   * AFTER INSERT WHEN (NEW.email_confirmed_at IS NOT NULL)   -- born confirmed
--   * AFTER UPDATE WHEN (OLD.email_confirmed_at IS NULL
--                        AND NEW.email_confirmed_at IS NOT NULL) -- confirmed later
--
-- Both key on email_confirmed_at and NEVER on confirmed_at, which is
-- GENERATED ALWAYS AS LEAST(email_confirmed_at, phone_confirmed_at) and cannot
-- carry a meaningful trigger predicate.
--
-- Precedent that auth-schema UPDATE triggers are permitted here: migration 022
-- already runs log_auth_session_update AFTER UPDATE ON auth.sessions with a
-- WHEN clause, live and enabled, on a table also owned by supabase_auth_admin.
--
-- WARN, NEVER RAISE -- a deliberate exception to hard-fail-over-soft-fail
-- ---------------------------------------------------------------------
-- This function runs inside GoTrue's own transaction on the sign-in critical
-- path. A RAISE EXCEPTION here would not "fail safe" -- it would abort the
-- confirmation and lock the user out of the product entirely. A missed link is
-- recoverable by an admin in seconds; a hard-failed confirmation is an outage
-- for that person. So the in-body guard warns and returns. The WHEN clauses are
-- the real enforcement; the guard only catches a future mis-wiring.
--
-- THIS MIGRATION PERFORMS ZERO DML
-- --------------------------------
-- Nothing is backfilled and nothing is unwound.
--   * The 5 players currently linked to unconfirmed auth users (Neal, Rosie,
--     Adam, JYe, buzzhecklertest) are legitimate unaccepted invites, NOT squats
--     -- every one carries Edge-Function-written display_name metadata. They
--     stay linked. The remedy for a stale invite is re-inviting it.
--   * There is nothing to link forward: 0 of the 54 pending players have a
--     matching UNCONFIRMED auth user. That is asserted as a precondition below
--     rather than expressed as a no-op backfill, so that if it is ever NOT true
--     at deploy time the migration stops and a human looks.
--
-- THE PRECONDITION IS SCOPED TO UNCONFIRMED ON PURPOSE -- DO NOT NARROW IT BACK
-- ----------------------------------------------------------------------------
-- The obvious form of that check -- "no pending player may have a matching auth
-- user at all" -- is correct only under the PRE-056 regime, where linking
-- happened at INSERT and so a pending row with a matching auth user was
-- anomalous. Under POST-056 semantics that shape is the ordinary steady state:
-- every invited-but-unconfirmed player is, by design, a pending players row
-- alongside an unconfirmed auth user.
--
-- The unqualified check would therefore abort on data this very migration makes
-- normal -- which would bite on any replay against a fresh database, where 056
-- runs after later migrations have produced exactly that shape. Scoping to
-- `u.email_confirmed_at IS NULL` keeps the predicate meaningful under both
-- regimes: an UNCONFIRMED auth user matching a pending row is the squat
-- signature, while a CONFIRMED one is merely a link that has not fired yet.
--
-- ROLLBACK
-- --------
-- Restore migration 020's pair verbatim:
--
--   DROP TRIGGER IF EXISTS link_player_on_email_confirm_ins ON auth.users;
--   DROP TRIGGER IF EXISTS link_player_on_email_confirm_upd ON auth.users;
--   DROP FUNCTION IF EXISTS public.link_player_on_email_confirm();
--
--   CREATE OR REPLACE FUNCTION link_player_on_auth_signup()
--   RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
--   SET search_path = public, pg_temp
--   AS $rollback$
--   DECLARE
--     match_count INT;
--     target_id   TEXT;
--   BEGIN
--     IF NEW.email IS NULL THEN RETURN NEW; END IF;
--     SELECT count(*) INTO match_count FROM public.players
--      WHERE lower(email) = lower(NEW.email) AND user_id IS NULL;
--     IF match_count = 0 THEN RETURN NEW; END IF;
--     IF match_count > 1 THEN
--       RAISE NOTICE 'link_player_on_auth_signup: % unlinked players rows match email %; linking the oldest by created_at', match_count, NEW.email;
--     END IF;
--     SELECT id INTO target_id FROM public.players
--      WHERE lower(email) = lower(NEW.email) AND user_id IS NULL
--      ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1;
--     UPDATE public.players SET user_id = NEW.id, updated_at = now()
--      WHERE id = target_id;
--     RETURN NEW;
--   END;
--   $rollback$;
--
--   DROP TRIGGER IF EXISTS link_player_on_auth_signup ON auth.users;
--   CREATE TRIGGER link_player_on_auth_signup
--     AFTER INSERT ON auth.users FOR EACH ROW
--     EXECUTE FUNCTION link_player_on_auth_signup();
--
-- (get_players_auth_status would also need reverting to its migration 028 form.)
--
-- Migration 056. The is_heckler -> is_gallery rename slides to 057/058.

-- =============================================================================
-- 0. Precondition: no pending player is already squatted
-- =============================================================================
-- Scoped to UNCONFIRMED deliberately -- see the header. A CONFIRMED auth user
-- matching a pending row is normal post-056 (a link that has not fired yet); an
-- UNCONFIRMED one is the squat signature. Do not drop the email_confirmed_at
-- predicate: without it this aborts on data 056 itself makes normal, and any
-- replay against a fresh database fails here.

DO $$
DECLARE
  stragglers INT;
  detail     TEXT;
BEGIN
  SELECT count(*), string_agg(p.id || ' (' || p.email || ')', ', ')
    INTO stragglers, detail
    FROM public.players p
    JOIN auth.users u ON lower(u.email) = lower(p.email)
   WHERE p.user_id IS NULL
     AND p.email IS NOT NULL
     AND u.email_confirmed_at IS NULL;

  IF stragglers > 0 THEN
    RAISE EXCEPTION
      'ABORT: % pending players match an UNCONFIRMED auth user (%). That is the squat signature. Investigate before deploying -- confirm-time linking prevents new squats but does not unwind existing ones.',
      stragglers, detail
      USING ERRCODE = 'raise_exception';
  END IF;

  RAISE NOTICE 'precondition OK: 0 pending players match an unconfirmed auth user';
END $$;

-- =============================================================================
-- 1. Confirm-time link function
-- =============================================================================

CREATE OR REPLACE FUNCTION public.link_player_on_email_confirm()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  match_count INT;
  target_id   TEXT;
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  -- Belt and braces. The WHEN clauses already guarantee confirmation; if this
  -- ever trips, the triggers have been re-wired wrongly. WARN, never RAISE --
  -- see the header: this runs on the auth critical path and must not be able
  -- to block a sign-in.
  IF NEW.email_confirmed_at IS NULL THEN
    RAISE WARNING
      'link_player_on_email_confirm fired for unconfirmed user % -- check trigger wiring; no link performed',
      NEW.id;
    RETURN NEW;
  END IF;

  SELECT count(*) INTO match_count
    FROM public.players
   WHERE lower(email) = lower(NEW.email)
     AND user_id IS NULL;

  IF match_count = 0 THEN
    -- No pending invite for this address. Normal for dev accounts and for
    -- anyone who confirms without a players row waiting.
    RETURN NEW;
  END IF;

  IF match_count > 1 THEN
    RAISE NOTICE
      'link_player_on_email_confirm: % unlinked players rows match email %; linking the oldest by created_at',
      match_count, NEW.email;
  END IF;

  SELECT id INTO target_id
    FROM public.players
   WHERE lower(email) = lower(NEW.email)
     AND user_id IS NULL
   ORDER BY created_at ASC NULLS LAST, id ASC
   LIMIT 1;

  UPDATE public.players
     SET user_id    = NEW.id,
         updated_at = now()
   WHERE id = target_id;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.link_player_on_email_confirm() IS
  'Links a pending players row to an auth user by email match, ONLY once that '
  'user has confirmed their email. Replaces link_player_on_auth_signup() '
  '(migration 020), which linked at INSERT and allowed an unconfirmed stranger '
  'to squat a pending row. Fired by two triggers on auth.users: AFTER INSERT '
  'for users born confirmed, AFTER UPDATE on the NULL -> timestamp transition '
  'of email_confirmed_at. Warns rather than raises: it runs inside GoTrue''s '
  'transaction and must never block a sign-in.';

-- =============================================================================
-- 2. Swap the triggers
-- =============================================================================

DROP TRIGGER IF EXISTS link_player_on_auth_signup ON auth.users;
DROP FUNCTION IF EXISTS public.link_player_on_auth_signup();

DROP TRIGGER IF EXISTS link_player_on_email_confirm_ins ON auth.users;
CREATE TRIGGER link_player_on_email_confirm_ins
  AFTER INSERT ON auth.users
  FOR EACH ROW
  WHEN (NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.link_player_on_email_confirm();

DROP TRIGGER IF EXISTS link_player_on_email_confirm_upd ON auth.users;
CREATE TRIGGER link_player_on_email_confirm_upd
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.link_player_on_email_confirm();

-- =============================================================================
-- 3. get_players_auth_status() -- re-key the admin UI onto invited-ness
-- =============================================================================
--
-- Three changes, all forced by the new through-line:
--
--   (i)   LATERAL email-fallback join. The old join was
--             LEFT JOIN auth.users u ON u.id = p.user_id
--         which goes blind exactly where we now need it: a pending invitee has
--         user_id IS NULL, so u.* was all NULL and the admin UI could not tell
--         "invited, awaiting sign-in" from "never invited". LATERAL + LIMIT 1
--         so a duplicate-email edge case cannot fan rows out.
--
--   (ii)  has_been_invited, DERIVED. Raw invited_at is NOT sufficient: it is
--         set only by inviteUserByEmail (send-invite). The dominant path,
--         invite-player's createUser + signInWithOtp, leaves invited_at NULL
--         and sets only confirmation_sent_at. Keying the pill on raw invited_at
--         would report "not invited" for most genuinely invited players.
--
--   (iii) has_signed_in also matches on user_id. log_auth_session_event()
--         (migration 022) stamps login_events.player_id at session-INSERT time
--         via `players WHERE user_id = v_user_id`. Under confirm-time linking,
--         if GoTrue INSERTs the session before the confirmation UPDATE lands,
--         that first row keeps player_id NULL FOREVER, and a has_signed_in that
--         only matched ae.player_id would stay false for someone who has
--         demonstrably signed in. Matching ae.user_id too removes the ordering
--         dependency entirely.
--
-- Return type gains a column, so this is DROP + CREATE, not CREATE OR REPLACE.

DROP FUNCTION IF EXISTS public.get_players_auth_status();

CREATE FUNCTION public.get_players_auth_status()
RETURNS TABLE(
  player_id           TEXT,
  has_signed_in       BOOLEAN,
  has_been_invited    BOOLEAN,
  invited_at          TIMESTAMPTZ,
  email_confirmed_at  TIMESTAMPTZ,
  last_sign_in_at     TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.am_i_super_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      p.id,
      (
        (u.email_confirmed_at IS NOT NULL OR u.last_sign_in_at IS NOT NULL)
        AND EXISTS (
          SELECT 1
          FROM public.activity_events ae
          WHERE ae.player_id = p.id
             OR (u.id IS NOT NULL AND ae.user_id = u.id)
        )
      ),
      (u.invited_at IS NOT NULL OR u.confirmation_sent_at IS NOT NULL),
      u.invited_at,
      u.email_confirmed_at,
      u.last_sign_in_at
    FROM public.players p
    LEFT JOIN LATERAL (
      SELECT au.*
        FROM auth.users au
       WHERE au.id = p.user_id
          OR (p.user_id IS NULL
              AND p.email IS NOT NULL
              AND lower(au.email) = lower(p.email))
       ORDER BY (au.id = p.user_id) DESC NULLS LAST, au.created_at ASC
       LIMIT 1
    ) u ON true;
END;
$$;

COMMENT ON FUNCTION public.get_players_auth_status() IS
  'Returns onboarding state per player for the admin UI. Super-admin only; '
  'non-admins get zero rows. Joins players -> auth.users by user_id, falling '
  'back to a case-insensitive email match when user_id IS NULL so that pending '
  'invitees (unlinked until they confirm, migration 056) are still visible as '
  'invited. has_been_invited is derived from invited_at OR confirmation_sent_at '
  'because the createUser + signInWithOtp path never sets invited_at. '
  'has_signed_in requires an auth signal AND a corroborating activity_events '
  'row matched on EITHER player_id OR user_id (migration 028 + 056).';

GRANT EXECUTE ON FUNCTION public.get_players_auth_status() TO authenticated;

-- =============================================================================
-- 4. Document the deliberate non-uniqueness of players.user_id
-- =============================================================================

COMMENT ON COLUMN public.players.user_id IS
  'Auth user that owns this player row. NULL means UNLINKED -- either never '
  'invited, or invited and not yet confirmed (migration 056 links on '
  'confirmation, not on signup). Use get_players_auth_status().has_been_invited '
  'to tell those apart; do NOT read user_id as a proxy for invited state. '
  'DELIBERATELY NOT UNIQUE: one auth user may own several player rows '
  '(dev@lateaddgolf.com owns two, and get_my_player_ids() is plural by design). '
  'Do not add a unique constraint here.';
