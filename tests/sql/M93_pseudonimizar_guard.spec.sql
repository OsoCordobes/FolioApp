-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M93 spec · pseudonimizar_paciente exige actor member de la org 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- Regresión que esto guarda (borrado IRREVERSIBLE de PII/PHI):
--
-- El cuerpo vigente hasta M70 resolvía el rol con
--   SELECT role, id INTO v_actor_role, … FROM member WHERE profile_id = … AND
--          organization_id = … AND deleted_at IS NULL;
--   IF v_actor_role NOT IN ('OWNER','DIRECTOR') THEN RAISE …
-- Con CERO filas, v_actor_role queda NULL y `NULL NOT IN (…)` evalúa a NULL —
-- no a true. El IF no entra, la función sigue y ejecuta los DELETE definitivos
-- (paciente_identidad, paciente_intake_avanzado, contacto_emergencia,
-- tutor_legal, instrumento_respuesta). Como es SECURITY DEFINER con GRANT
-- EXECUTE TO authenticated, la autorización quedaba INVERTIDA: el member activo
-- con rol bajo era rechazado, pero el que NO era member pasaba.
--
--   NEGATIVAS (la frontera que M93 cierra — todas sobre el MISMO paciente, que
--   tiene que sobrevivir intacto a las cuatro):
--     N1. Ex-empleado: member de la org con deleted_at seteado → 42501.
--     N2. OWNER de OTRA organización → 42501.
--     N3. Usuario autenticado sin NINGÚN member → 42501.
--     N4. ASISTENTE activo de la org → rechazo por rol (el chequeo que ya
--         existía; M93 no lo puede haber aflojado).
--
--   POSITIVAS (lo que no se puede romper al cerrar):
--     P1. OWNER de la org: dry-run reporta lo que borraría y no muta nada.
--     P2. OWNER de la org: ejecución real borra las 5 tablas de PII/PHI,
--         desvincula la cuenta portal (M70) y graba el pseudonimizacion_event
--         con performed_by = el OWNER.
--     P3. service_role (cron /api/cron/account-purge, rama v_is_service de
--         M45/M63) sigue funcionando, con performed_by NULL.
--
-- Mecánica CI: fixtures como superuser (bypass RLS) → auth.uid() se sobrescribe
-- por una versión que lee el GUC `folio.m93_uid`, así cada bloque simula su
-- actor con set_config local (mismo truco que M63 usa para auth.role()). No
-- hace falta SET ROLE: la autorización que se ejercita vive DENTRO de la
-- función SECURITY DEFINER, no en policies. Se restaura auth.uid() al stub del
-- CI (NULL) al final. Como siempre: el E2E con `supabase start` y JWTs reales
-- sigue siendo la fuente última.
--
-- UUIDs fijos:
--   Org A = …931 · Org B = …932
--   auth OWNER A = …93a · ex-empleado A = …93b · OWNER B = …93c
--   auth huérfano = …93d · ASISTENTE A = …93e · cuenta portal = …93f
--   pac OK = …93d1 · pac GUARD = …93d2 · pac SVC = …93d3
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Fixtures (superuser → bypass RLS) ──────────────────────────────────────
DO $$
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('a1930000-0000-4000-8000-00000000093a', 'm93-owner-a@spec.test'),
    ('a1930000-0000-4000-8000-00000000093b', 'm93-ex-empleado-a@spec.test'),
    ('a1930000-0000-4000-8000-00000000093c', 'm93-owner-b@spec.test'),
    ('a1930000-0000-4000-8000-00000000093d', 'm93-huerfano@spec.test'),
    ('a1930000-0000-4000-8000-00000000093e', 'm93-asistente-a@spec.test'),
    ('a1930000-0000-4000-8000-00000000093f', 'm93-portal@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization (id, slug, nombre) VALUES
    ('a1930000-0000-4000-8000-000000000931', 'm93-org-a', 'M93 Org A'),
    ('a1930000-0000-4000-8000-000000000932', 'm93-org-b', 'M93 Org B')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version) VALUES
    ('a1930000-0000-4000-8000-00000000093a', 'm93-owner-a@spec.test',       now(), 'v1'),
    ('a1930000-0000-4000-8000-00000000093b', 'm93-ex-empleado-a@spec.test', now(), 'v1'),
    ('a1930000-0000-4000-8000-00000000093c', 'm93-owner-b@spec.test',       now(), 'v1'),
    ('a1930000-0000-4000-8000-00000000093d', 'm93-huerfano@spec.test',      now(), 'v1'),
    ('a1930000-0000-4000-8000-00000000093e', 'm93-asistente-a@spec.test',   now(), 'v1')
  ON CONFLICT (id) DO NOTHING;

  -- OWNER activo de A · ex-empleado de A (soft-deleted) · OWNER de B ·
  -- ASISTENTE activo de A. El huérfano (…93d) NO tiene member en ningún lado.
  INSERT INTO member (id, organization_id, profile_id, role, accepted_at, deleted_at) VALUES
    ('b1930000-0000-4000-8000-0000000093a1', 'a1930000-0000-4000-8000-000000000931',
     'a1930000-0000-4000-8000-00000000093a', 'OWNER',     now(), NULL),
    ('b1930000-0000-4000-8000-0000000093b1', 'a1930000-0000-4000-8000-000000000931',
     'a1930000-0000-4000-8000-00000000093b', 'OWNER',     now(), now()),
    ('b1930000-0000-4000-8000-0000000093c1', 'a1930000-0000-4000-8000-000000000932',
     'a1930000-0000-4000-8000-00000000093c', 'OWNER',     now(), NULL),
    ('b1930000-0000-4000-8000-0000000093e1', 'a1930000-0000-4000-8000-000000000931',
     'a1930000-0000-4000-8000-00000000093e', 'ASISTENTE', now(), NULL)
  ON CONFLICT (id) DO NOTHING;

  -- Cuenta de portal linkeada al paciente del camino feliz: verifica que el
  -- desvinculado de M70 (cuenta_id := NULL) sobrevivió a la copia del cuerpo.
  INSERT INTO paciente_cuenta (id, auth_user_id, email) VALUES
    ('c1930000-0000-4000-8000-0000000093c1', 'a1930000-0000-4000-8000-00000000093f',
     'm93-portal@spec.test')
  ON CONFLICT (id) DO NOTHING;

  -- 3 pacientes de la org A: uno para el camino feliz (OK), uno que tiene que
  -- sobrevivir a las 4 negativas (GUARD) y uno para el cron (SVC).
  INSERT INTO paciente_identidad
    (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash, nombre_hash) VALUES
    ('e1930000-0000-4000-8000-0000000093e1', 'a1930000-0000-4000-8000-000000000931',
     '\x01'::bytea, '\x02'::bytea, '\x03'::bytea, repeat('1', 64), repeat('a', 64)),
    ('e1930000-0000-4000-8000-0000000093e2', 'a1930000-0000-4000-8000-000000000931',
     '\x01'::bytea, '\x02'::bytea, '\x03'::bytea, repeat('2', 64), repeat('b', 64)),
    ('e1930000-0000-4000-8000-0000000093e3', 'a1930000-0000-4000-8000-000000000931',
     '\x01'::bytea, '\x02'::bytea, '\x03'::bytea, repeat('3', 64), repeat('c', 64))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente (id, organization_id, identidad_id, cuenta_id) VALUES
    ('d1930000-0000-4000-8000-0000000093d1', 'a1930000-0000-4000-8000-000000000931',
     'e1930000-0000-4000-8000-0000000093e1', 'c1930000-0000-4000-8000-0000000093c1'),
    ('d1930000-0000-4000-8000-0000000093d2', 'a1930000-0000-4000-8000-000000000931',
     'e1930000-0000-4000-8000-0000000093e2', NULL),
    ('d1930000-0000-4000-8000-0000000093d3', 'a1930000-0000-4000-8000-000000000931',
     'e1930000-0000-4000-8000-0000000093e3', NULL)
  ON CONFLICT (id) DO NOTHING;

  -- PII de terceros + PHI para los tres: es EXACTAMENTE lo que la función borra.
  INSERT INTO contacto_emergencia (organization_id, paciente_id, nombre_cifrado, telefono_cifrado, vinculo)
    SELECT 'a1930000-0000-4000-8000-000000000931', p, '\x01'::bytea, '\x02'::bytea, 'CONYUGE'
      FROM unnest(ARRAY['d1930000-0000-4000-8000-0000000093d1',
                        'd1930000-0000-4000-8000-0000000093d2',
                        'd1930000-0000-4000-8000-0000000093d3']::uuid[]) AS t(p);
  INSERT INTO tutor_legal (organization_id, paciente_id, nombre_cifrado, numero_doc_cifrado, telefono_cifrado, vinculo)
    SELECT 'a1930000-0000-4000-8000-000000000931', p, '\x01'::bytea, '\x02'::bytea, '\x03'::bytea, 'MADRE'
      FROM unnest(ARRAY['d1930000-0000-4000-8000-0000000093d1',
                        'd1930000-0000-4000-8000-0000000093d2',
                        'd1930000-0000-4000-8000-0000000093d3']::uuid[]) AS t(p);
  INSERT INTO paciente_intake_avanzado (organization_id, paciente_id, especialidad)
    SELECT 'a1930000-0000-4000-8000-000000000931', p, 'psicologia'
      FROM unnest(ARRAY['d1930000-0000-4000-8000-0000000093d1',
                        'd1930000-0000-4000-8000-0000000093d2',
                        'd1930000-0000-4000-8000-0000000093d3']::uuid[]) AS t(p);
  INSERT INTO instrumento_respuesta
    (organization_id, paciente_id, instrumento_id, instrumento_version, score_total, banda, completado_por)
    SELECT 'a1930000-0000-4000-8000-000000000931', p, 'phq9.v1', 1, 9, 'leve', 'profesional'
      FROM unnest(ARRAY['d1930000-0000-4000-8000-0000000093d1',
                        'd1930000-0000-4000-8000-0000000093d2',
                        'd1930000-0000-4000-8000-0000000093d3']::uuid[]) AS t(p);

  RAISE NOTICE 'M93 spec · fixtures listos';
