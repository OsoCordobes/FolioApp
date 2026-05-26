-- pgTAP · Folio · M37 · is_internal_account flag + soft-delete cascade
-- ════════════════════════════════════════════════════════════════════════════
-- Verifies:
--   1. organization.is_internal_account column exists with correct default.
--   2. tg_audit_organization_internal_flag fires on UPDATE OF the column and
--      writes a row to audit_log with the expected action label.
--   3. tg_audit_organization_internal_flag does NOT fire on no-op updates
--      (NEW.is_internal_account IS NOT DISTINCT FROM OLD.is_internal_account).
--   4. tg_cascade_soft_delete_org_members fires when organization.deleted_at
--      transitions NULL → NOT NULL, propagating the timestamp to all
--      member rows that were still active.
--   5. The cascade is bounded to the affected org (does not touch unrelated
--      orgs' members).
--
-- Ejecución:
--   psql "$POSTGRES_URL_NON_POOLING" -f supabase/tests/12_M37_internal_flag_and_cascade.sql

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(10);

-- ─── Setup ────────────────────────────────────────────────────────────────

INSERT INTO profile (id, email, nombre_cifrado, apellido_cifrado) VALUES
  ('fe000000-0000-0000-0000-000000000001', 'a@folio.test', 'A', 'X'),
  ('fe000000-0000-0000-0000-000000000002', 'b@folio.test', 'B', 'Y');

INSERT INTO organization (id, slug, nombre) VALUES
  ('fe000000-0000-0000-0000-0000000000aa', 'clinic-m37-a', 'Clinic A'),
  ('fe000000-0000-0000-0000-0000000000bb', 'clinic-m37-b', 'Clinic B');

INSERT INTO member (id, organization_id, profile_id, role, accepted_at) VALUES
  ('fe000000-0000-0000-0000-0000000000a1', 'fe000000-0000-0000-0000-0000000000aa', 'fe000000-0000-0000-0000-000000000001', 'OWNER', now()),
  ('fe000000-0000-0000-0000-0000000000a2', 'fe000000-0000-0000-0000-0000000000aa', 'fe000000-0000-0000-0000-000000000002', 'PROFESIONAL', now()),
  ('fe000000-0000-0000-0000-0000000000b1', 'fe000000-0000-0000-0000-0000000000bb', 'fe000000-0000-0000-0000-000000000002', 'OWNER', now());

-- ─── 1. Column exists with correct default ───────────────────────────────

SELECT has_column('public', 'organization', 'is_internal_account',
  'M37 · organization.is_internal_account column exists');

SELECT col_default_is('public', 'organization', 'is_internal_account', 'false',
  'M37 · is_internal_account default is false');

SELECT col_not_null('public', 'organization', 'is_internal_account',
  'M37 · is_internal_account is NOT NULL');

-- ─── 2. Audit trigger fires on flag flip to true ─────────────────────────

UPDATE organization SET is_internal_account = true
WHERE id = 'fe000000-0000-0000-0000-0000000000aa';

SELECT cmp_ok(
  (SELECT count(*)::int FROM audit_log
   WHERE resource_type = 'organization'
     AND resource_id = 'fe000000-0000-0000-0000-0000000000aa'
     AND action = 'organization.internal_flag_set'),
  '>=', 1,
  'M37 · setting is_internal_account=true writes organization.internal_flag_set audit row');

-- Verify payload structure (before/after)
SELECT is(
  (SELECT (payload->>'before')::boolean FROM audit_log
   WHERE resource_type = 'organization'
     AND resource_id = 'fe000000-0000-0000-0000-0000000000aa'
     AND action = 'organization.internal_flag_set'
   ORDER BY ts DESC LIMIT 1),
  false,
  'M37 · audit payload.before reflects the prior value (false)');

SELECT is(
  (SELECT (payload->>'after')::boolean FROM audit_log
   WHERE resource_type = 'organization'
     AND resource_id = 'fe000000-0000-0000-0000-0000000000aa'
     AND action = 'organization.internal_flag_set'
   ORDER BY ts DESC LIMIT 1),
  true,
  'M37 · audit payload.after reflects the new value (true)');

-- ─── 3. Audit trigger does NOT fire on no-op updates ─────────────────────

-- Snapshot current count, then re-UPDATE with the same value, then assert
-- count did not increase.
DO $$
DECLARE
  v_before integer;
  v_after integer;
BEGIN
  SELECT count(*)::int INTO v_before FROM audit_log
   WHERE resource_type = 'organization'
     AND resource_id = 'fe000000-0000-0000-0000-0000000000aa';

  UPDATE organization SET is_internal_account = true
   WHERE id = 'fe000000-0000-0000-0000-0000000000aa';

  SELECT count(*)::int INTO v_after FROM audit_log
   WHERE resource_type = 'organization'
     AND resource_id = 'fe000000-0000-0000-0000-0000000000aa';

  PERFORM ok(v_before = v_after,
    'M37 · no-op UPDATE (same value) does not write a redundant audit row');
END
$$;

-- ─── 4. Audit trigger fires on flag flip back to false ───────────────────

UPDATE organization SET is_internal_account = false
WHERE id = 'fe000000-0000-0000-0000-0000000000aa';

SELECT cmp_ok(
  (SELECT count(*)::int FROM audit_log
   WHERE resource_type = 'organization'
     AND resource_id = 'fe000000-0000-0000-0000-0000000000aa'
     AND action = 'organization.internal_flag_cleared'),
  '>=', 1,
  'M37 · clearing is_internal_account writes organization.internal_flag_cleared audit row');

-- ─── 5. Cascade soft-delete propagates to org members ────────────────────

UPDATE organization SET deleted_at = '2026-05-27 12:00:00+00'::timestamptz
WHERE id = 'fe000000-0000-0000-0000-0000000000aa';

SELECT cmp_ok(
  (SELECT count(*)::int FROM member
    WHERE organization_id = 'fe000000-0000-0000-0000-0000000000aa'
      AND deleted_at = '2026-05-27 12:00:00+00'::timestamptz),
  '=', 2,
  'M37 · soft-deleting org cascades to all its members with the same timestamp');

-- ─── 6. Cascade does NOT touch other orgs' members ───────────────────────

SELECT is(
  (SELECT deleted_at FROM member
    WHERE id = 'fe000000-0000-0000-0000-0000000000b1'),
  NULL,
  'M37 · cascade is scoped to the soft-deleted org — unrelated members untouched');

SELECT * FROM finish();
ROLLBACK;
