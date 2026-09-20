-- M126 · Typed, serialized bootstrap for the new onboarding. The six-argument
-- M33/M37 RPC remains intact for already deployed clients.
CREATE SCHEMA IF NOT EXISTS folio_onboarding_private;
REVOKE ALL ON SCHEMA folio_onboarding_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA folio_onboarding_private TO service_role;

CREATE FUNCTION folio_onboarding_private.bootstrap_org_typed_core(
  p_user_id uuid, p_email text, p_provisional_slug text,
  p_consent_ip text, p_consent_user_agent text,
  p_consent_legal_text_version text, p_tipo text,
  p_owner_tratante boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_org_id uuid;
  v_member_id uuid;
  v_slug text;
  v_consent_ip inet;
  v_existing record;
  v_now timestamptz := now();
BEGIN
  IF p_user_id IS NULL OR NULLIF(trim(p_email), '') IS NULL
     OR NULLIF(trim(p_provisional_slug), '') IS NULL
     OR p_tipo IS NULL OR p_tipo NOT IN ('INDEPENDIENTE', 'CLINICA')
     OR p_owner_tratante IS NULL
     OR (p_tipo = 'INDEPENDIENTE' AND NOT p_owner_tratante) THEN
    RAISE EXCEPTION 'Selección de modalidad y titular inválida' USING ERRCODE = '22023';
  END IF;
  -- One transaction per identity. A repeated or concurrent request must return
  -- the stored membership, never create a second org or change its modality.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 126));
  SELECT m.id AS member_id, m.es_colegiado, m.role,
         o.id AS organization_id, o.slug, o.tipo, o.onboarding_completed
    INTO v_existing
    FROM public.member m JOIN public.organization o
      ON o.id = m.organization_id AND o.deleted_at IS NULL
   WHERE m.profile_id = p_user_id AND m.deleted_at IS NULL
     AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
   ORDER BY m.created_at, m.id LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('organization_id',v_existing.organization_id,
      'member_id',v_existing.member_id,'slug',v_existing.slug,'created',false,
      'tipo',v_existing.tipo,'owner_tratante',v_existing.es_colegiado,
      'role',v_existing.role,'onboarding_completed',v_existing.onboarding_completed);
  END IF;

  BEGIN
    v_consent_ip := NULLIF(trim(p_consent_ip), '')::inet;
  EXCEPTION WHEN others THEN
    v_consent_ip := NULL;
  END;
  INSERT INTO public.profile(id,email,nombre_cifrado,apellido_cifrado,matricula,
    consent_pii_signed_at,consent_pii_text_version,consent_pii_ip,consent_pii_user_agent)
  VALUES(p_user_id,p_email,NULL,NULL,NULL,v_now,p_consent_legal_text_version,
    v_consent_ip,p_consent_user_agent)
  ON CONFLICT(id) DO UPDATE SET
    email=COALESCE(profile.email,EXCLUDED.email),
    consent_pii_signed_at=COALESCE(profile.consent_pii_signed_at,EXCLUDED.consent_pii_signed_at),
    consent_pii_text_version=COALESCE(profile.consent_pii_text_version,EXCLUDED.consent_pii_text_version),
    consent_pii_ip=COALESCE(profile.consent_pii_ip,EXCLUDED.consent_pii_ip),
    consent_pii_user_agent=COALESCE(profile.consent_pii_user_agent,EXCLUDED.consent_pii_user_agent);

  v_slug := p_provisional_slug;
  BEGIN
    INSERT INTO public.organization(slug,nombre,rubro,ciudad,provincia,acento_hex,
      tipo,onboarding_completed,onboarding_step_max)
    VALUES(v_slug,CASE WHEN p_tipo='CLINICA' THEN 'Mi clínica' ELSE 'Mi consultorio' END,
      NULL,NULL,NULL,'#8A6722',p_tipo::public.organizacion_tipo,false,1)
    RETURNING id INTO v_org_id;
  EXCEPTION WHEN unique_violation THEN
    v_slug := p_provisional_slug || '-' || substr(replace(pg_catalog.gen_random_uuid()::text,'-',''),1,6);
    INSERT INTO public.organization(slug,nombre,rubro,ciudad,provincia,acento_hex,
      tipo,onboarding_completed,onboarding_step_max)
    VALUES(v_slug,CASE WHEN p_tipo='CLINICA' THEN 'Mi clínica' ELSE 'Mi consultorio' END,
      NULL,NULL,NULL,'#8A6722',p_tipo::public.organizacion_tipo,false,1)
    RETURNING id INTO v_org_id;
  END;
  INSERT INTO public.member(organization_id,profile_id,role,es_colegiado,accepted_at)
  VALUES(v_org_id,p_user_id,'OWNER',p_owner_tratante,v_now)
  RETURNING id INTO v_member_id;
  RETURN jsonb_build_object('organization_id',v_org_id,'member_id',v_member_id,
    'slug',v_slug,'created',true,'tipo',p_tipo,
    'owner_tratante',p_owner_tratante,'role','OWNER','onboarding_completed',false);
END
$$;

REVOKE ALL ON FUNCTION folio_onboarding_private.bootstrap_org_typed_core(uuid,text,text,text,text,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION folio_onboarding_private.bootstrap_org_typed_core(uuid,text,text,text,text,text,text,boolean) TO service_role;

-- Only an invoker wrapper is exposed through PostgREST. The private core owns
-- the cross-table transaction because service_role lacks direct table grants.
CREATE FUNCTION public.bootstrap_org_typed_atomic(
  p_user_id uuid, p_email text, p_provisional_slug text,
  p_consent_ip text, p_consent_user_agent text,
  p_consent_legal_text_version text, p_tipo text,
  p_owner_tratante boolean
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT folio_onboarding_private.bootstrap_org_typed_core(p_user_id,p_email,
  p_provisional_slug,p_consent_ip,p_consent_user_agent,
  p_consent_legal_text_version,p_tipo,p_owner_tratante)
$$;
REVOKE ALL ON FUNCTION public.bootstrap_org_typed_atomic(uuid,text,text,text,text,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_org_typed_atomic(uuid,text,text,text,text,text,text,boolean) TO service_role;
COMMENT ON FUNCTION public.bootstrap_org_typed_atomic(uuid,text,text,text,text,text,text,boolean) IS
  'M126 · service-only typed bootstrap; serializes by user and never modifies an existing membership.';

-- Preserve the old six-argument RPC for deployed clients. Both entry points
-- now take the same per-user advisory lock inside the typed core, so an older
-- browser cannot race a new one into creating two organizations.
CREATE OR REPLACE FUNCTION public.bootstrap_org_atomic(
  p_user_id uuid, p_email text, p_provisional_slug text,
  p_consent_ip text, p_consent_user_agent text,
  p_consent_legal_text_version text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  v_result := public.bootstrap_org_typed_atomic(p_user_id,p_email,
    p_provisional_slug,p_consent_ip,p_consent_user_agent,
    p_consent_legal_text_version,'INDEPENDIENTE',true);
  RETURN jsonb_build_object('organization_id',v_result->'organization_id',
    'member_id',v_result->'member_id','slug',v_result->'slug',
    'created',v_result->'created');
END
$$;
REVOKE ALL ON FUNCTION public.bootstrap_org_atomic(uuid,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_org_atomic(uuid,text,text,text,text,text) TO service_role;
