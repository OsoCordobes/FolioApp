-- Atomic administrative editors. M148/M149 and their incorporation API are unchanged.
-- The private helper only pins authority/link rows. Public invokers perform DML under RLS.
CREATE SCHEMA folio_editor_private;
REVOKE ALL ON SCHEMA folio_editor_private FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA folio_editor_private TO authenticated;

CREATE FUNCTION folio_editor_private.lock_scope(
  p_kind text,p_org uuid,p_patient uuid,p_actor uuid,p_role text,p_session uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid:=auth.uid(); actor public.member; account public.paciente_cuenta;
  patient public.paciente; live_session auth.sessions; attended boolean:=false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR uid IS NULL
    OR p_kind NOT IN ('contact','coverage','portal') OR p_kind IS NULL
    OR p_session IS NULL OR auth.jwt()->>'session_id' IS DISTINCT FROM p_session::text
    OR p_org IS NULL OR p_patient IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required';
  END IF;
  -- Pin the parent sources too: new factor/protected-account/member inserts cannot
  -- turn an absent source into a new authority/MFA requirement during this write.
  PERFORM 1 FROM auth.users WHERE id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required'; END IF;
  PERFORM 1 FROM public.profile WHERE id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required'; END IF;
  PERFORM 1 FROM folio_mfa_private.policy WHERE singleton FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required'; END IF;
  SELECT * INTO live_session FROM auth.sessions WHERE id=p_session AND user_id=uid FOR SHARE;
  IF NOT FOUND OR (live_session.not_after IS NOT NULL AND live_session.not_after<=now()) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required';
  END IF;
  PERFORM 1 FROM auth.mfa_factors WHERE user_id=uid ORDER BY id FOR SHARE;
  PERFORM 1 FROM folio_mfa_private.protected_account WHERE user_id=uid FOR SHARE;
  -- M101's staff test is account-wide, including accepted memberships in other orgs.
  PERFORM 1 FROM public.member WHERE profile_id=uid ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.organization WHERE id IN
    (SELECT organization_id FROM public.member WHERE profile_id=uid) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.organization WHERE id=p_org AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required'; END IF;
  -- A fresh statement after waits, with requirement/session/factor sources pinned.
  PERFORM folio_mfa_private.assert_access();
  IF p_kind='portal' THEN
    IF p_role IS DISTINCT FROM 'PORTAL' THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required';
    END IF;
    SELECT * INTO account FROM public.paciente_cuenta
      WHERE id=p_actor AND auth_user_id=uid AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required'; END IF;
  ELSE
    SELECT * INTO actor FROM public.member WHERE id=p_actor AND profile_id=uid
      AND organization_id=p_org AND deleted_at IS NULL
      AND (accepted_at IS NOT NULL OR invited_by_id IS NULL) FOR SHARE;
    IF NOT FOUND OR actor.role::text IS DISTINCT FROM p_role
      OR p_role NOT IN ('OWNER','DIRECTOR','PROFESIONAL','ASISTENTE') THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required';
    END IF;
    -- Pin a witness before patient/identity, just as the existing SELECT policy uses it.
    IF actor.role='PROFESIONAL' THEN
      PERFORM 1 FROM public.turno WHERE organization_id=p_org AND paciente_id=p_patient
        AND profesional_id=actor.id AND estado IN ('EN_SALA','ATENDIENDO','CERRADO')
        ORDER BY id LIMIT 1 FOR SHARE;
      attended:=FOUND;
    END IF;
  END IF;
  SELECT * INTO patient FROM public.paciente WHERE id=p_patient AND organization_id=p_org
    AND deleted_at IS NULL AND pseudonimizado_en IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required'; END IF;
  IF p_kind='portal' THEN
    -- This remains mandatory for dual-role users; staff RLS is never a portal shortcut.
    IF patient.cuenta_id IS DISTINCT FROM account.id THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required';
    END IF;
  ELSE
    -- Preserve the current patient SELECT scope. No intake AAL2/colegiation rule is copied.
    IF NOT public.can_read_clinical(p_org)
      OR (patient.caja_fuerte_profesional IS NOT NULL AND patient.caja_fuerte_profesional<>actor.id)
      OR (actor.role='PROFESIONAL' AND patient.profesional_principal_id IS DISTINCT FROM actor.id AND NOT attended) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required';
    END IF;
  END IF;
  PERFORM 1 FROM public.paciente_identidad WHERE id=patient.identidad_id
    AND organization_id=p_org AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required'; END IF;
  -- All mutable authority sources and the current link are now held until transaction end.
  PERFORM folio_mfa_private.assert_access();
END $$;
REVOKE ALL ON FUNCTION folio_editor_private.lock_scope(text,uuid,uuid,uuid,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION folio_editor_private.lock_scope(text,uuid,uuid,uuid,text,uuid) TO authenticated;

CREATE FUNCTION folio_editor_private.revision_valid(p_revision text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT coalesce(p_revision ~ '^(0|[1-9][0-9]*)$' AND length(p_revision)<=19
    AND (length(p_revision)<19 OR p_revision COLLATE "C"<='9223372036854775807' COLLATE "C"),false)
$$;
REVOKE ALL ON FUNCTION folio_editor_private.revision_valid(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION folio_editor_private.revision_valid(text) TO authenticated;

CREATE FUNCTION folio_editor_private.patch_valid(p_kind text,p_patch jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE field text; value jsonb; text_value text; allowed text[]; required text[];
  cipher_fields text[]:=ARRAY['nombre_cifrado','apellido_cifrado','telefono_cifrado','email_cifrado',
    'ocupacion_cifrado','cobertura_nro_afiliado_cifrado','domicilio_calle_cifrado','domicilio_numero_cifrado'];
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
    OR p_patch='{}'::jsonb OR pg_column_size(p_patch)>32768 THEN RETURN false; END IF;
  CASE p_kind
    WHEN 'contact' THEN
      allowed:=ARRAY['nombre_cifrado','apellido_cifrado','nombre_hash','telefono_cifrado','telefono_hash',
        'email_cifrado','email_hash','ocupacion_cifrado']; required:=allowed;
    WHEN 'coverage' THEN
      allowed:=ARRAY['cobertura_nombre','cobertura_plan','cobertura_nro_afiliado_cifrado']; required:=allowed;
    WHEN 'portal' THEN
      allowed:=ARRAY['email_cifrado','email_hash','telefono_cifrado','telefono_hash','domicilio_calle_cifrado',
        'domicilio_numero_cifrado','domicilio_ciudad','domicilio_provincia','domicilio_cp']; required:=ARRAY[]::text[];
    ELSE RETURN false;
  END CASE;
  IF p_patch-allowed<>'{}'::jsonb OR NOT p_patch ?& required THEN RETURN false; END IF;
  FOR field,value IN SELECT entry.key,entry.value FROM jsonb_each(p_patch) AS entry LOOP
    text_value:=value#>>'{}';
    IF jsonb_typeof(value)='null' THEN
      IF field IN ('nombre_cifrado','apellido_cifrado','nombre_hash','telefono_cifrado','telefono_hash') THEN RETURN false; END IF;
    ELSIF jsonb_typeof(value) IS DISTINCT FROM 'string' THEN RETURN false;
    ELSIF field=ANY(cipher_fields) THEN
      -- App bytea hex, not a base64/string double encoding. SQL cannot verify AES/HMAC.
      IF left(text_value,2)<>(chr(92)||'x') OR length(text_value) NOT BETWEEN 60 AND 16386
        OR length(text_value)%2<>0 OR substr(text_value,3)!~'^[0-9a-f]+$' THEN RETURN false; END IF;
    ELSIF field IN ('nombre_hash','telefono_hash','email_hash') THEN
      IF text_value !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
    ELSIF length(text_value) NOT BETWEEN 1 AND (CASE field
      WHEN 'cobertura_nombre' THEN 120 WHEN 'cobertura_plan' THEN 40
      WHEN 'domicilio_cp' THEN 15 ELSE 60 END) THEN RETURN false;
    END IF;
  END LOOP;
  IF (p_patch ? 'email_cifrado')<>(p_patch ? 'email_hash')
    OR ((p_patch ? 'email_cifrado') AND ((p_patch->>'email_cifrado' IS NULL)<>(p_patch->>'email_hash' IS NULL)))
    OR (p_patch ? 'telefono_cifrado')<>(p_patch ? 'telefono_hash') THEN RETURN false; END IF;
  IF p_kind='coverage' AND p_patch->>'cobertura_nombre' IS NULL
    AND (p_patch->>'cobertura_plan' IS NOT NULL OR p_patch->>'cobertura_nro_afiliado_cifrado' IS NOT NULL) THEN RETURN false; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION folio_editor_private.patch_valid(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION folio_editor_private.patch_valid(text,jsonb) TO authenticated;

CREATE FUNCTION public.patient_admin_contact_cas(
  p_org uuid,p_patient uuid,p_identity uuid,p_admin_revision text,p_link_revision text,
  p_actor uuid,p_actor_role text,p_session uuid,p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE patient public.paciente; identity_row public.paciente_identidad; after_revision bigint;
BEGIN
  IF NOT folio_editor_private.revision_valid(p_admin_revision)
    OR NOT folio_editor_private.revision_valid(p_link_revision)
    OR p_identity IS NULL OR NOT folio_editor_private.patch_valid('contact',p_patch) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid administrative editor input';
  END IF;
  PERFORM folio_editor_private.lock_scope('contact',p_org,p_patient,p_actor,p_actor_role,p_session);
  -- RLS visibility is rechecked after the helper's waits. No new patient UPDATE grant.
  SELECT * INTO patient FROM public.paciente WHERE id=p_patient AND organization_id=p_org
    AND deleted_at IS NULL AND pseudonimizado_en IS NULL;
  IF NOT FOUND  THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required';
  END IF;
  SELECT * INTO identity_row FROM public.paciente_identidad WHERE id=patient.identidad_id
    AND organization_id=p_org AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required'; END IF;
  -- A changed link is a conflict only while BOTH current rows remain authorized.
  -- Link revision rejects ABA even if the identity returns to its original value.
  IF patient.identidad_id IS DISTINCT FROM p_identity
    OR patient.identity_link_revision<>p_link_revision::bigint
    OR identity_row.admin_revision<>p_admin_revision::bigint THEN
    RETURN jsonb_build_object('status','conflict');
  END IF;
  UPDATE public.paciente_identidad SET nombre_cifrado=(p_patch->>'nombre_cifrado')::bytea,
      apellido_cifrado=(p_patch->>'apellido_cifrado')::bytea,nombre_hash=p_patch->>'nombre_hash',
      telefono_cifrado=(p_patch->>'telefono_cifrado')::bytea,telefono_hash=p_patch->>'telefono_hash',
      email_cifrado=(p_patch->>'email_cifrado')::bytea,email_hash=p_patch->>'email_hash',
      ocupacion_cifrado=(p_patch->>'ocupacion_cifrado')::bytea
    WHERE id=p_identity AND organization_id=p_org AND deleted_at IS NULL
      AND admin_revision=p_admin_revision::bigint RETURNING admin_revision INTO after_revision;
  IF NOT FOUND THEN
    -- Zero rows with locked matching versions means current UPDATE RLS rejected DML.
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required';
  END IF;
  RETURN jsonb_build_object('status',CASE WHEN after_revision=identity_row.admin_revision THEN 'unchanged' ELSE 'applied' END,
    'adminRevision',after_revision::text,'identityLinkRevision',patient.identity_link_revision::text);
END $$;
REVOKE ALL ON FUNCTION public.patient_admin_contact_cas(uuid,uuid,uuid,text,text,uuid,text,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.patient_admin_contact_cas(uuid,uuid,uuid,text,text,uuid,text,uuid,jsonb) TO authenticated;

CREATE FUNCTION public.patient_admin_coverage_cas(
  p_org uuid,p_patient uuid,p_identity uuid,p_admin_revision text,p_link_revision text,
  p_actor uuid,p_actor_role text,p_session uuid,p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE patient public.paciente; identity_row public.paciente_identidad; after_revision bigint;
BEGIN
  IF NOT folio_editor_private.revision_valid(p_admin_revision)
    OR NOT folio_editor_private.revision_valid(p_link_revision)
    OR p_identity IS NULL OR NOT folio_editor_private.patch_valid('coverage',p_patch) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid administrative editor input';
  END IF;
  PERFORM folio_editor_private.lock_scope('coverage',p_org,p_patient,p_actor,p_actor_role,p_session);
  -- RLS visibility is rechecked after the helper's waits. No new patient UPDATE grant.
  SELECT * INTO patient FROM public.paciente WHERE id=p_patient AND organization_id=p_org
    AND deleted_at IS NULL AND pseudonimizado_en IS NULL;
  IF NOT FOUND  THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required';
  END IF;
  SELECT * INTO identity_row FROM public.paciente_identidad WHERE id=patient.identidad_id
    AND organization_id=p_org AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required'; END IF;
  -- A changed link is a conflict only while BOTH current rows remain authorized.
  -- Link revision rejects ABA even if the identity returns to its original value.
  IF patient.identidad_id IS DISTINCT FROM p_identity
    OR patient.identity_link_revision<>p_link_revision::bigint
    OR identity_row.admin_revision<>p_admin_revision::bigint THEN
    RETURN jsonb_build_object('status','conflict');
  END IF;
  UPDATE public.paciente_identidad SET cobertura_nombre=p_patch->>'cobertura_nombre',cobertura_plan=p_patch->>'cobertura_plan',
      cobertura_nro_afiliado_cifrado=(p_patch->>'cobertura_nro_afiliado_cifrado')::bytea
    WHERE id=p_identity AND organization_id=p_org AND deleted_at IS NULL
      AND admin_revision=p_admin_revision::bigint RETURNING admin_revision INTO after_revision;
  IF NOT FOUND THEN
    -- Zero rows with locked matching versions means current UPDATE RLS rejected DML.
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required';
  END IF;
  RETURN jsonb_build_object('status',CASE WHEN after_revision=identity_row.admin_revision THEN 'unchanged' ELSE 'applied' END,
    'adminRevision',after_revision::text,'identityLinkRevision',patient.identity_link_revision::text);
END $$;
REVOKE ALL ON FUNCTION public.patient_admin_coverage_cas(uuid,uuid,uuid,text,text,uuid,text,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.patient_admin_coverage_cas(uuid,uuid,uuid,text,text,uuid,text,uuid,jsonb) TO authenticated;

CREATE FUNCTION public.patient_portal_contact_cas(
  p_org uuid,p_patient uuid,p_identity uuid,p_admin_revision text,p_link_revision text,
  p_actor uuid,p_actor_role text,p_session uuid,p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE patient public.paciente; identity_row public.paciente_identidad; after_revision bigint;
BEGIN
  IF NOT folio_editor_private.revision_valid(p_admin_revision)
    OR NOT folio_editor_private.revision_valid(p_link_revision)
    OR p_identity IS NULL OR NOT folio_editor_private.patch_valid('portal',p_patch) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid administrative editor input';
  END IF;
  PERFORM folio_editor_private.lock_scope('portal',p_org,p_patient,p_actor,p_actor_role,p_session);
  -- RLS visibility is rechecked after the helper's waits. No new patient UPDATE grant.
  SELECT * INTO patient FROM public.paciente WHERE id=p_patient AND organization_id=p_org
    AND deleted_at IS NULL AND pseudonimizado_en IS NULL;
  IF NOT FOUND OR patient.cuenta_id IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required';
  END IF;
  SELECT * INTO identity_row FROM public.paciente_identidad WHERE id=patient.identidad_id
    AND organization_id=p_org AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required'; END IF;
  -- A changed link is a conflict only while BOTH current rows remain authorized.
  -- Link revision rejects ABA even if the identity returns to its original value.
  IF patient.identidad_id IS DISTINCT FROM p_identity
    OR patient.identity_link_revision<>p_link_revision::bigint
    OR identity_row.admin_revision<>p_admin_revision::bigint THEN
    RETURN jsonb_build_object('status','conflict');
  END IF;
  UPDATE public.paciente_identidad SET email_cifrado=CASE WHEN p_patch ? 'email_cifrado' THEN (p_patch->>'email_cifrado')::bytea ELSE email_cifrado END,
      email_hash=CASE WHEN p_patch ? 'email_hash' THEN (p_patch->>'email_hash') ELSE email_hash END,
      telefono_cifrado=CASE WHEN p_patch ? 'telefono_cifrado' THEN (p_patch->>'telefono_cifrado')::bytea ELSE telefono_cifrado END,
      telefono_hash=CASE WHEN p_patch ? 'telefono_hash' THEN (p_patch->>'telefono_hash') ELSE telefono_hash END,
      domicilio_calle_cifrado=CASE WHEN p_patch ? 'domicilio_calle_cifrado' THEN (p_patch->>'domicilio_calle_cifrado')::bytea ELSE domicilio_calle_cifrado END,
      domicilio_numero_cifrado=CASE WHEN p_patch ? 'domicilio_numero_cifrado' THEN (p_patch->>'domicilio_numero_cifrado')::bytea ELSE domicilio_numero_cifrado END,
      domicilio_ciudad=CASE WHEN p_patch ? 'domicilio_ciudad' THEN (p_patch->>'domicilio_ciudad') ELSE domicilio_ciudad END,
      domicilio_provincia=CASE WHEN p_patch ? 'domicilio_provincia' THEN (p_patch->>'domicilio_provincia') ELSE domicilio_provincia END,
      domicilio_cp=CASE WHEN p_patch ? 'domicilio_cp' THEN (p_patch->>'domicilio_cp') ELSE domicilio_cp END
    WHERE id=p_identity AND organization_id=p_org AND deleted_at IS NULL
      AND admin_revision=p_admin_revision::bigint RETURNING admin_revision INTO after_revision;
  IF NOT FOUND THEN
    -- Zero rows with locked matching versions means current UPDATE RLS rejected DML.
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current editor scope required';
  END IF;
  RETURN jsonb_build_object('status',CASE WHEN after_revision=identity_row.admin_revision THEN 'unchanged' ELSE 'applied' END,
    'adminRevision',after_revision::text,'identityLinkRevision',patient.identity_link_revision::text);
END $$;
REVOKE ALL ON FUNCTION public.patient_portal_contact_cas(uuid,uuid,uuid,text,text,uuid,text,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.patient_portal_contact_cas(uuid,uuid,uuid,text,text,uuid,text,uuid,jsonb) TO authenticated;