END $$;

-- ─── Helper de sesión: foto de la PII/PHI de un paciente ────────────────────
-- Vive en pg_temp: muere con la sesión de psql, no contamina los specs que
-- corren después en la misma base.
CREATE FUNCTION pg_temp.m93_estado_pii(p_pac uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT format(
    'identidad=%s contactos=%s tutores=%s intake=%s instrumentos=%s pseudonimizado=%s eventos=%s',
    (SELECT count(*) FROM paciente_identidad i
      WHERE i.id = (SELECT identidad_id FROM paciente WHERE id = p_pac)),
    (SELECT count(*) FROM contacto_emergencia      WHERE paciente_id = p_pac),
    (SELECT count(*) FROM tutor_legal              WHERE paciente_id = p_pac),
    (SELECT count(*) FROM paciente_intake_avanzado WHERE paciente_id = p_pac),
    (SELECT count(*) FROM instrumento_respuesta    WHERE paciente_id = p_pac),
    -- ::text explícito: format('%s', bool) usa bool_out y rinde 't'/'f', no
    -- 'true'/'false'. El cast deja las aserciones de abajo legibles.
    (SELECT (pseudonimizado_en IS NOT NULL)::text FROM paciente WHERE id = p_pac),
    (SELECT count(*) FROM pseudonimizacion_event   WHERE paciente_id = p_pac)
  )
$$;

-- ─── auth.uid() pasa a leer el GUC `folio.m93_uid` ──────────────────────────
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('folio.m93_uid', true), '')::uuid $$;

