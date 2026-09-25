-- M143: append-only compatibility repair for M142 adult RPCs.
-- Keep the stricter M142 require_staff checks and add the legacy MFA guard.
-- M142 was already recorded on an isolated Preview branch; never rewrite it.

CREATE OR REPLACE FUNCTION public.read_adult_attestation(p_org uuid,p_patient uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; patient public.paciente; identity_row public.paciente_identidad;
  last_event folio_adult_private.attestation;
BEGIN
  PERFORM folio_mfa_private.assert_access();
  actor:=folio_adult_private.require_staff(p_org);
  SELECT * INTO patient FROM public.paciente
   WHERE id=p_patient AND organization_id=p_org AND deleted_at IS NULL
    AND pseudonimizado_en IS NULL FOR SHARE;
  IF NOT FOUND OR (patient.caja_fuerte_profesional IS NOT NULL
      AND patient.caja_fuerte_profesional IS DISTINCT FROM actor.id)
    OR (actor.role='PROFESIONAL' AND patient.profesional_principal_id IS DISTINCT FROM actor.id
      AND NOT public.profesional_attended_paciente(patient.id,p_org)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current patient clinical scope required';
  END IF;
  SELECT * INTO identity_row FROM public.paciente_identidad
   WHERE id=patient.identidad_id AND organization_id=p_org AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Current patient identity required';
  END IF;
  SELECT * INTO last_event FROM folio_adult_private.attestation
   WHERE organization_id=p_org AND paciente_id=patient.id AND identidad_id=identity_row.id
    AND dob_revision=identity_row.dob_revision
    AND identity_link_revision=patient.identity_link_revision
   ORDER BY attested_at DESC,id DESC LIMIT 1;
  RETURN jsonb_build_object('identityId',identity_row.id,'dob',identity_row.fecha_nacimiento,
   'dobRevision',identity_row.dob_revision,'identityLinkRevision',patient.identity_link_revision,
   'attested',last_event.id IS NOT NULL,'attestedAt',last_event.attested_at,
   'sourceCode',last_event.source_code);
END $$;
REVOKE ALL ON FUNCTION public.read_adult_attestation(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_adult_attestation(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.attest_adult_dob(
  p_org uuid,p_patient uuid,p_expected_identity uuid,p_expected_dob_revision bigint,
  p_expected_link_revision bigint,p_expected_dob date,p_new_dob date,
  p_source_code text,p_correction_reason_code text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; patient public.paciente; identity_row public.paciente_identidad;
  correction boolean; event_id bigint;
BEGIN
  PERFORM folio_mfa_private.assert_access();
  actor:=folio_adult_private.require_staff(p_org);
  IF p_expected_dob_revision IS NULL OR p_expected_dob_revision<0
    OR p_expected_link_revision IS NULL OR p_expected_link_revision<0
    OR p_new_dob IS NULL
    OR p_source_code IS NULL OR p_source_code NOT IN
      ('DOCUMENTO_EXHIBIDO','DECLARACION_PACIENTE','OTRA_FUENTE_REVISADA')
    OR (p_correction_reason_code IS NOT NULL AND p_correction_reason_code NOT IN
      ('ERROR_CARGA','DISCREPANCIA_FUENTE','ACTUALIZACION_DECLARADA')) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid adult attestation input';
  END IF;
  SELECT * INTO patient FROM public.paciente
   WHERE id=p_patient AND organization_id=p_org AND deleted_at IS NULL
    AND pseudonimizado_en IS NULL FOR UPDATE;
  IF NOT FOUND OR (patient.caja_fuerte_profesional IS NOT NULL
      AND patient.caja_fuerte_profesional IS DISTINCT FROM actor.id)
    OR (actor.role='PROFESIONAL' AND patient.profesional_principal_id IS DISTINCT FROM actor.id
      AND NOT public.profesional_attended_paciente(patient.id,p_org)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current patient clinical scope required';
  END IF;
  -- If the link changed, return its current revision without reading an
  -- unrelated identity. A changed-back link still has a newer revision.
  IF patient.identidad_id IS DISTINCT FROM p_expected_identity THEN
    RETURN jsonb_build_object('status','conflict','identityId',patient.identidad_id,
      'identityLinkRevision',patient.identity_link_revision);
  END IF;
  SELECT * INTO identity_row FROM public.paciente_identidad
   WHERE id=patient.identidad_id AND organization_id=p_org AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Current patient identity required';
  END IF;
  IF identity_row.id IS DISTINCT FROM p_expected_identity
    OR patient.identity_link_revision IS DISTINCT FROM p_expected_link_revision
    OR identity_row.dob_revision IS DISTINCT FROM p_expected_dob_revision
    OR identity_row.fecha_nacimiento IS DISTINCT FROM p_expected_dob THEN
    RETURN jsonb_build_object('status','conflict','identityId',identity_row.id,
      'identityLinkRevision',patient.identity_link_revision,
      'dobRevision',identity_row.dob_revision,'dob',identity_row.fecha_nacimiento);
  END IF;
  correction:=identity_row.fecha_nacimiento IS DISTINCT FROM p_new_dob;
  IF correction IS DISTINCT FROM (p_correction_reason_code IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DOB correction requires a reason code only when changed';
  END IF;
  IF correction THEN
    UPDATE public.paciente_identidad SET fecha_nacimiento=p_new_dob WHERE id=identity_row.id
      RETURNING * INTO identity_row;
  END IF;
  INSERT INTO folio_adult_private.attestation
   (organization_id,paciente_id,identidad_id,dob_revision,identity_link_revision,
    verified_by_member_id,source_code,correction_reason_code)
   VALUES(p_org,patient.id,identity_row.id,identity_row.dob_revision,
    patient.identity_link_revision,actor.id,p_source_code,p_correction_reason_code)
   RETURNING id INTO event_id;
  RETURN jsonb_build_object('status','attested','eventId',event_id,
    'identityId',identity_row.id,'dob',identity_row.fecha_nacimiento,
    'dobRevision',identity_row.dob_revision,
    'identityLinkRevision',patient.identity_link_revision);
END $$;
REVOKE ALL ON FUNCTION public.attest_adult_dob(uuid,uuid,uuid,bigint,bigint,date,date,text,text)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.attest_adult_dob(uuid,uuid,uuid,bigint,bigint,date,date,text,text)
  TO authenticated;
