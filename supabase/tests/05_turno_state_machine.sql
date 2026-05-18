-- pgTAP · Folio · state machine de turno
-- Verifica que las transiciones válidas funcionan y las inválidas lanzan.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(8);

-- Setup
INSERT INTO profile (id, email, nombre_cifrado, apellido_cifrado) VALUES
  ('cc000000-0000-0000-0000-000000000001', 'p@x', 'P', 'R');
INSERT INTO organization (id, slug, nombre) VALUES
  ('cc000000-0000-0000-0000-0000000000aa', 'org-sm', 'Org SM');
INSERT INTO member (id, organization_id, profile_id, role, accepted_at) VALUES
  ('cc000000-0000-0000-0000-0000000000a1', 'cc000000-0000-0000-0000-0000000000aa', 'cc000000-0000-0000-0000-000000000001', 'PROFESIONAL', now());

INSERT INTO paciente_identidad (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash, nombre_hash)
VALUES ('cc000000-0000-0000-0000-00000000aa01', 'cc000000-0000-0000-0000-0000000000aa', 'X', 'Y', 'Z', 'h1', 'h2');

INSERT INTO paciente (id, organization_id, identidad_id, profesional_principal_id)
VALUES ('cc000000-0000-0000-0000-00000000bb01', 'cc000000-0000-0000-0000-0000000000aa', 'cc000000-0000-0000-0000-00000000aa01', 'cc000000-0000-0000-0000-0000000000a1');

INSERT INTO servicio (id, organization_id, nombre, tipo_canonico, duracion_min, precio_cents)
VALUES ('cc000000-0000-0000-0000-00000000cc01', 'cc000000-0000-0000-0000-0000000000aa', 'X', 'SEGUIMIENTO_ESTANDAR', 45, 1000);

INSERT INTO turno (id, organization_id, paciente_id, servicio_id, profesional_id, inicio, duracion_min, precio_cents, estado)
VALUES ('cc000000-0000-0000-0000-00000000dd01',
        'cc000000-0000-0000-0000-0000000000aa',
        'cc000000-0000-0000-0000-00000000bb01',
        'cc000000-0000-0000-0000-00000000cc01',
        'cc000000-0000-0000-0000-0000000000a1',
        now(), 45, 1000, 'AGENDADO');

-- ─── Transiciones válidas ────────────────────────────────────────────────

SELECT lives_ok(
  $$ UPDATE turno SET estado = 'CONFIRMADO'
     WHERE id = 'cc000000-0000-0000-0000-00000000dd01' $$,
  'AGENDADO → CONFIRMADO');

SELECT lives_ok(
  $$ UPDATE turno SET estado = 'EN_SALA'
     WHERE id = 'cc000000-0000-0000-0000-00000000dd01' $$,
  'CONFIRMADO → EN_SALA');

SELECT lives_ok(
  $$ UPDATE turno SET estado = 'ATENDIENDO', atendiendo_desde = now()
     WHERE id = 'cc000000-0000-0000-0000-00000000dd01' $$,
  'EN_SALA → ATENDIENDO');

SELECT lives_ok(
  $$ UPDATE turno SET estado = 'CERRADO', duracion_real_min = 42
     WHERE id = 'cc000000-0000-0000-0000-00000000dd01' $$,
  'ATENDIENDO → CERRADO');

-- ─── Transición invalida: CERRADO → algo ─────────────────────────────────

SELECT throws_ok(
  $$ UPDATE turno SET estado = 'CONFIRMADO'
     WHERE id = 'cc000000-0000-0000-0000-00000000dd01' $$,
  'P0001',
  NULL,
  'CERRADO → CONFIRMADO falla');

-- ─── Transición invalida: AGENDADO → CERRADO (saltea estados) ────────────

INSERT INTO turno (id, organization_id, paciente_id, servicio_id, profesional_id, inicio, duracion_min, precio_cents, estado)
VALUES ('cc000000-0000-0000-0000-00000000dd02',
        'cc000000-0000-0000-0000-0000000000aa',
        'cc000000-0000-0000-0000-00000000bb01',
        'cc000000-0000-0000-0000-00000000cc01',
        'cc000000-0000-0000-0000-0000000000a1',
        now() + interval '1 hour', 45, 1000, 'AGENDADO');

SELECT throws_ok(
  $$ UPDATE turno SET estado = 'CERRADO'
     WHERE id = 'cc000000-0000-0000-0000-00000000dd02' $$,
  'P0001',
  NULL,
  'AGENDADO → CERRADO (skip) falla');

-- ─── Transición válida: AGENDADO → CANCELADO ─────────────────────────────

SELECT lives_ok(
  $$ UPDATE turno SET estado = 'CANCELADO'
     WHERE id = 'cc000000-0000-0000-0000-00000000dd02' $$,
  'AGENDADO → CANCELADO');

-- ─── Verificar log de transiciones generado ──────────────────────────────

SELECT cmp_ok(
  (SELECT count(*)::int FROM transicion
   WHERE turno_id = 'cc000000-0000-0000-0000-00000000dd01'),
  '>=', 4,
  'turno dd01 tiene >=4 transiciones logueadas');

SELECT * FROM finish();
ROLLBACK;