-- ════════════════════════════════════════════════════════════════════════════
-- N1. Ex-empleado (member de la org con deleted_at) → 42501
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_pac    uuid := 'd1930000-0000-4000-8000-0000000093d2';
  v_caught boolean := false;
  v_state  text;
  v_msg    text;
  v_estado text;
BEGIN
  PERFORM set_config('folio.m93_uid', 'a1930000-0000-4000-8000-00000000093b', true);
  BEGIN
    PERFORM public.pseudonimizar_paciente(v_pac, 'M93 spec: ex-empleado no deberia poder', false);
  EXCEPTION WHEN others THEN
    v_caught := true; v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'M93 FAIL N1: un ex-empleado (member.deleted_at) pseudonimizó al paciente';
  END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'M93 FAIL N1: rechazado con SQLSTATE % (esperado 42501): %', v_state, v_msg;
  END IF;
  IF v_msg NOT LIKE '%no es member%' THEN
    RAISE EXCEPTION 'M93 FAIL N1: mensaje inesperado: %', v_msg;
  END IF;

  v_estado := pg_temp.m93_estado_pii(v_pac);
  IF v_estado <> 'identidad=1 contactos=1 tutores=1 intake=1 instrumentos=1 pseudonimizado=false eventos=0' THEN
    RAISE EXCEPTION 'M93 FAIL N1: la PII del paciente no quedó intacta → %', v_estado;
  END IF;

  RAISE NOTICE 'M93 spec · N1 OK: el ex-empleado es rechazado (42501) y la PII sobrevive';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- N2. OWNER de OTRA organización → 42501
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_pac    uuid := 'd1930000-0000-4000-8000-0000000093d2';
  v_caught boolean := false;
  v_state  text;
  v_msg    text;
  v_estado text;
