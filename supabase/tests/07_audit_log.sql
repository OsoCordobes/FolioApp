-- pgTAP · Folio · audit_log triggers
-- Verifica que INSERT/UPDATE/DELETE en tablas críticas genera filas en audit_log.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(6);

-- Setup
INSERT INTO profile (id, email, nombre_cifrado, apellido_cifrado) VALUES
  ('ff000000-0000-0000-0000-000000000001', 'a@x', 'A', 'X');

INSERT INTO organization (id, slug, nombre) VALUES
  ('ff000000-0000-0000-0000-0000000000aa', 'clinic-au', 'Clinic AU');

INSERT INTO member (id, organization_id, profile_id, role, accepted_at) VALUES
  ('ff000000-0000-0000-0000-0000000000a1', 'ff000000-0000-0000-0000-0000000000aa', 'ff000000-0000-0000-0000-000000000001', 'OWNER', now());

INSERT INTO paciente_identidad (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash, nombre_hash)
VALUES ('ff000000-0000-0000-0000-00000000aa01', 'ff000000-0000-0000-0000-0000000000aa', 'X', 'Y', 'Z', 'h1', 'h2');

INSERT INTO paciente (id, organization_id, identidad_id)
VALUES ('ff000000-0000-0000-0000-00000000bb01', 'ff000000-0000-0000-0000-0000000000aa', 'ff000000-0000-0000-0000-00000000aa01');

-- ─── Test 1: INSERT paciente generó audit ────────────────────────────────

SELECT cmp_ok(
  (SELECT count(*)::int FROM audit_log
   WHERE resource_type = 'paciente'
     AND resource_id = 'ff000000-0000-0000-0000-00000000bb01'
     AND action = 'paciente.insert'),
  '>=', 1,
  'INSERT paciente genera audit_log.action=paciente.insert');

-- ─── Test 2: UPDATE genera audit con diff ────────────────────────────────

UPDATE paciente SET tags = ARRAY['VIP']
WHERE id = 'ff000000-0000-0000-0000-00000000bb01';

SELECT cmp_ok(
  (SELECT count(*)::int FROM audit_log
   WHERE resource_type = 'paciente'
     AND resource_id = 'ff000000-0000-0000-0000-00000000bb01'
     AND action = 'paciente.update'),
  '>=', 1,
  'UPDATE paciente genera audit_log.action=paciente.update');

-- ─── Test 3: payload de UPDATE contiene before/after ────────────────────

SELECT is(
  (SELECT payload ? 'before' AND payload ? 'after'
   FROM audit_log
   WHERE resource_type = 'paciente'
     AND resource_id = 'ff000000-0000-0000-0000-00000000bb01'
     AND action = 'paciente.update'
   ORDER BY ts DESC LIMIT 1),
  true,
  'payload de UPDATE contiene before y after');

-- ─── Test 4: INSERT a sesion también audita ─────────────────────────────

INSERT INTO servicio (id, organization_id, nombre, tipo_canonico, duracion_min, precio_cents)
VALUES ('ff000000-0000-0000-0000-00000000cc01', 'ff000000-0000-0000-0000-0000000000aa', 'X', 'SEGUIMIENTO_ESTANDAR', 45, 1000);

INSERT INTO turno (id, organization_id, paciente_id, servicio_id, profesional_id, inicio, duracion_min, precio_cents, estado)
VALUES ('ff000000-0000-0000-0000-00000000dd01',
        'ff000000-0000-0000-0000-0000000000aa',
        'ff000000-0000-0000-0000-00000000bb01',
        'ff000000-0000-0000-0000-00000000cc01',
        'ff000000-0000-0000-0000-0000000000a1',
        now(), 45, 1000, 'AGENDADO');

INSERT INTO sesion (id, organization_id, turno_id, paciente_id, vertebras_json)
VALUES ('ff000000-0000-0000-0000-00000000ee01',
        'ff000000-0000-0000-0000-0000000000aa',
        'ff000000-0000-0000-0000-00000000dd01',
        'ff000000-0000-0000-0000-00000000bb01',
        '[]'::jsonb);

SELECT cmp_ok(
  (SELECT count(*)::int FROM audit_log
   WHERE resource_type = 'sesion'
     AND resource_id = 'ff000000-0000-0000-0000-00000000ee01'),
  '>=', 1,
  'INSERT sesion genera audit_log');

-- ─── Test 5: audit_log es append-only (no UPDATE) ────────────────────────

SET LOCAL role = authenticated;
SET LOCAL request.jwt.claim.sub = 'ff000000-0000-0000-0000-000000000001';

SELECT throws_ok(
  $$ UPDATE audit_log SET action = 'hack' WHERE id = (SELECT id FROM audit_log LIMIT 1) $$,
  NULL,
  NULL,
  'UPDATE de audit_log bloqueado por RLS policy');

-- ─── Test 6: audit_log no se puede borrar ───────────────────────────────

SELECT throws_ok(
  $$ DELETE FROM audit_log WHERE id = (SELECT id FROM audit_log LIMIT 1) $$,
  NULL,
  NULL,
  'DELETE de audit_log bloqueado por RLS policy');

SELECT * FROM finish();
ROLLBACK;
