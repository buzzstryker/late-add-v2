-- Heckler: a global spectator user type.
--
-- Views everything (standings, rounds, chat, all groups), posts in chat under
-- their own display_name badged as a Heckler, and is NEVER a competitor.
--
-- Items 1 and 2 below MUST ship together. `authenticated` holds a TABLE-level
-- UPDATE grant on public.players, and a table-level grant automatically extends
-- to columns added later -- so the moment is_heckler exists, any signed-in user
-- can write it. The trigger pin in item 2 is the only thing standing between an
-- end user and self-badging; it is not belt-and-braces.


-- ============================================================================
-- 1. The flag.
-- ============================================================================
-- Zero group_members rows, ever. Standings / points / skins / payout exclusion
-- is STRUCTURAL, not predicated: season_standings and every Edge Function that
-- computes competitive output derive FROM group_members, so a row with no
-- membership is excluded automatically. Deliberately NO is_heckler predicate is
-- added to any of them -- do not add one later "for clarity"; it would be a
-- second source of truth that can drift from the first.
--
-- boolean, NOT smallint. The smallint flags on this table (is_active,
-- is_super_admin) are Glide-import legacy and are not being propagated, so
-- public.players carries mixed flag types from here on. Client code must NEVER
-- write is_heckler: 1 -- it is true/false.

ALTER TABLE public.players
  ADD COLUMN is_heckler boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.players.is_heckler IS
  'Global spectator ("Heckler" in UI). Views everything and posts in chat, but '
  'holds ZERO group_members rows and is never a competitor -- standings/points/'
  'payout exclusion is structural via group_members, not predicated on this '
  'column. Settable only by a super admin (enforce_players_privileged_columns).';


-- ============================================================================
-- 2. Pin is_heckler in the privileged-column guard.
-- ============================================================================
-- CREATE OR REPLACE on the function ONLY. The trigger
-- players_privileged_columns_trg is deliberately not dropped/recreated, so
-- there is never a window in which public.players sits unguarded.
--
-- ─── Everything to the next divider is the migration-054 header, preserved. ──
--
-- THE HOLE
-- --------
-- players_update (migration 051) is
--     USING      (am_i_super_admin() OR user_id = auth.uid())
--     WITH CHECK (am_i_super_admin() OR user_id = auth.uid())
-- RLS constrains WHICH ROWS may be written, never WHICH COLUMNS. Role
-- `authenticated` holds a table-wide UPDATE grant on public.players covering
-- every column, is_super_admin included. So any signed-in user could issue
--     PATCH /rest/v1/players?id=eq.<their-own-id>   {"is_super_admin": 1}
-- and self-promote. Their own row passes both USING and WITH CHECK, and no
-- trigger stood in the way. Confirmed against the live database 2026-08-08.
--
-- THE FIX
-- -------
-- A BEFORE UPDATE trigger that hard-fails (RAISE EXCEPTION -- never a silent
-- coercion back to OLD) when a non-super-admin app session tries to change a
-- privileged column. Chosen over column-level REVOKE/GRANT because column
-- grants surface as opaque PostgREST errors and every future column has to be
-- remembered; this is one self-documenting object that fails loudly.
--
-- WHO IS ENFORCED AGAINST
-- -----------------------
-- Only callers arriving through PostgREST with a verified `authenticated` JWT.
-- The discriminator is the per-request GUC `request.jwt.claims`, which is the
-- ONLY signal that survives SECURITY DEFINER:
--   * current_user  is rewritten to the function owner inside a SECURITY
--     DEFINER body, so it reads `postgres` for every caller -- useless here.
--   * session_user  is `authenticator` for all PostgREST traffic, both
--     `authenticated` and `service_role` -- also useless.
--
--   caller                                   role claim        verdict
--   ---------------------------------------  ----------------  --------
--   app user via PostgREST                   'authenticated'   ENFORCE
--   Edge Function service-role client        'service_role'    bypass
--   GoTrue triggers, psql, Management API    (GUC unset)       bypass
--
-- Treating an absent claim as a bypass is sound for this threat model: an end
-- user's only route to this database is PostgREST, which always sets the GUC
-- from the verified JWT before touching a table. No GUC therefore means the
-- write did not originate from an app session. ACCEPTED ON THE RECORD: a
-- service_role caller retains the ability to write these columns, so the
-- service-role key remains a super-admin-equivalent secret. This closes the
-- end-user escalation, not the key-compromise one.
--
-- A malformed request.jwt.claims GUC will fail the ::jsonb cast and abort the
-- statement. That is deliberate -- fail closed, not open.
--
-- WHY user_id IS DELIBERATELY *NOT* PROTECTED HERE
-- ------------------------------------------------
-- Do not "fix" this later by adding user_id to the pinned set below. It is
-- already covered at the RLS layer by migration 051, and adding it here would
-- make this trigger load-bearing for every invitation in the product.
--
--   * For an authenticated non-super-admin, USING is evaluated against the OLD
--     row (so OLD.user_id = auth.uid()) and WITH CHECK against the NEW row (so
--     NEW.user_id = auth.uid()). Any UPDATE that moves user_id off the
--     caller's own uid is rejected by WITH CHECK. Precision note: WITH CHECK
--     runs AFTER BEFORE-ROW triggers, so at trigger time NEW.user_id can still
--     differ from OLD.user_id -- the statement is simply aborted a moment later
--     by RLS instead. The outcome is identical; a trigger clause here would be
--     redundant, not additive.
--   * Rows with user_id IS NULL fail USING outright (NULL = auth.uid() is
--     NULL, not true), so claiming an unlinked account is already blocked.
--   * Critically: public.link_player_on_auth_signup() (migration 020, a
--     SECURITY DEFINER trigger on auth.users) does
--         UPDATE public.players SET user_id = NEW.id ...
--     inside GoTrue's connection, where auth.uid() is NULL and no PostgREST
--     GUC exists. Both invite-player and send-invite depend on that trigger to
--     link the pending players row. Protecting user_id here would put this
--     trigger on the critical path of every invitation for zero security gain.
--
-- ─── End of preserved 054 header. Migration 055 addendum follows. ────────────
--
-- HOW is_heckler DIFFERS FROM is_super_admin
-- ------------------------------------------
-- is_super_admin has NO legitimate authenticated writer anywhere in the
-- codebase -- nothing outside a manual SQL session has ever set it -- so its
-- "super admin succeeds" branch is effectively dead code in production.
--
-- is_heckler DOES have one: a super admin toggling the flag from windex-admin,
-- which arrives with role claim 'authenticated' and passes on
-- am_i_super_admin(). No new bypass is required; the existing super-admin
-- branch already covers it. But that branch is now a LIVE PRODUCTION PATH
-- rather than a theoretical one, and is proven explicitly (case N3), not
-- inferred.
--
-- Note also that the two directions are not equally interesting. false -> true
-- is harmless self-demotion (a player volunteering to stop competing);
-- true -> false is promotion OUT of spectator status. Both are blocked, and
-- true -> false is proven on its own (case N2) rather than inferred from N1.

