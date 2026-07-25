-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M91 spec · origen 'paciente' en el log de transiciones de turno 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- M91 arregla un log que MIENTE: una cancelación/confirmación hecha por el
-- PACIENTE (1-click del email o self-service del portal) quedaba en `transicion`
-- con trigger_origin='manual' — indistinguible de una de mostrador. En un log
-- append-only de un producto con PHI eso es un registro falso.
--
--   POSITIVAS:
--     P1. El CHECK transicion_trigger_origin_valid ensanchado ACEPTA 'paciente'
--         y sigue RECHAZANDO un valor bogus (23514).
--     P2. turno_transicion_paciente(t,'CANCELADO',{AGENDADO,CONFIRMADO}) cancela
--         el turno Y deja una fila `transicion` con trigger_origin='paciente'.
--     P3. …(t,'CONFIRMADO',{AGENDADO}) setea turno.confirmado_via='paciente'
--         (columna de M90) Y loguea trigger_origin='paciente'.
--     P5. La cancelación del PORTAL (path M84, sesión de paciente_cuenta) loguea
--         'paciente' SIN ningún cambio en el código de la app — la atribución
--         viaja por el guard BEFORE UPDATE redefinido en M91(c).
--     P4. NO-REGRESIÓN (la aserción crítica): un UPDATE de STAFF (sesión de
--         member, path M09 de siempre) sigue logueando 'manual'.
--
--   NEGATIVAS:
--     N1. CAS perdido: si el turno NO está en p_from → CERO filas y el turno no
--         cambia (el contrato que la action del email ya maneja: no es error).
--     N2. p_to fuera de {CONFIRMADO, CANCELADO} → aborta con errcode 22023.
--     N3. ACL: anon/authenticated SIN EXECUTE sobre turno_transicion_paciente;
--         service_role CON EXECUTE (bypassea RLS por definición).
--
-- ─── Por qué P4 corre AL FINAL (no es cosmético) ──────────────────────────────
-- El GUC `folio.transition_origin` se setea transaction-local (set_config …,
-- true), pero el PLACEHOLDER queda definido en la SESIÓN para siempre. Correr el
-- staff DESPUÉS de P2/P3/P5 reproduce exactamente el escenario de producción:
-- una conexión del pool de PostgREST que ya sirvió una transición de paciente y
-- después sirve una de staff. Si el orden fuera el inverso, P4 pasaría siempre y
-- no probaría nada. Es la única forma honesta de afirmar "no hay regresión".
--
-- ─── Mecánica CI ──────────────────────────────────────────────────────────────
-- Fixtures como superuser (bypassa RLS, NO los CHECK de tabla). El RPC se llama
-- bajo `SET LOCAL ROLE service_role` — el llamador real de la action del email.
-- Los paths de portal/staff corren bajo `SET ROLE authenticated` con auth.uid()
-- overrideado (patrón M84/M87/M88). Las verificaciones de efecto se leen SIEMPRE
-- como superuser: la unidad bajo prueba es el LOG, no la RLS de lectura de
-- `transicion`. Restaura auth.uid() a NULL al final.
--
-- UUIDs fijos (bloque …91x, sin colisión con M84 …8x ni M88 …88x):
--   Org A = …91a1 · auth pac X = …91a2 · cuenta X = …91c2
--   auth clínico = …91aa · member A = …91a5 · servicio A = …91e5
--   identidad X = …91e1 · paciente X = …91d1
--   turnos: f1 RPC-cancel · f2 RPC-confirm · f3 CAS-perdido · f4 staff · f5 portal
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Fixtures (superuser → bypass RLS) ──────────────────────────────────────
DO $$
BEGIN
  -- Borrar turnos primero: `transicion` cuelga con ON DELETE CASCADE, así el
  -- spec es re-ejecutable sin arrastrar filas de log de una corrida anterior.
  DELETE FROM turno WHERE id IN (
    'f1910000-0000-4000-8000-0000000091f1','f1910000-0000-4000-8000-0000000091f2',
    'f1910000-0000-4000-8000-0000000091f3','f1910000-0000-4000-8000-0000000091f4',
    'f1910000-0000-4000-8000-0000000091f5');

  INSERT INTO auth.users (id, email) VALUES
    ('a1910000-0000-4000-8000-0000000091a2', 'm91-pac-x@spec.test'),
    ('a1910000-0000-4000-8000-0000000091aa', 'm91-clin-a@spec.test')
  ON CONFLICT (id) DO NOTHING;

  -- cutoff 24h: todos los turnos del spec están a días de distancia, así que la
  -- ventana de corte del portal (M84) nunca es el motivo de un bloqueo acá.
  INSERT INTO organization (id, slug, nombre, tipo, portal_cancel_cutoff_horas) VALUES
    ('a1910000-0000-4000-8000-0000000091a1', 'm91-org-a', 'M91 Org A', 'INDEPENDIENTE', 24)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente_cuenta (id, auth_user_id, email) VALUES
    ('c1910000-0000-4000-8000-0000000091c2', 'a1910000-0000-4000-8000-0000000091a2', 'm91-pac-x@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version) VALUES
    ('a1910000-0000-4000-8000-0000000091aa', 'm91-clin-a@spec.test', now(), 'v1')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at) VALUES
    ('a1910000-0000-4000-8000-0000000091a5', 'a1910000-0000-4000-8000-0000000091a1',
     'a1910000-0000-4000-8000-0000000091aa', 'OWNER', true, now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO servicio (id, organization_id, nombre, tipo_canonico, duracion_min, precio_cents) VALUES
    ('a1910000-0000-4000-8000-0000000091e5', 'a1910000-0000-4000-8000-0000000091a1',
     'Consulta', 'CONSULTA_INICIAL', 30, 100000)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente_identidad
    (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash, nombre_hash) VALUES
    ('e1910000-0000-4000-8000-0000000091e1', 'a1910000-0000-4000-8000-0000000091a1',
     '\x01'::bytea, '\x02'::bytea, '\x03'::bytea, repeat('9', 64), repeat('e', 64))
  ON CONFLICT (id) DO NOTHING;

  -- Paciente X linkeado a la cuenta X → paciente_owns() da true bajo su sesión.
  INSERT INTO paciente (id, organization_id, identidad_id, cuenta_id) VALUES
    ('d1910000-0000-4000-8000-0000000091d1', 'a1910000-0000-4000-8000-0000000091a1',
     'e1910000-0000-4000-8000-0000000091e1', 'c1910000-0000-4000-8000-0000000091c2')
  ON CONFLICT (id) DO NOTHING;

  -- Un turno por aserción, con `inicio` ESCALONADO: el EXCLUDE M40
  -- (turno_no_overlap_excl) es per-profesional e ignora el paciente, y los cinco
  -- turnos comparten profesional …91a5 — solapados no entrarían.
  --   f1 = +3d CONFIRMADO → P2 (RPC cancela)
  --   f2 = +4d AGENDADO   → P3 (RPC confirma)
  --   f3 = +5d EN_SALA    → N1 (el CAS {AGENDADO,CONFIRMADO} no matchea)
  --   f4 = +6d CONFIRMADO → N2 (aborta antes de tocar nada) y luego P4 (staff)
  --   f5 = +7d CONFIRMADO → P5 (portal; muy fuera de la ventana de 24h)
  INSERT INTO turno (id, organization_id, paciente_id, servicio_id, profesional_id, inicio, duracion_min, precio_cents, estado) VALUES
    ('f1910000-0000-4000-8000-0000000091f1', 'a1910000-0000-4000-8000-0000000091a1',
     'd1910000-0000-4000-8000-0000000091d1', 'a1910000-0000-4000-8000-0000000091e5',
     'a1910000-0000-4000-8000-0000000091a5', now() + interval '3 day', 30, 100000, 'CONFIRMADO'),
    ('f1910000-0000-4000-8000-0000000091f2', 'a1910000-0000-4000-8000-0000000091a1',
     'd1910000-0000-4000-8000-0000000091d1', 'a1910000-0000-4000-8000-0000000091e5',
     'a1910000-0000-4000-8000-0000000091a5', now() + interval '4 day', 30, 100000, 'AGENDADO'),
    ('f1910000-0000-4000-8000-0000000091f3', 'a1910000-0000-4000-8000-0000000091a1',
     'd1910000-0000-4000-8000-0000000091d1', 'a1910000-0000-4000-8000-0000000091e5',
     'a1910000-0000-4000-8000-0000000091a5', now() + interval '5 day', 30, 100000, 'EN_SALA'),
    ('f1910000-0000-4000-8000-0000000091f4', 'a1910000-0000-4000-8000-0000000091a1',
     'd1910000-0000-4000-8000-0000000091d1', 'a1910000-0000-4000-8000-0000000091e5',
     'a1910000-0000-4000-8000-0000000091a5', now() + interval '6 day', 30, 100000, 'CONFIRMADO'),
    ('f1910000-0000-4000-8000-0000000091f5', 'a1910000-0000-4000-8000-0000000091a1',
     'd1910000-0000-4000-8000-0000000091d1', 'a1910000-0000-4000-8000-0000000091e5',
     'a1910000-0000-4000-8000-0000000091a5', now() + interval '7 day', 30, 100000, 'CONFIRMADO')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'M91 spec · fixtures listos';
END $$;

-- ─── Grants mínimos ─────────────────────────────────────────────────────────
-- En prod Supabase concede estos por default; el CI vanilla no. Sólo lo que
-- tocan los paths bajo prueba: el RPC (service_role) y el UPDATE de turno que
-- ejercen portal (P5) y staff (P4) con el rol bajado.
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT, UPDATE ON turno TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- P1. El CHECK ensanchado acepta 'paciente' y sigue rechazando un valor bogus.
-- ════════════════════════════════════════════════════════════════════════════
-- `transicion` tiene policy transicion_no_direct_insert WITH CHECK (false), pero
-- este spec corre como SUPERUSER y la RLS no aplica a superusers (mismo supuesto
-- que los fixtures de M84). Los CHECK de tabla SÍ se evalúan para superusers —
-- que es justo lo que acá se mide, aislado del trigger. La aceptación de
-- 'paciente' se re-verifica end-to-end (vía turno_record_transition) en P2/P3/P5;
-- P1 aísla el constraint para que un FAIL diga "el CHECK", no "el path".
-- La fila sonda se borra al final para no ensuciar los conteos posteriores.
DO $$
DECLARE v_probe bigint; v_state text;
BEGIN
  -- (a) 'paciente' debe entrar.
  INSERT INTO transicion (turno_id, from_estado, to_estado, trigger_origin)
  VALUES ('f1910000-0000-4000-8000-0000000091f1', 'CONFIRMADO', 'CANCELADO', 'paciente')
  RETURNING id INTO v_probe;
  IF v_probe IS NULL THEN
    RAISE EXCEPTION 'M91 FAIL P1: el CHECK no aceptó trigger_origin = paciente';
  END IF;
  DELETE FROM transicion WHERE id = v_probe;

  -- (b) un valor bogus debe seguir rebotando con 23514 (check_violation): el
  --     ensanchamiento suma UN valor, no abre el dominio.
  BEGIN
    INSERT INTO transicion (turno_id, from_estado, to_estado, trigger_origin)
    VALUES ('f1910000-0000-4000-8000-0000000091f1', 'CONFIRMADO', 'CANCELADO', 'chatbot');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM '23514' THEN
    RAISE EXCEPTION 'M91 FAIL P1: un trigger_origin bogus debió abortar 23514 (sqlstate=%)',
      coalesce(v_state, '<entró sin error>');
  END IF;

  RAISE NOTICE 'M91 spec · P1 OK: el CHECK acepta paciente y rechaza lo demás';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- P2. RPC cancela (CAS desde AGENDADO|CONFIRMADO) y loguea origen 'paciente'.
-- ════════════════════════════════════════════════════════════════════════════
-- Se llama bajo service_role — el llamador real (la action del email corre con
-- el service client). La función es SECURITY DEFINER: adentro corre como el
-- owner, así que service_role sólo necesita el EXECUTE que M91 le otorga.
DO $$
DECLARE v_ret uuid[]; v_estado text; v_origin text; v_from text; v_to text;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT array_agg(t) INTO v_ret
    FROM public.turno_transicion_paciente(
           'f1910000-0000-4000-8000-0000000091f1', 'CANCELADO',
           ARRAY['AGENDADO','CONFIRMADO']) AS t;
  RESET ROLE;

  IF v_ret IS DISTINCT FROM ARRAY['f1910000-0000-4000-8000-0000000091f1'::uuid] THEN
    RAISE EXCEPTION 'M91 FAIL P2: el RPC debió devolver el id del turno cancelado (devolvió %)', v_ret;
  END IF;

  SELECT estado::text INTO v_estado FROM turno WHERE id = 'f1910000-0000-4000-8000-0000000091f1';
  IF v_estado <> 'CANCELADO' THEN
    RAISE EXCEPTION 'M91 FAIL P2: el turno no quedó CANCELADO (estado=%)', v_estado;
  END IF;

  SELECT trigger_origin, from_estado::text, to_estado::text
    INTO v_origin, v_from, v_to
    FROM transicion
   WHERE turno_id = 'f1910000-0000-4000-8000-0000000091f1'
   ORDER BY id DESC LIMIT 1;
  IF v_origin IS DISTINCT FROM 'paciente' THEN
    RAISE EXCEPTION 'M91 FAIL P2: la transición debió quedar con trigger_origin=paciente (origin=%)',
      coalesce(v_origin, '<sin fila>');
  END IF;
  IF v_from <> 'CONFIRMADO' OR v_to <> 'CANCELADO' THEN
    RAISE EXCEPTION 'M91 FAIL P2: la transición logueada no es CONFIRMADO→CANCELADO (% → %)', v_from, v_to;
  END IF;

  RAISE NOTICE 'M91 spec · P2 OK: cancelación 1-click auditada como paciente';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- P3. RPC confirma: turno.confirmado_via='paciente' (M90) + log 'paciente'.
-- ════════════════════════════════════════════════════════════════════════════
-- Las DOS atribuciones tienen que coincidir: la columna (para el chip de la
-- agenda) y la fila del log (para la auditoría). Antes de M91 la columna decía
-- 'paciente' y el log decía 'manual' — el mismo hecho contado de dos formas.
DO $$
DECLARE v_ret uuid[]; v_estado text; v_via text; v_origin text; v_from text; v_to text;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT array_agg(t) INTO v_ret
    FROM public.turno_transicion_paciente(
           'f1910000-0000-4000-8000-0000000091f2', 'CONFIRMADO',
           ARRAY['AGENDADO']) AS t;
  RESET ROLE;

  IF v_ret IS DISTINCT FROM ARRAY['f1910000-0000-4000-8000-0000000091f2'::uuid] THEN
    RAISE EXCEPTION 'M91 FAIL P3: el RPC debió devolver el id del turno confirmado (devolvió %)', v_ret;
  END IF;

  SELECT estado::text, confirmado_via INTO v_estado, v_via
    FROM turno WHERE id = 'f1910000-0000-4000-8000-0000000091f2';
  IF v_estado <> 'CONFIRMADO' THEN
    RAISE EXCEPTION 'M91 FAIL P3: el turno no quedó CONFIRMADO (estado=%)', v_estado;
  END IF;
  IF v_via IS DISTINCT FROM 'paciente' THEN
    RAISE EXCEPTION 'M91 FAIL P3: turno.confirmado_via debió ser paciente (via=%)',
      coalesce(v_via, '<NULL>');
  END IF;

  SELECT trigger_origin, from_estado::text, to_estado::text
    INTO v_origin, v_from, v_to
    FROM transicion
   WHERE turno_id = 'f1910000-0000-4000-8000-0000000091f2'
   ORDER BY id DESC LIMIT 1;
  IF v_origin IS DISTINCT FROM 'paciente' THEN
    RAISE EXCEPTION 'M91 FAIL P3: la transición debió quedar con trigger_origin=paciente (origin=%)',
      coalesce(v_origin, '<sin fila>');
  END IF;
  IF v_from <> 'AGENDADO' OR v_to <> 'CONFIRMADO' THEN
    RAISE EXCEPTION 'M91 FAIL P3: la transición logueada no es AGENDADO→CONFIRMADO (% → %)', v_from, v_to;
  END IF;

  RAISE NOTICE 'M91 spec · P3 OK: confirmación 1-click coherente en columna y log';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- N1. CAS perdido: el turno no está en p_from → CERO filas, nada cambia.
-- ════════════════════════════════════════════════════════════════════════════
-- f3 está EN_SALA (el paciente ya llegó). Ojo: EN_SALA→CANCELADO SÍ es una
-- arista válida de la máquina M09 — lo que bloquea acá es el CAS por estado, que
-- es el punto: el guard vive en la función, no en la máquina. Cero filas NO es
-- error (es "otro click ganó la carrera" / "el staff ya lo movió"), así que
-- además de las 0 filas verificamos que no haya quedado NINGUNA fila de log.
DO $$
DECLARE v_rows int; v_estado text; v_antes int; v_despues int;
BEGIN
  SELECT count(*) INTO v_antes FROM transicion WHERE turno_id = 'f1910000-0000-4000-8000-0000000091f3';

  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_rows
    FROM public.turno_transicion_paciente(
           'f1910000-0000-4000-8000-0000000091f3', 'CANCELADO',
           ARRAY['AGENDADO','CONFIRMADO']) AS t;
  RESET ROLE;

  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'M91 FAIL N1: con el CAS perdido debió devolver 0 filas (rows=%)', v_rows;
  END IF;

  SELECT estado::text INTO v_estado FROM turno WHERE id = 'f1910000-0000-4000-8000-0000000091f3';
  IF v_estado <> 'EN_SALA' THEN
    RAISE EXCEPTION 'M91 FAIL N1: el turno no debió cambiar de estado (estado=%)', v_estado;
  END IF;

  SELECT count(*) INTO v_despues FROM transicion WHERE turno_id = 'f1910000-0000-4000-8000-0000000091f3';
  IF v_despues <> v_antes THEN
    RAISE EXCEPTION 'M91 FAIL N1: no debió loguearse ninguna transición (% → %)', v_antes, v_despues;
  END IF;

  RAISE NOTICE 'M91 spec · N1 OK: CAS perdido = 0 filas, sin efecto ni log';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- N2. p_to fuera de {CONFIRMADO, CANCELADO} → aborta 22023.
-- ════════════════════════════════════════════════════════════════════════════
-- La función es angosta a propósito: un email nunca cierra ni pone en sala un
-- turno. Se prueba sobre f4, que SÍ matchearía el CAS — así el único motivo
-- posible del aborto es el destino, no el estado de origen. f4 debe quedar
-- intacto para P4.
DO $$
DECLARE v_state text; v_rows int := -1; v_estado text;
BEGIN
  SET LOCAL ROLE service_role;
  BEGIN
    SELECT count(*) INTO v_rows
      FROM public.turno_transicion_paciente(
             'f1910000-0000-4000-8000-0000000091f4', 'CERRADO',
             ARRAY['CONFIRMADO']) AS t;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  RESET ROLE;

  IF v_state IS DISTINCT FROM '22023' THEN
    RAISE EXCEPTION 'M91 FAIL N2: un destino no permitido debió abortar 22023 (sqlstate=%, rows=%)',
      coalesce(v_state, '<sin error>'), v_rows;
  END IF;

  SELECT estado::text INTO v_estado FROM turno WHERE id = 'f1910000-0000-4000-8000-0000000091f4';
  IF v_estado <> 'CONFIRMADO' THEN
    RAISE EXCEPTION 'M91 FAIL N2: el turno no debió tocarse (estado=%)', v_estado;
  END IF;

  RAISE NOTICE 'M91 spec · N2 OK: destino no permitido aborta 22023 sin efecto';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- N3. ACL: anon/authenticated SIN EXECUTE; service_role CON EXECUTE.
-- ════════════════════════════════════════════════════════════════════════════
-- La función es SECURITY DEFINER y bypassea la RLS de turno: si `authenticated`
-- pudiera invocarla, CUALQUIER paciente logueado cancelaría/confirmaría el turno
-- de cualquier otro con sólo saber el uuid — la RLS del portal quedaría en nada.
DO $$
BEGIN
  IF has_function_privilege('anon',
       'public.turno_transicion_paciente(uuid, text, text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'M91 FAIL N3: anon NO debe tener EXECUTE sobre turno_transicion_paciente';
  END IF;
  IF has_function_privilege('authenticated',
       'public.turno_transicion_paciente(uuid, text, text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'M91 FAIL N3: authenticated NO debe tener EXECUTE sobre turno_transicion_paciente (bypassea RLS)';
  END IF;
  IF NOT has_function_privilege('service_role',
       'public.turno_transicion_paciente(uuid, text, text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'M91 FAIL N3: service_role DEBE tener EXECUTE sobre turno_transicion_paciente';
  END IF;
  RAISE NOTICE 'M91 spec · N3 OK: EXECUTE sólo service_role (public/anon/authenticated revocados)';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- P5. PORTAL: el paciente cancela su propio turno (path M84) → log 'paciente'.
-- ════════════════════════════════════════════════════════════════════════════
-- Este path NO pasa por el RPC: es el UPDATE directo con RLS que ya hace
-- lib/db/portal-turnos.ts. La atribución viaja por turno_portal_cancel_guard()
-- (BEFORE UPDATE, redefinido en M91(c)), que setea el GUC recién DESPUÉS de las
-- cuatro invariantes de M84 — por eso una cancelación rechazada no lo deja
-- seteado. El log lo escribe turno_transition_log (AFTER, misma transacción).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1910000-0000-4000-8000-0000000091a2'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int;
BEGIN
  UPDATE turno SET estado = 'CANCELADO'
   WHERE id = 'f1910000-0000-4000-8000-0000000091f5' AND estado IN ('AGENDADO','CONFIRMADO');
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v <> 1 THEN
    RAISE EXCEPTION 'M91 FAIL P5: el paciente no pudo cancelar su turno por el portal (rows=%)', v;
  END IF;
END $$;

RESET ROLE;

-- Efecto leído como superuser: `authenticated` no tiene SELECT sobre transicion
-- en el CI vanilla, y la unidad bajo prueba es el log, no su RLS de lectura.
DO $$
DECLARE v_origin text; v_from text; v_to text;
BEGIN
  SELECT trigger_origin, from_estado::text, to_estado::text
    INTO v_origin, v_from, v_to
    FROM transicion
   WHERE turno_id = 'f1910000-0000-4000-8000-0000000091f5'
   ORDER BY id DESC LIMIT 1;
  IF v_origin IS DISTINCT FROM 'paciente' THEN
    RAISE EXCEPTION 'M91 FAIL P5: la cancelación del portal debió loguear paciente (origin=%)',
      coalesce(v_origin, '<sin fila>');
  END IF;
  IF v_from <> 'CONFIRMADO' OR v_to <> 'CANCELADO' THEN
    RAISE EXCEPTION 'M91 FAIL P5: la transición logueada no es CONFIRMADO→CANCELADO (% → %)', v_from, v_to;
  END IF;
  RAISE NOTICE 'M91 spec · P5 OK: el portal audita paciente sin tocar el código de la app';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- P4. NO-REGRESIÓN: el STAFF (member) sigue logueando 'manual'.
-- ════════════════════════════════════════════════════════════════════════════
-- LA aserción crítica de M91, y va ÚLTIMA a propósito: esta sesión ya sirvió
-- tres transiciones de paciente (P2, P3, P5), que es exactamente lo que le pasa
-- a una conexión reusada del pool de PostgREST. El GUC se setea transaction-local
-- (muere con la transacción), pero el PLACEHOLDER folio.transition_origin queda
-- DEFINIDO en la sesión para siempre — y una vez definido, current_setting(…,
-- true) ya no devuelve NULL sino CADENA VACÍA. Si el coalesce() de
-- turno_record_transition() no la neutraliza, el staff deja de escribir 'manual'.
-- Cazamos las dos formas del fallo: el aborto por CHECK (trigger_origin='') y el
-- log con un origen equivocado.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1910000-0000-4000-8000-0000000091aa'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int; v_state text;
BEGIN
  BEGIN
    UPDATE turno SET estado = 'CANCELADO'
     WHERE id = 'f1910000-0000-4000-8000-0000000091f4';
    GET DIAGNOSTICS v = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    RAISE EXCEPTION 'M91 FAIL P4: el UPDATE de staff abortó con sqlstate % — si es 23514, '
                    'el GUC folio.transition_origin revirtió a cadena vacía tras las '
                    'transiciones de paciente y el coalesce() de turno_record_transition() '
                    'no la neutraliza (falta un nullif(…, ''''))', v_state;
  END;
  IF v <> 1 THEN
    RAISE EXCEPTION 'M91 FAIL P4: el staff no pudo cancelar el turno (rows=%)', v;
  END IF;
END $$;

RESET ROLE;

DO $$
DECLARE v_origin text; v_actor uuid;
BEGIN
  SELECT trigger_origin, actor_id INTO v_origin, v_actor
    FROM transicion
   WHERE turno_id = 'f1910000-0000-4000-8000-0000000091f4'
   ORDER BY id DESC LIMIT 1;
  IF v_origin IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION 'M91 FAIL P4: REGRESIÓN — el cambio de estado del staff debió loguear manual (origin=%)',
      coalesce(nullif(v_origin, ''), '<vacío o sin fila>');
  END IF;
  -- Cinturón: si el origen es 'manual' pero el actor se perdió, el log también
  -- dejó de servir para auditar (M09 lo llena con user_member_id_in).
  IF v_actor IS DISTINCT FROM 'a1910000-0000-4000-8000-0000000091a5'::uuid THEN
    RAISE EXCEPTION 'M91 FAIL P4: el actor_id del staff debió ser el member de la sesión (actor=%)',
      coalesce(v_actor::text, '<NULL>');
  END IF;
  RAISE NOTICE 'M91 spec · P4 OK: el staff sigue logueando manual tras las transiciones de paciente';
END $$;

-- ─── Restaurar auth.uid() a NULL (estado de CI) ─────────────────────────────
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

DO $$ BEGIN RAISE NOTICE 'M91 spec PASS · origen paciente verificado (CHECK + RPC 1-click + portal + ACL) sin regresión del staff'; END $$;
