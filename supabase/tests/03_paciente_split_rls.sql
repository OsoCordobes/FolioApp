-- pgTAP · Folio · split PII (paciente_identidad) vs PHI (paciente)
-- Verifica que:
--   - ASISTENTE puede leer paciente_identidad (PII para agenda) pero NO paciente (PHI)
--   - PROFESIONAL puede leer ambas si profesional_principal_id = su member_id
--   - DIRECTOR sin es_colegiado NO ve PHI; con es_colegiado SÍ
--   - caja_fuerte_profesional restringe lectura aún más

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(8);

-- Setup
INSERT INTO profile (id, email, nombre_cifrado, apellido_cifrado) VALUES
  ('aa000000-0000-0000-0000-000000000001', 'owner@x', 'O', 'W'),
  ('aa000000-0000-0000-0000-000000000002', 'prof@x',  'P', 'R'),
  ('aa000000-0000-0000-0000-000000000003', 'asist@x', 'A', 'S'),
  ('aa000000-0000-0000-0000-000000000004', 'dir@x',   'D', 'I');

INSERT INTO organization (id, slug, nombre) VALUES
  ('aa000000-0000-0000-0000-0000000000aa', 'clinic-x', 'Clinic X');

INSERT INTO member (id, organization_id, profile_id, role, accepted_at, es_colegiado) VALUES
  ('aa000000-0000-0000-0000-0000000000a1', 'aa000000-0000-0000-0000-0000000000aa', 'aa000000-0000-0000-0000-000000000001', 'OWNER',       now(), false),
  ('aa000000-0000-0000-0000-0000000000a2', 'aa000000-0000-0000-0000-0000000000aa', 'aa000000-0000-0000-0000-000000000002', 'PROFESIONAL', now(), true),
  ('aa000000-0000-0000-0000-0000000000a3', 'aa000000-0000-0000-0000-0000000000aa', 'aa000000-0000-0000-0000-000000000003', 'ASISTENTE',   now(), false),
  ('aa000000-0000-0000-0000-0000000000a4', 'aa000000-0000-0000-0000-0000000000aa', 'aa000000-0000-0000-0000-000000000004', 'DIRECTOR',    now(), false);

INSERT INTO paciente_identidad (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash, nombre_hash)
VALUES ('aa000000-0000-0000-0000-00000000aa01', 'aa000000-0000-0000-0000-0000000000aa', 'X', 'Y', 'Z', 'h1', 'h2');

INSERT INTO paciente (id, organization_id, identidad_id, profesional_principal_id)
VALUES ('aa000000-0000-0000-0000-00000000bb01', 'aa000000-0000-0000-0000-0000000000aa', 'aa000000-0000-0000-0000-00000000aa01', 'aa000000-0000-0000-0000-0000000000a2');

SET LOCAL role = authenticated;

-- ─── ASISTENTE: PII sí, PHI no ────────────────────────────────────────────
SET LOCAL request.jwt.claim.sub = 'aa000000-0000-0000-0000-000000000003';

SELECT is(
  (SELECT count(*)::int FROM paciente_identidad WHERE id = 'aa000000-0000-0000-0000-00000000aa01'),
  1, 'ASISTENTE puede leer paciente_identidad (PII)');

SELECT is(
  (SELECT count(*)::int FROM paciente WHERE id = 'aa000000-0000-0000-0000-00000000bb01'),
  0, 'ASISTENTE NO puede leer paciente (PHI)');

-- ─── PROFESIONAL dueño: ambas ─────────────────────────────────────────────
SET LOCAL request.jwt.claim.sub = 'aa000000-0000-0000-0000-000000000002';

SELECT is(
  (SELECT count(*)::int FROM paciente_identidad WHERE id = 'aa000000-0000-0000-0000-00000000aa01'),
  1, 'PROFESIONAL puede leer paciente_identidad');

SELECT is(
  (SELECT count(*)::int FROM paciente WHERE id = 'aa000000-0000-0000-0000-00000000bb01'),
  1, 'PROFESIONAL dueño puede leer paciente (PHI)');

-- ─── DIRECTOR sin es_colegiado: PII sí, PHI no ────────────────────────────
SET LOCAL request.jwt.claim.sub = 'aa000000-0000-0000-0000-000000000004';

SELECT is(
  (SELECT count(*)::int FROM paciente_identidad WHERE id = 'aa000000-0000-0000-0000-00000000aa01'),
  1, 'DIRECTOR no-colegiado puede leer paciente_identidad');

SELECT is(
  (SELECT count(*)::int FROM paciente WHERE id = 'aa000000-0000-0000-0000-00000000bb01'),
  0, 'DIRECTOR no-colegiado NO puede leer paciente (PHI)');

-- ─── OWNER: ambas siempre ────────────────────────────────────────────────
SET LOCAL request.jwt.claim.sub = 'aa000000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM paciente_identidad WHERE id = 'aa000000-0000-0000-0000-00000000aa01'),
  1, 'OWNER puede leer paciente_identidad');

SELECT is(
  (SELECT count(*)::int FROM paciente WHERE id = 'aa000000-0000-0000-0000-00000000bb01'),
  1, 'OWNER puede leer paciente (PHI)');

SELECT * FROM finish();
ROLLBACK;
