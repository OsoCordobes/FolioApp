-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M97 spec · guardar horarios es atómico (o no pasa nada) 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- Regresión del bug que M97 cierra: `saveHorarios` reemplazaba la
-- disponibilidad semanal con un DELETE y un INSERT SUELTOS (dos requests
-- PostgREST = dos transacciones), descartando además el error del DELETE. Si el
-- INSERT fallaba, el DELETE ya estaba commiteado: la UI decía "no se guardó" y
-- la agenda pública quedaba en CERO slots, en silencio, hasta que el
-- profesional volviera a entrar a /configuracion.
--
--   ATOMICIDAD (el corazón del spec):
--     A1. Un INSERT que viola `disp_orden` levanta Y DEJA LA SEMANA VIEJA
--         INTACTA. Antes de M97 este mismo caso dejaba 0 franjas.
--
--   POSITIVAS (lo que no se puede romper al mover el write a la función):
--     P1. El PROFESIONAL reemplaza SU propia semana (self-scoping).
--     P2. El OWNER reemplaza la semana de OTRO member de su org.
--     P3. Un array vacío SIGUE borrando todo: poner la agenda en cero a
--         propósito es legítimo; lo que M97 impide es el cero ACCIDENTAL.
--
--   NEGATIVAS (los guards, espejo de la policy disp_write_self_or_admin):
--     N1. Un PROFESIONAL no escribe la agenda de OTRO member de su org.
--     N2. El staff de OTRA org no toca nada de la org A (multi-tenant).
--     N3. Un OWNER de A no puede escribirle la agenda a un member de B
--         (guard 3: el member tiene que ser de la org del parámetro).
--
-- Mecánica CI: fixtures como superuser → override de auth.uid() → GRANT mínimo
-- a `authenticated` → SET ROLE. Los conteos se hacen SIEMPRE fuera del SET ROLE
-- (como superuser) para que una negativa no dé verde por RLS de lectura en vez
-- de por el guard. Restaura auth.uid() a NULL al final. Igual que M92/M93/M95.
--
-- Sobre A1: el bloque BEGIN…EXCEPTION de plpgsql abre una SUBTRANSACCIÓN, así
-- que atrapar el error revierte todo lo que la función escribió — exactamente el
-- mismo mecanismo con el que PostgREST revierte la transacción del RPC en
-- producción. Es el modelo fiel del path real, no un atajo del test.
--
-- UUIDs fijos:
--   Org A = …971 · Org B = …972
--   auth OWNER A = …97a · auth PROF A = …97b · auth OWNER B = …97c
--   member OWNER A = …97d · member PROF A = …97e · member OWNER B = …97f
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Fixtures (superuser → bypass RLS) ──────────────────────────────────────
DO $$
BEGIN
  DELETE FROM disponibilidad_profesional
   WHERE member_id IN (
     'a1970000-0000-4000-8000-00000000097d',
     'a1970000-0000-4000-8000-00000000097e',
     'a1970000-0000-4000-8000-00000000097f'
   );

  INSERT INTO auth.users (id, email) VALUES
    ('a1970000-0000-4000-8000-00000000097a', 'm97-owner-a@spec.test'),
    ('a1970000-0000-4000-8000-00000000097b', 'm97-prof-a@spec.test'),
    ('a1970000-0000-4000-8000-00000000097c', 'm97-owner-b@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization (id, slug, nombre, tipo) VALUES
    ('a1970000-0000-4000-8000-000000000971', 'm97-org-a', 'M97 Org A', 'INDEPENDIENTE'),
    ('a1970000-0000-4000-8000-000000000972', 'm97-org-b', 'M97 Org B', 'INDEPENDIENTE')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version) VALUES
    ('a1970000-0000-4000-8000-00000000097a', 'm97-owner-a@spec.test', now(), 'v1'),
    ('a1970000-0000-4000-8000-00000000097b', 'm97-prof-a@spec.test',  now(), 'v1'),
    ('a1970000-0000-4000-8000-00000000097c', 'm97-owner-b@spec.test', now(), 'v1')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at) VALUES
    ('a1970000-0000-4000-8000-00000000097d', 'a1970000-0000-4000-8000-000000000971',
     'a1970000-0000-4000-8000-00000000097a', 'OWNER', true, now()),
    ('a1970000-0000-4000-8000-00000000097e', 'a1970000-0000-4000-8000-000000000971',
     'a1970000-0000-4000-8000-00000000097b', 'PROFESIONAL', true, now()),
    ('a1970000-0000-4000-8000-00000000097f', 'a1970000-0000-4000-8000-000000000972',
     'a1970000-0000-4000-8000-00000000097c', 'OWNER', true, now())
  ON CONFLICT (id) DO NOTHING;

  -- Semanas "viejas": las que NO se pueden perder ante un error.
  INSERT INTO disponibilidad_profesional
    (organization_id, member_id, dia_semana, hora_inicio, hora_fin) VALUES
    ('a1970000-0000-4000-8000-000000000971', 'a1970000-0000-4000-8000-00000000097d', 2, '08:00', '12:00'),
    ('a1970000-0000-4000-8000-000000000972', 'a1970000-0000-4000-8000-00000000097f', 3, '10:00', '14:00');

  RAISE NOTICE 'M97 spec · fixtures listos';
