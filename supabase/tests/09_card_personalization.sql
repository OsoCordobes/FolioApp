-- pgTAP · Folio · M21 card personalization
-- Verifies organization.logo_url, organization.card_mood, the CHECK constraint,
-- the org-logos storage bucket, and the two RLS policies created by M21.
--
-- Ejecución:
--   psql "$POSTGRES_URL_NON_POOLING" -f supabase/tests/09_card_personalization.sql
--
-- Wraps in BEGIN/ROLLBACK so the negative-case INSERT does not pollute data.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(11);

-- ─── organization.logo_url ────────────────────────────────────────────────

SELECT has_column('public', 'organization', 'logo_url',
  'organization.logo_url exists');

SELECT col_type_is('public', 'organization', 'logo_url', 'text',
  'organization.logo_url is text');

SELECT col_is_null('public', 'organization', 'logo_url',
  'organization.logo_url is nullable');

-- ─── organization.card_mood ───────────────────────────────────────────────

SELECT has_column('public', 'organization', 'card_mood',
  'organization.card_mood exists');

SELECT col_type_is('public', 'organization', 'card_mood', 'text',
  'organization.card_mood is text');

SELECT col_not_null('public', 'organization', 'card_mood',
  'organization.card_mood is NOT NULL');

SELECT col_default_is('public', 'organization', 'card_mood', 'editorial',
  'organization.card_mood default is editorial');

-- ─── CHECK constraint enforces the 4-mood enum ───────────────────────────

SELECT throws_ok(
  $$ INSERT INTO organization (slug, nombre, card_mood)
     VALUES ('m21-test-bad-mood', 'X', 'invalid_mood') $$,
  '23514',
  NULL,
  'card_mood rejects invalid values (CHECK constraint enforced)'
);

-- Positive: 'calido' is accepted (and we rollback so this row never lands).
SELECT lives_ok(
  $$ INSERT INTO organization (slug, nombre, card_mood)
     VALUES ('m21-test-good-mood', 'Y', 'calido') $$,
  'card_mood accepts calido'
);

-- ─── Storage bucket org-logos ────────────────────────────────────────────

SELECT ok(
  EXISTS(SELECT 1 FROM storage.buckets WHERE id = 'org-logos' AND public = true),
  'org-logos bucket exists and is public'
);

-- ─── RLS policies on storage.objects ─────────────────────────────────────

SELECT ok(
  (SELECT COUNT(*) FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('org-logos public read', 'org-logos owner-or-director write')) = 2,
  'two RLS policies exist on storage.objects for org-logos'
);

SELECT * FROM finish();

ROLLBACK;
