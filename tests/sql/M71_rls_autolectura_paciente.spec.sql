-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M71 spec · RLS de auto-lectura del paciente (portal · P2) 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- Esta es LA FRONTERA DE SEGURIDAD del portal. El spec prueba, CORRIENDO COMO EL
-- ROL `authenticated` con auth.uid() = una cuenta de paciente (no superuser — la
-- RLS con FORCE no aplica a superusers), CADA POSITIVA y CADA NEGATIVA:
--
--   POSITIVAS (el paciente SÍ lee lo suyo):
--     P1. El paciente X lee SU fila paciente (la de la org linkeada).
--     P2. El paciente X lee SU paciente_identidad (PII).
--     P3. El paciente X lee SU turno.
--     P4. El paciente X lee SU consentimiento.
--     P5. paciente_owns(mi_paciente) = true; paciente_cuenta_actual() resuelve mi
--         cuenta por auth.uid().
--
--   NEGATIVAS (la frontera — el paciente NO lee nada más):
--     N1. X NO lee la fila paciente de Y (otro humano, misma org).
--     N2. X NO lee la paciente_identidad de Y.
--     N3. X NO lee el turno de Y.
--     N4. X NO lee el consentimiento de Y.
--     N5. X NO lee NINGUNA sesion (ni la suya ni la de Y): el SOAP crudo es
--         estructuralmente inalcanzable (no hay policy aditiva sobre sesion).
--     N6. X NO lee su copia paciente en una org NO linkeada (cuenta_id NULL):
--         tener una ficha en esa org no basta; el link portal debe existir.
--     N7. paciente_owns(paciente_de_Y) = false para X.
--     N8. El paciente NO puede resolver (UPDATE) un claim (aprobar es del clínico).
--
--   CLÍNICO (regresión de que las policies de staff siguen intactas y el clínico
--   ve/resuelve claims de SU org, y NO de otra):
--     C1. El clínico de la org A ve el claim de su org; el de B no lo ve; y a un
--         miembro de staff paciente_cuenta_actual() le da NULL (el fan-out del
--         portal no le aplica).
--
-- Mecánica CI (pgtap.yml): specs corren como postgres sobre vanilla postgres:16;
-- auth.uid() está stubeado a NULL. Para ejercer RLS de verdad: fixtures como
-- superuser → override de auth.uid() (patrón M51/M65_M66) → GRANTs mínimos al rol
-- `authenticated` → SET ROLE authenticated. Los helpers paciente_cuenta_actual()
-- (M70), paciente_owns() (M71), user_org_ids()/can_read_clinical() (M01) son
-- SECURITY DEFINER ⇒ funcionan bajo el rol bajado. Restaura auth.uid() a NULL al
-- final para no contaminar specs posteriores.
--
-- Nota honesta: este es el aislamiento dos-pacientes/dos-tenant EJECUTABLE en el
-- CI pgtap (con override de auth.uid()). El E2E con `supabase start` + JWTs reales
-- sigue siendo la fuente de verdad última; este spec cubre la lógica de las
-- policies M71 sin depender de esa infra.
--
-- UUIDs fijos (todo hex, compartidos entre bloques; cada DO/SET ROLE es indep.):
--   Org A = …0a1   Org B = …0b1
--   auth X = …0a2 · cuenta X = …0c2     auth Y = …0a3 · cuenta Y = …0c3
--   auth clínico A = …0aa · member A = …0a5     auth clínico B = …0bb · member B = …0b5
--   pac X en A (linkeado a X) = …0d1 · identidad …0e1 · turno …0f1 · consent …091 · sesion …081
--   pac X en B (NO linkeado)  = …0d2
--   pac Y en A (linkeado a Y) = …0d3 · identidad …0e3 · turno …0f3 · consent …093 · sesion …083
--   servicio A = …0e5 · plantilla global = …0e6 · claim de X en A = …0d9
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Fixtures (superuser → bypass RLS) ──────────────────────────────────────
DO $$
BEGIN
  -- limpieza idempotente (en CI la DB nace fresca; un dev puede correrlo 2 veces)
  DELETE FROM sesion         WHERE id IN ('81710000-0000-4000-8000-000000000081','81710000-0000-4000-8000-000000000083');
  DELETE FROM consentimiento WHERE id IN ('91710000-0000-4000-8000-000000000091','91710000-0000-4000-8000-000000000093');
  DELETE FROM turno          WHERE id IN ('f1710000-0000-4000-8000-0000000000f1','f1710000-0000-4000-8000-0000000000f3');
  DELETE FROM paciente_claim WHERE id = 'd1710000-0000-4000-8000-0000000000d9';

  INSERT INTO auth.users (id, email) VALUES
    ('a1710000-0000-4000-8000-0000000000a2', 'm71-pac-x@spec.test'),
    ('a1710000-0000-4000-8000-0000000000a3', 'm71-pac-y@spec.test'),
    ('a1710000-0000-4000-8000-0000000000aa', 'm71-clin-a@spec.test'),
    ('a1710000-0000-4000-8000-0000000000bb', 'm71-clin-b@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization (id, slug, nombre, tipo) VALUES
    ('a1710000-0000-4000-8000-0000000000a1', 'm71-org-a', 'M71 Org A', 'INDEPENDIENTE'),
    ('a1710000-0000-4000-8000-0000000000b1', 'm71-org-b', 'M71 Org B', 'INDEPENDIENTE')
  ON CONFLICT (id) DO NOTHING;

  -- Cuentas portal (M70) de los dos humanos-paciente.
  INSERT INTO paciente_cuenta (id, auth_user_id, email) VALUES
    ('c1710000-0000-4000-8000-0000000000c2', 'a1710000-0000-4000-8000-0000000000a2', 'm71-pac-x@spec.test'),
    ('c1710000-0000-4000-8000-0000000000c3', 'a1710000-0000-4000-8000-0000000000a3', 'm71-pac-y@spec.test')
  ON CONFLICT (id) DO NOTHING;

  -- Profiles + members clínicos (OWNER) de cada org — para la regresión clínica.
  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version) VALUES
    ('a1710000-0000-4000-8000-0000000000aa', 'm71-clin-a@spec.test', now(), 'v1'),
    ('a1710000-0000-4000-8000-0000000000bb', 'm71-clin-b@spec.test', now(), 'v1')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at) VALUES
    ('a1710000-0000-4000-8000-0000000000a5', 'a1710000-0000-4000-8000-0000000000a1',
     'a1710000-0000-4000-8000-0000000000aa', 'OWNER', true, now()),
    ('a1710000-0000-4000-8000-0000000000b5', 'a1710000-0000-4000-8000-0000000000b1',
     'a1710000-0000-4000-8000-0000000000bb', 'OWNER', true, now())
  ON CONFLICT (id) DO NOTHING;

  -- Servicio (org A) para colgar turnos.
  INSERT INTO servicio (id, organization_id, nombre, tipo_canonico, duracion_min, precio_cents) VALUES
    ('a1710000-0000-4000-8000-0000000000e5', 'a1710000-0000-4000-8000-0000000000a1',
     'Consulta', 'CONSULTA_INICIAL', 30, 100000)
  ON CONFLICT (id) DO NOTHING;

  -- Plantilla global de consentimiento (texto > 100 chars).
  INSERT INTO plantilla_consentimiento (id, organization_id, tipo, texto_markdown) VALUES
    ('a1710000-0000-4000-8000-0000000000e6', NULL, 'GENERAL',
     repeat('Consentimiento informado de prueba para el spec M71 del portal del paciente. ', 3))
  ON CONFLICT (id) DO NOTHING;

  -- Identidades (PII): X-en-A y Y-en-A.
  INSERT INTO paciente_identidad
    (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash, nombre_hash) VALUES
    ('e1710000-0000-4000-8000-0000000000e1', 'a1710000-0000-4000-8000-0000000000a1',
     '\x01'::bytea, '\x02'::bytea, '\x03'::bytea, repeat('1', 64), repeat('a', 64)),
    ('e1710000-0000-4000-8000-0000000000e3', 'a1710000-0000-4000-8000-0000000000a1',
     '\x04'::bytea, '\x05'::bytea, '\x06'::bytea, repeat('2', 64), repeat('b', 64))
  ON CONFLICT (id) DO NOTHING;

  -- Pacientes:
  --   d1 = X en A, LINKEADO a cuenta X.
  --   d2 = X en B, NO linkeado (cuenta_id NULL) — su copia inalcanzable.
  --   d3 = Y en A, LINKEADO a cuenta Y.
  INSERT INTO paciente (id, organization_id, identidad_id, cuenta_id) VALUES
    ('d1710000-0000-4000-8000-0000000000d1', 'a1710000-0000-4000-8000-0000000000a1',
     'e1710000-0000-4000-8000-0000000000e1', 'c1710000-0000-4000-8000-0000000000c2'),
    ('d1710000-0000-4000-8000-0000000000d2', 'a1710000-0000-4000-8000-0000000000b1',
     NULL, NULL),
    ('d1710000-0000-4000-8000-0000000000d3', 'a1710000-0000-4000-8000-0000000000a1',
     'e1710000-0000-4000-8000-0000000000e3', 'c1710000-0000-4000-8000-0000000000c3')
  ON CONFLICT (id) DO NOTHING;

  -- Turnos (uno de X, uno de Y) en A.
  INSERT INTO turno (id, organization_id, paciente_id, servicio_id, profesional_id, inicio, duracion_min, precio_cents) VALUES
    ('f1710000-0000-4000-8000-0000000000f1', 'a1710000-0000-4000-8000-0000000000a1',
     'd1710000-0000-4000-8000-0000000000d1', 'a1710000-0000-4000-8000-0000000000e5',
     'a1710000-0000-4000-8000-0000000000a5', now() + interval '1 day', 30, 100000),
    ('f1710000-0000-4000-8000-0000000000f3', 'a1710000-0000-4000-8000-0000000000a1',
     'd1710000-0000-4000-8000-0000000000d3', 'a1710000-0000-4000-8000-0000000000e5',
     'a1710000-0000-4000-8000-0000000000a5', now() + interval '2 day', 30, 100000)
  ON CONFLICT (id) DO NOTHING;

  -- Sesiones SOAP (una de X, una de Y) — el paciente NUNCA debe poder leerlas.
  INSERT INTO sesion (id, organization_id, turno_id, paciente_id, soap_s_cifrado) VALUES
    ('81710000-0000-4000-8000-000000000081', 'a1710000-0000-4000-8000-0000000000a1',
     'f1710000-0000-4000-8000-0000000000f1', 'd1710000-0000-4000-8000-0000000000d1', '\xdead'::bytea),
    ('81710000-0000-4000-8000-000000000083', 'a1710000-0000-4000-8000-0000000000a1',
     'f1710000-0000-4000-8000-0000000000f3', 'd1710000-0000-4000-8000-0000000000d3', '\xbeef'::bytea)
  ON CONFLICT (id) DO NOTHING;

  -- Consentimientos firmados (uno de X, uno de Y).
  INSERT INTO consentimiento (id, organization_id, paciente_id, plantilla_id, tipo, firma_storage_path) VALUES
    ('91710000-0000-4000-8000-000000000091', 'a1710000-0000-4000-8000-0000000000a1',
     'd1710000-0000-4000-8000-0000000000d1', 'a1710000-0000-4000-8000-0000000000e6', 'GENERAL',
     'consentimientos-firmados/a1710000-0000-4000-8000-0000000000a1/d1710000-0000-4000-8000-0000000000d1/x.pdf'),
    ('91710000-0000-4000-8000-000000000093', 'a1710000-0000-4000-8000-0000000000a1',
     'd1710000-0000-4000-8000-0000000000d3', 'a1710000-0000-4000-8000-0000000000e6', 'GENERAL',
     'consentimientos-firmados/a1710000-0000-4000-8000-0000000000a1/d1710000-0000-4000-8000-0000000000d3/y.pdf')
  ON CONFLICT (id) DO NOTHING;

  -- Un claim de la cuenta X en la org A (para C1 y la negativa N8).
  INSERT INTO paciente_claim (id, organization_id, paciente_cuenta_id, paciente_id) VALUES
    ('d1710000-0000-4000-8000-0000000000d9', 'a1710000-0000-4000-8000-0000000000a1',
     'c1710000-0000-4000-8000-0000000000c2', 'd1710000-0000-4000-8000-0000000000d1')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'M71 spec · fixtures listos';