BEGIN
  PERFORM set_config('folio.m93_uid', 'a1930000-0000-4000-8000-00000000093c', true);
  BEGIN
    PERFORM public.pseudonimizar_paciente(v_pac, 'M93 spec: OWNER de otra org no deberia poder', false);
  EXCEPTION WHEN others THEN
    v_caught := true; v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'M93 FAIL N2: el OWNER de otra org borró la PII de un paciente ajeno';
  END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'M93 FAIL N2: rechazado con SQLSTATE % (esperado 42501): %', v_state, v_msg;
  END IF;

  v_estado := pg_temp.m93_estado_pii(v_pac);
  IF v_estado <> 'identidad=1 contactos=1 tutores=1 intake=1 instrumentos=1 pseudonimizado=false eventos=0' THEN
    RAISE EXCEPTION 'M93 FAIL N2: la PII del paciente no quedó intacta → %', v_estado;
  END IF;

  RAISE NOTICE 'M93 spec · N2 OK: el aislamiento multi-tenant se respeta (42501)';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- N3. Usuario autenticado sin NINGÚN member → 42501
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_pac    uuid := 'd1930000-0000-4000-8000-0000000093d2';
  v_caught boolean := false;
  v_state  text;
  v_msg    text;
  v_estado text;
BEGIN
  PERFORM set_config('folio.m93_uid', 'a1930000-0000-4000-8000-00000000093d', true);
  BEGIN
    PERFORM public.pseudonimizar_paciente(v_pac, 'M93 spec: usuario sin membership no deberia poder', false);
  EXCEPTION WHEN others THEN
    v_caught := true; v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'M93 FAIL N3: un usuario sin ningún member borró PII';
  END IF;
  IF v_state <> '42501' THEN
    RAISE EXCEPTION 'M93 FAIL N3: rechazado con SQLSTATE % (esperado 42501): %', v_state, v_msg;
  END IF;

  v_estado := pg_temp.m93_estado_pii(v_pac);
  IF v_estado <> 'identidad=1 contactos=1 tutores=1 intake=1 instrumentos=1 pseudonimizado=false eventos=0' THEN
    RAISE EXCEPTION 'M93 FAIL N3: la PII del paciente no quedó intacta → %', v_estado;
  END IF;

  RAISE NOTICE 'M93 spec · N3 OK: sin membership no se pseudonimiza (42501)';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- N4. ASISTENTE activo de la org → rechazo por rol (regresión del chequeo viejo)
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_pac    uuid := 'd1930000-0000-4000-8000-0000000093d2';
  v_caught boolean := false;
  v_msg    text;
  v_estado text;