END $$;

-- ─── Grants mínimos para ejercer la función como `authenticated` ────────────
-- En prod Supabase concede USAGE sobre public a authenticated por default; el CI
-- vanilla no. El EXECUTE de la función lo concede la propia migración M97.
GRANT USAGE ON SCHEMA public TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- P1 · El PROFESIONAL reemplaza SU propia semana.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1970000-0000-4000-8000-00000000097b'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int;
BEGIN
  v := public.reemplazar_disponibilidad(
    'a1970000-0000-4000-8000-000000000971',
    'a1970000-0000-4000-8000-00000000097e',
    '[{"dia_semana": 1, "hora_inicio": "09:00", "hora_fin": "13:00"},
      {"dia_semana": 1, "hora_inicio": "15:00", "hora_fin": "19:00"},
      {"dia_semana": 3, "hora_inicio": "09:00", "hora_fin": "13:00"}]'::jsonb);
  IF v <> 3 THEN
    RAISE EXCEPTION 'M97 FAIL P1: el profesional no pudo guardar su propia semana (insertadas=%)', v;
  END IF;
  RAISE NOTICE 'M97 spec · P1 OK: el profesional guarda sus 3 franjas';
END $$;

RESET ROLE;

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM disponibilidad_profesional
   WHERE member_id = 'a1970000-0000-4000-8000-00000000097e';
  IF v <> 3 THEN
    RAISE EXCEPTION 'M97 FAIL P1: quedaron % franjas en vez de 3', v;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- A1 · EL CORAZÓN: un INSERT inválido NO deja la agenda en cero.
-- ════════════════════════════════════════════════════════════════════════════
-- La segunda franja invierte el orden (18:00 → 09:00) y viola el CHECK
-- `disp_orden` (M02). Antes de M97, el DELETE de la app ya estaba commiteado
-- cuando el INSERT explotaba: 3 franjas → 0, y la UI mostraba un error que el
-- profesional leía como "no se guardó nada".
SET ROLE authenticated;

DO $$
DECLARE v_levanto boolean := false;
BEGIN
  BEGIN
    PERFORM public.reemplazar_disponibilidad(
      'a1970000-0000-4000-8000-000000000971',
      'a1970000-0000-4000-8000-00000000097e',
      '[{"dia_semana": 2, "hora_inicio": "09:00", "hora_fin": "13:00"},
        {"dia_semana": 2, "hora_inicio": "18:00", "hora_fin": "09:00"}]'::jsonb);
  EXCEPTION WHEN check_violation THEN
    v_levanto := true;
  END;

  IF NOT v_levanto THEN
    RAISE EXCEPTION 'M97 FAIL A1: una franja invertida (18:00→09:00) NO levantó — el CHECK disp_orden dejó de aplicar';
  END IF;
  RAISE NOTICE 'M97 spec · A1 · la franja inválida levantó, como se espera';
END $$;

RESET ROLE;

DO $$
DECLARE v int; v_lun int;
BEGIN
  SELECT count(*) INTO v FROM disponibilidad_profesional
   WHERE member_id = 'a1970000-0000-4000-8000-00000000097e';
  SELECT count(*) INTO v_lun FROM disponibilidad_profesional
   WHERE member_id = 'a1970000-0000-4000-8000-00000000097e' AND dia_semana = 1;
  IF v <> 3 OR v_lun <> 2 THEN
    RAISE EXCEPTION 'M97 FAIL A1: el save fallido se llevó la semana vieja puesta (franjas=%, lunes=%) — la agenda pública queda en cero', v, v_lun;
  END IF;
  RAISE NOTICE 'M97 spec · A1 OK: el save fallido dejó las 3 franjas viejas intactas';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- N1 · Un PROFESIONAL no escribe la agenda de OTRO member de su org.
-- ════════════════════════════════════════════════════════════════════════════
SET ROLE authenticated;

