-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M54 spec · slot_ocupado per-profesional + exclusión de turno
-- ════════════════════════════════════════════════════════════════════════════
-- Verifica:
--   1. Una sola firma (6 args) — las de 3 y 4 args fueron dropeadas.
--   2. Caso clínica: dos profesionales a la MISMA hora — el turno del prof A
--      NO bloquea al prof B cuando se pasa p_profesional=B (fix del
--      sobre-bloqueo org-wide).
--   3. Compat: sin p_profesional (NULL) la semántica org-wide de M53 se
--      mantiene (el turno de A sí cuenta).
--   4. p_exclude_turno: el propio turno no se cuenta (pre-check de REAGENDAR).
--   5. Pedido sin profesional asignado bloquea conservadoramente aunque se
--      pase p_profesional.
--   6. Bloqueo de A no bloquea a B con p_profesional=B.
--
-- Fixtures como superuser (bypass RLS), patrón M30/M49/M50/M53. Pedido canal
-- TELEFONO (evita pedido_web_requires_consent de M39).
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_org      uuid := gen_random_uuid();
  v_user_a   uuid := gen_random_uuid();
  v_user_b   uuid := gen_random_uuid();
  v_prof_a   uuid := gen_random_uuid();
  v_prof_b   uuid := gen_random_uuid();
  v_paciente uuid := gen_random_uuid();
  v_servicio uuid := gen_random_uuid();
  v_turno_a  uuid := gen_random_uuid();
  v_inicio   timestamptz := date_trunc('hour', now() + interval '3 day');
  v_fin      timestamptz;
  v_count    int;
  v_ocupado  boolean;
BEGIN
  v_fin := v_inicio + interval '30 minutes';

  -- ── 1. una sola firma, de 6 args ──────────────────────────────────────────
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'slot_ocupado';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'M54 spec FAIL: % versiones de slot_ocupado (esperada 1)', v_count;
  END IF;
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'slot_ocupado' AND p.pronargs = 6;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'M54 spec FAIL: slot_ocupado no tiene la firma de 6 args';
  END IF;

  -- ── fixtures: org con DOS profesionales ───────────────────────────────────
  INSERT INTO organization (id, slug, nombre) VALUES (v_org, 'm54-spec', 'M54 Clinica Spec');
  INSERT INTO auth.users (id, email) VALUES (v_user_a, 'a-m54@spec.test'), (v_user_b, 'b-m54@spec.test');
  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version)
    VALUES (v_user_a, 'a-m54@spec.test', now(), 'v1'), (v_user_b, 'b-m54@spec.test', now(), 'v1');
  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at)
    VALUES (v_prof_a, v_org, v_user_a, 'PROFESIONAL', true, now()),
           (v_prof_b, v_org, v_user_b, 'PROFESIONAL', true, now());
  INSERT INTO paciente (id, organization_id) VALUES (v_paciente, v_org);
  INSERT INTO servicio (id, organization_id, nombre, tipo_canonico, duracion_min, precio_cents)
    VALUES (v_servicio, v_org, 'Sesión M54', 'SEGUIMIENTO_ESTANDAR', 30, 100000);

  -- turno del profesional A en el horario bajo prueba
  INSERT INTO turno (id, organization_id, paciente_id, servicio_id, profesional_id,
                     inicio, duracion_min, precio_cents, estado)
    VALUES (v_turno_a, v_org, v_paciente, v_servicio, v_prof_a,
            v_inicio, 30, 100000, 'CONFIRMADO');

  -- ── 2. el turno de A NO bloquea a B (per-profesional) ─────────────────────
  SELECT slot_ocupado(v_org, v_inicio, v_fin, NULL, v_prof_b, NULL) INTO v_ocupado;
  IF v_ocupado IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'M54 spec FAIL: el turno del prof A bloquea al prof B (sobre-bloqueo org-wide sigue)';
  END IF;

  -- ── 3. compat org-wide: sin p_profesional el turno de A SÍ cuenta ─────────
  SELECT slot_ocupado(v_org, v_inicio, v_fin) INTO v_ocupado;
  IF v_ocupado IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'M54 spec FAIL: semántica org-wide (p_profesional NULL) no detecta el turno';
  END IF;

  -- ── 4. p_exclude_turno: el propio turno de A no se cuenta ─────────────────
  SELECT slot_ocupado(v_org, v_inicio, v_fin, NULL, v_prof_a, v_turno_a) INTO v_ocupado;
  IF v_ocupado IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'M54 spec FAIL: p_exclude_turno no excluye el propio turno (pre-check REAGENDAR roto)';
  END IF;
  -- y sin exclusión, para A sí está ocupado
  SELECT slot_ocupado(v_org, v_inicio, v_fin, NULL, v_prof_a, NULL) INTO v_ocupado;
  IF v_ocupado IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'M54 spec FAIL: el propio turno de A no cuenta para A sin exclusión';
  END IF;

  -- ── 5. pedido sin profesional bloquea conservadoramente ───────────────────
  INSERT INTO pedido (organization_id, canal, estado, nombre_cifrado, fecha_propuesta, duracion_min)
    VALUES (v_org, 'TELEFONO', 'PENDIENTE', '\x00'::bytea, v_inicio + interval '2 hour', 30);
  SELECT slot_ocupado(v_org, v_inicio + interval '2 hour', v_fin + interval '2 hour', NULL, v_prof_b, NULL)
    INTO v_ocupado;
  IF v_ocupado IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'M54 spec FAIL: pedido sin profesional asignado no bloquea con p_profesional';
  END IF;

  -- ── 6. bloqueo de A no bloquea a B ────────────────────────────────────────
  INSERT INTO bloqueo (organization_id, profesional_id, inicio, duracion_min, origen)
    VALUES (v_org, v_prof_a, v_inicio + interval '4 hour', 60, 'manual');
  SELECT slot_ocupado(v_org, v_inicio + interval '4 hour', v_fin + interval '4 hour', NULL, v_prof_b, NULL)
    INTO v_ocupado;
  IF v_ocupado IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'M54 spec FAIL: el bloqueo personal de A bloquea a B';
  END IF;
  SELECT slot_ocupado(v_org, v_inicio + interval '4 hour', v_fin + interval '4 hour', NULL, v_prof_a, NULL)
    INTO v_ocupado;
  IF v_ocupado IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'M54 spec FAIL: el bloqueo de A no cuenta para A';
  END IF;

  RAISE NOTICE 'M54 spec OK';
END $$;