BEGIN
  PERFORM set_config('folio.m93_uid', 'a1930000-0000-4000-8000-00000000093e', true);
  BEGIN
    PERFORM public.pseudonimizar_paciente(v_pac, 'M93 spec: ASISTENTE no deberia poder', false);
  EXCEPTION WHEN others THEN
    v_caught := true; v_msg := SQLERRM;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'M93 FAIL N4: un ASISTENTE activo pseudonimizó al paciente';
  END IF;
  -- El guard nuevo NO puede haberse comido este caso: el ASISTENTE SÍ es member,
  -- así que tiene que caer en el chequeo de rol, no en el de membership.
  IF v_msg NOT LIKE '%no autorizado%' THEN
    RAISE EXCEPTION 'M93 FAIL N4: el ASISTENTE fue rechazado por el motivo equivocado: %', v_msg;
  END IF;

  v_estado := pg_temp.m93_estado_pii(v_pac);
  IF v_estado <> 'identidad=1 contactos=1 tutores=1 intake=1 instrumentos=1 pseudonimizado=false eventos=0' THEN
    RAISE EXCEPTION 'M93 FAIL N4: la PII del paciente no quedó intacta → %', v_estado;
  END IF;

  RAISE NOTICE 'M93 spec · N4 OK: el ASISTENTE sigue rechazado por rol';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- P1. OWNER de la org · dry-run: reporta y no muta
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_pac    uuid := 'd1930000-0000-4000-8000-0000000093d1';
  v_res    jsonb;
  v_estado text;
BEGIN
  PERFORM set_config('folio.m93_uid', 'a1930000-0000-4000-8000-00000000093a', true);
  v_res := public.pseudonimizar_paciente(v_pac, 'M93 spec: OWNER dry-run', true);

  IF v_res ->> 'actor_role' IS DISTINCT FROM 'OWNER' THEN
    RAISE EXCEPTION 'M93 FAIL P1: actor_role = % (esperado OWNER)', v_res ->> 'actor_role';
  END IF;
  IF (v_res ->> 'contactos_emergencia_a_borrar')::int <> 1
     OR (v_res ->> 'tutores_legales_a_borrar')::int <> 1
     OR (v_res ->> 'intake_avanzado_a_borrar')::int <> 1
     OR (v_res ->> 'instrumento_respuesta_a_borrar')::int <> 1 THEN
    RAISE EXCEPTION 'M93 FAIL P1: conteos de dry_run inesperados: %', v_res;
  END IF;
  IF (v_res ->> 'cuenta_link_a_desvincular')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'M93 FAIL P1: no reporta el link de cuenta portal a desvincular (M70): %', v_res;
  END IF;

  v_estado := pg_temp.m93_estado_pii(v_pac);
  IF v_estado <> 'identidad=1 contactos=1 tutores=1 intake=1 instrumentos=1 pseudonimizado=false eventos=0' THEN
    RAISE EXCEPTION 'M93 FAIL P1: el dry_run mutó datos → %', v_estado;
  END IF;

  RAISE NOTICE 'M93 spec · P1 OK: el OWNER pasa el guard y el dry-run no muta';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- P2. OWNER de la org · ejecución real: borra todo y deja audit-trail
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_pac    uuid := 'd1930000-0000-4000-8000-0000000093d1';
  v_res    jsonb;
  v_estado text;
