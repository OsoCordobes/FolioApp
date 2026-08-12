-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M96 spec · nota_clinica: la ficha como papel 📝
-- ════════════════════════════════════════════════════════════════════════════
-- `nota_clinica` es una anotación fechada, atribuida y cifrada, colgada del
-- PACIENTE y no de un turno: la llamada telefónica, el WhatsApp, lo que el
-- profesional recuerda al día siguiente.
--
-- Lo que este spec fija:
--
--   P1. PROF-1 (profesional del paciente) inserta su nota.
--   P2. PROF-2, otro clínico de la MISMA org que también ve la ficha, la lee.
--       La ficha es del paciente, no del profesional — como la carpeta de papel
--       que está en el consultorio.
--   P3. El INSERT deja audit_log (Ley 26.529 art. 18).
--   N1. APPEND-ONLY como `authenticated`: UPDATE y DELETE afectan 0 filas.
--   N2. APPEND-ONLY como SUPERUSER (que bypassa RLS): los triggers levantan
--       42501. Es el segundo candado — cubre service_role y cualquier función
--       SECURITY DEFINER futura que se olvide de la regla.
--   N3. Un clínico de OTRA organización no lee ni inserta.
--   N4. autor_id ajeno → rechazado (la autoría no se declara, se deriva).
--   N5. ASISTENTE: ni lee ni inserta (no pasa can_read_clinical).
--   N6. Caja fuerte: el profesional que no ve la ficha tampoco ve sus notas —
--       el EXISTS encadena la RLS de `paciente` en vez de repetir la regla.
--
-- Mecánica CI: fixtures como superuser → auth.uid() redefinido + SET ROLE
-- authenticated para ejercer las policies, con los GRANT mínimos que en prod da
-- Supabase por default y el CI vanilla no. Mismo patrón que M92/M95.
--
-- UUIDs: Org A = …961 · Org B = …962
--   auth PROF-1 = …96a · PROF-2 = …96b · ASISTENTE = …96c · clínico B = …96d
--   paciente abierto = …96d1 · paciente en caja fuerte de PROF-1 = …96d2
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('a1960000-0000-4000-8000-00000000096a', 'm96-prof1@spec.test'),
    ('a1960000-0000-4000-8000-00000000096b', 'm96-prof2@spec.test'),
    ('a1960000-0000-4000-8000-00000000096c', 'm96-asistente@spec.test'),
    ('a1960000-0000-4000-8000-00000000096d', 'm96-clinico-b@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization (id, slug, nombre) VALUES
    ('a1960000-0000-4000-8000-000000000961', 'm96-org-a', 'M96 Org A'),
    ('a1960000-0000-4000-8000-000000000962', 'm96-org-b', 'M96 Org B')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version) VALUES
    ('a1960000-0000-4000-8000-00000000096a', 'm96-prof1@spec.test',     now(), 'v1'),
    ('a1960000-0000-4000-8000-00000000096b', 'm96-prof2@spec.test',     now(), 'v1'),
    ('a1960000-0000-4000-8000-00000000096c', 'm96-asistente@spec.test', now(), 'v1'),
    ('a1960000-0000-4000-8000-00000000096d', 'm96-clinico-b@spec.test', now(), 'v1')
  ON CONFLICT (id) DO NOTHING;

  -- PROF-1 y PROF-2 son OWNER de A: los dos ven cualquier ficha de la org, que
  -- es justo lo que P2 tiene que demostrar. El ASISTENTE no pasa
  -- can_read_clinical(). El clínico B es OWNER de la org B.
  INSERT INTO member (id, organization_id, profile_id, role, accepted_at) VALUES
    ('b1960000-0000-4000-8000-0000000096a1', 'a1960000-0000-4000-8000-000000000961',
     'a1960000-0000-4000-8000-00000000096a', 'OWNER', now()),
    ('b1960000-0000-4000-8000-0000000096b1', 'a1960000-0000-4000-8000-000000000961',
     'a1960000-0000-4000-8000-00000000096b', 'OWNER', now()),
    ('b1960000-0000-4000-8000-0000000096c1', 'a1960000-0000-4000-8000-000000000961',
     'a1960000-0000-4000-8000-00000000096c', 'ASISTENTE', now()),
    ('b1960000-0000-4000-8000-0000000096d1', 'a1960000-0000-4000-8000-000000000962',
     'a1960000-0000-4000-8000-00000000096d', 'OWNER', now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente_identidad
    (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado) VALUES
    ('e1960000-0000-4000-8000-0000000096e1', 'a1960000-0000-4000-8000-000000000961',
     '\x01'::bytea, '\x02'::bytea, '\x03'::bytea),
    ('e1960000-0000-4000-8000-0000000096e2', 'a1960000-0000-4000-8000-000000000961',
     '\x01'::bytea, '\x02'::bytea, '\x03'::bytea)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente (id, organization_id, identidad_id, caja_fuerte_profesional) VALUES
    ('d1960000-0000-4000-8000-0000000096d1', 'a1960000-0000-4000-8000-000000000961',
     'e1960000-0000-4000-8000-0000000096e1', NULL),
    -- En la caja fuerte de PROF-1: PROF-2 no debe ver ni la ficha ni sus notas.
    ('d1960000-0000-4000-8000-0000000096d2', 'a1960000-0000-4000-8000-000000000961',
     'e1960000-0000-4000-8000-0000000096e2', 'b1960000-0000-4000-8000-0000000096a1')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'M96 spec · fixtures listos';
END $$;

-- ─── Grants mínimos para ejercer RLS como `authenticated` ───────────────────
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON nota_clinica TO authenticated;
GRANT SELECT ON paciente TO authenticated;
GRANT SELECT ON member   TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- P1 · PROF-1 anota en la ficha
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1960000-0000-4000-8000-00000000096a'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int;
BEGIN
  INSERT INTO nota_clinica (id, organization_id, paciente_id, autor_id, texto_cifrado) VALUES
    ('c1960000-0000-4000-8000-0000000096c1', 'a1960000-0000-4000-8000-000000000961',
     'd1960000-0000-4000-8000-0000000096d1', 'b1960000-0000-4000-8000-0000000096a1',
     '\xdeadbeef'::bytea);
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v <> 1 THEN
    RAISE EXCEPTION 'M96 FAIL P1: el profesional no pudo anotar en la ficha (filas=%)', v;
  END IF;
  RAISE NOTICE 'M96 spec · P1 OK: el profesional anota sin turno de por medio';
END $$;

-- La nota de la ficha en caja fuerte, para N6.
DO $$
BEGIN
  INSERT INTO nota_clinica (id, organization_id, paciente_id, autor_id, texto_cifrado) VALUES
    ('c1960000-0000-4000-8000-0000000096c2', 'a1960000-0000-4000-8000-000000000961',
     'd1960000-0000-4000-8000-0000000096d2', 'b1960000-0000-4000-8000-0000000096a1',
     '\xcafe'::bytea);
END $$;

-- ── N4. autor_id ajeno: la autoría se deriva, no se declara ──────────────────
DO $$
DECLARE v_caught boolean := false;
BEGIN
  BEGIN
    INSERT INTO nota_clinica (organization_id, paciente_id, autor_id, texto_cifrado) VALUES
      ('a1960000-0000-4000-8000-000000000961', 'd1960000-0000-4000-8000-0000000096d1',
       'b1960000-0000-4000-8000-0000000096b1', '\xbeef'::bytea);
  EXCEPTION WHEN others THEN v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M96 FAIL N4: PROF-1 firmó una nota como si fuera PROF-2';
  END IF;
  RAISE NOTICE 'M96 spec · N4 OK: no se puede firmar una nota con el member de otro';
END $$;

-- ── N1. Append-only bajo RLS: UPDATE y DELETE no tocan nada ─────────────────
DO $$
DECLARE v int;
BEGIN
  UPDATE nota_clinica SET texto_cifrado = '\x00'::bytea
   WHERE id = 'c1960000-0000-4000-8000-0000000096c1';
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M96 FAIL N1: se pudo EDITAR una nota clínica (filas=%)', v;
  END IF;

  DELETE FROM nota_clinica WHERE id = 'c1960000-0000-4000-8000-0000000096c1';
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M96 FAIL N1: se pudo BORRAR una nota clínica (filas=%)', v;
  END IF;
  RAISE NOTICE 'M96 spec · N1 OK: append-only bajo RLS (un typo se corrige con otra nota)';
END $$;

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- P2 · Otro clínico de la MISMA org lee la nota. N6 · la caja fuerte no.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1960000-0000-4000-8000-00000000096b'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM nota_clinica
   WHERE paciente_id = 'd1960000-0000-4000-8000-0000000096d1';
  IF v <> 1 THEN
    RAISE EXCEPTION 'M96 FAIL P2: el otro clínico de la org no ve la nota (filas=%) — la ficha es del paciente', v;
  END IF;
  RAISE NOTICE 'M96 spec · P2 OK: entre clínicos de la org las notas se ven';
END $$;

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM nota_clinica
   WHERE paciente_id = 'd1960000-0000-4000-8000-0000000096d2';
  IF v <> 0 THEN
    RAISE EXCEPTION 'M96 FAIL N6: se filtró la nota de un paciente en caja fuerte ajena (filas=%)', v;
  END IF;
  RAISE NOTICE 'M96 spec · N6 OK: la caja fuerte se hereda de la RLS de paciente';
END $$;

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- N5 · ASISTENTE: ni lee ni inserta
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1960000-0000-4000-8000-00000000096c'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int; v_caught boolean := false;
BEGIN
  SELECT count(*) INTO v FROM nota_clinica;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M96 FAIL N5: el ASISTENTE lee notas clínicas (filas=%)', v;
  END IF;

  BEGIN
    INSERT INTO nota_clinica (organization_id, paciente_id, autor_id, texto_cifrado) VALUES
      ('a1960000-0000-4000-8000-000000000961', 'd1960000-0000-4000-8000-0000000096d1',
       'b1960000-0000-4000-8000-0000000096c1', '\x01'::bytea);
  EXCEPTION WHEN others THEN v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M96 FAIL N5: el ASISTENTE escribió en la historia clínica';
  END IF;
  RAISE NOTICE 'M96 spec · N5 OK: el ASISTENTE no toca la historia clínica';
END $$;

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- N3 · Otra organización: aislamiento multi-tenant
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1960000-0000-4000-8000-00000000096d'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int; v_caught boolean := false;
BEGIN
  SELECT count(*) INTO v FROM nota_clinica;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M96 FAIL N3: un clínico de otra org lee notas ajenas (filas=%)', v;
  END IF;

  BEGIN
    INSERT INTO nota_clinica (organization_id, paciente_id, autor_id, texto_cifrado) VALUES
      ('a1960000-0000-4000-8000-000000000961', 'd1960000-0000-4000-8000-0000000096d1',
       'b1960000-0000-4000-8000-0000000096d1', '\x01'::bytea);
  EXCEPTION WHEN others THEN v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M96 FAIL N3: un clínico de otra org escribió en una ficha ajena';
  END IF;
  RAISE NOTICE 'M96 spec · N3 OK: aislamiento multi-tenant';
END $$;

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- P3 · el INSERT dejó audit_log · N2 · append-only también para el superuser
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM audit_log
   WHERE resource_type = 'nota_clinica'
     AND resource_id = 'c1960000-0000-4000-8000-0000000096c1';
  IF v < 1 THEN
    RAISE EXCEPTION 'M96 FAIL P3: la nota no dejó rastro en audit_log (Ley 26.529 art. 18)';
  END IF;
  RAISE NOTICE 'M96 spec · P3 OK: la nota queda auditada';
END $$;

DO $$
DECLARE v_upd boolean := false; v_del boolean := false; v_state text;
BEGIN
  -- Como superuser la RLS no aplica: acá se ejercita el SEGUNDO candado, el
  -- trigger — que es el que cubre a service_role y a cualquier función
  -- SECURITY DEFINER futura.
  BEGIN
    UPDATE nota_clinica SET texto_cifrado = '\x00'::bytea
     WHERE id = 'c1960000-0000-4000-8000-0000000096c1';
  EXCEPTION WHEN others THEN v_upd := true; v_state := SQLSTATE;
  END;
  IF NOT v_upd THEN
    RAISE EXCEPTION 'M96 FAIL N2: el superuser EDITÓ una nota clínica (el trigger no está)';
  END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'M96 FAIL N2: UPDATE rechazado con SQLSTATE % (esperado 42501)', v_state;
  END IF;

  BEGIN
    DELETE FROM nota_clinica WHERE id = 'c1960000-0000-4000-8000-0000000096c1';
  EXCEPTION WHEN others THEN v_del := true;
  END;
  IF NOT v_del THEN
    RAISE EXCEPTION 'M96 FAIL N2: el superuser BORRÓ una nota clínica';
  END IF;
  RAISE NOTICE 'M96 spec · N2 OK: append-only también contra service_role';
END $$;

-- ─── Restaurar auth.uid() a NULL (estado de CI) ─────────────────────────────
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

DO $$ BEGIN RAISE NOTICE 'M96 spec PASS · la ficha se puede anotar sin turno, y lo anotado no se reescribe'; END $$;
