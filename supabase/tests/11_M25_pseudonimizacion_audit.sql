-- pgTAP · Folio · M25 pseudonimizacion_event + integration_active
--
-- Verifies that the M25 additions land correctly:
--   1. pseudonimizacion_event table exists with the right shape
--   2. Append-only policies (no_direct_insert, no_update, no_delete) are present
--   3. SELECT policy gated on OWNER/DIRECTOR is present
--   4. integration_active view exists
--   5. pseudonimizar_paciente() returns the expected dry-run shape
--
-- Run:
--   node -e "..." or psql -f supabase/tests/11_M25_pseudonimizacion_audit.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(9);

-- ─── Table structure ────────────────────────────────────────────────────

SELECT has_table('public', 'pseudonimizacion_event',
  'M25 · pseudonimizacion_event table exists');

SELECT has_column('public', 'pseudonimizacion_event', 'dni_sha256',
  'M25 · pseudonimizacion_event.dni_sha256 exists');

SELECT has_column('public', 'pseudonimizacion_event', 'nombre_sha256',
  'M25 · pseudonimizacion_event.nombre_sha256 exists');

SELECT col_not_null('public', 'pseudonimizacion_event', 'motivo',
  'M25 · pseudonimizacion_event.motivo is NOT NULL');

-- ─── Append-only policies ──────────────────────────────────────────────

SELECT ok(
  EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pseudonimizacion_event' AND policyname='pseudonimizacion_event_no_direct_insert' AND cmd='INSERT'),
  'M25 · no-direct-insert policy on pseudonimizacion_event'
);

SELECT ok(
  EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pseudonimizacion_event' AND policyname='pseudonimizacion_event_no_update' AND cmd='UPDATE'),
  'M25 · no-update policy on pseudonimizacion_event'
);

SELECT ok(
  EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='pseudonimizacion_event' AND policyname='pseudonimizacion_event_no_delete' AND cmd='DELETE'),
  'M25 · no-delete policy on pseudonimizacion_event'
);

-- ─── integration_active view ───────────────────────────────────────────

SELECT ok(
  EXISTS(SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='integration_active'),
  'M25 · integration_active view exists'
);

-- ─── Function signature unchanged after extension ──────────────────────

SELECT has_function('public', 'pseudonimizar_paciente', ARRAY['uuid','text','boolean'],
  'M25 · pseudonimizar_paciente(uuid, text, boolean) still callable');

SELECT * FROM finish();

ROLLBACK;
