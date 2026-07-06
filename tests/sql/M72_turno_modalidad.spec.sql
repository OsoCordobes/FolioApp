-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M72 spec · turno.modalidad (telemedicina) + campos de sala
-- ════════════════════════════════════════════════════════════════════════════
-- Verifica:
--   1. Columnas nuevas existen (turno.modalidad/sala_url_cifrado/
--      sala_provider_room_id/sala_expira_ts + servicio.modalidad_default).
--   2. Default backfill: un turno insertado sin modalidad queda 'presencial'
--      (preserva comportamiento) y sin campos de sala. Un servicio sin
--      modalidad_default queda 'presencial'.
--   3. modalidad 'telemedicina' con campos de sala acepta (INSERT y UPDATE).
--   4. modalidad inválida → CHECK turno_modalidad_valida falla.
--   5. Turno presencial con sala_url_cifrado → CHECK turno_sala_solo_telemedicina
--      falla (estado inconsistente prohibido). Telemedicina con sala acepta.
--   6. servicio.modalidad_default inválido → CHECK falla.
--   7. turno_extendido expone `modalidad` y conserva security_invoker=true
--      (no se convirtió en fuga cross-tenant al redefinir la vista).
--
-- Fixtures como superuser (bypass RLS), patrón M54/M55 specs. Cadena completa
-- (org→user→profile→member→paciente→servicio) porque turno_validate_same_org
-- (M09) exige que paciente/servicio/profesional sean de la misma org.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_org       uuid := gen_random_uuid();
  v_user      uuid := gen_random_uuid();
  v_prof      uuid := gen_random_uuid();
  v_paciente  uuid := gen_random_uuid();
  v_servicio  uuid := gen_random_uuid();
  v_turno_p   uuid := gen_random_uuid();
  v_turno_t   uuid := gen_random_uuid();
  v_inicio    timestamptz := date_trunc('hour', now() + interval '5 day');
  v_modalidad text;
  v_default   text;
  v_url       bytea;
  v_caught    boolean;
