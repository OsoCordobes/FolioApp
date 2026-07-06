-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M87 spec · resolución de claims por el clínico (P9) 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- Prueba la FRONTERA ANTI-IMPERSONACIÓN de resolver_paciente_claim. La función es
-- SECURITY DEFINER y decide la autorización adentro (can_read_clinical por auth.uid()),
-- así que la LLAMAMOS bajo `SET ROLE authenticated` con auth.uid() overrideado al
-- profile del actor de cada caso — así se ejerce el gate de verdad. Las
-- VERIFICACIONES de efecto (estado del claim, cuenta_id de la ficha) se leen como
-- SUPERUSER (RESET ROLE): la unidad bajo prueba es la FUNCIÓN, no la RLS de lectura;
-- leer la verdad de fondo sin RLS evita falsos negativos (p. ej. en los casos donde
-- el actor no-autorizado no vería la fila igual).
--
--   POSITIVAS:
--     P1. Clínico de A aprueba un claim PENDIENTE de una ficha SIN cuenta → setea
--         paciente.cuenta_id, claim 'aprobado', link_seteado=true.
--     P2. Clínico de A rechaza un claim PENDIENTE → claim 'rechazado', ficha intacta.
--
--   NEGATIVAS (la frontera):
--     N1. ANTI-IMPERSONACIÓN: aprobar un claim cuya ficha YA está linkeada a OTRA
--         cuenta → raise 23505; cuenta_id NO cambia; el claim sigue 'pendiente'.
--     N2. ANTI-IDOR: un clínico de OTRA org (B) NO puede resolver un claim de A →
--         raise 42501; el claim sigue 'pendiente'.
--     N3. ROL: un ASISTENTE de A (no can_read_clinical) NO puede resolver → raise
--         42501; el claim sigue 'pendiente'.
--     N4. CAS: re-resolver un claim ya 'aprobado' → raise (no doble-efecto).
--
-- UUIDs fijos (bloque …87x):
--   Org A = …8701   Org B = …8702
--   clínico A (OWNER)   = …870a · member = …8705
--   asistente A         = …870b · member = …8706
--   clínico B (OWNER)   = …870c · member = …8707
--   cuenta 1 = …87c1   cuenta 2 = …87c2   cuenta 9 (ya-linkeada) = …87c9
--   pac libre en A       = …87d1 (identidad …87e1)   claim = …87f1
--   pac ya-linkeado en A = …87d2 (identidad …87e2)   claim = …87f2
--   pac para rechazo A   = …87d3 (identidad …87e3)   claim = …87f3
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Fixtures (superuser → bypass RLS) ──────────────────────────────────────
DO $$
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('a1870000-0000-4000-8000-00000000870a', 'm87-clin-a@spec.test'),
    ('a1870000-0000-4000-8000-00000000870b', 'm87-asis-a@spec.test'),
    ('a1870000-0000-4000-8000-00000000870c', 'm87-clin-b@spec.test'),
    ('a1870000-0000-4000-8000-0000000087a1', 'm87-cuenta-1@spec.test'),
    ('a1870000-0000-4000-8000-0000000087a2', 'm87-cuenta-2@spec.test'),
    ('a1870000-0000-4000-8000-0000000087a9', 'm87-cuenta-9@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization (id, slug, nombre, tipo) VALUES
    ('a1870000-0000-4000-8000-000000008701', 'm87-org-a', 'M87 Org A', 'INDEPENDIENTE'),
    ('a1870000-0000-4000-8000-000000008702', 'm87-org-b', 'M87 Org B', 'INDEPENDIENTE')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version) VALUES
    ('a1870000-0000-4000-8000-00000000870a', 'm87-clin-a@spec.test', now(), 'v1'),
    ('a1870000-0000-4000-8000-00000000870b', 'm87-asis-a@spec.test', now(), 'v1'),
    ('a1870000-0000-4000-8000-00000000870c', 'm87-clin-b@spec.test', now(), 'v1')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at) VALUES
    ('a1870000-0000-4000-8000-000000008705', 'a1870000-0000-4000-8000-000000008701',
     'a1870000-0000-4000-8000-00000000870a', 'OWNER', true, now()),
    ('a1870000-0000-4000-8000-000000008706', 'a1870000-0000-4000-8000-000000008701',
     'a1870000-0000-4000-8000-00000000870b', 'ASISTENTE', false, now()),
    ('a1870000-0000-4000-8000-000000008707', 'a1870000-0000-4000-8000-000000008702',
     'a1870000-0000-4000-8000-00000000870c', 'OWNER', true, now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente_cuenta (id, auth_user_id, email, email_verificado_en) VALUES
    ('c1870000-0000-4000-8000-0000000087c1', 'a1870000-0000-4000-8000-0000000087a1', 'm87-cuenta-1@spec.test', now()),
    ('c1870000-0000-4000-8000-0000000087c2', 'a1870000-0000-4000-8000-0000000087a2', 'm87-cuenta-2@spec.test', now()),
    ('c1870000-0000-4000-8000-0000000087c9', 'a1870000-0000-4000-8000-0000000087a9', 'm87-cuenta-9@spec.test', now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente_identidad (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado) VALUES
    ('e1870000-0000-4000-8000-0000000087e1', 'a1870000-0000-4000-8000-000000008701', '\x01'::bytea, '\x01'::bytea, '\x01'::bytea),
    ('e1870000-0000-4000-8000-0000000087e2', 'a1870000-0000-4000-8000-000000008701', '\x02'::bytea, '\x02'::bytea, '\x02'::bytea),
    ('e1870000-0000-4000-8000-0000000087e3', 'a1870000-0000-4000-8000-000000008701', '\x03'::bytea, '\x03'::bytea, '\x03'::bytea)
  ON CONFLICT (id) DO NOTHING;

  -- d1 SIN cuenta (P1), d2 YA linkeado a cuenta 9 (N1), d3 SIN cuenta (P2 rechazo).
  INSERT INTO paciente (id, organization_id, identidad_id, cuenta_id) VALUES
    ('d1870000-0000-4000-8000-0000000087d1', 'a1870000-0000-4000-8000-000000008701',
     'e1870000-0000-4000-8000-0000000087e1', NULL),
    ('d1870000-0000-4000-8000-0000000087d2', 'a1870000-0000-4000-8000-000000008701',
     'e1870000-0000-4000-8000-0000000087e2', 'c1870000-0000-4000-8000-0000000087c9'),
    ('d1870000-0000-4000-8000-0000000087d3', 'a1870000-0000-4000-8000-000000008701',
     'e1870000-0000-4000-8000-0000000087e3', NULL)
  ON CONFLICT (id) DO NOTHING;

  -- Claims pendientes.
  INSERT INTO paciente_claim (id, organization_id, paciente_cuenta_id, paciente_id, estado) VALUES
    ('f1870000-0000-4000-8000-0000000087f1', 'a1870000-0000-4000-8000-000000008701',
     'c1870000-0000-4000-8000-0000000087c1', 'd1870000-0000-4000-8000-0000000087d1', 'pendiente'),
    ('f1870000-0000-4000-8000-0000000087f2', 'a1870000-0000-4000-8000-000000008701',
     'c1870000-0000-4000-8000-0000000087c1', 'd1870000-0000-4000-8000-0000000087d2', 'pendiente'),
    ('f1870000-0000-4000-8000-0000000087f3', 'a1870000-0000-4000-8000-000000008701',
     'c1870000-0000-4000-8000-0000000087c2', 'd1870000-0000-4000-8000-0000000087d3', 'pendiente')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'M87 spec · fixtures listos';
END $$;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolver_paciente_claim(uuid, boolean) TO authenticated;

-- Helper de aserción: lee la verdad de fondo (superuser) y compara. Definido como
-- superuser para no depender de RLS de lectura.
-- (Se implementa inline por bloque para mantener el spec autocontenido.)

-- ════════════════════════════════════════════════════════════════════════════
-- P1. CLÍNICO A aprueba un claim de ficha libre.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1870000-0000-4000-8000-00000000870a'::uuid $$;

DO $$
DECLARE v_res jsonb;
BEGIN
  SET LOCAL ROLE authenticated;
  v_res := public.resolver_paciente_claim('f1870000-0000-4000-8000-0000000087f1', true);
  RESET ROLE;
  IF (v_res->>'estado') <> 'aprobado' THEN
    RAISE EXCEPTION 'M87 FAIL P1: la función no devolvió aprobado (res=%)', v_res;
  END IF;
  IF (v_res->>'link_seteado')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'M87 FAIL P1: link_seteado debió ser true (res=%)', v_res;
  END IF;
END $$;

DO $$
DECLARE v_estado text; v_cuenta uuid;
BEGIN
  SELECT estado INTO v_estado FROM paciente_claim WHERE id = 'f1870000-0000-4000-8000-0000000087f1';
  SELECT cuenta_id INTO v_cuenta FROM paciente WHERE id = 'd1870000-0000-4000-8000-0000000087d1';
  IF v_estado <> 'aprobado' THEN
    RAISE EXCEPTION 'M87 FAIL P1: claim no quedó aprobado (estado=%)', v_estado;
  END IF;
  IF v_cuenta <> 'c1870000-0000-4000-8000-0000000087c1' THEN
    RAISE EXCEPTION 'M87 FAIL P1: la ficha no quedó linkeada a la cuenta reclamante (cuenta=%)', v_cuenta;
  END IF;
  RAISE NOTICE 'M87 spec · P1 OK: aprobar ficha libre linkea + marca aprobado';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- N1. ANTI-IMPERSONACIÓN: aprobar ficha YA linkeada a otra cuenta → raise 23505.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.resolver_paciente_claim('f1870000-0000-4000-8000-0000000087f2', true);
  EXCEPTION WHEN unique_violation THEN
    v_blocked := true;  -- 23505 esperado
  END;
  RESET ROLE;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M87 FAIL N1: se aprobó un claim sobre una ficha ya linkeada a otra cuenta (impersonación)';
  END IF;
END $$;

DO $$
DECLARE v_estado text; v_cuenta uuid;
BEGIN
  SELECT estado INTO v_estado FROM paciente_claim WHERE id = 'f1870000-0000-4000-8000-0000000087f2';
  SELECT cuenta_id INTO v_cuenta FROM paciente WHERE id = 'd1870000-0000-4000-8000-0000000087d2';
  IF v_cuenta <> 'c1870000-0000-4000-8000-0000000087c9' THEN
    RAISE EXCEPTION 'M87 FAIL N1: la ficha se re-asignó (cuenta=% ≠ cuenta original)', v_cuenta;
  END IF;
  IF v_estado <> 'pendiente' THEN
    RAISE EXCEPTION 'M87 FAIL N1: el claim conflictivo no debió resolverse (estado=%)', v_estado;
  END IF;
  RAISE NOTICE 'M87 spec · N1 OK: no se re-asigna una ficha ya vinculada a otra cuenta';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- P2. CLÍNICO A rechaza un claim de ficha libre → 'rechazado', ficha intacta.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_res jsonb;
BEGIN
  SET LOCAL ROLE authenticated;
  v_res := public.resolver_paciente_claim('f1870000-0000-4000-8000-0000000087f3', false);
  RESET ROLE;
  IF (v_res->>'estado') <> 'rechazado' THEN
    RAISE EXCEPTION 'M87 FAIL P2: la función no devolvió rechazado (res=%)', v_res;
  END IF;
END $$;

DO $$
DECLARE v_estado text; v_cuenta uuid;
BEGIN
  SELECT estado INTO v_estado FROM paciente_claim WHERE id = 'f1870000-0000-4000-8000-0000000087f3';
  SELECT cuenta_id INTO v_cuenta FROM paciente WHERE id = 'd1870000-0000-4000-8000-0000000087d3';
  IF v_estado <> 'rechazado' THEN
    RAISE EXCEPTION 'M87 FAIL P2: claim no quedó rechazado (estado=%)', v_estado;
  END IF;
  IF v_cuenta IS NOT NULL THEN
    RAISE EXCEPTION 'M87 FAIL P2: rechazar NO debe linkear la ficha (cuenta=%)', v_cuenta;
  END IF;
  RAISE NOTICE 'M87 spec · P2 OK: rechazar cierra el claim sin tocar la ficha';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- N4. CAS: re-resolver un claim ya aprobado (f1) → raise.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.resolver_paciente_claim('f1870000-0000-4000-8000-0000000087f1', false);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;  -- P0001: 'el claim ya fue resuelto'
  END;
  RESET ROLE;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M87 FAIL N4: se re-resolvió un claim ya aprobado (doble-efecto)';
  END IF;
  RAISE NOTICE 'M87 spec · N4 OK: no se re-resuelve un claim ya resuelto (CAS)';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- N3. ASISTENTE A (no can_read_clinical) NO puede resolver → raise 42501.
-- Reusa f2 (sigue 'pendiente'). El gate de rol frena ANTES del conflicto.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1870000-0000-4000-8000-00000000870b'::uuid $$;

DO $$
DECLARE v_blocked boolean := false;
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.resolver_paciente_claim('f1870000-0000-4000-8000-0000000087f2', false);
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;  -- 42501 (gate de rol)
  END;
  RESET ROLE;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M87 FAIL N3: un ASISTENTE resolvió un claim (sin acceso clínico)';
  END IF;
END $$;

DO $$
DECLARE v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM paciente_claim WHERE id = 'f1870000-0000-4000-8000-0000000087f2';
  IF v_estado <> 'pendiente' THEN
    RAISE EXCEPTION 'M87 FAIL N3: el claim cambió de estado con un ASISTENTE (estado=%)', v_estado;
  END IF;
  RAISE NOTICE 'M87 spec · N3 OK: el ASISTENTE no puede resolver (gate de rol)';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- N2. ANTI-IDOR: clínico de OTRA org (B) NO puede resolver un claim de A → 42501.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1870000-0000-4000-8000-00000000870c'::uuid $$;

DO $$
DECLARE v_blocked boolean := false;
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.resolver_paciente_claim('f1870000-0000-4000-8000-0000000087f2', false);
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;  -- 42501: can_read_clinical(A) = false para un member de B
  END;
  RESET ROLE;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M87 FAIL N2: un clínico de B resolvió un claim de A (IDOR cross-org)';
  END IF;
END $$;

DO $$
DECLARE v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM paciente_claim WHERE id = 'f1870000-0000-4000-8000-0000000087f2';
  IF v_estado <> 'pendiente' THEN
    RAISE EXCEPTION 'M87 FAIL N2: el claim de A cambió con un clínico de B (estado=%)', v_estado;
  END IF;
  RAISE NOTICE 'M87 spec · N2 OK: un clínico de otra org no puede resolver (anti-IDOR)';
END $$;

-- ─── Restaurar auth.uid() a NULL (estado de CI) ─────────────────────────────
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

DO $$ BEGIN RAISE NOTICE 'M87 spec PASS · resolución de claims verificada (aprobar/rechazar + anti-impersonación + anti-IDOR + gate de rol + CAS)'; END $$;