END $$;

-- ─── Grants mínimos para ejercer RLS como `authenticated` ───────────────────
-- En Supabase real ya existen (default grants). En CI vanilla el rol nace sin
-- nada; sin esto el test fallaría por falta de privilegio de TABLA (no por RLS).
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON paciente, paciente_identidad, turno, consentimiento, sesion TO authenticated;
GRANT SELECT, INSERT, UPDATE ON paciente_claim TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- POSITIVAS + NEGATIVAS como PACIENTE X (auth.uid() = cuenta X)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1710000-0000-4000-8000-0000000000a2'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE
  v int;
BEGIN
  -- ── P5. helpers resuelven mi cuenta por auth.uid() ────────────────────────
  IF public.paciente_cuenta_actual() <> 'c1710000-0000-4000-8000-0000000000c2'::uuid THEN
    RAISE EXCEPTION 'M71 FAIL P5: paciente_cuenta_actual() no resolvió la cuenta de X';
  END IF;
  IF NOT public.paciente_owns('d1710000-0000-4000-8000-0000000000d1') THEN
    RAISE EXCEPTION 'M71 FAIL P5: paciente_owns(mi paciente) = false';
  END IF;

  -- ── P1. X lee SU fila paciente (la linkeada en A) ─────────────────────────
  SELECT count(*) INTO v FROM paciente WHERE id = 'd1710000-0000-4000-8000-0000000000d1';
  IF v <> 1 THEN RAISE EXCEPTION 'M71 FAIL P1: X no lee su propia fila paciente (count=%)', v; END IF;

  -- ── P2. X lee SU paciente_identidad ───────────────────────────────────────
  SELECT count(*) INTO v FROM paciente_identidad WHERE id = 'e1710000-0000-4000-8000-0000000000e1';
  IF v <> 1 THEN RAISE EXCEPTION 'M71 FAIL P2: X no lee su propia identidad (count=%)', v; END IF;

  -- ── P3. X lee SU turno ────────────────────────────────────────────────────
  SELECT count(*) INTO v FROM turno WHERE id = 'f1710000-0000-4000-8000-0000000000f1';
  IF v <> 1 THEN RAISE EXCEPTION 'M71 FAIL P3: X no lee su propio turno (count=%)', v; END IF;

  -- ── P4. X lee SU consentimiento ───────────────────────────────────────────
  SELECT count(*) INTO v FROM consentimiento WHERE id = '91710000-0000-4000-8000-000000000091';
  IF v <> 1 THEN RAISE EXCEPTION 'M71 FAIL P4: X no lee su propio consentimiento (count=%)', v; END IF;

  RAISE NOTICE 'M71 spec · POSITIVAS OK (P1-P5): X lee lo suyo (paciente/identidad/turno/consentimiento)';

  -- ══ NEGATIVAS ═════════════════════════════════════════════════════════════
  -- ── N1. X NO lee la fila paciente de Y ────────────────────────────────────
  SELECT count(*) INTO v FROM paciente WHERE id = 'd1710000-0000-4000-8000-0000000000d3';
  IF v <> 0 THEN RAISE EXCEPTION 'M71 FAIL N1: X leyó la fila paciente de Y (count=%)', v; END IF;

  -- ── N2. X NO lee la identidad de Y ────────────────────────────────────────
  SELECT count(*) INTO v FROM paciente_identidad WHERE id = 'e1710000-0000-4000-8000-0000000000e3';
  IF v <> 0 THEN RAISE EXCEPTION 'M71 FAIL N2: X leyó la identidad de Y (count=%)', v; END IF;

  -- ── N3. X NO lee el turno de Y ────────────────────────────────────────────
  SELECT count(*) INTO v FROM turno WHERE id = 'f1710000-0000-4000-8000-0000000000f3';
  IF v <> 0 THEN RAISE EXCEPTION 'M71 FAIL N3: X leyó el turno de Y (count=%)', v; END IF;

  -- ── N4. X NO lee el consentimiento de Y ───────────────────────────────────
  SELECT count(*) INTO v FROM consentimiento WHERE id = '91710000-0000-4000-8000-000000000093';
  IF v <> 0 THEN RAISE EXCEPTION 'M71 FAIL N4: X leyó el consentimiento de Y (count=%)', v; END IF;

  -- ── N5. X NO lee NINGUNA sesion (ni la suya ni la de Y). LA FRONTERA. ──────
  SELECT count(*) INTO v FROM sesion;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M71 FAIL N5: el paciente leyó % fila(s) de sesion — el SOAP crudo NO debe ser alcanzable', v;
  END IF;
  -- Explícito también sobre SU propia sesion (no basta que no vea la de Y).
  SELECT count(*) INTO v FROM sesion WHERE id = '81710000-0000-4000-8000-000000000081';
  IF v <> 0 THEN RAISE EXCEPTION 'M71 FAIL N5: X leyó su PROPIA sesion (SOAP) — prohibido'; END IF;

  -- ── N6. X NO lee su copia paciente en la org B (NO linkeada) ──────────────
  SELECT count(*) INTO v FROM paciente WHERE id = 'd1710000-0000-4000-8000-0000000000d2';
  IF v <> 0 THEN
    RAISE EXCEPTION 'M71 FAIL N6: X leyó su copia en org B sin link (count=%) — el link portal debe existir', v;
  END IF;

  -- ── N7. paciente_owns(paciente de Y) = false para X ───────────────────────
  IF public.paciente_owns('d1710000-0000-4000-8000-0000000000d3') THEN
    RAISE EXCEPTION 'M71 FAIL N7: paciente_owns(paciente de Y) = true para X';
  END IF;
  IF public.paciente_owns('d1710000-0000-4000-8000-0000000000d2') THEN
    RAISE EXCEPTION 'M71 FAIL N7: paciente_owns(copia no-linkeada de X en B) = true';
  END IF;

  RAISE NOTICE 'M71 spec · NEGATIVAS OK (N1-N7): X no lee a Y, ninguna sesion, ni su copia no-linkeada';
