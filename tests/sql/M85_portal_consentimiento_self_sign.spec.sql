-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M85 spec · firma de consentimiento por el paciente (portal · P6) 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- Prueba, CORRIENDO COMO EL ROL `authenticated` con auth.uid() = una cuenta de
-- paciente (no superuser — la RLS con FORCE no aplica a superusers), la policy
-- consentimiento_insert_portal (M85):
--
--   POSITIVA (el paciente firma lo SUYO):
--     P1. X inserta un consentimiento sobre SU ficha (paciente_owns) en la MISMA org.
--
--   NEGATIVAS (la frontera):
--     N1. X NO inserta un consentimiento sobre la ficha de Y (otro paciente).
--     N2. X NO inserta un consentimiento con org distinta a la de su ficha
--         (EXISTS paciente.organization_id = consentimiento.organization_id falla).
--     N3. X NO puede insertar YA revocado (revocado_en/motivo deben ser NULL).
--     N4. X NO puede UPDATE (revocar) un consentimiento (sin policy de UPDATE portal).
--
--   REGRESIÓN CLÍNICA:
--     C1. El clínico OWNER de A sigue insertando consentimientos de su org (M07),
--         y el paciente sigue LEYENDO el suyo (M71) — las policies conviven (OR).
--
-- Mecánica CI (pgtap.yml): specs corren como postgres sobre vanilla postgres:16;
-- auth.uid() stubeado a NULL. Fixtures como superuser → override de auth.uid() →
-- GRANTs mínimos a `authenticated` → SET ROLE authenticated. paciente_owns() (M71),
-- user_org_ids()/can_read_clinical() (M01) son SECURITY DEFINER ⇒ funcionan bajo el
-- rol bajado. Restaura auth.uid() a NULL al final.
--
-- NOTA: las policies de storage.objects de M85 NO se ejercen acá (el runner del CI
-- no es dueño de storage.objects y las salta; la cobertura del binario es E2E). Este
-- spec cubre consentimiento_insert_portal, que es la frontera de la fila.
--
-- UUIDs fijos (prefijo 85…):
--   Org A = …0a1   Org B = …0b1
--   auth X = …0a2 · cuenta X = …0c2     auth Y = …0a3 · cuenta Y = …0c3
--   auth clínico A = …0aa · member A = …0a5
--   pac X en A (linkeado a X) = …0d1 · identidad …0e1
--   pac Y en A (linkeado a Y) = …0d3 · identidad …0e3
--   plantilla global = …0e6
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Fixtures (superuser → bypass RLS) ──────────────────────────────────────
DO $$
BEGIN
  DELETE FROM consentimiento WHERE id IN (
    '85850000-0000-4000-8000-000000000091',
    '85850000-0000-4000-8000-000000000092',
    '85850000-0000-4000-8000-000000000093'
  );

  INSERT INTO auth.users (id, email) VALUES
    ('85850000-0000-4000-8000-0000000000a2', 'm85-pac-x@spec.test'),
    ('85850000-0000-4000-8000-0000000000a3', 'm85-pac-y@spec.test'),
    ('85850000-0000-4000-8000-0000000000aa', 'm85-clin-a@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization (id, slug, nombre, tipo) VALUES
    ('85850000-0000-4000-8000-0000000000a1', 'm85-org-a', 'M85 Org A', 'INDEPENDIENTE'),
    ('85850000-0000-4000-8000-0000000000b1', 'm85-org-b', 'M85 Org B', 'INDEPENDIENTE')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente_cuenta (id, auth_user_id, email) VALUES
    ('85850000-0000-4000-8000-0000000000c2', '85850000-0000-4000-8000-0000000000a2', 'm85-pac-x@spec.test'),
    ('85850000-0000-4000-8000-0000000000c3', '85850000-0000-4000-8000-0000000000a3', 'm85-pac-y@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version) VALUES
    ('85850000-0000-4000-8000-0000000000aa', 'm85-clin-a@spec.test', now(), 'v1')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at) VALUES
    ('85850000-0000-4000-8000-0000000000a5', '85850000-0000-4000-8000-0000000000a1',
     '85850000-0000-4000-8000-0000000000aa', 'OWNER', true, now())
  ON CONFLICT (id) DO NOTHING;

  -- Plantilla global de consentimiento (texto > 100 chars).
  INSERT INTO plantilla_consentimiento (id, organization_id, tipo, texto_markdown) VALUES
    ('85850000-0000-4000-8000-0000000000e6', NULL, 'GENERAL',
     repeat('Consentimiento informado de prueba para el spec M85 del portal del paciente. ', 3))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente_identidad
    (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash, nombre_hash) VALUES
    ('85850000-0000-4000-8000-0000000000e1', '85850000-0000-4000-8000-0000000000a1',
     '\x01'::bytea, '\x02'::bytea, '\x03'::bytea, repeat('1', 64), repeat('a', 64)),
    ('85850000-0000-4000-8000-0000000000e3', '85850000-0000-4000-8000-0000000000a1',
     '\x04'::bytea, '\x05'::bytea, '\x06'::bytea, repeat('2', 64), repeat('b', 64))
  ON CONFLICT (id) DO NOTHING;

  -- Pacientes: X en A (linkeado a X), Y en A (linkeado a Y).
  INSERT INTO paciente (id, organization_id, identidad_id, cuenta_id) VALUES
    ('85850000-0000-4000-8000-0000000000d1', '85850000-0000-4000-8000-0000000000a1',
     '85850000-0000-4000-8000-0000000000e1', '85850000-0000-4000-8000-0000000000c2'),
    ('85850000-0000-4000-8000-0000000000d3', '85850000-0000-4000-8000-0000000000a1',
     '85850000-0000-4000-8000-0000000000e3', '85850000-0000-4000-8000-0000000000c3')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'M85 spec · fixtures listos';
END $$;

-- ─── Grants mínimos para ejercer RLS como `authenticated` ───────────────────
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON consentimiento TO authenticated;
GRANT SELECT ON paciente, plantilla_consentimiento TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- COMO PACIENTE X (auth.uid() = cuenta X)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT '85850000-0000-4000-8000-0000000000a2'::uuid $$;

SET ROLE authenticated;

-- ── P1. X inserta un consentimiento sobre SU ficha en la MISMA org → OK ──────
DO $$
DECLARE v int;
BEGIN
  INSERT INTO consentimiento
    (id, organization_id, paciente_id, plantilla_id, tipo, firma_storage_path) VALUES
    ('85850000-0000-4000-8000-000000000091',
     '85850000-0000-4000-8000-0000000000a1',
     '85850000-0000-4000-8000-0000000000d1',
     '85850000-0000-4000-8000-0000000000e6', 'GENERAL',
     'consentimientos-firmados/85850000-0000-4000-8000-0000000000a1/85850000-0000-4000-8000-0000000000d1/firma.png');
  SELECT count(*) INTO v FROM consentimiento WHERE id = '85850000-0000-4000-8000-000000000091';
  IF v <> 1 THEN RAISE EXCEPTION 'M85 FAIL P1: X no pudo firmar su propio consentimiento (count=%)', v; END IF;
  RAISE NOTICE 'M85 spec · P1 OK: X firma su propio consentimiento';
END $$;

-- ── N1. X NO inserta sobre la ficha de Y ─────────────────────────────────────
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO consentimiento
      (id, organization_id, paciente_id, plantilla_id, tipo, firma_storage_path) VALUES
      ('85850000-0000-4000-8000-000000000092',
       '85850000-0000-4000-8000-0000000000a1',
       '85850000-0000-4000-8000-0000000000d3',   -- ficha de Y
       '85850000-0000-4000-8000-0000000000e6', 'GENERAL',
       'consentimientos-firmados/85850000-0000-4000-8000-0000000000a1/85850000-0000-4000-8000-0000000000d3/firma.png');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_blocked := true;  -- RLS lo rechaza (WITH CHECK / privilege)
  END;
  IF NOT v_blocked THEN
    -- Si no lanzó, verificar que igual NO se insertó (algunas rutas devuelven 0 filas).
    IF EXISTS (SELECT 1 FROM consentimiento WHERE id = '85850000-0000-4000-8000-000000000092') THEN
      RAISE EXCEPTION 'M85 FAIL N1: X insertó un consentimiento sobre la ficha de Y';
    END IF;
  END IF;
  RAISE NOTICE 'M85 spec · N1 OK: X no puede firmar por la ficha de Y';
END $$;

-- ── N2. X NO inserta con org distinta a la de su ficha ──────────────────────
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO consentimiento
      (id, organization_id, paciente_id, plantilla_id, tipo, firma_storage_path) VALUES
      ('85850000-0000-4000-8000-000000000093',
       '85850000-0000-4000-8000-0000000000b1',   -- org B, pero la ficha d1 es de A
       '85850000-0000-4000-8000-0000000000d1',
       '85850000-0000-4000-8000-0000000000e6', 'GENERAL',
       'consentimientos-firmados/85850000-0000-4000-8000-0000000000b1/85850000-0000-4000-8000-0000000000d1/firma.png');
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    IF EXISTS (SELECT 1 FROM consentimiento WHERE id = '85850000-0000-4000-8000-000000000093') THEN
      RAISE EXCEPTION 'M85 FAIL N2: X insertó un consentimiento con org distinta a su ficha';
    END IF;
  END IF;
  RAISE NOTICE 'M85 spec · N2 OK: X no puede firmar con org distinta a su ficha';
END $$;

-- ── N3. X NO puede insertar YA revocado ──────────────────────────────────────
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO consentimiento
      (id, organization_id, paciente_id, plantilla_id, tipo, firma_storage_path, revocado_en, revocado_motivo) VALUES
      ('85850000-0000-4000-8000-000000000094',
       '85850000-0000-4000-8000-0000000000a1',
       '85850000-0000-4000-8000-0000000000d1',
       '85850000-0000-4000-8000-0000000000e6', 'GENERAL',
       'consentimientos-firmados/85850000-0000-4000-8000-0000000000a1/85850000-0000-4000-8000-0000000000d1/firma2.png',
       now(), 'nace revocado (prohibido)');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    IF EXISTS (SELECT 1 FROM consentimiento WHERE id = '85850000-0000-4000-8000-000000000094') THEN
      RAISE EXCEPTION 'M85 FAIL N3: X insertó un consentimiento ya revocado';
    END IF;
  END IF;
  RAISE NOTICE 'M85 spec · N3 OK: X no puede firmar un consentimiento naciendo revocado';
END $$;

-- ── N4. X NO puede UPDATE (revocar) un consentimiento ────────────────────────
-- Sin policy de UPDATE para el paciente ⇒ el UPDATE afecta 0 filas o lanza privilege.
DO $$
DECLARE v_updated int;
BEGIN
  BEGIN
    UPDATE consentimiento
       SET revocado_en = now(), revocado_motivo = 'intento del paciente'
     WHERE id = '85850000-0000-4000-8000-000000000091';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    v_updated := 0;
  END;
  IF v_updated <> 0 THEN
    RAISE EXCEPTION 'M85 FAIL N4: el paciente actualizó % consentimiento(s) (no debe revocar por RLS)', v_updated;
  END IF;
  RAISE NOTICE 'M85 spec · N4 OK: el paciente no puede revocar por el portal';
END $$;

RESET ROLE;

-- Sanity superuser: P1 se insertó y sigue vigente (el 0-update de N4 fue RLS).
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM consentimiento
   WHERE id = '85850000-0000-4000-8000-000000000091' AND revocado_en IS NULL;
  IF v <> 1 THEN
    RAISE EXCEPTION 'M85 FAIL: el consentimiento de X no quedó vigente tras N4 (count=%)', v;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- REGRESIÓN CLÍNICA: el clínico sigue insertando (M07) y el paciente sigue leyendo.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT '85850000-0000-4000-8000-0000000000aa'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int;
BEGIN
  INSERT INTO consentimiento
    (id, organization_id, paciente_id, plantilla_id, tipo, firma_storage_path) VALUES
    ('85850000-0000-4000-8000-000000000095',
     '85850000-0000-4000-8000-0000000000a1',
     '85850000-0000-4000-8000-0000000000d3',   -- clínico firma por la ficha de Y (M07)
     '85850000-0000-4000-8000-0000000000e6', 'GENERAL',
     'consentimientos-firmados/85850000-0000-4000-8000-0000000000a1/85850000-0000-4000-8000-0000000000d3/clin.png');
  SELECT count(*) INTO v FROM consentimiento WHERE id = '85850000-0000-4000-8000-000000000095';
  IF v <> 1 THEN RAISE EXCEPTION 'M85 FAIL C1: el clínico no pudo insertar consentimiento (M07 roto?, count=%)', v; END IF;
  RAISE NOTICE 'M85 spec · C1 OK: el clínico sigue firmando (M07 intacto)';
END $$;

RESET ROLE;

-- El paciente X sigue LEYENDO su consentimiento (M71) tras agregar la policy de INSERT.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT '85850000-0000-4000-8000-0000000000a2'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM consentimiento WHERE id = '85850000-0000-4000-8000-000000000091';
  IF v <> 1 THEN RAISE EXCEPTION 'M85 FAIL C1: X no lee su propio consentimiento (M71 roto?, count=%)', v; END IF;
  -- Y NO lee el de Y (frontera M71 intacta).
  SELECT count(*) INTO v FROM consentimiento WHERE id = '85850000-0000-4000-8000-000000000095';
  IF v <> 0 THEN RAISE EXCEPTION 'M85 FAIL C1: X leyó el consentimiento de Y (frontera M71 rota)'; END IF;
  RAISE NOTICE 'M85 spec · C1 OK: la lectura del paciente (M71) sigue intacta';
END $$;

RESET ROLE;

-- ─── Restaurar auth.uid() a NULL (estado de CI) para specs posteriores ───────
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

DO $$ BEGIN RAISE NOTICE 'M85 spec PASS · el paciente firma lo suyo, no lo ajeno; clínico y lectura M71 intactos'; END $$;
