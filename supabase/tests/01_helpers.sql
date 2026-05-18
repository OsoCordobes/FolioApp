-- pgTAP · Folio · helpers RLS
-- Verifica que user_org_ids, user_role_in, can_read_clinical, etc. existen
-- y se invocan correctamente con la signature esperada.
--
-- Ejecución: psql -f supabase/tests/01_helpers.sql
-- (requiere extensión pgtap: CREATE EXTENSION IF NOT EXISTS pgtap)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(10);

-- ─── Existence ─────────────────────────────────────────────────────────────

SELECT has_function('public', 'user_org_ids', ARRAY[]::text[],
  'user_org_ids() existe en schema public');

SELECT has_function('public', 'user_role_in', ARRAY['uuid'],
  'user_role_in(uuid) existe');

SELECT has_function('public', 'can_read_clinical', ARRAY['uuid'],
  'can_read_clinical(uuid) existe');

SELECT has_function('public', 'can_read_admin', ARRAY['uuid'],
  'can_read_admin(uuid) existe');

SELECT has_function('public', 'user_member_id_in', ARRAY['uuid'],
  'user_member_id_in(uuid) existe');

SELECT has_function('public', 'user_has_scope_over', ARRAY['uuid', 'uuid'],
  'user_has_scope_over(uuid, uuid) existe');

SELECT has_function('public', 'hmac_blind', ARRAY['text'],
  'hmac_blind(text) existe');

-- ─── SECURITY DEFINER + search_path ───────────────────────────────────────

SELECT is(
  (SELECT prosecdef FROM pg_proc
   WHERE proname = 'user_org_ids' AND pronamespace = 'public'::regnamespace),
  true,
  'user_org_ids es SECURITY DEFINER');

SELECT is(
  (SELECT proconfig FROM pg_proc
   WHERE proname = 'user_role_in' AND pronamespace = 'public'::regnamespace
   LIMIT 1),
  ARRAY['search_path=public'],
  'user_role_in tiene search_path=public (mitigación CWE-1284)');

-- ─── hmac_blind funcional ─────────────────────────────────────────────────

SELECT is(
  hmac_blind(NULL),
  NULL::text,
  'hmac_blind(NULL) devuelve NULL');

SELECT * FROM finish();
ROLLBACK;