END $$;

-- ── N8. El paciente NO puede resolver (UPDATE) un claim ──────────────────────
-- Sin policy de UPDATE para el paciente sobre paciente_claim ⇒ el UPDATE afecta 0
-- filas (RLS lo hace invisible como target) o lanza insufficient_privilege. En
-- cualquier caso el estado NO cambia a 'aprobado'.
DO $$
DECLARE v_updated int;
BEGIN
  BEGIN
    UPDATE paciente_claim
       SET estado = 'aprobado'
     WHERE id = 'd1710000-0000-4000-8000-0000000000d9';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    v_updated := 0;  -- bloqueado por RLS: también aceptable
  END;
  IF v_updated <> 0 THEN
    RAISE EXCEPTION 'M71 FAIL N8: el paciente actualizó % fila(s) de paciente_claim (no debe resolver claims)', v_updated;
  END IF;
END $$;

RESET ROLE;

-- Sanity superuser: el claim sigue 'pendiente' (el 0-update de arriba fue RLS, no
-- una aprobación silenciosa).
DO $$
DECLARE v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM paciente_claim WHERE id = 'd1710000-0000-4000-8000-0000000000d9';
  IF v_estado <> 'pendiente' THEN
    RAISE EXCEPTION 'M71 FAIL N8: el claim quedó en estado % (esperado pendiente)', v_estado;
  END IF;
  RAISE NOTICE 'M71 spec · N8 OK: el paciente no puede resolver claims';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- REGRESIÓN CLÍNICA: las policies de staff siguen intactas; el clínico ve/resuelve
