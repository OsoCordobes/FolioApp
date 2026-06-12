-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M55 spec · member.especialidad (especialidad por profesional)
-- ════════════════════════════════════════════════════════════════════════════
-- Verifica:
--   1. La columna member.especialidad existe.
--   2. Default/NULL permitido: un member nuevo sin especialidad queda NULL
--      (semántica "hereda organization.especialidad" — compat Solo).
--   3. Slug válido del registry acepta (INSERT y UPDATE).
--   4. Slug inválido → CHECK member_especialidad_valida falla (INSERT y UPDATE).
--   5. Volver a NULL (re-heredar de la org) está permitido.
--
-- Fixtures como superuser (bypass RLS), patrón de M30/M49/M50/M54 specs.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_org      uuid := gen_random_uuid();
  v_user_a   uuid := gen_random_uuid();
  v_user_b   uuid := gen_random_uuid();
  v_member_a uuid := gen_random_uuid();
  v_member_b uuid := gen_random_uuid();
  v_esp      text;
  v_caught   boolean;
BEGIN
  -- ── 1. columna existe ─────────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'member' AND column_name = 'especialidad'
  ) THEN
    RAISE EXCEPTION 'M55 spec FAIL: columna member.especialidad ausente';
  END IF;

  -- ── fixtures ──────────────────────────────────────────────────────────────
  INSERT INTO organization (id, slug, nombre, especialidad)
    VALUES (v_org, 'm55-spec', 'M55 Member Especialidad Spec', 'cardiologia');
  INSERT INTO auth.users (id, email)
    VALUES (v_user_a, 'a-m55@spec.test'), (v_user_b, 'b-m55@spec.test');
  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version)
    VALUES (v_user_a, 'a-m55@spec.test', now(), 'v1'),
           (v_user_b, 'b-m55@spec.test', now(), 'v1');

  -- ── 2. member sin especialidad → NULL (hereda la org) ─────────────────────
  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at)
    VALUES (v_member_a, v_org, v_user_a, 'OWNER', true, now());
  SELECT especialidad INTO v_esp FROM member WHERE id = v_member_a;
  IF v_esp IS NOT NULL THEN
    RAISE EXCEPTION 'M55 spec FAIL: member nuevo tiene especialidad = % (esperado NULL)', v_esp;
  END IF;

  -- ── 3. slug válido acepta en INSERT ───────────────────────────────────────
  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at, especialidad)
    VALUES (v_member_b, v_org, v_user_b, 'PROFESIONAL', true, now(), 'psicologia');
  SELECT especialidad INTO v_esp FROM member WHERE id = v_member_b;
  IF v_esp IS DISTINCT FROM 'psicologia' THEN
    RAISE EXCEPTION 'M55 spec FAIL: especialidad insertada = % (esperado psicologia)', v_esp;
  END IF;

  -- ── 4a. slug inválido en UPDATE → CHECK falla ─────────────────────────────
  v_caught := false;
  BEGIN
    UPDATE member SET especialidad = 'odontologia' WHERE id = v_member_b;
  EXCEPTION WHEN check_violation THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M55 spec FAIL: UPDATE con slug inválido no fue bloqueado por el CHECK';
  END IF;

  -- ── 4b. slug inválido en INSERT → CHECK falla ─────────────────────────────
  v_caught := false;
  BEGIN
    INSERT INTO member (organization_id, profile_id, role, es_colegiado, especialidad)
      VALUES (v_org, v_user_b, 'PROFESIONAL', true, 'homeopatia');
  EXCEPTION WHEN check_violation THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M55 spec FAIL: INSERT con slug inválido no fue bloqueado por el CHECK';
  END IF;

  -- ── 3b. UPDATE a otro slug válido acepta ──────────────────────────────────
  UPDATE member SET especialidad = 'quiropraxia' WHERE id = v_member_b;
  SELECT especialidad INTO v_esp FROM member WHERE id = v_member_b;
  IF v_esp IS DISTINCT FROM 'quiropraxia' THEN
    RAISE EXCEPTION 'M55 spec FAIL: especialidad actualizada = % (esperado quiropraxia)', v_esp;
  END IF;

  -- ── 5. volver a NULL (re-heredar de la org) permitido ─────────────────────
  UPDATE member SET especialidad = NULL WHERE id = v_member_b;
  SELECT especialidad INTO v_esp FROM member WHERE id = v_member_b;
  IF v_esp IS NOT NULL THEN
    RAISE EXCEPTION 'M55 spec FAIL: especialidad no volvió a NULL (= %)', v_esp;
  END IF;

  RAISE NOTICE 'M55 spec OK: member.especialidad nullable + CHECK contra slugs del registry';
END $$;
