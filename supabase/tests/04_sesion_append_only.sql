-- pgTAP · Folio · append-only enforcement de sesion (Ley 26.529 art. 15)
-- Verifica que:
--   - Una sesion sin locked_at se puede editar libremente
--   - Una vez locked_at IS NOT NULL, UPDATE de campos clínicos falla
--   - DELETE de sesion lockeada falla
--   - INSERT a sesion_enmienda funciona (la corrección debe ir acá)
--   - UPDATE/DELETE de sesion_enmienda falla (append-only puro)

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(8);

-- Setup minimal
INSERT INTO profile (id, email, nombre_cifrado, apellido_cifrado) VALUES
  ('ee000000-0000-0000-0000-000000000001', 'dr@x', 'D', 'R');

INSERT INTO organization (id, slug, nombre) VALUES
  ('ee000000-0000-0000-0000-0000000000aa', 'clinic-ao', 'Clinic AO');

INSERT INTO member (id, organization_id, profile_id, role, accepted_at, es_colegiado) VALUES
  ('ee000000-0000-0000-0000-0000000000a1', 'ee000000-0000-0000-0000-0000000000aa', 'ee000000-0000-0000-0000-000000000001', 'PROFESIONAL', now(), true);

INSERT INTO paciente_identidad (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash, nombre_hash)
VALUES ('ee000000-0000-0000-0000-00000000aa01', 'ee000000-0000-0000-0000-0000000000aa', 'X', 'Y', 'Z', 'h1', 'h2');

INSERT INTO paciente (id, organization_id, identidad_id, profesional_principal_id)
VALUES ('ee000000-0000-0000-0000-00000000bb01', 'ee000000-0000-0000-0000-0000000000aa', 'ee000000-0000-0000-0000-00000000aa01', 'ee000000-0000-0000-0000-0000000000a1');

INSERT INTO servicio (id, organization_id, nombre, tipo_canonico, duracion_min, precio_cents)
VALUES ('ee000000-0000-0000-0000-00000000cc01', 'ee000000-0000-0000-0000-0000000000aa', 'Seguimiento', 'SEGUIMIENTO_ESTANDAR', 45, 2200000);

INSERT INTO turno (id, organization_id, paciente_id, servicio_id, profesional_id, inicio, duracion_min, precio_cents, estado)
VALUES ('ee000000-0000-0000-0000-00000000dd01',
        'ee000000-0000-0000-0000-0000000000aa',
        'ee000000-0000-0000-0000-00000000bb01',
        'ee000000-0000-0000-0000-00000000cc01',
        'ee000000-0000-0000-0000-0000000000a1',
        now(), 45, 2200000, 'ATENDIENDO');

INSERT INTO sesion (id, organization_id, turno_id, paciente_id, soap_s_cifrado, vertebras_json)
VALUES ('ee000000-0000-0000-0000-00000000ee01',
        'ee000000-0000-0000-0000-0000000000aa',
        'ee000000-0000-0000-0000-00000000dd01',
        'ee000000-0000-0000-0000-00000000bb01',
        decode('AB', 'hex'), '[]'::jsonb);

-- ─── Test 1: editar antes del lock funciona ──────────────────────────────

SELECT lives_ok(
  $$ UPDATE sesion SET soap_s_cifrado = decode('CD', 'hex')
     WHERE id = 'ee000000-0000-0000-0000-00000000ee01' $$,
  'UPDATE de sesion sin lock funciona');

-- ─── Test 2: lockear funciona ────────────────────────────────────────────

SELECT lives_ok(
  $$ UPDATE sesion SET locked_at = now(), locked_by_id = 'ee000000-0000-0000-0000-0000000000a1'
     WHERE id = 'ee000000-0000-0000-0000-00000000ee01' $$,
  'Setear locked_at funciona');

-- ─── Test 3: UPDATE post-lock falla ──────────────────────────────────────

SELECT throws_ok(
  $$ UPDATE sesion SET soap_s_cifrado = decode('FF', 'hex')
     WHERE id = 'ee000000-0000-0000-0000-00000000ee01' $$,
  'P0001',
  NULL,
  'UPDATE de sesion lockeada lanza excepción');

-- ─── Test 4: vertebras post-lock falla ────────────────────────────────────

SELECT throws_ok(
  $$ UPDATE sesion SET vertebras_json = '[{"id":"C4","estado":"ajustada"}]'::jsonb
     WHERE id = 'ee000000-0000-0000-0000-00000000ee01' $$,
  'P0001',
  NULL,
  'UPDATE de vertebras_json post-lock falla');

-- ─── Test 5: DELETE de sesion lockeada falla ──────────────────────────────

SELECT throws_ok(
  $$ DELETE FROM sesion WHERE id = 'ee000000-0000-0000-0000-00000000ee01' $$,
  'P0001',
  NULL,
  'DELETE de sesion lockeada lanza excepción');

-- ─── Test 6: INSERT a sesion_enmienda funciona (la forma correcta de corregir) ──

SELECT lives_ok(
  $$ INSERT INTO sesion_enmienda
     (organization_id, sesion_id, autor_id, motivo, texto_correccion_cifrado)
     VALUES ('ee000000-0000-0000-0000-0000000000aa',
             'ee000000-0000-0000-0000-00000000ee01',
             'ee000000-0000-0000-0000-0000000000a1',
             'Corrección de transcripción: C4 → C5 en mapa vertebral',
             decode('AABBCC', 'hex')) $$,
  'INSERT a sesion_enmienda funciona');

-- ─── Test 7: UPDATE a sesion_enmienda falla (append-only puro) ───────────

SELECT throws_ok(
  $$ UPDATE sesion_enmienda SET motivo = 'cambio'
     WHERE sesion_id = 'ee000000-0000-0000-0000-00000000ee01' $$,
  'P0001',
  'sesion_enmienda es append-only (no UPDATE)',
  'UPDATE de sesion_enmienda lanza excepción');

-- ─── Test 8: DELETE a sesion_enmienda falla ──────────────────────────────

SELECT throws_ok(
  $$ DELETE FROM sesion_enmienda WHERE sesion_id = 'ee000000-0000-0000-0000-00000000ee01' $$,
  'P0001',
  'sesion_enmienda es append-only (no DELETE)',
  'DELETE de sesion_enmienda lanza excepción');

SELECT * FROM finish();
ROLLBACK;