DO $$
DECLARE v_denegado boolean := false;
BEGIN
  BEGIN
    PERFORM public.reemplazar_disponibilidad(
      'a1970000-0000-4000-8000-000000000971',
      'a1970000-0000-4000-8000-00000000097d',   -- el OWNER de A, no él mismo
      '[]'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN
    v_denegado := true;
  END;

  IF NOT v_denegado THEN
    RAISE EXCEPTION 'M97 FAIL N1: un PROFESIONAL reescribió la agenda de otro member de su org';
  END IF;
  RAISE NOTICE 'M97 spec · N1 OK: el self-scoping del PROFESIONAL se mantiene';
END $$;

RESET ROLE;

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM disponibilidad_profesional
   WHERE member_id = 'a1970000-0000-4000-8000-00000000097d';
  IF v <> 1 THEN
    RAISE EXCEPTION 'M97 FAIL N1: la agenda del OWNER de A quedó en % franjas (esperaba 1)', v;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- P2 · El OWNER de A SÍ reemplaza la agenda de otro member de su org.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1970000-0000-4000-8000-00000000097a'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int;
BEGIN
  v := public.reemplazar_disponibilidad(
    'a1970000-0000-4000-8000-000000000971',
    'a1970000-0000-4000-8000-00000000097e',
    '[{"dia_semana": 5, "hora_inicio": "07:00", "hora_fin": "11:00"}]'::jsonb);
  IF v <> 1 THEN
    RAISE EXCEPTION 'M97 FAIL P2: el OWNER no pudo reemplazar la agenda de su profesional (insertadas=%)', v;
  END IF;
  RAISE NOTICE 'M97 spec · P2 OK: el OWNER administra la agenda de su equipo';
END $$;

-- ── N3 · …pero NO la de un member de OTRA org (guard 3) ────────────────────
DO $$
DECLARE v_denegado boolean := false;
BEGIN
  BEGIN
    PERFORM public.reemplazar_disponibilidad(
      'a1970000-0000-4000-8000-000000000971',   -- su propia org…
      'a1970000-0000-4000-8000-00000000097f',   -- …pero un member de B
      '[]'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN
    v_denegado := true;
  END;

  IF NOT v_denegado THEN
    RAISE EXCEPTION 'M97 FAIL N3: el OWNER de A escribió sobre un member de otra org';
  END IF;
  RAISE NOTICE 'M97 spec · N3 OK: el member tiene que ser de la org del parámetro';
END $$;

RESET ROLE;

DO $$
DECLARE v_a int; v_b int;
BEGIN
  SELECT count(*) INTO v_a FROM disponibilidad_profesional
   WHERE member_id = 'a1970000-0000-4000-8000-00000000097e';
  SELECT count(*) INTO v_b FROM disponibilidad_profesional
   WHERE member_id = 'a1970000-0000-4000-8000-00000000097f';
  IF v_a <> 1 THEN
    RAISE EXCEPTION 'M97 FAIL P2: quedaron % franjas del profesional de A (esperaba 1)', v_a;
  END IF;
  IF v_b <> 1 THEN
    RAISE EXCEPTION 'M97 FAIL N3: la agenda del member de B quedó en % franjas (esperaba 1)', v_b;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- N2 · El staff de OTRA org no toca nada de la org A (multi-tenant).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1970000-0000-4000-8000-00000000097c'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v_denegado boolean := false;
BEGIN
  BEGIN
    PERFORM public.reemplazar_disponibilidad(
      'a1970000-0000-4000-8000-000000000971',
      'a1970000-0000-4000-8000-00000000097e',
      '[]'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN
    v_denegado := true;
  END;

  IF NOT v_denegado THEN
    RAISE EXCEPTION 'M97 FAIL N2: el OWNER de B borró la agenda de un profesional de A';
  END IF;
  RAISE NOTICE 'M97 spec · N2 OK: el aislamiento multi-tenant se mantiene';
END $$;

RESET ROLE;

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM disponibilidad_profesional
   WHERE member_id = 'a1970000-0000-4000-8000-00000000097e';
  IF v <> 1 THEN
    RAISE EXCEPTION 'M97 FAIL N2: la agenda del profesional de A quedó en % franjas (esperaba 1)', v;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- P3 · El cero EXPLÍCITO sigue siendo posible.
-- ════════════════════════════════════════════════════════════════════════════
-- M97 no prohíbe vaciar la agenda: prohíbe que se vacíe SOLA. Un profesional que
-- apaga todos sus días manda un array vacío y la función lo obedece.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1970000-0000-4000-8000-00000000097b'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int;
BEGIN
  v := public.reemplazar_disponibilidad(
    'a1970000-0000-4000-8000-000000000971',
    'a1970000-0000-4000-8000-00000000097e',
    '[]'::jsonb);
  IF v <> 0 THEN
    RAISE EXCEPTION 'M97 FAIL P3: vaciar la agenda devolvió % (esperaba 0)', v;
  END IF;
END $$;

RESET ROLE;

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM disponibilidad_profesional
   WHERE member_id = 'a1970000-0000-4000-8000-00000000097e';
  IF v <> 0 THEN
    RAISE EXCEPTION 'M97 FAIL P3: el array vacío dejó % franjas', v;
  END IF;
  RAISE NOTICE 'M97 spec · P3 OK: vaciar la agenda a propósito sigue funcionando';
END $$;

-- ─── Restaurar auth.uid() a NULL (estado de CI) ─────────────────────────────
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

DO $$ BEGIN RAISE NOTICE 'M97 spec PASS · el save de horarios es atómico: o entra la semana nueva, o queda la vieja'; END $$;