BEGIN
  -- ── 1. columnas existen ───────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'turno' AND column_name = 'modalidad') THEN
    RAISE EXCEPTION 'M72 spec FAIL: columna turno.modalidad ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'turno' AND column_name = 'sala_url_cifrado') THEN
    RAISE EXCEPTION 'M72 spec FAIL: columna turno.sala_url_cifrado ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'turno' AND column_name = 'sala_provider_room_id') THEN
    RAISE EXCEPTION 'M72 spec FAIL: columna turno.sala_provider_room_id ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'turno' AND column_name = 'sala_expira_ts') THEN
    RAISE EXCEPTION 'M72 spec FAIL: columna turno.sala_expira_ts ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'servicio' AND column_name = 'modalidad_default') THEN
    RAISE EXCEPTION 'M72 spec FAIL: columna servicio.modalidad_default ausente';
  END IF;

  -- ── fixtures ──────────────────────────────────────────────────────────────
  INSERT INTO organization (id, slug, nombre) VALUES (v_org, 'm72-spec', 'M72 Modalidad Spec');
  INSERT INTO auth.users (id, email) VALUES (v_user, 'a-m72@spec.test');
  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version)
    VALUES (v_user, 'a-m72@spec.test', now(), 'v1');
  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at)
    VALUES (v_prof, v_org, v_user, 'PROFESIONAL', true, now());
  INSERT INTO paciente (id, organization_id) VALUES (v_paciente, v_org);
  INSERT INTO servicio (id, organization_id, nombre, tipo_canonico, duracion_min, precio_cents)
    VALUES (v_servicio, v_org, 'Sesión M72', 'SEGUIMIENTO_ESTANDAR', 30, 100000);

  -- ── 2. default backfill: servicio sin modalidad_default → 'presencial' ────
  SELECT modalidad_default INTO v_default FROM servicio WHERE id = v_servicio;
  IF v_default IS DISTINCT FROM 'presencial' THEN
    RAISE EXCEPTION 'M72 spec FAIL: servicio.modalidad_default = % (esperado presencial)', v_default;
  END IF;

  -- turno sin modalidad → toma el DEFAULT 'presencial' y no tiene sala
  INSERT INTO turno (id, organization_id, paciente_id, servicio_id, profesional_id,
                     inicio, duracion_min, precio_cents, estado)
    VALUES (v_turno_p, v_org, v_paciente, v_servicio, v_prof,
            v_inicio, 30, 100000, 'AGENDADO');
  SELECT modalidad, sala_url_cifrado INTO v_modalidad, v_url FROM turno WHERE id = v_turno_p;
  IF v_modalidad IS DISTINCT FROM 'presencial' THEN
    RAISE EXCEPTION 'M72 spec FAIL: turno sin modalidad = % (esperado presencial)', v_modalidad;
  END IF;
  IF v_url IS NOT NULL THEN
    RAISE EXCEPTION 'M72 spec FAIL: turno presencial nuevo tiene sala_url_cifrado no-NULL';
  END IF;

  -- ── 3. telemedicina con campos de sala acepta (INSERT) ────────────────────
  INSERT INTO turno (id, organization_id, paciente_id, servicio_id, profesional_id,
                     inicio, duracion_min, precio_cents, estado,
                     modalidad, sala_url_cifrado, sala_provider_room_id, sala_expira_ts)
    VALUES (v_turno_t, v_org, v_paciente, v_servicio, v_prof,
            v_inicio + interval '1 hour', 30, 100000, 'AGENDADO',
            'telemedicina', '\x0102'::bytea, 'room-abc', v_inicio + interval '2 hour');
  SELECT modalidad INTO v_modalidad FROM turno WHERE id = v_turno_t;
  IF v_modalidad IS DISTINCT FROM 'telemedicina' THEN
    RAISE EXCEPTION 'M72 spec FAIL: turno telemedicina insertado = % (esperado telemedicina)', v_modalidad;
  END IF;

  -- ── 4. modalidad inválida → CHECK falla (UPDATE) ──────────────────────────
  v_caught := false;
  BEGIN
    UPDATE turno SET modalidad = 'hibrido' WHERE id = v_turno_p;
  EXCEPTION WHEN check_violation THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M72 spec FAIL: modalidad inválida no fue bloqueada por turno_modalidad_valida';
  END IF;

  -- ── 5a. presencial con sala → CHECK turno_sala_solo_telemedicina falla ────
  v_caught := false;
  BEGIN
    UPDATE turno SET sala_url_cifrado = '\x99'::bytea WHERE id = v_turno_p; -- sigue presencial
  EXCEPTION WHEN check_violation THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M72 spec FAIL: turno presencial con sala_url no fue bloqueado (turno_sala_solo_telemedicina)';
  END IF;

  -- ── 5b. cambiar el telemedicina a presencial CON sala presente → falla ────
  v_caught := false;
  BEGIN
    UPDATE turno SET modalidad = 'presencial' WHERE id = v_turno_t; -- todavía tiene sala
  EXCEPTION WHEN check_violation THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M72 spec FAIL: pasar a presencial dejando la sala no fue bloqueado';
  END IF;

  -- ── 6. servicio.modalidad_default inválido → CHECK falla ──────────────────
  v_caught := false;
  BEGIN
    UPDATE servicio SET modalidad_default = 'presencia' WHERE id = v_servicio;
  EXCEPTION WHEN check_violation THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M72 spec FAIL: servicio.modalidad_default inválido no fue bloqueado por el CHECK';
  END IF;
  -- default válido acepta
  UPDATE servicio SET modalidad_default = 'telemedicina' WHERE id = v_servicio;
  SELECT modalidad_default INTO v_default FROM servicio WHERE id = v_servicio;
  IF v_default IS DISTINCT FROM 'telemedicina' THEN
    RAISE EXCEPTION 'M72 spec FAIL: servicio.modalidad_default no se actualizó a telemedicina (= %)', v_default;
  END IF;

  -- ── 7. turno_extendido expone modalidad + conserva security_invoker ───────
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'turno_extendido' AND column_name = 'modalidad'
  ) THEN
    RAISE EXCEPTION 'M72 spec FAIL: turno_extendido no expone la columna modalidad';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'turno_extendido' AND relkind = 'v'
      AND reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE EXCEPTION 'M72 spec FAIL: turno_extendido perdió security_invoker=true (fuga RLS)';
  END IF;
  -- y la fila del turno telemedicina se ve con su modalidad
  SELECT modalidad INTO v_modalidad FROM turno_extendido WHERE id = v_turno_t;
  IF v_modalidad IS DISTINCT FROM 'telemedicina' THEN
    RAISE EXCEPTION 'M72 spec FAIL: turno_extendido.modalidad = % (esperado telemedicina)', v_modalidad;
  END IF;

  RAISE NOTICE 'M72 spec OK: turno.modalidad + campos de sala + servicio.modalidad_default + view';
END $$;
