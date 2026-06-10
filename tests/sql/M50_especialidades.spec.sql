-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M50 spec · especialidades (organization.especialidad + sesion tool slot)
-- ════════════════════════════════════════════════════════════════════════════
-- Verifica:
--   1. Columnas nuevas existen (organization.especialidad, sesion.tool_id,
--      sesion.tool_data_cifrado).
--   2. Org nueva sin especialidad explícita → default 'quiropraxia'.
--   3. Especialidad inválida → CHECK organization_especialidad_valida falla.
--   4. Lock guard (Ley 26.529): con locked_at seteado, UPDATE de
--      tool_data_cifrado y de tool_id fallan con la excepción del guard.
--   5. Regresión: UPDATE de vertebras_json en sesión bloqueada sigue fallando.
--
-- Fixtures como superuser (bypass RLS), patrón de M30/M49 specs. auth.uid()
-- devuelve NULL en CI → audit_log_trigger registra actor NULL (permitido).
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_org      uuid := gen_random_uuid();
  v_user     uuid := gen_random_uuid();
  v_member   uuid := gen_random_uuid();
  v_paciente uuid := gen_random_uuid();
  v_servicio uuid := gen_random_uuid();
  v_turno    uuid := gen_random_uuid();
  v_sesion   uuid := gen_random_uuid();
  v_esp      text;
  v_caught   boolean;
  v_msg      text;
BEGIN
  -- ── 1. columnas existen ───────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organization' AND column_name = 'especialidad'
  ) THEN
    RAISE EXCEPTION 'M50 spec FAIL: columna organization.especialidad ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sesion' AND column_name = 'tool_id'
  ) THEN
    RAISE EXCEPTION 'M50 spec FAIL: columna sesion.tool_id ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sesion' AND column_name = 'tool_data_cifrado'
  ) THEN
    RAISE EXCEPTION 'M50 spec FAIL: columna sesion.tool_data_cifrado ausente';
  END IF;

  -- ── 2. default 'quiropraxia' ──────────────────────────────────────────────
  INSERT INTO organization (id, slug, nombre)
    VALUES (v_org, 'm50-spec', 'M50 Especialidades Spec');
  SELECT especialidad INTO v_esp FROM organization WHERE id = v_org;
  IF v_esp IS DISTINCT FROM 'quiropraxia' THEN
    RAISE EXCEPTION 'M50 spec FAIL: default de especialidad = % (esperado quiropraxia)', v_esp;
  END IF;

  -- ── 3. especialidad inválida → CHECK falla ────────────────────────────────
  v_caught := false;
  BEGIN
    INSERT INTO organization (slug, nombre, especialidad)
      VALUES ('m50-spec-bad', 'M50 Spec Inválida', 'odontologia');
  EXCEPTION WHEN check_violation THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M50 spec FAIL: especialidad inválida no fue bloqueada por el CHECK';
  END IF;

  -- ── Fixtures clínicas para el lock guard ──────────────────────────────────
  INSERT INTO auth.users (id, email) VALUES (v_user, 'pro-m50@spec.test');
  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version)
    VALUES (v_user, 'pro-m50@spec.test', now(), 'v1');
  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at)
    VALUES (v_member, v_org, v_user, 'OWNER', true, now());
  INSERT INTO paciente (id, organization_id)
    VALUES (v_paciente, v_org);
  INSERT INTO servicio (id, organization_id, nombre, tipo_canonico, duracion_min, precio_cents)
    VALUES (v_servicio, v_org, 'Sesión M50', 'SEGUIMIENTO_ESTANDAR', 30, 100000);
  INSERT INTO turno (id, organization_id, paciente_id, servicio_id, profesional_id,
                     inicio, duracion_min, precio_cents)
    VALUES (v_turno, v_org, v_paciente, v_servicio, v_member,
            now() - interval '1 hour', 30, 100000);
  INSERT INTO sesion (id, organization_id, turno_id, paciente_id,
                      vertebras_json, tool_id, tool_data_cifrado)
    VALUES (v_sesion, v_org, v_turno, v_paciente,
            '[{"id":"C4","estado":"ajustada"}]'::jsonb,
            'quiropraxia.spine.v1', '\x00'::bytea);

  -- Lock (NULL → not NULL es la única transición permitida).
  UPDATE sesion SET locked_at = now(), locked_by_id = v_member WHERE id = v_sesion;
  IF NOT EXISTS (SELECT 1 FROM sesion WHERE id = v_sesion AND locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'M50 spec FAIL: no se pudo lockear la sesión fixture';
  END IF;

  -- ── 4a. UPDATE de tool_data_cifrado en sesión locked → bloqueado ──────────
  v_caught := false;
  BEGIN
    UPDATE sesion SET tool_data_cifrado = '\x01'::bytea WHERE id = v_sesion;
  EXCEPTION WHEN others THEN
    v_caught := true;
    v_msg := SQLERRM;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M50 spec FAIL: UPDATE de tool_data_cifrado en sesión locked no fue bloqueado';
  END IF;
  IF v_msg NOT LIKE '%26.529%' THEN
    RAISE EXCEPTION 'M50 spec FAIL: la excepción del guard no menciona Ley 26.529: %', v_msg;
  END IF;

  -- ── 4b. UPDATE de tool_id en sesión locked → bloqueado ────────────────────
  v_caught := false;
  v_msg := NULL;
  BEGIN
    UPDATE sesion SET tool_id = 'cardiologia.placeholder' WHERE id = v_sesion;
  EXCEPTION WHEN others THEN
    v_caught := true;
    v_msg := SQLERRM;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M50 spec FAIL: UPDATE de tool_id en sesión locked no fue bloqueado';
  END IF;
  IF v_msg NOT LIKE '%26.529%' THEN
    RAISE EXCEPTION 'M50 spec FAIL: la excepción del guard (tool_id) no menciona Ley 26.529: %', v_msg;
  END IF;

  -- ── 5. regresión: vertebras_json sigue protegida ──────────────────────────
  v_caught := false;
  v_msg := NULL;
  BEGIN
    UPDATE sesion SET vertebras_json = '[]'::jsonb WHERE id = v_sesion;
  EXCEPTION WHEN others THEN
    v_caught := true;
    v_msg := SQLERRM;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M50 spec FAIL: UPDATE de vertebras_json en sesión locked no fue bloqueado (regresión M10)';
  END IF;
  IF v_msg NOT LIKE '%26.529%' THEN
    RAISE EXCEPTION 'M50 spec FAIL: la excepción del guard (vertebras_json) no menciona Ley 26.529: %', v_msg;
  END IF;

  -- La sesión locked queda intacta (no hay cleanup de filas clínicas: el
  -- trigger prevent_locked_sesion_delete las protege, y cada spec usa su
  -- propia org → no contamina specs posteriores).
  RAISE NOTICE 'M50 spec OK';
END $$;
