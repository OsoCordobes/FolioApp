-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M92 spec · el log interno de turnos es SÓLO del staff 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- Regresión de la fuga que M71 abrió sin querer sobre DOS tablas satélite de
-- `turno` cuyas policies de SELECT no tenían predicado propio de org y
-- delegaban entero en la RLS de `turno`:
--
--   transicion_select_scoped  (M09:465)  EXISTS (SELECT 1 FROM turno t WHERE t.id = …)
--   pago_select_admin         (M09:476)  EXISTS (SELECT 1 FROM turno t WHERE t.id = …)
--
-- Mientras `turno` sólo tuvo policies de staff, ese EXISTS significaba "el staff
-- ve los satélites de los turnos que ya puede ver". M71 sumó
-- `turno_select_portal USING (paciente_owns(turno.paciente_id))` y, como las
-- policies PERMISSIVE se OR-ean, el mismo EXISTS pasó a dar true para una cuenta
-- de PORTAL sobre sus propios turnos.
--
-- Qué se filtraba (ninguna UI lo pide — es lectura no intencional vía PostgREST):
--   · transicion → actor_id (qué member del staff tocó cada estado), ts y
--     trigger_origin (con M91, además, 'paciente' vs 'manual').
--   · pago → comision_clinica_cents / liquidado_profesional_cents (el split
--     clínica↔profesional), notas internas y factura_afip_numero.
--
--   NEGATIVAS (la frontera — el paciente de portal NO lee el log interno):
--     N1. X NO lee NINGUNA fila de `transicion` de SU PROPIO turno.
--     N2. X NO lee `transicion` en general (count global = 0).
--     N3. X NO lee la fila de `pago` de SU PROPIO turno.
--     N4. Staff de OTRA org (B) no lee la `transicion` del turno de A (regresión
--         del aislamiento multi-tenant que ya existía; no debe romperse).
--
--   POSITIVAS (lo que NO se puede romper al angostar):
--     P1. X sigue leyendo SU turno (la policy de M71 queda intacta — este spec
--         verifica que angostamos los satélites, no el portal).
--     P2. El clínico de A sigue leyendo las `transicion` de su turno, con
--         actor_id poblado (el log del consultorio sigue completo).
--     P3. El clínico de A sigue leyendo el `pago` de su turno.
--
-- Mecánica CI: fixtures como superuser → override auth.uid() → GRANTs mínimos a
-- `authenticated` (en prod Supabase los concede por default; el CI vanilla no) →
-- SET ROLE. Restaura auth.uid() a NULL al final. Igual que M84/M85/M91: el E2E
-- con JWTs reales sigue siendo la fuente última; acá se ejerce la lógica de las
-- policies.
--
-- UUIDs fijos:
--   Org A = …921 · Org B = …922 · servicio A = …925
--   auth X (paciente) = …92a · cuenta X = …92c · pac X = …92d1 · identidad X = …92e1
--   auth clínico A = …92b · member A = …92d   |   auth clínico B = …92e · member B = …92f
--   turno X = …92f1 · pago X = …92b1
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Fixtures (superuser → bypass RLS) ──────────────────────────────────────
DO $$
BEGIN
  DELETE FROM turno WHERE id = 'f1920000-0000-4000-8000-0000000092f1';  -- cascadea transicion + pago

  INSERT INTO auth.users (id, email) VALUES
    ('a1920000-0000-4000-8000-00000000092a', 'm92-pac-x@spec.test'),
    ('a1920000-0000-4000-8000-00000000092b', 'm92-clin-a@spec.test'),
    ('a1920000-0000-4000-8000-00000000092e', 'm92-clin-b@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization (id, slug, nombre, tipo) VALUES
    ('a1920000-0000-4000-8000-000000000921', 'm92-org-a', 'M92 Org A', 'INDEPENDIENTE'),
    ('a1920000-0000-4000-8000-000000000922', 'm92-org-b', 'M92 Org B', 'INDEPENDIENTE')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente_cuenta (id, auth_user_id, email) VALUES
    ('c1920000-0000-4000-8000-00000000092c', 'a1920000-0000-4000-8000-00000000092a', 'm92-pac-x@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version) VALUES
    ('a1920000-0000-4000-8000-00000000092b', 'm92-clin-a@spec.test', now(), 'v1'),
    ('a1920000-0000-4000-8000-00000000092e', 'm92-clin-b@spec.test', now(), 'v1')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at) VALUES
    ('a1920000-0000-4000-8000-00000000092d', 'a1920000-0000-4000-8000-000000000921',
     'a1920000-0000-4000-8000-00000000092b', 'OWNER', true, now()),
    ('a1920000-0000-4000-8000-00000000092f', 'a1920000-0000-4000-8000-000000000922',
     'a1920000-0000-4000-8000-00000000092e', 'OWNER', true, now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO servicio (id, organization_id, nombre, tipo_canonico, duracion_min, precio_cents) VALUES
    ('a1920000-0000-4000-8000-000000000925', 'a1920000-0000-4000-8000-000000000921',
     'Consulta', 'CONSULTA_INICIAL', 30, 100000)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente_identidad
    (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash, nombre_hash) VALUES
    ('e1920000-0000-4000-8000-0000000092e1', 'a1920000-0000-4000-8000-000000000921',
     '\x01'::bytea, '\x02'::bytea, '\x03'::bytea, repeat('9', 64), repeat('e', 64))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente (id, organization_id, identidad_id, cuenta_id) VALUES
    ('d1920000-0000-4000-8000-0000000092d1', 'a1920000-0000-4000-8000-000000000921',
     'e1920000-0000-4000-8000-0000000092e1', 'c1920000-0000-4000-8000-00000000092c')
  ON CONFLICT (id) DO NOTHING;

  -- Turno de X en A. El INSERT dispara turno_transition_log → transicion #1
  -- (from NULL → AGENDADO). El UPDATE a CONFIRMADO lo hace el clínico más abajo
  -- para que la fila #2 quede con actor_id poblado — que es EXACTAMENTE el dato
  -- que no debe ver el paciente.
  INSERT INTO turno (id, organization_id, paciente_id, servicio_id, profesional_id,
                     inicio, duracion_min, precio_cents, estado) VALUES
    ('f1920000-0000-4000-8000-0000000092f1', 'a1920000-0000-4000-8000-000000000921',
     'd1920000-0000-4000-8000-0000000092d1', 'a1920000-0000-4000-8000-000000000925',
     'a1920000-0000-4000-8000-00000000092d', now() + interval '6 day', 30, 100000, 'AGENDADO');

  -- Pago con el split interno clínica↔profesional y una nota de mostrador.
  INSERT INTO pago (id, turno_id, monto_cents, metodo, estado, notas, comision_clinica_cents) VALUES
    ('b1920000-0000-4000-8000-0000000092b1', 'f1920000-0000-4000-8000-0000000092f1',
     100000, 'EFECTIVO', 'PENDIENTE', 'interno: paciente pidió factura A', 30000);

  RAISE NOTICE 'M92 spec · fixtures listos';
END $$;

-- ─── Grants mínimos para ejercer RLS como `authenticated` ───────────────────
-- En prod Supabase concede SELECT sobre todo `public` a authenticated por
-- default; el CI vanilla no. Sin estos GRANTs las negativas darían 0 filas por
-- FALTA DE PRIVILEGIO y no por la policy — un falso verde.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, UPDATE ON turno TO authenticated;
GRANT SELECT ON transicion TO authenticated;
GRANT SELECT ON pago TO authenticated;
GRANT SELECT ON paciente TO authenticated;
GRANT SELECT ON member TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- El clínico de A mueve el turno a CONFIRMADO → transicion #2 con actor_id.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1920000-0000-4000-8000-00000000092b'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int;
BEGIN
  UPDATE turno SET estado = 'CONFIRMADO'
   WHERE id = 'f1920000-0000-4000-8000-0000000092f1';
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v <> 1 THEN
    RAISE EXCEPTION 'M92 SETUP FAIL: el clínico de A no pudo confirmar su turno (rows=%)', v;
  END IF;
END $$;

-- ── P2. El staff de A lee el log completo de SU turno, con actor_id ──────────
DO $$
DECLARE v_total int; v_con_actor int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE actor_id IS NOT NULL)
    INTO v_total, v_con_actor
    FROM transicion WHERE turno_id = 'f1920000-0000-4000-8000-0000000092f1';
  IF v_total < 2 THEN
    RAISE EXCEPTION 'M92 FAIL P2: el staff perdió el log de transiciones de su turno (filas=%)', v_total;
  END IF;
  IF v_con_actor < 1 THEN
    RAISE EXCEPTION 'M92 FAIL P2: el staff no ve el actor_id de la confirmación (filas con actor=%)', v_con_actor;
  END IF;
  RAISE NOTICE 'M92 spec · P2 OK: el staff lee % transiciones (% con actor_id)', v_total, v_con_actor;
END $$;

-- ── P3. El staff de A lee el pago de su turno ───────────────────────────────
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM pago WHERE turno_id = 'f1920000-0000-4000-8000-0000000092f1';
  IF v <> 1 THEN
    RAISE EXCEPTION 'M92 FAIL P3: el staff perdió el pago de su turno (filas=%)', v;
  END IF;
  RAISE NOTICE 'M92 spec · P3 OK: el staff lee el pago de su turno';
END $$;

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- STAFF DE OTRA ORG (B): aislamiento multi-tenant (regresión).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1920000-0000-4000-8000-00000000092e'::uuid $$;

SET ROLE authenticated;

-- ── N4. El staff de B no ve NADA del turno de A ─────────────────────────────
DO $$
DECLARE v_tr int; v_pg int;
BEGIN
  SELECT count(*) INTO v_tr FROM transicion WHERE turno_id = 'f1920000-0000-4000-8000-0000000092f1';
  SELECT count(*) INTO v_pg FROM pago       WHERE turno_id = 'f1920000-0000-4000-8000-0000000092f1';
  IF v_tr <> 0 THEN
    RAISE EXCEPTION 'M92 FAIL N4: staff de B leyó transiciones de un turno de A (filas=%)', v_tr;
  END IF;
  IF v_pg <> 0 THEN
    RAISE EXCEPTION 'M92 FAIL N4: staff de B leyó el pago de un turno de A (filas=%)', v_pg;
  END IF;
  RAISE NOTICE 'M92 spec · N4 OK: el staff de otra org no ve el log ni el pago';
END $$;

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- PACIENTE X DE PORTAL (auth.uid() = cuenta X) — la frontera que M92 cierra.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1920000-0000-4000-8000-00000000092a'::uuid $$;

SET ROLE authenticated;

-- ── P1. X sigue leyendo SU turno (M71 intacto) ──────────────────────────────
-- Va primero: si esto fallara, las negativas de abajo darían verde por el motivo
-- equivocado (el paciente no ve NADA, no porque angostamos los satélites).
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM turno WHERE id = 'f1920000-0000-4000-8000-0000000092f1';
  IF v <> 1 THEN
    RAISE EXCEPTION 'M92 FAIL P1: X perdió la lectura de SU turno (filas=%) — M92 angostó de más', v;
  END IF;
  RAISE NOTICE 'M92 spec · P1 OK: X sigue viendo su turno (autolectura M71 intacta)';
END $$;

-- ── N1. X NO lee las transiciones de SU PROPIO turno ────────────────────────
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM transicion WHERE turno_id = 'f1920000-0000-4000-8000-0000000092f1';
  IF v <> 0 THEN
    RAISE EXCEPTION 'M92 FAIL N1: el paciente leyó el log interno de SU turno (filas=% — incluye actor_id del staff y trigger_origin)', v;
  END IF;
  RAISE NOTICE 'M92 spec · N1 OK: el log de transiciones es invisible para el portal';
END $$;

-- ── N2. X NO lee `transicion` en general ────────────────────────────────────
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM transicion;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M92 FAIL N2: el paciente lee % filas de transicion en total', v;
  END IF;
  RAISE NOTICE 'M92 spec · N2 OK: transicion es totalmente opaca para el portal';
END $$;

-- ── N3. X NO lee el `pago` de SU PROPIO turno ───────────────────────────────
-- El split clínica↔profesional y las notas de mostrador no son del paciente.
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM pago WHERE turno_id = 'f1920000-0000-4000-8000-0000000092f1';
  IF v <> 0 THEN
    RAISE EXCEPTION 'M92 FAIL N3: el paciente leyó el pago de SU turno (filas=% — incluye comision_clinica_cents y notas)', v;
  END IF;
  RAISE NOTICE 'M92 spec · N3 OK: el pago es invisible para el portal';
END $$;

RESET ROLE;

-- ─── Restaurar auth.uid() a NULL (estado de CI) ─────────────────────────────
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

DO $$ BEGIN RAISE NOTICE 'M92 spec PASS · transicion y pago quedaron sólo para el staff (portal ciego, staff intacto)'; END $$;
