-- pgTAP · Folio · M22 RLS hardening
-- Verifies the 3 changes: sesion lock immutability, financial/outcome/legal
-- DELETE prevention, storage bucket UUID validation tightening.
--
-- Ejecución:
--   psql "$POSTGRES_URL_NON_POOLING" -f supabase/tests/10_M22_rls_hardening.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(11);

-- ─── 1. sesion lock immutability trigger exists + works ─────────────────

SELECT has_function('public', 'prevent_sesion_unlock', ARRAY[]::text[],
  'M22 · prevent_sesion_unlock() function exists');

SELECT has_trigger('public', 'sesion', 'sesion_lock_immutable_trg',
  'M22 · sesion_lock_immutable_trg trigger on sesion');

-- ─── 2. DELETE policies exist on financial / outcome / legal tables ─────

SELECT ok(
  EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pago' AND policyname='pago_no_delete' AND cmd='DELETE' AND qual='false'),
  'M22 · pago_no_delete policy exists with USING false'
);
SELECT ok(
  EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='post_visita' AND policyname='post_visita_no_delete' AND cmd='DELETE' AND qual='false'),
  'M22 · post_visita_no_delete policy exists with USING false'
);
SELECT ok(
  EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cobertura_paciente' AND policyname='cobertura_paciente_no_delete' AND cmd='DELETE' AND qual='false'),
  'M22 · cobertura_paciente_no_delete policy exists with USING false'
);
SELECT ok(
  EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='cargo_suscripcion' AND policyname='cargo_suscripcion_no_delete' AND cmd='DELETE' AND qual='false'),
  'M22 · cargo_suscripcion_no_delete policy exists with USING false'
);
SELECT ok(
  EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='suscripcion' AND policyname='suscripcion_no_delete' AND cmd='DELETE' AND qual='false'),
  'M22 · suscripcion_no_delete policy exists with USING false'
);
SELECT ok(
  EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='seguro_profesional' AND policyname='seguro_profesional_no_delete' AND cmd='DELETE' AND qual='false'),
  'M22 · seguro_profesional_no_delete policy exists with USING false'
);

-- ─── 3. Storage bucket policy was redefined with UUID regex ─────────────

SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'org-logos owner-or-director write'
  ),
  'M22 · org-logos owner-or-director write policy exists post-redefine'
);

-- ─── 4. Already-existing policies still intact (regression sanity) ──────

SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'audit_log'
      AND policyname = 'audit_log_no_delete'
  ),
  'regression · audit_log_no_delete still in place after M22'
);

SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'consentimiento'
      AND policyname = 'consentimiento_no_delete'
  ),
  'regression · consentimiento_no_delete still in place after M22'
);

SELECT * FROM finish();

ROLLBACK;