BEGIN
  PERFORM set_config('folio.m93_uid', 'a1930000-0000-4000-8000-00000000093a', true);
  v_res := public.pseudonimizar_paciente(v_pac, 'M93 spec: OWNER ejecucion real', false);

  IF (v_res ->> 'contactos_emergencia_borrados')::int <> 1
     OR (v_res ->> 'tutores_legales_borrados')::int <> 1
     OR (v_res ->> 'intake_avanzado_borrados')::int <> 1
     OR (v_res ->> 'instrumento_respuesta_borrados')::int <> 1 THEN
    RAISE EXCEPTION 'M93 FAIL P2: conteos de borrado inesperados: %', v_res;
  END IF;
  IF (v_res ->> 'cuenta_link_desvinculado')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'M93 FAIL P2: no reporta la desvinculación de la cuenta portal (M70): %', v_res;
  END IF;
  IF (SELECT cuenta_id FROM paciente WHERE id = v_pac) IS NOT NULL THEN
    RAISE EXCEPTION 'M93 FAIL P2: el link cuenta_id sobrevivió a la pseudonimización (M70)';
  END IF;

  v_estado := pg_temp.m93_estado_pii(v_pac);
  IF v_estado <> 'identidad=0 contactos=0 tutores=0 intake=0 instrumentos=0 pseudonimizado=true eventos=1' THEN
    RAISE EXCEPTION 'M93 FAIL P2: la supresión quedó incompleta → %', v_estado;
  END IF;

  IF (SELECT count(*) FROM pseudonimizacion_event
       WHERE paciente_id = v_pac
         AND performed_by = 'a1930000-0000-4000-8000-00000000093a') <> 1 THEN
    RAISE EXCEPTION 'M93 FAIL P2: el pseudonimizacion_event no quedó atribuido al OWNER';
  END IF;

  RAISE NOTICE 'M93 spec · P2 OK: el OWNER pseudonimiza de verdad y queda el audit-trail';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- P3. service_role (cron account-purge) · la rama v_is_service sigue viva
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_pac    uuid := 'd1930000-0000-4000-8000-0000000093d3';
  v_res    jsonb;
  v_estado text;
BEGIN
  -- Sin auth.uid() (GUC vacío) y con auth.role() = service_role: exactamente el
  -- cliente service-role del cron.
  PERFORM set_config('folio.m93_uid', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  v_res := public.pseudonimizar_paciente(v_pac, 'M93 spec: cron account-purge', false);

  IF v_res ->> 'actor_role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'M93 FAIL P3: actor_role = % (esperado service_role)', v_res ->> 'actor_role';
  END IF;

  v_estado := pg_temp.m93_estado_pii(v_pac);
  IF v_estado <> 'identidad=0 contactos=0 tutores=0 intake=0 instrumentos=0 pseudonimizado=true eventos=1' THEN
    RAISE EXCEPTION 'M93 FAIL P3: el cron no completó la supresión → %', v_estado;
  END IF;

  IF (SELECT count(*) FROM pseudonimizacion_event
       WHERE paciente_id = v_pac AND performed_by IS NULL) <> 1 THEN
    RAISE EXCEPTION 'M93 FAIL P3: el evento del cron debería tener performed_by NULL';
  END IF;

  RAISE NOTICE 'M93 spec · P3 OK: el cron service_role sigue pudiendo purgar';
END $$;

-- ─── Restaurar auth.uid() al stub del CI (NULL) ─────────────────────────────
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

DO $$ BEGIN RAISE NOTICE 'M93 spec PASS · pseudonimizar_paciente exige member activo de la org (ex-empleados, orgs ajenas y usuarios sin membership quedan afuera)'; END $$;
