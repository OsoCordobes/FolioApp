-- B04a: additive adult-attestation foundation. No visit or note gate is enabled.
-- The migration runner owns the transaction and canonical version ledger.

ALTER TABLE public.paciente_identidad
  ADD COLUMN dob_revision bigint NOT NULL DEFAULT 0
    CONSTRAINT paciente_identidad_dob_revision_nonnegative CHECK (dob_revision >= 0);
ALTER TABLE public.paciente
  ADD COLUMN identity_link_revision bigint NOT NULL DEFAULT 0
    CONSTRAINT paciente_identity_link_revision_nonnegative CHECK (identity_link_revision >= 0);

CREATE FUNCTION public.adult_dob_revision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.dob_revision IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DOB revision must start at zero';
    END IF;
  ELSE
    IF NEW.dob_revision IS DISTINCT FROM OLD.dob_revision THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='DOB revision is database managed';
    END IF;
    IF NEW.fecha_nacimiento IS DISTINCT FROM OLD.fecha_nacimiento THEN
      IF OLD.dob_revision=9223372036854775807 THEN
        RAISE EXCEPTION USING ERRCODE='22003',MESSAGE='DOB revision exhausted';
      END IF;
      NEW.dob_revision:=OLD.dob_revision+1;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER adult_dob_revision_guard
  BEFORE INSERT OR UPDATE ON public.paciente_identidad
  FOR EACH ROW EXECUTE FUNCTION public.adult_dob_revision_guard();
REVOKE ALL ON FUNCTION public.adult_dob_revision_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.adult_identity_link_revision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.identity_link_revision IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Identity link revision must start at zero';
    END IF;
  ELSE
    IF NEW.identity_link_revision IS DISTINCT FROM OLD.identity_link_revision THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Identity link revision is database managed';
    END IF;
    IF NEW.identidad_id IS DISTINCT FROM OLD.identidad_id THEN
      IF OLD.identity_link_revision=9223372036854775807 THEN
        RAISE EXCEPTION USING ERRCODE='22003',MESSAGE='Identity link revision exhausted';
      END IF;
      NEW.identity_link_revision:=OLD.identity_link_revision+1;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER adult_identity_link_revision_guard
  BEFORE INSERT OR UPDATE ON public.paciente
  FOR EACH ROW EXECUTE FUNCTION public.adult_identity_link_revision_guard();
REVOKE ALL ON FUNCTION public.adult_identity_link_revision_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE SCHEMA folio_adult_private;
REVOKE ALL ON SCHEMA folio_adult_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE folio_adult_private.attestation (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Identity has no FK so a future reviewed identity-retention workflow can
  -- remove it without altering evidence. The patient row key is immutable
  -- once attested: renaming/recreating its ID would revive an old event.
  organization_id uuid NOT NULL,
  paciente_id uuid NOT NULL CONSTRAINT adult_attestation_patient_fk
    REFERENCES public.paciente(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  identidad_id uuid NOT NULL,
  dob_revision bigint NOT NULL CHECK (dob_revision>=0),
  identity_link_revision bigint NOT NULL CHECK (identity_link_revision>=0),
  verified_by_member_id uuid NOT NULL CONSTRAINT adult_attestation_author_fk
    REFERENCES public.member(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  attested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  source_code text NOT NULL CHECK (source_code IN
    ('DOCUMENTO_EXHIBIDO','DECLARACION_PACIENTE','OTRA_FUENTE_REVISADA')),
  correction_reason_code text CHECK (correction_reason_code IS NULL OR correction_reason_code IN
    ('ERROR_CARGA','DISCREPANCIA_FUENTE','ACTUALIZACION_DECLARADA'))
);
CREATE INDEX adult_attestation_current_idx ON folio_adult_private.attestation
  (organization_id,paciente_id,identidad_id,identity_link_revision,dob_revision,attested_at DESC,id DESC);
CREATE INDEX adult_attestation_author_idx ON folio_adult_private.attestation
  (verified_by_member_id);
ALTER TABLE folio_adult_private.attestation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA folio_adult_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA folio_adult_private FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION folio_adult_private.reject_event_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Adult attestation events are append-only';
END $$;
CREATE TRIGGER adult_attestation_immutable
  BEFORE UPDATE OR DELETE ON folio_adult_private.attestation
  FOR EACH ROW EXECUTE FUNCTION folio_adult_private.reject_event_mutation();
CREATE TRIGGER adult_attestation_no_truncate
  BEFORE TRUNCATE ON folio_adult_private.attestation
  FOR EACH STATEMENT EXECUTE FUNCTION folio_adult_private.reject_event_mutation();
REVOKE ALL ON FUNCTION folio_adult_private.reject_event_mutation() FROM PUBLIC,anon,authenticated,service_role;

-- Order: organization -> member FOR SHARE, then patient -> identity in callers.
-- The member row is rechecked under its lock, so revocation cannot race commit.
CREATE FUNCTION folio_adult_private.require_staff(p_org uuid) RETURNS public.member
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; mfa jsonb;
BEGIN
  IF p_org IS NULL OR auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current authenticated clinician required';
  END IF;
  PERFORM 1 FROM public.organization WHERE id=p_org AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current organization required';
  END IF;
  SELECT * INTO actor FROM public.member
   WHERE organization_id=p_org AND profile_id=auth.uid()
    AND deleted_at IS NULL AND (accepted_at IS NOT NULL OR invited_by_id IS NULL)
    AND es_colegiado AND role IN ('OWNER','DIRECTOR','PROFESIONAL')
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current accredited clinician required';
  END IF;
  mfa:=public.mfa_access_status();
  IF (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2'
    OR (mfa->>'allowed')::boolean IS DISTINCT FROM true
    OR (mfa->>'hasVerifiedFactor')::boolean IS DISTINCT FROM true
    OR (mfa->>'sessionValid')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current verified session required';
  END IF;
  RETURN actor;
END $$;
REVOKE ALL ON FUNCTION folio_adult_private.require_staff(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- This is a private-read result exposed only through the checked RPC, not a
-- certificate of age or approval of a particular source.
CREATE FUNCTION public.read_adult_attestation(p_org uuid,p_patient uuid) RETURNS jsonb
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

CREATE FUNCTION public.attest_adult_dob(
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

COMMENT ON TABLE folio_adult_private.attestation IS
  'Immutable staff attestation of current DOB/link revisions; no copied DOB, document, or clinical plaintext. Not an adult-age certificate.';
