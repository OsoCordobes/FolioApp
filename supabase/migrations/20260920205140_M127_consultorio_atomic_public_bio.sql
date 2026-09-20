-- M127 · Atomic public practice editor. The exposed function is invoker-only;
-- authorization and the two-row write live in a private definer function.
CREATE SCHEMA IF NOT EXISTS folio_public_editor_private;
REVOKE ALL ON SCHEMA folio_public_editor_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA folio_public_editor_private TO authenticated;

CREATE FUNCTION folio_public_editor_private.save_consultorio(
  p_org uuid, p_member uuid,
  p_expected_org_updated_at timestamptz, p_expected_profile_updated_at timestamptz,
  p_org_patch jsonb, p_profile_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_member public.member;
  v_org public.organization;
  v_profile public.profile;
  v_key text;
BEGIN
  PERFORM folio_mfa_private.assert_access();
  IF v_actor IS NULL OR p_org IS NULL OR p_member IS NULL
     OR p_expected_org_updated_at IS NULL OR p_expected_profile_updated_at IS NULL
     OR p_org_patch IS NULL OR p_profile_patch IS NULL
     OR pg_catalog.jsonb_typeof(p_org_patch) <> 'object'
     OR pg_catalog.jsonb_typeof(p_profile_patch) <> 'object'
     OR (p_org_patch = '{}'::jsonb AND p_profile_patch = '{}'::jsonb) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid practice edit';
  END IF;

  -- This lock conflicts with a role change/revocation until the transaction
  -- commits. No privileged organization write can outrun the membership guard.
  SELECT * INTO v_member FROM public.member m
   WHERE m.id = p_member AND m.organization_id = p_org AND m.profile_id = v_actor
     AND m.deleted_at IS NULL
     AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
     AND m.role IN ('OWNER', 'DIRECTOR')
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Current owner or director membership required';
  END IF;

  SELECT * INTO v_org FROM public.organization o
   WHERE o.id = p_org AND o.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Practice unavailable';
  END IF;
  SELECT * INTO v_profile FROM public.profile p
   WHERE p.id = v_actor FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Profile unavailable';
  END IF;

  FOR v_key IN SELECT pg_catalog.jsonb_object_keys(p_org_patch) LOOP
    IF v_key NOT IN ('nombre', 'bio', 'ciudad', 'provincia', 'telefono_publico',
                     'direccion_completa', 'instagram_handle', 'timezone', 'especialidad')
       OR pg_catalog.jsonb_typeof(p_org_patch -> v_key) NOT IN ('string', 'null')
       OR (v_key IN ('nombre', 'timezone', 'especialidad')
           AND pg_catalog.jsonb_typeof(p_org_patch -> v_key) <> 'string') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid practice field';
    END IF;
  END LOOP;
  FOR v_key IN SELECT pg_catalog.jsonb_object_keys(p_profile_patch) LOOP
    IF v_key NOT IN ('nombre_cifrado', 'apellido_cifrado', 'matricula')
       OR pg_catalog.jsonb_typeof(p_profile_patch -> v_key) NOT IN ('string', 'null')
       OR (v_key IN ('nombre_cifrado', 'apellido_cifrado')
           AND pg_catalog.jsonb_typeof(p_profile_patch -> v_key) <> 'string') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid profile field';
    END IF;
  END LOOP;
  IF p_org_patch ? 'nombre' AND pg_catalog.length(pg_catalog.btrim(p_org_patch ->> 'nombre')) NOT BETWEEN 1 AND 120
     OR p_org_patch ? 'bio' AND p_org_patch ->> 'bio' IS NOT NULL
        AND pg_catalog.length(p_org_patch ->> 'bio') > 280
     OR p_org_patch ? 'ciudad' AND pg_catalog.length(p_org_patch ->> 'ciudad') > 60
     OR p_org_patch ? 'provincia' AND pg_catalog.length(p_org_patch ->> 'provincia') > 60
     OR p_org_patch ? 'telefono_publico' AND pg_catalog.length(p_org_patch ->> 'telefono_publico') > 30
     OR p_org_patch ? 'direccion_completa' AND pg_catalog.length(p_org_patch ->> 'direccion_completa') > 200
     OR p_org_patch ? 'instagram_handle' AND pg_catalog.length(p_org_patch ->> 'instagram_handle') > 40
     OR p_org_patch ? 'timezone' AND pg_catalog.length(p_org_patch ->> 'timezone') NOT BETWEEN 1 AND 60
     OR p_org_patch ? 'especialidad' AND p_org_patch ->> 'especialidad' NOT IN ('quiropraxia', 'cardiologia', 'psicologia', 'kinesiologia', 'nutricion')
     OR p_profile_patch ? 'matricula' AND pg_catalog.length(p_profile_patch ->> 'matricula') > 60 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid practice value';
  END IF;

  IF p_org_patch <> '{}'::jsonb THEN
    IF v_org.updated_at IS DISTINCT FROM p_expected_org_updated_at THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Practice changed since it was opened';
    END IF;
    UPDATE public.organization o SET
      nombre = CASE WHEN p_org_patch ? 'nombre' THEN p_org_patch ->> 'nombre' ELSE o.nombre END,
      bio = CASE WHEN p_org_patch ? 'bio' THEN NULLIF(pg_catalog.btrim(p_org_patch ->> 'bio'), '') ELSE o.bio END,
      ciudad = CASE WHEN p_org_patch ? 'ciudad' THEN p_org_patch ->> 'ciudad' ELSE o.ciudad END,
      provincia = CASE WHEN p_org_patch ? 'provincia' THEN p_org_patch ->> 'provincia' ELSE o.provincia END,
      telefono_publico = CASE WHEN p_org_patch ? 'telefono_publico' THEN p_org_patch ->> 'telefono_publico' ELSE o.telefono_publico END,
      direccion_completa = CASE WHEN p_org_patch ? 'direccion_completa' THEN p_org_patch ->> 'direccion_completa' ELSE o.direccion_completa END,
      instagram_handle = CASE WHEN p_org_patch ? 'instagram_handle' THEN p_org_patch ->> 'instagram_handle' ELSE o.instagram_handle END,
      timezone = CASE WHEN p_org_patch ? 'timezone' THEN p_org_patch ->> 'timezone' ELSE o.timezone END,
      especialidad = CASE WHEN p_org_patch ? 'especialidad' THEN p_org_patch ->> 'especialidad' ELSE o.especialidad END
     WHERE o.id = p_org RETURNING * INTO v_org;
  END IF;
  IF p_profile_patch <> '{}'::jsonb THEN
    IF v_profile.updated_at IS DISTINCT FROM p_expected_profile_updated_at THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Profile changed since it was opened';
    END IF;
    UPDATE public.profile p SET
      nombre_cifrado = CASE WHEN p_profile_patch ? 'nombre_cifrado' THEN (p_profile_patch ->> 'nombre_cifrado')::bytea ELSE p.nombre_cifrado END,
      apellido_cifrado = CASE WHEN p_profile_patch ? 'apellido_cifrado' THEN (p_profile_patch ->> 'apellido_cifrado')::bytea ELSE p.apellido_cifrado END,
      matricula = CASE WHEN p_profile_patch ? 'matricula' THEN p_profile_patch ->> 'matricula' ELSE p.matricula END
     WHERE p.id = v_actor RETURNING * INTO v_profile;
  END IF;
  RETURN pg_catalog.jsonb_build_object('organizationUpdatedAt', v_org.updated_at,
                                        'profileUpdatedAt', v_profile.updated_at);
END
$$;
REVOKE ALL ON FUNCTION folio_public_editor_private.save_consultorio(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION folio_public_editor_private.save_consultorio(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb)
  TO authenticated;

CREATE FUNCTION public.save_consultorio_atomic(
  p_org uuid, p_member uuid,
  p_expected_org_updated_at timestamptz, p_expected_profile_updated_at timestamptz,
  p_org_patch jsonb, p_profile_patch jsonb
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT folio_public_editor_private.save_consultorio(p_org, p_member,
    p_expected_org_updated_at, p_expected_profile_updated_at, p_org_patch, p_profile_patch)
$$;
REVOKE ALL ON FUNCTION public.save_consultorio_atomic(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_consultorio_atomic(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb)
  TO authenticated;
COMMENT ON FUNCTION public.save_consultorio_atomic(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb) IS
  'M127 · Atomic owner/director practice and own-profile edit with locked membership and optimistic revisions.';
