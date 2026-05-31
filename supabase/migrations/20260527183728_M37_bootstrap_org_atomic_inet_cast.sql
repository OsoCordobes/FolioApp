-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M37 · Fix bootstrap_org_atomic: cast p_consent_ip text → inet
-- ════════════════════════════════════════════════════════════════════════════
-- Bug en producción (bloquea onboarding): la RPC M33 recibe p_consent_ip como
-- text (viene del header x-forwarded-for / x-real-ip) y lo inserta directo en
-- profile.consent_pii_ip, que es de tipo `inet`. Postgres NO tiene assignment
-- cast implícito text→inet, así que el INSERT falla con:
--
--   column "consent_pii_ip" is of type inet but expression is of type text
--
-- y todo el bootstrap aborta → el usuario nunca puede crear su consultorio.
--
-- Fix: parsear el IP defensivamente a inet ANTES del insert. El IP es metadata
-- best-effort para el audit trail de consentimiento (Ley 25.326 art. 14); no
-- debe poder tumbar el signup. Si el valor viene vacío o malformado (proxies
-- raros, IPv6 con puerto, lista x-forwarded-for sucia), guardamos NULL en vez
-- de romper la transacción entera.
--
-- Migración append-only: reemplaza la función vía CREATE OR REPLACE. No toca
-- M33 (historia inmutable). En un DB nuevo, M33 crea la versión con bug y M37
-- la corrige acto seguido — la función rota nunca llega a ejecutarse en el medio.
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
  v_consent_ip     inet;
  v_now            timestamptz := now();
BEGIN
  -- Validación liviana (la app ya valida con Zod; redundante por defense-in-depth)
  IF p_user_id IS NULL OR p_email IS NULL OR trim(p_email) = '' THEN
    RAISE EXCEPTION 'bootstrap_org_atomic: p_user_id y p_email son obligatorios';
  END IF;
  IF p_provisional_slug IS NULL OR length(trim(p_provisional_slug)) = 0 THEN
    RAISE EXCEPTION 'bootstrap_org_atomic: p_provisional_slug no puede ser vacío';
  END IF;

  -- ── IP de consentimiento: parse defensivo text → inet ────────────────
  -- Metadata best-effort para el audit trail; nunca debe abortar el bootstrap.
  -- Vacío o malformado → NULL.
  BEGIN
    v_consent_ip := NULLIF(trim(p_consent_ip), '')::inet;
  EXCEPTION WHEN others THEN
    v_consent_ip := NULL;
  END;

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
    v_now, p_consent_legal_text_version, v_consent_ip, p_consent_user_agent
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
  'M33+M37 · atomic profile+org+member creation. M37 fix: p_consent_ip se castea defensivamente text→inet (vacío/malformado → NULL) antes del insert, que antes rompía con "is of type inet but expression is of type text". Idempotent. Slug collision retry interno. Solo callable por service_role.';
