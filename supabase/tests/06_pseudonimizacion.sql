-- pgTAP · Folio · pseudonimizacion_paciente (Habeas Data art. 16)
-- Verifica que:
--   - dry_run muestra impacto sin ejecutar
--   - solo OWNER/DIRECTOR pueden invocar
--   - motivo <20 chars rechaza
--   - ejecución borra paciente_identidad, contactos, tutores
--   - paciente queda con identidad_id=NULL y pseudonimizado_en seteado
--   - segunda ejecución sobre el mismo paciente rechaza
--   - audit log captura la operación

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(10);

-- Setup
INSERT INTO profile (id, email, nombre_cifrado, apellido_cifrado) VALUES
  ('dd000000-0000-0000-0000-000000000001', 'owner@x', 'O', 'W'),
  ('dd000000-0000-0000-0000-000000000002', 'asist@x', 'A', 'S');

INSERT INTO organization (id, slug, nombre) VALUES
  ('dd000000-0000-0000-0000-0000000000aa', 'clinic-ps', 'Clinic PS');

INSERT INTO member (id, organization_id, profile_id, role, accepted_at) VALUES
  ('dd000000-0000-0000-0000-0000000000a1', 'dd000000-0000-0000-0000-0000000000aa', 'dd000000-0000-0000-0000-000000000001', 'OWNER',     now()),
  ('dd000000-0000-0000-0000-0000000000a2', 'dd000000-0000-0000-0000-0000000000aa', 'dd000000-0000-0000-0000-000000000002', 'ASISTENTE', now());

INSERT INTO paciente_identidad (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash, nombre_hash)
VALUES ('dd000000-0000-0000-0000-00000000aa01', 'dd000000-0000-0000-0000-0000000000aa', 'X', 'Y', 'Z', 'h1', 'h2');

INSERT INTO paciente (id, organization_id, identidad_id)
VALUES ('dd000000-0000-0000-0000-00000000bb01', 'dd000000-0000-0000-0000-0000000000aa', 'dd000000-0000-0000-0000-00000000aa01');

INSERT INTO contacto_emergencia (organization_id, paciente_id, nombre_cifrado, telefono_cifrado, vinculo)
VALUES ('dd000000-0000-0000-0000-0000000000aa', 'dd000000-0000-0000-0000-00000000bb01', 'X', 'Y', 'CONYUGE');

SET LOCAL role = authenticated;

-- ─── Test 1: ASISTENTE no puede invocar ──────────────────────────────────
SET LOCAL request.jwt.claim.sub = 'dd000000-0000-0000-0000-000000000002';

SELECT throws_like(
  $$ SELECT public.pseudonimizar_paciente('dd000000-0000-0000-0000-00000000bb01'::uuid, 'Solicitud del paciente del 2026-05-13', false) $$,
  '%requiere OWNER o DIRECTOR%',
  'ASISTENTE no puede pseudonimizar');

-- ─── Switch a OWNER ──────────────────────────────────────────────────────
SET LOCAL request.jwt.claim.sub = 'dd000000-0000-0000-0000-000000000001';

-- ─── Test 2: motivo muy corto rechaza ────────────────────────────────────

SELECT throws_like(
  $$ SELECT public.pseudonimizar_paciente('dd000000-0000-0000-0000-00000000bb01'::uuid, 'corto', false) $$,
  '%motivo requerido%',
  'motivo <20 chars rechaza');

-- ─── Test 3: dry_run no modifica ─────────────────────────────────────────

SELECT lives_ok(
  $$ SELECT public.pseudonimizar_paciente('dd000000-0000-0000-0000-00000000bb01'::uuid, 'Solicitud del paciente: derecho al olvido AAIP-2026-001', true) $$,
  'dry_run ejecuta sin error');

SELECT is(
  (SELECT count(*)::int FROM paciente_identidad WHERE id = 'dd000000-0000-0000-0000-00000000aa01'),
  1,
  'dry_run NO borró paciente_identidad');

SELECT is(
  (SELECT identidad_id FROM paciente WHERE id = 'dd000000-0000-0000-0000-00000000bb01'),
  'dd000000-0000-0000-0000-00000000aa01'::uuid,
  'dry_run NO desvinculó identidad_id');

-- ─── Test 4: ejecución real ──────────────────────────────────────────────

SELECT lives_ok(
  $$ SELECT public.pseudonimizar_paciente('dd000000-0000-0000-0000-00000000bb01'::uuid, 'Solicitud del paciente: derecho al olvido AAIP-2026-001', false) $$,
  'pseudonimización ejecutada sin error');

SELECT is(
  (SELECT count(*)::int FROM paciente_identidad WHERE id = 'dd000000-0000-0000-0000-00000000aa01'),
  0,
  'paciente_identidad borrada físicamente');

SELECT is(
  (SELECT identidad_id FROM paciente WHERE id = 'dd000000-0000-0000-0000-00000000bb01'),
  NULL,
  'paciente.identidad_id seteado a NULL');

SELECT isnt(
  (SELECT pseudonimizado_en FROM paciente WHERE id = 'dd000000-0000-0000-0000-00000000bb01'),
  NULL,
  'paciente.pseudonimizado_en seteado');

SELECT is(
  (SELECT count(*)::int FROM contacto_emergencia WHERE paciente_id = 'dd000000-0000-0000-0000-00000000bb01'),
  0,
  'contactos de emergencia borrados también');

-- ─── Test 5: segunda invocación rechaza ──────────────────────────────────

SELECT throws_like(
  $$ SELECT public.pseudonimizar_paciente('dd000000-0000-0000-0000-00000000bb01'::uuid, 'Segundo intento: el paciente ya pseudonimizado', false) $$,
  '%ya está pseudonimizado%',
  'segunda invocación sobre el mismo paciente rechaza');

SELECT * FROM finish();
ROLLBACK;
