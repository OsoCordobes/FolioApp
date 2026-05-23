-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M33 · Atomic signup bootstrap via SECURITY DEFINER RPC
-- ════════════════════════════════════════════════════════════════════════════
-- Hallazgo auditoría HIGH-7/8/14: signUpAndInitOrganization y
-- bootstrapOrgForAuthenticatedUser implementan el bootstrap del onboarding
-- en 3 statements separados (profile → organization → member) sobre
-- PostgREST. Cada call HTTP es su propia transacción Postgres; no hay
-- atomicidad entre pasos.
--
-- Cuando un paso intermedio falla (timeout transient, RLS hiccup, errno
-- network), el código intenta rollback con DELETEs compensatorios. Pero
-- esos DELETEs también pueden fallar — y si lo hacen, queda data huérfana
-- (org sin profile, profile sin member, member sin org). El usuario reintenta,
-- el listUsers ceiling de 200 lo bloquea, y el sistema acumula garbage.
--
-- Esta migración resuelve la atomicidad real: una sola función plpgsql
-- SECURITY DEFINER que ejecuta los 3 inserts en una transacción Postgres.
-- Si cualquier paso falla, EL POSTGRES rollback automático limpia TODO sin
-- depender de código de aplicación. Garantía dura, no best-effort.
--
-- IDEMPOTENCIA: la función verifica primero si el usuario ya tiene member
-- ACTIVO; si sí, devuelve la org existente (resume scenario). No re-crea.
--
-- SLUG COLLISION: estrategia de retry interna. Si el slug provisional choca,
-- intenta una vez más con sufijo aleatorio de 6 chars. El caller debe
-- pre-pickear con la lógica de "slug-2, slug-3..." si quiere mejor UX para
-- emails comunes.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.bootstrap_org_atomic(
  p_user_id                     uuid,
  p_email                       text,
  p_provisional_slug            text,
  p_consent_ip                  text,
  p_consent_user_agent          text,
  p_consent_legal_text_version  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id         uuid;
  v_member_id      uuid;
  v_existing_org   uuid;
  v_existing_mem   uuid;
  v_existing_slug  text;
  v_slug           text;
  v_now            timestamptz := now();
BEGIN
  -- Validación liviana (la app ya valida con Zod; redundante por defense-in-depth)
  IF p_user_id IS NULL OR p_email IS NULL OR trim(p_email) = '' THEN
    RAISE EXCEPTION 'bootstrap_org_atomic: p_user_id y p_email son obligatorios';
  END IF;
  IF p_provisional_slug IS NULL OR length(trim(p_provisional_slug)) = 0 THEN
    RAISE EXCEPTION 'bootstrap_org_atomic: p_provisional_slug no puede ser vacío';
  END IF;

  -- ── 0. IDEMPOTENCIA: ¿ya tiene membership activa? Devolverla. ────────
  SELECT m.organization_id, m.id, o.slug
    INTO v_existing_org, v_existing_mem, v_existing_slug
    FROM member m
    JOIN organization o ON o.id = m.organization_id AND o.deleted_at IS NULL
    WHERE m.profile_id = p_user_id AND m.deleted_at IS NULL
    LIMIT 1;

  IF v_existing_org IS NOT NULL THEN
    RETURN jsonb_build_object(
      'organization_id', v_existing_org,
      'member_id',       v_existing_mem,
      'slug',            v_existing_slug,
      'created',         false
    );
  END IF;

  -- ── 1. PROFILE (upsert idempotente, persiste consent) ────────────────
  --
  -- Solo escribimos consent_pii_* si están NULL (preservamos el primero,
  -- típico de OAuth/email-confirm flow donde el bootstrap puede correr más
  -- de una vez antes de completar el onboarding).
  INSERT INTO profile (
    id, email, nombre_cifrado, apellido_cifrado, matricula,
    consent_pii_signed_at, consent_pii_text_version, consent_pii_ip, consent_pii_user_agent
  )
  VALUES (
    p_user_id, p_email, NULL, NULL, NULL,
    v_now, p_consent_legal_text_version, p_consent_ip, p_consent_user_agent
  )
  ON CONFLICT (id) DO UPDATE SET
    email                    = COALESCE(profile.email, EXCLUDED.email),
    consent_pii_signed_at    = COALESCE(profile.consent_pii_signed_at, EXCLUDED.consent_pii_signed_at),
    consent_pii_text_version = COALESCE(profile.consent_pii_text_version, EXCLUDED.consent_pii_text_version),
    consent_pii_ip           = COALESCE(profile.consent_pii_ip, EXCLUDED.consent_pii_ip),
    consent_pii_user_agent   = COALESCE(profile.consent_pii_user_agent, EXCLUDED.consent_pii_user_agent);

  -- ── 2. ORGANIZATION (con retry en caso de slug collision) ────────────
  v_slug := p_provisional_slug;
  BEGIN
    INSERT INTO organization (
      slug, nombre, rubro, ciudad, provincia, acento_hex,
      onboarding_completed, onboarding_step_max
    )
    VALUES (
      v_slug, 'Mi consultorio', NULL, NULL, NULL, '#8A6722',
      false, 1
    )
    RETURNING id INTO v_org_id;
  EXCEPTION WHEN unique_violation THEN
    -- Slug taken; retry con sufijo random de 6 chars (probabilidad de
    -- colisión doble: ~1 en 2 billones, suficientemente bueno).
    v_slug := p_provisional_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    INSERT INTO organization (
      slug, nombre, rubro, ciudad, provincia, acento_hex,
      onboarding_completed, onboarding_step_max
    )
    VALUES (
      v_slug, 'Mi consultorio', NULL, NULL, NULL, '#8A6722',
      false, 1
    )
    RETURNING id INTO v_org_id;
  END;

  -- ── 3. MEMBER (OWNER, colegiado por default) ─────────────────────────
  INSERT INTO member (
    organization_id, profile_id, role, es_colegiado, accepted_at
  )
  VALUES (
    v_org_id, p_user_id, 'OWNER', true, v_now
  )
  RETURNING id INTO v_member_id;

  RETURN jsonb_build_object(
    'organization_id', v_org_id,
    'member_id',       v_member_id,
    'slug',            v_slug,
    'created',         true
  );

  -- Cualquier EXCEPTION no manejada arriba causa ROLLBACK automático de
  -- toda la transacción → no quedan filas huérfanas. Garantía atomicity.
END
$$;

REVOKE ALL ON FUNCTION public.bootstrap_org_atomic(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_org_atomic(uuid, text, text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.bootstrap_org_atomic IS
  'M33 · atomic profile+org+member creation. Reemplaza el bootstrap multi-step de signUpAndInitOrganization / bootstrapOrgForAuthenticatedUser. Idempotent (devuelve membership existente si está). Slug collision retry interno. Solo callable por service_role.';
