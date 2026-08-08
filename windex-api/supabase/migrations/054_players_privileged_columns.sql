-- Block end-user self-promotion to super-admin on public.players.
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
-- A BEFORE UPDATE trigger that hard-fails (RAISE EXCEPTION — never a silent
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
--     DEFINER body, so it reads `postgres` for every caller — useless here.
--   * session_user  is `authenticator` for all PostgREST traffic, both
--     `authenticated` and `service_role` — also useless.
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
-- service_role caller retains the ability to write is_super_admin, so the
-- service-role key remains a super-admin-equivalent secret. This migration
-- closes the end-user escalation, not the key-compromise one.
--
-- A malformed request.jwt.claims GUC will fail the ::jsonb cast and abort the
-- statement. That is deliberate — fail closed, not open.
--
-- WHY user_id IS DELIBERATELY *NOT* PROTECTED HERE
-- ------------------------------------------------
-- Do not "fix" this later by adding user_id to PROTECTED below. It is already
-- covered at the RLS layer by migration 051, and adding it here would make
-- this trigger load-bearing for every invitation in the product.
--
--   * For an authenticated non-super-admin, USING is evaluated against the OLD
--     row (so OLD.user_id = auth.uid()) and WITH CHECK against the NEW row (so
--     NEW.user_id = auth.uid()). Any UPDATE that moves user_id off the
--     caller's own uid is rejected by WITH CHECK. Precision note: WITH CHECK
--     runs AFTER BEFORE-ROW triggers, so at trigger time NEW.user_id can still
--     differ from OLD.user_id — the statement is simply aborted a moment later
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
-- Migration 054. Does NOT alter players_update — the RLS policy is unchanged.

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
    RETURN NEW;              -- super admins may set the flag on any row
  END IF;

  IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
    RAISE EXCEPTION
      'players.is_super_admin may only be changed by a super admin (attempted % -> % on player %)',
      OLD.is_super_admin, NEW.is_super_admin, OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS players_privileged_columns_trg ON public.players;
CREATE TRIGGER players_privileged_columns_trg
  BEFORE UPDATE ON public.players
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_players_privileged_columns();
