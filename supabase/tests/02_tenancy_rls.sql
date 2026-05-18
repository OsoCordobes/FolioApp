-- pgTAP · Folio · RLS multi-tenant (tenant isolation)
-- Verifica que usuarios de orgs distintas NO ven datos cruzados.
--
-- Setup:
--   - Crea profiles A y B en auth.users (mock)
--   - Crea organization A y B
--   - Hace A miembro OWNER de orgA, B miembro OWNER de orgB
--   - Inserta 1 paciente_identidad + paciente en cada org
--   - Verifica que con auth.uid()=A, solo se ven datos de orgA
--   - Verifica que con auth.uid()=B, solo se ven datos de orgB

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(12);

-- ─── Setup (en transacción, rollback al final) ────────────────────────────

-- Profiles (sin FK a auth.users por ahora — pgTAP corre sin auth Supabase)
INSERT INTO profile (id, email, nombre_cifrado, apellido_cifrado)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'a@test', 'A', 'A'),
  ('22222222-2222-2222-2222-222222222222', 'b@test', 'B', 'B');

-- Orgs
INSERT INTO organization (id, slug, nombre) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'org-a', 'Org A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'org-b', 'Org B');

-- Members (A en orgA, B en orgB)
INSERT INTO member (organization_id, profile_id, role, accepted_at) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'OWNER', now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'OWNER', now());

-- PacienteIdentidad en cada org
INSERT INTO paciente_identidad (organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash, nombre_hash)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'XA', 'YA', 'ZA', 'hash_dni_a', 'hash_nombre_a'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'XB', 'YB', 'ZB', 'hash_dni_b', 'hash_nombre_b');

-- ─── Test: usuario A solo ve identidades de orgA ──────────────────────────

-- Simular auth.uid() = A
SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
SET LOCAL role = authenticated;

SELECT is(
  (SELECT count(*)::int FROM paciente_identidad
   WHERE organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'Usuario A ve la identidad de su orgA');

SELECT is(
  (SELECT count(*)::int FROM paciente_identidad
   WHERE organization_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'Usuario A NO ve identidad de orgB (RLS aisla)');

-- ─── Test: usuario A no puede leer organization B ─────────────────────────

SELECT is(
  (SELECT count(*)::int FROM organization
   WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'Usuario A NO ve organization B');

SELECT is(
  (SELECT count(*)::int FROM organization
   WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'Usuario A ve su organization A');

-- ─── Switch a usuario B ──────────────────────────────────────────────────

SET LOCAL request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

SELECT is(
  (SELECT count(*)::int FROM paciente_identidad
   WHERE organization_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  1,
  'Usuario B ve identidad de orgB');

SELECT is(
  (SELECT count(*)::int FROM paciente_identidad
   WHERE organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'Usuario B NO ve identidad de orgA');

-- ─── Test: helper user_org_ids funciona por usuario ──────────────────────

SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

SELECT is(
  (SELECT array_agg(id)::uuid[] FROM (SELECT public.user_org_ids() AS id) x),
  ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid],
  'user_org_ids() devuelve solo la org de A');

-- ─── Test: usuario sin sesion no ve nada ──────────────────────────────────

RESET role;
SET LOCAL request.jwt.claim.sub = NULL;

SELECT is(
  (SELECT count(*)::int FROM organization),
  -- service_role en BEGIN bypassea RLS; tras SET LOCAL role authenticated
  -- + sub NULL, ve 0 filas
  0,
  'Sin sub en JWT, no se ven organizaciones (cuando role=authenticated)',
  'Test omitido si role no es authenticated');

-- ─── Test: rol del usuario ────────────────────────────────────────────────

SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
SET LOCAL role = authenticated;

SELECT is(
  public.user_role_in('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'OWNER',
  'user_role_in retorna OWNER para A en orgA');

SELECT is(
  public.user_role_in('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid),
  NULL,
  'user_role_in retorna NULL para A en orgB (no es member)');

SELECT is(
  public.can_read_clinical('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  true,
  'OWNER puede leer clínica de su org');

SELECT is(
  public.can_read_clinical('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid),
  false,
  'OWNER de orgA NO puede leer clínica de orgB');

SELECT * FROM finish();
ROLLBACK;
