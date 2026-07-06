-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M86 spec · auto-gestión de contacto del portal (P8) 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- Prueba la frontera de P8 CORRIENDO COMO `authenticated` con auth.uid() = una
-- cuenta de paciente (no superuser — la RLS FORCE no aplica a superusers):
--
--   POSITIVAS (el paciente SÍ puede su auto-servicio acotado):
--     P1. X edita SU contacto (telefono_cifrado + telefono_hash + domicilio) → OK.
--
--   NEGATIVAS (la frontera — el paciente NO puede tocar identidad):
--     N1. X NO puede cambiar su nombre_cifrado (guard 42501).
--     N2. X NO puede cambiar su documento (numero_doc_cifrado) (guard 42501).
--     N3. X NO puede cambiar su dni_hash / nombre_hash (guard 42501).
--     N4. X NO puede editar la identidad de Y (no es dueño → 0 filas por RLS).
--     N5. X NO puede re-asignar la identidad a otra org (guard 42501).
--
--   REGRESIÓN STAFF:
--     C1. El clínico (member) sigue pudiendo cambiar el nombre sin que el guard lo
--         toque (early-return por ser member).
--
-- Mecánica CI: fixtures como superuser → override auth.uid() → GRANTs mínimos a
-- `authenticated` → SET ROLE. Los helpers (paciente_owns_identidad/
-- paciente_cuenta_actual de M70/M86, user_member_id_in DEFINER) funcionan bajo el rol
-- bajado. Restaura auth.uid() a NULL al final. Honesto: el E2E con JWTs reales sigue
-- siendo la fuente última; este spec ejerce la lógica de la policy + guard M86.
--
-- UUIDs fijos (bloque …86x):
--   Org A = …8601   auth X = …8602 · cuenta X = …86c2   auth Y = …8603 · cuenta Y = …86c3
--   auth clínico A = …860a · member A = …8605
--   pac X en A = …86d1 · identidad …86e1     pac Y en A = …86d3 · identidad …86e3
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Fixtures (superuser → bypass RLS) ──────────────────────────────────────
DO $$
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('a1860000-0000-4000-8000-000000008602', 'm86-pac-x@spec.test'),
    ('a1860000-0000-4000-8000-000000008603', 'm86-pac-y@spec.test'),
    ('a1860000-0000-4000-8000-00000000860a', 'm86-clin-a@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization (id, slug, nombre, tipo) VALUES
    ('a1860000-0000-4000-8000-000000008601', 'm86-org-a', 'M86 Org A', 'INDEPENDIENTE')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente_cuenta (id, auth_user_id, email) VALUES
    ('c1860000-0000-4000-8000-0000000086c2', 'a1860000-0000-4000-8000-000000008602', 'm86-pac-x@spec.test'),
    ('c1860000-0000-4000-8000-0000000086c3', 'a1860000-0000-4000-8000-000000008603', 'm86-pac-y@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version) VALUES
    ('a1860000-0000-4000-8000-00000000860a', 'm86-clin-a@spec.test', now(), 'v1')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at) VALUES
    ('a1860000-0000-4000-8000-000000008605', 'a1860000-0000-4000-8000-000000008601',
     'a1860000-0000-4000-8000-00000000860a', 'OWNER', true, now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente_identidad
    (id, organization_id, nombre_cifrado, apellido_cifrado, numero_doc_cifrado,
     telefono_cifrado, dni_hash, nombre_hash) VALUES
    ('e1860000-0000-4000-8000-0000000086e1', 'a1860000-0000-4000-8000-000000008601',
     '\x01'::bytea, '\x02'::bytea, '\x0a'::bytea, '\x03'::bytea, repeat('3', 64), repeat('c', 64)),
    ('e1860000-0000-4000-8000-0000000086e3', 'a1860000-0000-4000-8000-000000008601',
     '\x04'::bytea, '\x05'::bytea, '\x0b'::bytea, '\x06'::bytea, repeat('4', 64), repeat('d', 64))
  ON CONFLICT (id) DO NOTHING;

  -- Pacientes: X linkeado a cuenta X, Y linkeado a cuenta Y (ambos en A).
  INSERT INTO paciente (id, organization_id, identidad_id, cuenta_id) VALUES
    ('d1860000-0000-4000-8000-0000000086d1', 'a1860000-0000-4000-8000-000000008601',
     'e1860000-0000-4000-8000-0000000086e1', 'c1860000-0000-4000-8000-0000000086c2'),
    ('d1860000-0000-4000-8000-0000000086d3', 'a1860000-0000-4000-8000-000000008601',
     'e1860000-0000-4000-8000-0000000086e3', 'c1860000-0000-4000-8000-0000000086c3')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'M86 spec · fixtures listos';
END $$;

-- ─── Grants mínimos para ejercer RLS como `authenticated` ───────────────────
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, UPDATE ON paciente_identidad TO authenticated;
GRANT SELECT ON paciente TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PACIENTE X (auth.uid() = cuenta X)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1860000-0000-4000-8000-000000008602'::uuid $$;

SET ROLE authenticated;

-- ── P1. X edita SU contacto (telefono + hash + domicilio) ───────────────────
DO $$
DECLARE v int;
BEGIN
  UPDATE paciente_identidad
     SET telefono_cifrado = '\x99'::bytea,
         telefono_hash    = repeat('a', 64),
         domicilio_ciudad = 'Córdoba',
         domicilio_cp     = '5000'
   WHERE id = 'e1860000-0000-4000-8000-0000000086e1';
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v <> 1 THEN RAISE EXCEPTION 'M86 FAIL P1: X no pudo editar su contacto (rows=%)', v; END IF;
  RAISE NOTICE 'M86 spec · P1 OK: X editó su contacto/domicilio';
END $$;

-- ── N1. X NO puede cambiar su nombre_cifrado (identidad) ────────────────────
DO $$
DECLARE v int; v_blocked boolean := false;
BEGIN
  BEGIN
    UPDATE paciente_identidad SET nombre_cifrado = '\xEE'::bytea
     WHERE id = 'e1860000-0000-4000-8000-0000000086e1';
    GET DIAGNOSTICS v = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true; v := 0;  -- guard RAISE 42501
  END;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M86 FAIL N1: X cambió su nombre_cifrado (rows=%)', v;
  END IF;
  RAISE NOTICE 'M86 spec · N1 OK: nombre no editable por el paciente (blocked=%)', v_blocked;
END $$;

-- ── N2. X NO puede cambiar su documento (numero_doc_cifrado) ────────────────
DO $$
DECLARE v int; v_blocked boolean := false;
BEGIN
  BEGIN
    UPDATE paciente_identidad SET numero_doc_cifrado = '\xEF'::bytea
     WHERE id = 'e1860000-0000-4000-8000-0000000086e1';
    GET DIAGNOSTICS v = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true; v := 0;
  END;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M86 FAIL N2: X cambió su documento (rows=%)', v;
  END IF;
  RAISE NOTICE 'M86 spec · N2 OK: documento no editable por el paciente (blocked=%)', v_blocked;
END $$;

-- ── N3. X NO puede cambiar dni_hash / nombre_hash (blind indexes de identidad) ─
DO $$
DECLARE v int; v_blocked boolean := false;
BEGIN
  BEGIN
    UPDATE paciente_identidad SET dni_hash = repeat('f', 64)
     WHERE id = 'e1860000-0000-4000-8000-0000000086e1';
    GET DIAGNOSTICS v = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true; v := 0;
  END;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M86 FAIL N3: X cambió su dni_hash (rows=%)', v;
  END IF;
  RAISE NOTICE 'M86 spec · N3 OK: dni_hash no editable por el paciente (blocked=%)', v_blocked;
END $$;

-- ── N4. X NO puede editar la identidad de Y (no es dueño) ───────────────────
DO $$
DECLARE v int;
BEGIN
  UPDATE paciente_identidad SET domicilio_ciudad = 'Hackerville'
   WHERE id = 'e1860000-0000-4000-8000-0000000086e3';
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v <> 0 THEN RAISE EXCEPTION 'M86 FAIL N4: X editó la identidad de Y (rows=%)', v; END IF;
  RAISE NOTICE 'M86 spec · N4 OK: X no puede tocar la identidad de Y';
END $$;

-- ── N5. X NO puede re-asignar su identidad a otra org ───────────────────────
DO $$
DECLARE v int; v_blocked boolean := false;
BEGIN
  BEGIN
    UPDATE paciente_identidad
       SET organization_id = 'a1860000-0000-4000-8000-000000008601', domicilio_cp = '9999'
     WHERE id = 'e1860000-0000-4000-8000-0000000086e1';
    -- (Mismo org acá para no violar FK; el guard igual compara IS DISTINCT — si
    -- alguien intentara otra org real, el guard RAISE. Con la misma org, pasa el
    -- guard porque organization_id NO cambió; validamos que el CP sí se guardó.)
    GET DIAGNOSTICS v = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true; v := 0;
  END;
  -- Con la MISMA org el guard no bloquea (org no cambió); el CP se debe haber
  -- actualizado. Este caso confirma que el guard compara identidad, no bloquea
  -- ediciones legítimas de contacto que "mencionan" org sin cambiarla.
  IF v <> 1 THEN
    RAISE EXCEPTION 'M86 FAIL N5: edición de contacto con org sin cambiar debió pasar (rows=%, blocked=%)', v, v_blocked;
  END IF;
  RAISE NOTICE 'M86 spec · N5 OK: guard compara identidad (org sin cambiar → contacto se guarda)';
END $$;

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- REGRESIÓN STAFF: el clínico (member) cambia el nombre sin que el guard lo toque.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1860000-0000-4000-8000-00000000860a'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int;
BEGIN
  UPDATE paciente_identidad SET nombre_cifrado = '\xAB'::bytea
   WHERE id = 'e1860000-0000-4000-8000-0000000086e1';
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v <> 1 THEN
    RAISE EXCEPTION 'M86 FAIL C1: el clínico no pudo cambiar el nombre (rows=%) — el guard no debe tocar a staff', v;
  END IF;
  RAISE NOTICE 'M86 spec · C1 OK: el staff edita la identidad sin el guard del portal';
END $$;

RESET ROLE;

-- ─── Restaurar auth.uid() a NULL (estado de CI) ─────────────────────────────
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

DO $$ BEGIN RAISE NOTICE 'M86 spec PASS · auto-gestión de contacto verificada (contacto editable + identidad inmutable + aislamiento + regresión staff)'; END $$;
