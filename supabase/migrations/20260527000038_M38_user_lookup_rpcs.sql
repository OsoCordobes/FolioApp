-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M38 · auth.users lookup helpers (SECURITY DEFINER)
-- ════════════════════════════════════════════════════════════════════════════
-- Two related helpers that move auth.users lookups off the slow paginated
-- admin REST API and onto direct SQL. Both are restricted to service_role.
--
-- Background (audit 2026-05-26):
--   - lib/auth/find-user-by-email.ts paginated `admin.listUsers` in pages of
--     1000, up to 50 pages — up to 50 round-trips per existing-email signup
--     attempt. Slow + fragile. find_user_id_by_email replaces that with a
--     single indexed SQL query.
--   - signInWithPassword returns a generic "incorrect" error even when the
--     real cause is that the account exists but only has a Google identity
--     (no password). Demos repeatedly hit this dead end. user_providers_by_email
--     lets us surface "Esta cuenta entra con Google" without leaking
--     enumeration info (we only call it AFTER a sign-in failure).
--
-- Both are SECURITY DEFINER + REVOKE FROM PUBLIC + GRANT TO service_role
-- following the M33 / M34 convention. Neither leaks rows the caller couldn't
-- already derive via the admin SDK; they're a faster path for the same data.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. find_user_id_by_email ─────────────────────────────────────────────
-- Returns the auth.users.id for an email (case-insensitive) or NULL.
-- Replaces the paginated listUsers loop in lib/auth/find-user-by-email.ts.

CREATE OR REPLACE FUNCTION public.find_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT id
    FROM auth.users
   WHERE lower(email) = lower(p_email)
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.find_user_id_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_user_id_by_email(text) TO service_role;

COMMENT ON FUNCTION public.find_user_id_by_email IS
  'M38 · direct-SQL replacement for admin.listUsers pagination. Returns auth.users.id by case-insensitive email, or NULL. Service-role only.';

-- ─── 2. user_providers_by_email ───────────────────────────────────────────
-- Returns a sorted JSON array of auth identity providers for the email.
--
-- Example outputs:
--   ["email"]              → password-only user
--   ["google"]             → Google OAuth user, no password
--   ["email", "google"]    → both linked
--   []                     → no such user
--
-- We return a sorted array (not a set) so the caller can do simple
-- equality checks in TS. Sorted lexicographically for deterministic shape.
--
-- Note on auth.identities.provider: Supabase stores OAuth-linked providers
-- (google, github, apple, ...) AND the "email" identity for users with a
-- password. So a Google-only user has ["google"], a password-only user has
-- ["email"], and a user who signed up with Google then added a password
-- via the reset flow has ["email", "google"].

CREATE OR REPLACE FUNCTION public.user_providers_by_email(p_email text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(jsonb_agg(DISTINCT i.provider ORDER BY i.provider), '[]'::jsonb)
    FROM auth.identities i
    JOIN auth.users u ON u.id = i.user_id
   WHERE lower(u.email) = lower(p_email)
$$;

REVOKE ALL ON FUNCTION public.user_providers_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_providers_by_email(text) TO service_role;

COMMENT ON FUNCTION public.user_providers_by_email IS
  'M38 · returns the sorted list of auth identity providers for an email (e.g. ["google"], ["email"], ["email","google"]). Empty array if no user. Service-role only. Used to surface provider-aware login errors after a sign-in failure (audit 2026-05-26 finding #6).';
