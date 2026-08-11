-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M95 spec · el UPDATE clínico exige poder VER al paciente 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- Regresión que esto guarda:
--
-- El SELECT de `diagnostico`/`alergia`/`medicacion`/`documento_clinico` exige
-- `EXISTS (SELECT 1 FROM paciente p WHERE p.id = <tabla>.paciente_id)` — que es
-- lo único que hace jugar la RLS de `paciente` (asignación M32 + caja fuerte
-- M03/M31). El UPDATE hermano no lo tenía: se conformaba con
-- `organization_id IN user_org_ids() AND can_read_clinical(org)`.
--
-- O sea que la escritura era de ORGANIZACIÓN ENTERA. Un
--     PATCH /rest/v1/alergia?organization_id=eq.<org>   {"activa": false}
-- desactivaba las alergias de TODOS los pacientes de la clínica, incluidas las
-- de fichas que el usuario no puede ni abrir — y con eso se apaga la bandera de
-- alergia severa de /hoy.
--
--   NEGATIVAS (lo que M95 cierra) — PROF-2 es PROFESIONAL de la org pero no está
--   asignado al paciente ni lo atendió nunca, así que la ficha le es invisible:
--     N1..N4. UPDATE masivo por organization_id sobre las 4 tablas → 0 filas.
--             (Antes de M95 tocaba 1 fila en cada una.)
--     N5.     PROF-1 (que SÍ ve la ficha) no puede auto-asignarse la caja fuerte.
--
--   POSITIVAS (lo que no se puede romper al cerrar):
--     P1..P4. PROF-1, el profesional principal del paciente, sigue editando las
--             4 tablas.
--     P5.     El OWNER sigue editando.
--     P6.     El OWNER sí puede mover la caja fuerte.
--
-- Mecánica CI: fixtures como superuser (bypass RLS) → se redefine auth.uid() y
-- se hace SET ROLE authenticated para ejercer las policies de verdad, con los
-- GRANT mínimos que en prod Supabase da por default y el CI vanilla no (sin
-- ellos las negativas darían 0 filas por falta de privilegio: falso verde).
-- Mismo patrón que M84/M85/M91/M92. auth.uid() vuelve a NULL al final.
--
-- UUIDs fijos: Org A = …951 · Org B = …952
--   auth OWNER A = …95a · PROF-1 = …95b · PROF-2 = …95c
--   member OWNER = …95a1 · PROF-1 = …95b1 · PROF-2 = …95c1
--   paciente = …95d1
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('a1950000-0000-4000-8000-00000000095a', 'm95-owner-a@spec.test'),
    ('a1950000-0000-4000-8000-00000000095b', 'm95-prof1-a@spec.test'),
    ('a1950000-0000-4000-8000-00000000095c', 'm95-prof2-a@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization (id, slug, nombre) VALUES
    ('a1950000-0000-4000-8000-000000000951', 'm95-org-a', 'M95 Org A')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version) VALUES
    ('a1950000-0000-4000-8000-00000000095a', 'm95-owner-a@spec.test', now(), 'v1'),
    ('a1950000-0000-4000-8000-00000000095b', 'm95-prof1-a@spec.test', now(), 'v1'),
    ('a1950000-0000-4000-8000-00000000095c', 'm95-prof2-a@spec.test', now(), 'v1')
  ON CONFLICT (id) DO NOTHING;

  -- Los tres pasan can_read_clinical() (OWNER y PROFESIONAL lo satisfacen): la
  -- frontera que se testea NO es el gate clínico, es la visibilidad del paciente.
  INSERT INTO member (id, organization_id, profile_id, role, accepted_at) VALUES
    ('b1950000-0000-4000-8000-0000000095a1', 'a1950000-0000-4000-8000-000000000951',
     'a1950000-0000-4000-8000-00000000095a', 'OWNER', now()),
    ('b1950000-0000-4000-8000-0000000095b1', 'a1950000-0000-4000-8000-000000000951',
     'a1950000-0000-4000-8000-00000000095b', 'PROFESIONAL', now()),
    ('b1950000-0000-4000-8000-0000000095c1', 'a1950000-0000-4000-8000-000000000951',
     'a1950000-0000-4000-8000-00000000095c', 'PROFESIONAL', now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente_identidad
    (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado) VALUES
    ('e1950000-0000-4000-8000-0000000095e1', 'a1950000-0000-4000-8000-000000000951',
     '\x01'::bytea, '\x02'::bytea, '\x03'::bytea)
  ON CONFLICT (id) DO NOTHING;

  -- Paciente de PROF-1. PROF-2 no es su profesional principal y no tiene ningún
  -- turno EN_SALA/ATENDIENDO/CERRADO con él ⇒ profesional_attended_paciente()
  -- da false ⇒ paciente_select_clinical no se lo muestra.
  INSERT INTO paciente (id, organization_id, identidad_id, profesional_principal_id) VALUES
    ('d1950000-0000-4000-8000-0000000095d1', 'a1950000-0000-4000-8000-000000000951',
     'e1950000-0000-4000-8000-0000000095e1', 'b1950000-0000-4000-8000-0000000095b1')
  ON CONFLICT (id) DO NOTHING;

  -- Una fila en cada una de las cuatro tablas del hallazgo.
  INSERT INTO diagnostico
    (id, organization_id, paciente_id, descripcion_cifrado, fecha_inicio, creado_por_id, estado) VALUES
    ('01950000-0000-4000-8000-0000000095d1', 'a1950000-0000-4000-8000-000000000951',
     'd1950000-0000-4000-8000-0000000095d1', '\x01'::bytea, current_date,
     'b1950000-0000-4000-8000-0000000095b1', 'ACTIVO')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO alergia
    (id, organization_id, paciente_id, sustancia_cifrado, severidad, activa) VALUES
    ('02950000-0000-4000-8000-0000000095d1', 'a1950000-0000-4000-8000-000000000951',
     'd1950000-0000-4000-8000-0000000095d1', '\x01'::bytea, 'ANAFILAXIA', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO medicacion
    (id, organization_id, paciente_id, principio_activo_cifrado, dosis) VALUES
    ('03950000-0000-4000-8000-0000000095d1', 'a1950000-0000-4000-8000-000000000951',
     'd1950000-0000-4000-8000-0000000095d1', '\x01'::bytea, '10mg')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO documento_clinico
    (id, organization_id, paciente_id, tipo, storage_path, mime_type, tamanio_bytes, subido_por_id) VALUES
    ('04950000-0000-4000-8000-0000000095d1', 'a1950000-0000-4000-8000-000000000951',
     'd1950000-0000-4000-8000-0000000095d1', 'RADIOGRAFIA',
     -- CHECK documento_path_format: storage_path SÍ lleva el prefijo del bucket.
     -- (En storage.objects.name NO va: la app lo strippea antes de llamar a
     -- storage.from() — ver lib/db/documentos.ts:293.)
     'documentos-clinicos/a1950000-0000-4000-8000-000000000951/d1950000-0000-4000-8000-0000000095d1/rx.jpg',
     'image/jpeg', 1024, 'b1950000-0000-4000-8000-0000000095b1')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'M95 spec · fixtures listos';
END $$;

-- ─── Grants mínimos para ejercer RLS como `authenticated` ───────────────────
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, UPDATE ON diagnostico       TO authenticated;
GRANT SELECT, UPDATE ON alergia           TO authenticated;
GRANT SELECT, UPDATE ON medicacion        TO authenticated;
GRANT SELECT, UPDATE ON documento_clinico TO authenticated;
GRANT SELECT, UPDATE ON paciente          TO authenticated;
GRANT SELECT ON member                    TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PROF-2: PROFESIONAL de la org que NO puede ver la ficha.
-- Los UPDATE van filtrados SÓLO por organization_id — el shape exacto del
-- ataque (PATCH /rest/v1/<tabla>?organization_id=eq.<org>).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1950000-0000-4000-8000-00000000095c'::uuid $$;

SET ROLE authenticated;

-- Premisa del spec: si PROF-2 pudiera ver la ficha, las negativas de abajo
-- pasarían por el motivo equivocado.
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM paciente WHERE id = 'd1950000-0000-4000-8000-0000000095d1';
  IF v <> 0 THEN
    RAISE EXCEPTION 'M95 SETUP FAIL: PROF-2 ve la ficha del paciente (filas=%) — el spec no probaría nada', v;
  END IF;
END $$;

DO $$
DECLARE v int;
BEGIN
  UPDATE diagnostico SET estado = 'RESUELTO'
   WHERE organization_id = 'a1950000-0000-4000-8000-000000000951';
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M95 FAIL N1: PROF-2 editó % diagnostico(s) de un paciente que no puede ver', v;
  END IF;
  RAISE NOTICE 'M95 spec · N1 OK: diagnostico protegido del UPDATE masivo por org';
END $$;

DO $$
DECLARE v int;
BEGIN
  -- El caso del hallazgo: apagar la alergia ANAFILAXIA de toda la clínica.
  UPDATE alergia SET activa = false
   WHERE organization_id = 'a1950000-0000-4000-8000-000000000951';
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M95 FAIL N2: PROF-2 desactivó % alergia(s) a ciegas', v;
  END IF;
  RAISE NOTICE 'M95 spec · N2 OK: alergia protegida del UPDATE masivo por org';
END $$;

DO $$
DECLARE v int;
BEGIN
  UPDATE medicacion SET dosis = '999mg'
   WHERE organization_id = 'a1950000-0000-4000-8000-000000000951';
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M95 FAIL N3: PROF-2 editó % medicacion(es) ajena(s)', v;
  END IF;
  RAISE NOTICE 'M95 spec · N3 OK: medicacion protegida del UPDATE masivo por org';
END $$;

DO $$
DECLARE v int;
BEGIN
  UPDATE documento_clinico SET deleted_at = now()
   WHERE organization_id = 'a1950000-0000-4000-8000-000000000951';
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M95 FAIL N4: PROF-2 archivó % documento(s) ajeno(s)', v;
  END IF;
  RAISE NOTICE 'M95 spec · N4 OK: documento_clinico protegido del UPDATE masivo por org';
END $$;

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- PROF-1: el profesional principal. Todo lo legítimo sigue funcionando.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1950000-0000-4000-8000-00000000095b'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int; v_total int := 0;
BEGIN
  UPDATE diagnostico SET estado = 'CRONICO'
   WHERE id = '01950000-0000-4000-8000-0000000095d1';
  GET DIAGNOSTICS v = ROW_COUNT; v_total := v_total + v;
  UPDATE alergia SET activa = true
   WHERE id = '02950000-0000-4000-8000-0000000095d1';
  GET DIAGNOSTICS v = ROW_COUNT; v_total := v_total + v;
  UPDATE medicacion SET dosis = '20mg'
   WHERE id = '03950000-0000-4000-8000-0000000095d1';
  GET DIAGNOSTICS v = ROW_COUNT; v_total := v_total + v;
  UPDATE documento_clinico SET fecha_estudio = current_date
   WHERE id = '04950000-0000-4000-8000-0000000095d1';
  GET DIAGNOSTICS v = ROW_COUNT; v_total := v_total + v;

  IF v_total <> 4 THEN
    RAISE EXCEPTION 'M95 FAIL P1-P4: el profesional del paciente perdió acceso de escritura (filas=%/4)', v_total;
  END IF;
  RAISE NOTICE 'M95 spec · P1-P4 OK: el profesional asignado sigue editando las 4 tablas';
END $$;

-- ── N5. PROF-1 ve la ficha, pero no puede auto-asignarse la caja fuerte ──────
DO $$
DECLARE v_caught boolean := false; v_state text; v_msg text;
BEGIN
  BEGIN
    UPDATE paciente SET caja_fuerte_profesional = 'b1950000-0000-4000-8000-0000000095b1'
     WHERE id = 'd1950000-0000-4000-8000-0000000095d1';
  EXCEPTION WHEN others THEN
    v_caught := true; v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'M95 FAIL N5: un PROFESIONAL se auto-asignó la caja fuerte y dejó al OWNER afuera';
  END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'M95 FAIL N5: rechazado con SQLSTATE % (esperado 42501): %', v_state, v_msg;
  END IF;
  -- El mensaje importa: 'permission denied for schema auth' también es 42501 y
  -- haría pasar este caso sin que el guard hubiera intervenido (pasó de verdad).
  IF v_msg NOT LIKE '%caja fuerte%' THEN
    RAISE EXCEPTION 'M95 FAIL N5: rechazado por el motivo equivocado (no fue el guard): %', v_msg;
  END IF;
  RAISE NOTICE 'M95 spec · N5 OK: la caja fuerte no se la puede poner el propio profesional';
END $$;

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- OWNER: sigue pudiendo todo, incluida la caja fuerte.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1950000-0000-4000-8000-00000000095a'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int;
BEGIN
  UPDATE alergia SET activa = true
   WHERE organization_id = 'a1950000-0000-4000-8000-000000000951';
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v <> 1 THEN
    RAISE EXCEPTION 'M95 FAIL P5: el OWNER perdió la escritura clínica (filas=%)', v;
  END IF;
  RAISE NOTICE 'M95 spec · P5 OK: el OWNER sigue editando la ficha de su clínica';
END $$;

DO $$
DECLARE v int;
BEGIN
  UPDATE paciente SET caja_fuerte_profesional = 'b1950000-0000-4000-8000-0000000095b1'
   WHERE id = 'd1950000-0000-4000-8000-0000000095d1';
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v <> 1 THEN
    RAISE EXCEPTION 'M95 FAIL P6: el OWNER no pudo poner la caja fuerte (filas=%)', v;
  END IF;
  RAISE NOTICE 'M95 spec · P6 OK: el OWNER sí administra la caja fuerte';
END $$;

RESET ROLE;

-- ─── Restaurar auth.uid() a NULL (estado de CI) ─────────────────────────────
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

DO $$ BEGIN RAISE NOTICE 'M95 spec PASS · el UPDATE clínico ya no alcanza a pacientes invisibles, y la caja fuerte la mueve sólo un admin'; END $$;