CREATE OR REPLACE FUNCTION public.enforce_players_privileged_columns()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role text;
BEGIN
  -- NULL when the GUC is unset or empty (GoTrue / psql / Management API).
  -- Mirrors the nullif() guard auth.uid() uses on the same setting.
  v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';

  IF v_role IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;              -- service_role or a non-PostgREST connection
  END IF;

  IF public.am_i_super_admin() THEN
    RETURN NEW;              -- super admins may set these flags on any row
  END IF;

  IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
    RAISE EXCEPTION
      'players.is_super_admin may only be changed by a super admin (attempted % -> % on player %)',
      OLD.is_super_admin, NEW.is_super_admin, OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.is_heckler IS DISTINCT FROM OLD.is_heckler THEN
    RAISE EXCEPTION
      'players.is_heckler may only be changed by a super admin (attempted % -> % on player %)',
      OLD.is_heckler, NEW.is_heckler, OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;


-- ============================================================================
-- 3. Chat policy future-proofing.
-- ============================================================================
-- All four membership-gated chat policies currently admit a caller only when
--     r.kind = 'global' OR am_i_group_member(r.group_id)
-- am_i_group_member() is permanently false for a Heckler (zero group_members
-- rows by definition), so today only the kind='global' escape hatch keeps chat
-- working for them -- and it works only because the live rooms table happens to
-- hold exactly one row, kind='global'. The first kind='group' room created
-- would silently lock every Heckler out of it. Add the disjunct now, while the
-- reasoning is fresh, rather than discovering it as a bug later.
--
-- The author_player_id / player_id IN get_my_player_ids() conjunct on the two
-- INSERT policies is deliberately NOT relaxed: a Heckler may read anything but
-- may still only write AS THEMSELVES.
--
-- FOR THE RECORD, NOT IMPLEMENTED HERE: a genuinely private team channel should
-- be a THIRD rooms.kind value ('private'), not a re-narrowing of 'group'.
-- Re-narrowing 'group' would silently revoke Heckler access to every existing
-- group room at once; a new kind is additive and explicit.

-- Mirrors am_i_group_member's shape. EXISTS, not a scalar subquery: a single
-- auth user may own several players rows (see get_my_player_ids), and any one
-- of them carrying the flag makes the user a Heckler.
CREATE OR REPLACE FUNCTION public.am_i_heckler()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM players p
    WHERE p.user_id = auth.uid()
      AND p.is_heckler
  );
$function$;

DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM rooms r
       WHERE r.id = messages.room_id
         AND (r.kind = 'global' OR am_i_group_member(r.group_id) OR am_i_heckler())
    )
  );

DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    author_player_id IN (SELECT get_my_player_ids())
    AND EXISTS (
      SELECT 1 FROM rooms r
       WHERE r.id = messages.room_id
         AND (r.kind = 'global' OR am_i_group_member(r.group_id) OR am_i_heckler())
    )
  );

DROP POLICY IF EXISTS message_reactions_select ON public.message_reactions;
CREATE POLICY message_reactions_select ON public.message_reactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM messages m
        JOIN rooms r ON r.id = m.room_id
       WHERE m.id = message_reactions.message_id
         AND (r.kind = 'global' OR am_i_group_member(r.group_id) OR am_i_heckler())
    )
  );

DROP POLICY IF EXISTS message_reactions_insert ON public.message_reactions;
CREATE POLICY message_reactions_insert ON public.message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    player_id IN (SELECT get_my_player_ids())
    AND EXISTS (
      SELECT 1 FROM messages m
        JOIN rooms r ON r.id = m.room_id
       WHERE m.id = message_reactions.message_id
         AND (r.kind = 'global' OR am_i_group_member(r.group_id) OR am_i_heckler())
    )
  );

-- messages_update is intentionally untouched: it gates on authorship
-- (am_i_super_admin() OR author_player_id IN get_my_player_ids()), not
-- membership, so it already behaves correctly for a Heckler.