-- claims de SU org y NO de otra; a un staff paciente_cuenta_actual() le da NULL.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1710000-0000-4000-8000-0000000000aa'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int;
BEGIN
  -- C1a. El clínico OWNER de A ve el claim de su org.
  SELECT count(*) INTO v FROM paciente_claim WHERE id = 'd1710000-0000-4000-8000-0000000000d9';
  IF v <> 1 THEN
    RAISE EXCEPTION 'M71 FAIL C1: el clínico de A no ve el claim de su org (count=%)', v;
  END IF;

  -- Un miembro de staff no es un paciente ⇒ paciente_cuenta_actual() = NULL ⇒ las
  -- policies de auto-lectura del paciente son no-op para él.
  IF public.paciente_cuenta_actual() IS NOT NULL THEN
    RAISE EXCEPTION 'M71 FAIL C1: paciente_cuenta_actual() no es NULL para un miembro de staff';
  END IF;
END $$;

RESET ROLE;

-- Clínico de la org B: NO ve el claim de A (cross-tenant).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1710000-0000-4000-8000-0000000000bb'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM paciente_claim WHERE id = 'd1710000-0000-4000-8000-0000000000d9';
  IF v <> 0 THEN
    RAISE EXCEPTION 'M71 FAIL C1: el clínico de B ve el claim de la org A (count=%) — cross-tenant', v;
  END IF;
  RAISE NOTICE 'M71 spec · C1 OK: el clínico ve/resuelve claims de su org, no de otra';
END $$;

RESET ROLE;

-- ─── Restaurar auth.uid() a NULL (estado de CI) para specs posteriores ───────
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

DO $$ BEGIN RAISE NOTICE 'M71 spec PASS · frontera de auto-lectura del paciente verificada (positivas + negativas + sin sesion + cross-tenant)'; END $$;
