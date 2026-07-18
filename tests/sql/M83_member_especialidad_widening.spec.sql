-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M83 spec · widening de member.especialidad → kinesiologia + nutricion
-- ════════════════════════════════════════════════════════════════════════════
-- Remediación del gap de lockstep detectado en la review adversarial: M74/M75
-- ampliaron el CHECK de especialidad en organization e intake, pero NO en
-- member.especialidad (M55). M83 lo alinea. Verifica:
--   1. La columna member.especialidad sigue existiendo (regresión M55).
--   2. NULL sigue permitido (semántica "hereda organization.especialidad").
--   3. Los slugs previos (quiropraxia/cardiologia/psicologia) siguen aceptando.
--   4. Los slugs NUEVOS (kinesiologia, nutricion) aceptan en INSERT y en UPDATE.
--   5. Un slug fuera del registry ('odontologia') sigue siendo rechazado por el
--      CHECK member_especialidad_valida (el widening SOLO agrega, no afloja).
--
-- Fixtures como superuser (bypass RLS), patrón de M50/M55 specs.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_org      uuid := gen_random_uuid();
  v_user_a   uuid := gen_random_uuid();
  v_user_b   uuid := gen_random_uuid();
  v_user_c   uuid := gen_random_uuid();
  v_member_a uuid := gen_random_uuid();
  v_member_b uuid := gen_random_uuid();
  v_esp      text;
  v_caught   boolean;
BEGIN
  -- ── 1. columna existe (regresión) ─────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'member' AND column_name = 'especialidad'
  ) THEN
    RAISE EXCEPTION 'M83 spec FAIL: columna member.especialidad ausente';
  END IF;

  -- ── fixtures ──────────────────────────────────────────────────────────────
  INSERT INTO organization (id, slug, nombre, especialidad)
    VALUES (v_org, 'm83-spec', 'M83 Member Especialidad Widening Spec', 'kinesiologia');
  INSERT INTO auth.users (id, email)
    VALUES (v_user_a, 'a-m83@spec.test'),
           (v_user_b, 'b-m83@spec.test'),
           (v_user_c, 'c-m83@spec.test');
  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version)
    VALUES (v_user_a, 'a-m83@spec.test', now(), 'v1'),
           (v_user_b, 'b-m83@spec.test', now(), 'v1'),
           (v_user_c, 'c-m83@spec.test', now(), 'v1');

  -- ── 2. member sin especialidad → NULL permitido ───────────────────────────
  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at)
    VALUES (v_member_a, v_org, v_user_a, 'OWNER', true, now());
  SELECT especialidad INTO v_esp FROM member WHERE id = v_member_a;
  IF v_esp IS NOT NULL THEN
    RAISE EXCEPTION 'M83 spec FAIL: member nuevo tiene especialidad = % (esperado NULL)', v_esp;
  END IF;

  -- ── 3. slug previo (psicologia) sigue aceptando en INSERT (regresión) ──────
  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at, especialidad)
    VALUES (v_member_b, v_org, v_user_b, 'PROFESIONAL', true, now(), 'psicologia');

  -- ── 4a. slug NUEVO 'kinesiologia' acepta en UPDATE ────────────────────────
  UPDATE member SET especialidad = 'kinesiologia' WHERE id = v_member_b;
  SELECT especialidad INTO v_esp FROM member WHERE id = v_member_b;
  IF v_esp IS DISTINCT FROM 'kinesiologia' THEN
    RAISE EXCEPTION 'M83 spec FAIL: UPDATE a kinesiologia no persistió (= %)', v_esp;
  END IF;

  -- ── 4b. slug NUEVO 'nutricion' acepta en UPDATE ───────────────────────────
  UPDATE member SET especialidad = 'nutricion' WHERE id = v_member_b;
  SELECT especialidad INTO v_esp FROM member WHERE id = v_member_b;
  IF v_esp IS DISTINCT FROM 'nutricion' THEN
    RAISE EXCEPTION 'M83 spec FAIL: UPDATE a nutricion no persistió (= %)', v_esp;
  END IF;

  -- ── 4c. slug NUEVO acepta también en INSERT (usuario fresco: la tabla tiene
  --        UNIQUE (organization_id, profile_id), así que no se reusa v_user_a/b) ─
  INSERT INTO member (organization_id, profile_id, role, es_colegiado, especialidad)
    VALUES (v_org, v_user_c, 'PROFESIONAL', true, 'kinesiologia');

  -- ── 5. slug fuera del registry sigue rechazado por el CHECK ───────────────
  v_caught := false;
  BEGIN
    UPDATE member SET especialidad = 'odontologia' WHERE id = v_member_b;
  EXCEPTION WHEN check_violation THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M83 spec FAIL: slug fuera del registry no fue bloqueado por el CHECK (el widening aflojó de más)';
  END IF;

  RAISE NOTICE 'M83 spec OK: member.especialidad acepta kinesiologia/nutricion, sigue rechazando slugs desconocidos';
END $$;
