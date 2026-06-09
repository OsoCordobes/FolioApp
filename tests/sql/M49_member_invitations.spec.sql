-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M49 spec · clinic mode (organization.tipo + member invitations)
-- ════════════════════════════════════════════════════════════════════════════
-- Verifica:
--   1. enum organizacion_tipo + columna organization.tipo (default INDEPENDIENTE).
--   2. tabla member_invitation con RLS habilitada/forzada + índices clave.
--   3. get_invitation_preview devuelve datos no sensibles por token.
--   4. accept_member_invitation materializa profile (con consentimiento) + member.
--   5. Idempotencia: re-aceptar devuelve el mismo member sin duplicar.
--   6. Guard: email de sesión ≠ email de invitación → excepción.
--   7. Guard: invitación expirada → excepción + estado EXPIRADA.
--
-- NOTA: este spec sobreescribe auth.uid() para simular la sesión del invitado
-- (en CI auth.uid() devuelve NULL). Lo restaura a NULL al final para no
-- contaminar specs posteriores.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_org      uuid := gen_random_uuid();
  v_owner    uuid := gen_random_uuid();
  v_invitee  uuid := gen_random_uuid();
  v_owner_m  uuid := gen_random_uuid();
  v_member   uuid;
  v_res      jsonb;
  v_caught   boolean;
BEGIN
  -- ── 1. enum + columna tipo ────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organizacion_tipo') THEN
    RAISE EXCEPTION 'M49 spec FAIL: enum organizacion_tipo ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organization' AND column_name = 'tipo'
  ) THEN
    RAISE EXCEPTION 'M49 spec FAIL: columna organization.tipo ausente';
  END IF;

  -- ── 2. tabla + RLS + índices ─────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'member_invitation') THEN
    RAISE EXCEPTION 'M49 spec FAIL: tabla member_invitation ausente';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE relname = 'member_invitation') THEN
    RAISE EXCEPTION 'M49 spec FAIL: RLS no habilitada/forzada en member_invitation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE tablename = 'member_invitation'
                   AND indexname = 'member_invitation_pending_unique') THEN
    RAISE EXCEPTION 'M49 spec FAIL: índice parcial pending_unique ausente';
  END IF;

  -- ── Fixtures (superuser → bypass RLS) ────────────────────────────────────
  INSERT INTO auth.users (id, email) VALUES
    (v_owner,   'owner-m49@spec.test'),
    (v_invitee, 'invitee-m49@spec.test');
  INSERT INTO organization (id, slug, nombre, tipo)
    VALUES (v_org, 'm49-spec', 'M49 Clínica Spec', 'CLINICA');
  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version)
    VALUES (v_owner, 'owner-m49@spec.test', now(), 'v1');
  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at)
    VALUES (v_owner_m, v_org, v_owner, 'OWNER', true, now());
  INSERT INTO member_invitation (organization_id, email, role, es_colegiado, token_hash, invited_by_member_id)
    VALUES (v_org, 'invitee-m49@spec.test', 'PROFESIONAL', true,
            encode(digest('m49-token-ok', 'sha256'), 'hex'), v_owner_m);

  -- Simular la sesión del invitado.
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT %L::uuid $f$',
    v_invitee
  );

  -- ── 3. preview ───────────────────────────────────────────────────────────
  v_res := public.get_invitation_preview('m49-token-ok');
  IF v_res IS NULL OR v_res->>'role' <> 'PROFESIONAL'
     OR v_res->>'organization_name' <> 'M49 Clínica Spec' THEN
    RAISE EXCEPTION 'M49 spec FAIL: preview inesperado: %', v_res;
  END IF;

  -- ── 4. accept materializa member + consentimiento ────────────────────────
  v_res := public.accept_member_invitation('m49-token-ok', '9.9.9.9', 'spec-UA', 'v1');
  IF (v_res->>'created')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'M49 spec FAIL: accept no marcó created=true: %', v_res;
  END IF;
  SELECT id INTO v_member FROM member
    WHERE organization_id = v_org AND profile_id = v_invitee AND deleted_at IS NULL;
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'M49 spec FAIL: member no materializado';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM profile
    WHERE id = v_invitee AND consent_pii_signed_at IS NOT NULL
      AND consent_pii_text_version = 'v1'
  ) THEN
    RAISE EXCEPTION 'M49 spec FAIL: consentimiento del invitado no registrado';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM member_invitation
    WHERE organization_id = v_org AND lower(email) = 'invitee-m49@spec.test'
      AND estado = 'ACEPTADA' AND accepted_by_profile_id = v_invitee
  ) THEN
    RAISE EXCEPTION 'M49 spec FAIL: invitación no marcada ACEPTADA';
  END IF;

  -- ── 5. idempotencia ──────────────────────────────────────────────────────
  v_res := public.accept_member_invitation('m49-token-ok');
  IF (v_res->>'created')::boolean IS DISTINCT FROM false
     OR (v_res->>'member_id')::uuid <> v_member THEN
    RAISE EXCEPTION 'M49 spec FAIL: re-accept no idempotente: %', v_res;
  END IF;

  -- ── 6. guard: email mismatch ─────────────────────────────────────────────
  INSERT INTO member_invitation (organization_id, email, role, token_hash, invited_by_member_id)
    VALUES (v_org, 'otro-m49@spec.test', 'ASISTENTE',
            encode(digest('m49-token-mismatch', 'sha256'), 'hex'), v_owner_m);
  v_caught := false;
  BEGIN
    PERFORM public.accept_member_invitation('m49-token-mismatch'); -- uid sigue = invitee
  EXCEPTION WHEN others THEN v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M49 spec FAIL: email mismatch no bloqueado';
  END IF;

  -- ── 7. guard: expirada ───────────────────────────────────────────────────
  INSERT INTO member_invitation (organization_id, email, role, token_hash, invited_by_member_id, expires_at)
    VALUES (v_org, 'invitee-m49@spec.test', 'PROFESIONAL',
            encode(digest('m49-token-expired', 'sha256'), 'hex'), v_owner_m,
            now() - interval '1 day');
  v_caught := false;
  BEGIN
    PERFORM public.accept_member_invitation('m49-token-expired');
  EXCEPTION WHEN others THEN v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M49 spec FAIL: invitación expirada no bloqueada';
  END IF;
  -- La transacción que levanta excepción hace rollback: la invitación expirada
  -- permanece PENDIENTE en DB (el barrido/listado la marca EXPIRADA aparte).
  IF NOT EXISTS (
    SELECT 1 FROM member_invitation
    WHERE token_hash = encode(digest('m49-token-expired', 'sha256'), 'hex')
      AND estado = 'PENDIENTE'
  ) THEN
    RAISE EXCEPTION 'M49 spec FAIL: invitación expirada debería seguir PENDIENTE tras rollback';
  END IF;
  -- Y NO debe haberse creado membership para una invitación expirada.
  IF EXISTS (
    SELECT 1 FROM member m
    JOIN profile p ON p.id = m.profile_id
    WHERE m.organization_id = v_org AND p.email = 'invitee-m49@spec.test'
      AND m.role = 'PROFESIONAL' AND m.created_at > now() - interval '1 second'
      AND m.id <> v_member
  ) THEN
    RAISE EXCEPTION 'M49 spec FAIL: se creó membership desde invitación expirada';
  END IF;

  RAISE NOTICE 'M49 spec OK';
END $$;

-- Restaurar auth.uid() a NULL (estado de CI) para no contaminar specs posteriores.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
