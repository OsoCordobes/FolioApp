-- D1. Existing records remain unchanged; new evidence is explicit and scoped.
BEGIN;
CREATE SCHEMA folio_consent_private;
REVOKE ALL ON SCHEMA folio_consent_private FROM PUBLIC,anon,authenticated;
CREATE TABLE folio_consent_private.policy(singleton boolean PRIMARY KEY CHECK(singleton),enforced boolean NOT NULL DEFAULT false,activated_at timestamptz,activation_reason text);
INSERT INTO folio_consent_private.policy(singleton) VALUES(true);
ALTER TABLE folio_consent_private.policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON folio_consent_private.policy FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.consent_enable_reviewed_signatures(p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF length(trim(coalesce(p_reason,'')))<20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Record deployed UI and professional rollout verification'; END IF;
 UPDATE folio_consent_private.policy SET enforced=true,activated_at=now(),activation_reason=p_reason WHERE singleton AND NOT enforced;
END $$;
REVOKE ALL ON FUNCTION public.consent_enable_reviewed_signatures(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consent_enable_reviewed_signatures(text) TO service_role;
CREATE FUNCTION public.consent_evidence_client_read_allowed() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM folio_mfa_private.assert_access();
 RETURN NOT(SELECT enforced FROM folio_consent_private.policy WHERE singleton);
END $$;
REVOKE ALL ON FUNCTION public.consent_evidence_client_read_allowed() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.consent_evidence_client_read_allowed() TO authenticated;

ALTER TABLE public.tutor_legal
 ADD COLUMN estado_verificacion text NOT NULL DEFAULT 'PENDIENTE' CHECK(estado_verificacion IN ('PENDIENTE','VERIFICADA','REVOCADA')),
 ADD COLUMN identidad_verificada boolean NOT NULL DEFAULT false,
 ADD COLUMN vinculo_verificado boolean NOT NULL DEFAULT false,
 ADD COLUMN evidencia_verificacion_cifrado bytea,
 ADD COLUMN restricciones_cifrado bytea,
 ADD COLUMN alcances text[] NOT NULL DEFAULT '{}',
 ADD COLUMN verificado_por uuid REFERENCES public.member(id),
 ADD COLUMN verificado_en timestamptz,
 ADD COLUMN revocado_en timestamptz,
 ADD COLUMN revocacion_motivo_cifrado bytea;
COMMENT ON TABLE public.tutor_legal IS 'D1 representation distinct from emergency contacts and patient account ownership. Legacy rows require review; no automatic guardian rule by age or template.';

CREATE FUNCTION folio_consent_private.representation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.estado_verificacion<>'PENDIENTE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Revoke representation; preserve its evidence'; END IF;
  RETURN OLD;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.paciente p WHERE p.id=NEW.paciente_id AND p.organization_id=NEW.organization_id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Representation patient and organization mismatch';
 END IF;
 IF NOT NEW.alcances <@ ARRAY['CONSENTIMIENTO','AGENDA','ENTREGA_REVISADA']::text[] THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid representation scope';
 END IF;
 IF TG_OP='UPDATE' AND OLD.estado_verificacion<>'PENDIENTE' AND
   (to_jsonb(NEW)-ARRAY['estado_verificacion','revocado_en','revocacion_motivo_cifrado','updated_at']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['estado_verificacion','revocado_en','revocacion_motivo_cifrado','updated_at']) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Verified representation is immutable; revoke and create a new record';
 END IF;
 IF TG_OP='UPDATE' AND OLD.estado_verificacion='VERIFICADA' AND NEW.estado_verificacion NOT IN ('VERIFICADA','REVOCADA') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Verified representation can only be revoked';
 END IF;
 IF TG_OP='UPDATE' AND OLD.estado_verificacion='REVOCADA' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Revoked representation cannot be reactivated';
 END IF;
 IF NEW.estado_verificacion='VERIFICADA' THEN
  IF NOT NEW.identidad_verificada OR NOT NEW.vinculo_verificado OR NEW.evidencia_verificacion_cifrado IS NULL OR NEW.restricciones_cifrado IS NULL
     OR NEW.vigencia_desde IS NULL OR NEW.vigencia_hasta IS NULL OR cardinality(NEW.alcances)=0 OR NEW.revocado_en IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Verify identity, relationship, evidence, scopes and explicit validity period';
  END IF;
  IF TG_OP='INSERT' OR OLD.estado_verificacion='PENDIENTE' THEN
   IF NOT public.can_read_clinical(NEW.organization_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Clinical review required'; END IF;
   NEW.verificado_por:=public.user_member_id_in(NEW.organization_id); NEW.verificado_en:=now();
  END IF;
 ELSIF NEW.estado_verificacion='REVOCADA' THEN
  IF NEW.revocacion_motivo_cifrado IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Record the revocation reason'; END IF;
  NEW.revocado_en:=now();
 ELSE
  NEW.verificado_por:=null; NEW.verificado_en:=null; NEW.revocado_en:=null;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION folio_consent_private.representation_guard() FROM PUBLIC;
CREATE TRIGGER representation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tutor_legal
FOR EACH ROW EXECUTE FUNCTION folio_consent_private.representation_guard();

CREATE TABLE public.consentimiento_evaluacion (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organization(id),
 paciente_id uuid NOT NULL REFERENCES public.paciente(id),
 plantilla_id uuid NOT NULL REFERENCES public.plantilla_consentimiento(id),
 modo text NOT NULL CHECK(modo IN ('PENDIENTE','AUTONOMO','ASISTIDO','REPRESENTADO')),
 riesgo text NOT NULL CHECK(riesgo IN ('EVALUADO','REQUIERE_REVISION')),
 fundamento_cifrado bytea NOT NULL,
 participacion_cifrado bytea NOT NULL,
 representante_id uuid REFERENCES public.tutor_legal(id),
 texto_snapshot text NOT NULL,
 version_snapshot integer NOT NULL,
 tipo public.tipo_consentimiento NOT NULL,
 paciente_identidad_snapshot jsonb,
 representante_snapshot jsonb,
 evaluado_por uuid NOT NULL REFERENCES public.member(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 vigente_hasta timestamptz NOT NULL,
 revocado_en timestamptz,
 revocacion_motivo_cifrado bytea,
 CHECK(vigente_hasta>created_at),
 CHECK((modo IN ('ASISTIDO','REPRESENTADO') AND representante_id IS NOT NULL) OR
       (modo IN ('PENDIENTE','AUTONOMO') AND representante_id IS NULL)),
 CHECK(modo='PENDIENTE' OR riesgo='EVALUADO')
);
ALTER TABLE public.consentimiento_evaluacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consentimiento_evaluacion FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON public.consentimiento_evaluacion TO authenticated;
GRANT ALL ON public.consentimiento_evaluacion TO service_role;
CREATE POLICY evaluacion_clinical_read ON public.consentimiento_evaluacion FOR SELECT TO authenticated
 USING(public.can_read_clinical(organization_id) AND EXISTS(SELECT 1 FROM public.paciente p WHERE p.id=paciente_id AND p.organization_id=consentimiento_evaluacion.organization_id));
CREATE POLICY evaluacion_clinical_insert ON public.consentimiento_evaluacion FOR INSERT TO authenticated
 WITH CHECK(public.can_read_clinical(organization_id) AND evaluado_por=public.user_member_id_in(organization_id));
CREATE POLICY evaluacion_clinical_revoke ON public.consentimiento_evaluacion FOR UPDATE TO authenticated
 USING(public.can_read_clinical(organization_id)) WITH CHECK(public.can_read_clinical(organization_id));
CREATE POLICY evaluacion_self_read ON public.consentimiento_evaluacion FOR SELECT TO authenticated
 USING(modo='AUTONOMO' AND public.paciente_owns(paciente_id));
CREATE POLICY folio_mfa_gate ON public.consentimiento_evaluacion AS RESTRICTIVE FOR ALL TO authenticated
 USING((SELECT public.mfa_access_allowed())) WITH CHECK((SELECT public.mfa_access_allowed()));

CREATE FUNCTION folio_consent_private.evaluation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tpl public.plantilla_consentimiento; rep public.tutor_legal;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['revocado_en','revocacion_motivo_cifrado']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['revocado_en','revocacion_motivo_cifrado']) OR OLD.revocado_en IS NOT NULL
     OR NEW.revocado_en IS NULL OR NEW.revocacion_motivo_cifrado IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assessment is immutable; revoke and reassess';
  END IF;
  NEW.revocado_en:=now(); RETURN NEW;
 END IF;
 IF NOT public.can_read_clinical(NEW.organization_id) OR public.user_member_id_in(NEW.organization_id) IS DISTINCT FROM NEW.evaluado_por THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Clinical assessment required';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.paciente p WHERE p.id=NEW.paciente_id AND p.organization_id=NEW.organization_id AND p.deleted_at IS NULL AND p.pseudonimizado_en IS NULL) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Patient unavailable for assessment';
 END IF;
 SELECT * INTO tpl FROM public.plantilla_consentimiento WHERE id=NEW.plantilla_id AND reemplazado_por IS NULL
  AND (organization_id IS NULL OR organization_id=NEW.organization_id);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current consent template required'; END IF;
 IF NEW.texto_snapshot IS DISTINCT FROM tpl.texto_markdown OR NEW.version_snapshot IS DISTINCT FROM tpl.version THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Consent text changed; read the current version before confirming';
 END IF;
 NEW.texto_snapshot:=tpl.texto_markdown; NEW.version_snapshot:=tpl.version; NEW.tipo:=tpl.tipo;
 SELECT jsonb_build_object('id',i.id,'nombre_cifrado',i.nombre_cifrado,'apellido_cifrado',i.apellido_cifrado,'fecha_nacimiento',i.fecha_nacimiento)
  INTO NEW.paciente_identidad_snapshot FROM public.paciente p JOIN public.paciente_identidad i ON i.id=p.identidad_id
  WHERE p.id=NEW.paciente_id AND i.organization_id=NEW.organization_id AND i.deleted_at IS NULL;
 IF NEW.paciente_identidad_snapshot IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Review patient identity before assessment'; END IF;
 IF NEW.representante_id IS NOT NULL THEN
  SELECT * INTO rep FROM public.tutor_legal WHERE id=NEW.representante_id FOR UPDATE;
  IF NOT FOUND OR rep.organization_id<>NEW.organization_id OR rep.paciente_id<>NEW.paciente_id OR rep.estado_verificacion<>'VERIFICADA'
   OR rep.revocado_en IS NOT NULL OR NOT('CONSENTIMIENTO'=ANY(rep.alcances))
   OR timezone('America/Argentina/Cordoba',now())::date NOT BETWEEN rep.vigencia_desde AND rep.vigencia_hasta THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Review current representation before approving this assessment';
  END IF;
  NEW.representante_snapshot:=jsonb_build_object('id',rep.id,'nombre_cifrado',rep.nombre_cifrado,'numero_doc_cifrado',rep.numero_doc_cifrado,
    'vinculo',rep.vinculo,'restricciones_cifrado',rep.restricciones_cifrado,'alcances',rep.alcances,'verificado_por',rep.verificado_por,'verificado_en',rep.verificado_en);
 ELSE NEW.representante_snapshot:=null;
 END IF;
 NEW.created_at:=now();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION folio_consent_private.evaluation_guard() FROM PUBLIC;
CREATE TRIGGER evaluation_guard BEFORE INSERT OR UPDATE ON public.consentimiento_evaluacion
FOR EACH ROW EXECUTE FUNCTION folio_consent_private.evaluation_guard();

ALTER TABLE public.consentimiento
 ADD COLUMN evaluacion_id uuid UNIQUE REFERENCES public.consentimiento_evaluacion(id),
 ADD COLUMN evidencia_estado text NOT NULL DEFAULT 'LEGADO_PENDIENTE' CHECK(evidencia_estado IN ('LEGADO_PENDIENTE','REGISTRADA')),
 ADD COLUMN texto_snapshot text,
 ADD COLUMN version_snapshot integer,
 ADD COLUMN participantes jsonb;
ALTER TABLE public.consentimiento ADD COLUMN registrado_por_auth_uid uuid REFERENCES auth.users(id);

CREATE FUNCTION folio_consent_private.signature_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ev public.consentimiento_evaluacion; rep public.tutor_legal; participant jsonb;
 expected_roles text[]; actual_roles text[]; today date:=timezone('America/Argentina/Cordoba',now())::date;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['revocado_en','revocado_motivo']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['revocado_en','revocado_motivo']) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Signed evidence is immutable';
  END IF;
  IF OLD.revocado_en IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Revocation cannot be undone'; END IF;
  RETURN NEW;
 END IF;
 -- Trusted imports without a user cannot claim newly verified evidence.
 IF NEW.evaluacion_id IS NULL AND (auth.uid() IS NULL OR NOT(SELECT enforced FROM folio_consent_private.policy WHERE singleton)) THEN
  NEW.evidencia_estado:='LEGADO_PENDIENTE'; NEW.participantes:=null; NEW.texto_snapshot:=null; NEW.version_snapshot:=null; NEW.registrado_por_auth_uid:=null; RETURN NEW;
 END IF;
 SELECT * INTO ev FROM public.consentimiento_evaluacion WHERE id=NEW.evaluacion_id FOR UPDATE;
 IF NOT FOUND OR ev.organization_id<>NEW.organization_id OR ev.paciente_id<>NEW.paciente_id OR ev.plantilla_id<>NEW.plantilla_id
   OR ev.modo='PENDIENTE' OR ev.revocado_en IS NOT NULL OR ev.vigente_hasta<=now() THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='A current act-specific clinical assessment is required';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.paciente p WHERE p.id=NEW.paciente_id AND p.organization_id=NEW.organization_id AND p.deleted_at IS NULL AND p.pseudonimizado_en IS NULL) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Patient unavailable for signature';
 END IF;
 IF NOT public.can_read_clinical(NEW.organization_id) AND NOT(ev.modo='AUTONOMO' AND public.paciente_owns(NEW.paciente_id)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Signer not authorized for this assessment';
 END IF;
 IF ev.representante_id IS NOT NULL THEN
  SELECT * INTO rep FROM public.tutor_legal WHERE id=ev.representante_id FOR UPDATE;
  IF NOT FOUND OR rep.paciente_id<>NEW.paciente_id OR rep.organization_id<>NEW.organization_id
    OR rep.estado_verificacion<>'VERIFICADA' OR NOT rep.identidad_verificada OR NOT rep.vinculo_verificado
    OR rep.revocado_en IS NOT NULL OR rep.vigencia_desde IS NULL OR rep.vigencia_hasta IS NULL
    OR today NOT BETWEEN rep.vigencia_desde AND rep.vigencia_hasta OR NOT('CONSENTIMIENTO'=ANY(rep.alcances)) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Verified current consent representation required';
  END IF;
 END IF;
 expected_roles:=CASE ev.modo WHEN 'AUTONOMO' THEN ARRAY['PACIENTE'] WHEN 'ASISTIDO' THEN ARRAY['PACIENTE','REPRESENTANTE'] ELSE ARRAY['REPRESENTANTE'] END;
 IF jsonb_typeof(NEW.participantes) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Individual participant evidence required'; END IF;
 SELECT array_agg(value->>'rol' ORDER BY ordinality) INTO actual_roles FROM jsonb_array_elements(NEW.participantes) WITH ORDINALITY;
 IF actual_roles IS DISTINCT FROM expected_roles THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Missing or misattributed participant signature'; END IF;
 IF (SELECT count(DISTINCT value->>'path') FROM jsonb_array_elements(NEW.participantes))<>cardinality(expected_roles) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Each participant requires separate evidence';
 END IF;
 FOR participant IN SELECT value FROM jsonb_array_elements(NEW.participantes) LOOP
  IF coalesce(participant->>'sha256','')!~'^[0-9a-f]{64}$'
    OR left(coalesce(participant->>'path',''),length('consentimientos-firmados/'||NEW.organization_id||'/'||NEW.paciente_id||'/'))<>'consentimientos-firmados/'||NEW.organization_id||'/'||NEW.paciente_id||'/'
    OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='consentimientos-firmados' AND o.name=substr(participant->>'path',26)) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Participant signature file is missing or outside the patient scope';
  END IF;
 END LOOP;
 IF NEW.firma_storage_path IS DISTINCT FROM NEW.participantes->0->>'path' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Primary signature mismatch'; END IF;
 NEW.firmado_por_tutor_id:=CASE WHEN ev.modo='REPRESENTADO' THEN ev.representante_id ELSE NULL END;
 SELECT jsonb_agg(value||jsonb_build_object('persona_ref',CASE WHEN value->>'rol'='PACIENTE' THEN NEW.paciente_id ELSE ev.representante_id END,
   'registrado_en',now(),'registrado_por',auth.uid()) ORDER BY ordinality) INTO NEW.participantes
   FROM jsonb_array_elements(NEW.participantes) WITH ORDINALITY;
 NEW.registrado_por_auth_uid:=auth.uid();
 NEW.tipo:=ev.tipo; NEW.texto_snapshot:=ev.texto_snapshot; NEW.version_snapshot:=ev.version_snapshot;
 NEW.evidencia_estado:='REGISTRADA'; NEW.firmado_en:=now();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION folio_consent_private.signature_guard() FROM PUBLIC;
CREATE TRIGGER consent_signature_guard BEFORE INSERT OR UPDATE ON public.consentimiento
FOR EACH ROW EXECUTE FUNCTION folio_consent_private.signature_guard();

CREATE FUNCTION folio_consent_private.audit_representation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO public.audit_log(organization_id,action,resource_type,resource_id,payload)
 VALUES(NEW.organization_id,'representation.'||lower(NEW.estado_verificacion),'tutor_legal',NEW.id::text,
  jsonb_build_object('actor',auth.uid(),'scopes',NEW.alcances,'validFrom',NEW.vigencia_desde,'validUntil',NEW.vigencia_hasta));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION folio_consent_private.audit_representation() FROM PUBLIC;
CREATE TRIGGER representation_audit AFTER INSERT OR UPDATE ON public.tutor_legal
FOR EACH ROW EXECUTE FUNCTION folio_consent_private.audit_representation();
CREATE TRIGGER evaluation_audit AFTER INSERT OR UPDATE ON public.consentimiento_evaluacion
FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();
-- Reads must pass the authenticated application endpoint; no bearer URLs that
-- survive account, membership or MFA revocation. Upload remains RLS-scoped.
CREATE POLICY consent_evidence_server_read ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
 USING(bucket_id<>'consentimientos-firmados' OR (SELECT public.consent_evidence_client_read_allowed()));
COMMIT;
