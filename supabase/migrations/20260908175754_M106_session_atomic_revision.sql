-- C2 expansion: compatible readers/writers deploy before service-only activation.
BEGIN;
CREATE SCHEMA folio_session_private;
REVOKE ALL ON SCHEMA folio_session_private FROM PUBLIC,anon,authenticated;
CREATE TABLE folio_session_private.policy(singleton boolean PRIMARY KEY CHECK(singleton),enabled_at timestamptz,reason text);
INSERT INTO folio_session_private.policy(singleton) VALUES(true);
CREATE TABLE folio_session_private.authority (
 tx bigint NOT NULL,turno_id uuid NOT NULL,actor_id uuid,mode text NOT NULL CHECK(mode IN ('WRITE','LOCK')),
 PRIMARY KEY(tx,turno_id)
);
CREATE TABLE folio_session_private.receipt (
 actor_id uuid NOT NULL,organization_id uuid NOT NULL,operation_id uuid NOT NULL,
 turno_id uuid NOT NULL,paciente_id uuid NOT NULL,expected_revision bigint NOT NULL,
 intent text NOT NULL,request_hash text NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,organization_id,operation_id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA folio_session_private FROM PUBLIC,anon,authenticated;
ALTER TABLE folio_session_private.policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_session_private.authority ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_session_private.receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sesion ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK(revision>0);

CREATE FUNCTION public.enable_session_atomic_writes(p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF length(trim(coalesce(p_reason,'')))<20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Record compatible editor rollout verification'; END IF;
 UPDATE folio_session_private.policy SET enabled_at=clock_timestamp(),reason=p_reason WHERE singleton AND enabled_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.enable_session_atomic_writes(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enable_session_atomic_writes(text) TO service_role;

CREATE FUNCTION folio_session_private.revision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE authority_mode text;
BEGIN
 IF TG_OP='DELETE' THEN
  IF auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM folio_session_private.policy WHERE enabled_at IS NOT NULL) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Clinical revisions cannot be deleted by the editor';
  END IF;
  RETURN OLD;
 END IF;
 SELECT mode INTO authority_mode FROM folio_session_private.authority
  WHERE tx=txid_current() AND turno_id=NEW.turno_id AND actor_id IS NOT DISTINCT FROM auth.uid();
 IF auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM folio_session_private.policy WHERE enabled_at IS NOT NULL) AND authority_mode IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Use the revision-checked clinical writer';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.locked_at IS NOT NULL AND (to_jsonb(NEW)-ARRAY['revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revision','updated_at']) THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Clinical original locked; add an amendment';
  END IF;
  IF authority_mode='LOCK' AND (to_jsonb(NEW)-ARRAY['locked_at','locked_by_id','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['locked_at','locked_by_id','revision','updated_at']) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Scheduling close cannot change clinical content';
  END IF;
  NEW.revision:=OLD.revision+1;
 ELSE
  IF authority_mode='LOCK' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Scheduling close cannot create clinical content'; END IF;
  NEW.revision:=1;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION folio_session_private.revision_guard() FROM PUBLIC;
CREATE TRIGGER sesion_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sesion FOR EACH ROW EXECUTE FUNCTION folio_session_private.revision_guard();

-- Existing scheduling close uses its own RLS permissions. This trigger may only
-- lock saved content; it cannot authorize a caller-supplied clinical payload.
CREATE FUNCTION folio_session_private.close_saved_session() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; inserted_authority boolean:=false;
BEGIN
 IF NEW.estado<>'CERRADO' OR OLD.estado='CERRADO' OR NOT EXISTS(SELECT 1 FROM folio_session_private.policy WHERE enabled_at IS NOT NULL) THEN RETURN NEW; END IF;
 actor:=public.user_member_id_in(NEW.organization_id);
 IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current staff identity required to close clinical encounter'; END IF;
 INSERT INTO folio_session_private.authority(tx,turno_id,actor_id,mode) VALUES(txid_current(),NEW.id,auth.uid(),'LOCK') ON CONFLICT DO NOTHING;
 inserted_authority:=FOUND;
 UPDATE public.sesion SET locked_at=clock_timestamp(),locked_by_id=actor WHERE turno_id=NEW.id AND locked_at IS NULL;
 IF inserted_authority THEN DELETE FROM folio_session_private.authority WHERE tx=txid_current() AND turno_id=NEW.id; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION folio_session_private.close_saved_session() FROM PUBLIC;
CREATE TRIGGER turno_close_saved_session BEFORE UPDATE OF estado ON public.turno FOR EACH ROW EXECUTE FUNCTION folio_session_private.close_saved_session();

CREATE FUNCTION public.save_clinical_session(
 p_organization uuid,p_turno uuid,p_paciente uuid,p_operation uuid,p_expected_revision bigint,
 p_intent text,p_request_hash text,p_data jsonb,p_context jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t public.turno;s public.sesion;prior folio_session_private.receipt;actor uuid;outcome jsonb;closed boolean;duration integer;ctx_org public.organization;ctx_member public.member;ctx_patient public.paciente;ctx_identity public.paciente_identidad;
BEGIN
 PERFORM folio_mfa_private.assert_access();
 actor:=public.user_member_id_in(p_organization);
 IF auth.uid() IS NULL OR actor IS NULL OR NOT public.can_read_clinical(p_organization) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current clinical access required';
 END IF;
 IF p_operation IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0 OR p_expected_revision>9007199254740990
  OR p_intent IS NULL OR p_intent NOT IN ('SAVE','AUTOSAVE','CLOSE') OR coalesce(p_request_hash,'')!~'^[a-f0-9]{64}$'
  OR (p_data IS NOT NULL AND (jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>1000000)) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Explicit operation, revision and valid payload required';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('soap_s_cifrado','soap_o_cifrado','soap_a_cifrado','soap_p_cifrado','notas_cifrado','eva_antes','eva_despues','vertebras_json','tool_id','tool_data_cifrado')) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Clinical payload contains unsupported columns';
 END IF;
 -- Appointment first establishes one lock order, including concurrent creation.
 SELECT * INTO t FROM public.turno WHERE id=p_turno FOR UPDATE;
 IF NOT FOUND OR t.organization_id IS DISTINCT FROM p_organization OR t.paciente_id IS DISTINCT FROM p_paciente OR t.deleted_at IS NOT NULL
  OR NOT(public.user_role_in(p_organization) IN ('OWNER','DIRECTOR') OR t.profesional_id=actor) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Appointment and current clinical assignment required';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.paciente p WHERE p.id=p_paciente AND p.organization_id=p_organization AND p.deleted_at IS NULL AND p.pseudonimizado_en IS NULL) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current patient required';
 END IF;
 SELECT * INTO prior FROM folio_session_private.receipt WHERE actor_id=auth.uid() AND organization_id=p_organization AND operation_id=p_operation;
 IF FOUND THEN
  IF prior.turno_id IS DISTINCT FROM p_turno OR prior.paciente_id IS DISTINCT FROM p_paciente OR prior.expected_revision<>p_expected_revision OR prior.intent<>p_intent OR prior.request_hash<>p_request_hash THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Operation identity was reused for different content';
  END IF;
  RETURN prior.result;
 END IF;
 SELECT * INTO s FROM public.sesion WHERE turno_id=p_turno FOR UPDATE;
 -- Match M39 UPDATE scope. Reading all clinical histories as a director does
 -- not authorize replacing another professional's saved original. Existing
 -- receipts above are read-only confirmations of this actor's prior operation.
 IF s.id IS NOT NULL AND public.user_role_in(p_organization)<>'OWNER' AND t.profesional_id IS DISTINCT FROM actor THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Existing original requires its assigned clinician or owner';
 END IF;
 IF p_data IS NULL THEN RETURN NULL; END IF; -- Read-only receipt probe, same current authorization.
 IF (s.id IS NULL AND p_expected_revision<>0) OR (s.id IS NOT NULL AND s.revision<>p_expected_revision) THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Clinical revision conflict; preserve local draft';
 END IF;
 IF s.locked_at IS NOT NULL OR t.estado IN ('CERRADO','CANCELADO','REAGENDADO','NO_ASISTIO') THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Clinical encounter locked; preserve draft for amendment';
 END IF;
 IF p_intent='CLOSE' AND t.estado<>'ATENDIENDO' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Start encounter before closing'; END IF;
 IF p_intent='AUTOSAVE' AND t.estado<>'ATENDIENDO' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Autosave requires an active encounter'; END IF;
 -- Freeze the exact source context used by server-side validation through commit.
 SELECT * INTO ctx_org FROM public.organization WHERE id=p_organization FOR SHARE;
 PERFORM 1 FROM public.member WHERE id=actor FOR SHARE;
 SELECT * INTO ctx_member FROM public.member WHERE id=t.profesional_id AND organization_id=p_organization FOR SHARE;
 SELECT * INTO ctx_patient FROM public.paciente WHERE id=p_paciente AND organization_id=p_organization FOR SHARE;
 SELECT * INTO ctx_identity FROM public.paciente_identidad WHERE id=ctx_patient.identidad_id AND organization_id=p_organization FOR SHARE;
 IF ctx_org.deleted_at IS NOT NULL OR ctx_patient.deleted_at IS NOT NULL OR ctx_patient.pseudonimizado_en IS NOT NULL
  OR public.user_member_id_in(p_organization) IS DISTINCT FROM actor OR NOT public.can_read_clinical(p_organization)
  OR (ctx_patient.identidad_id IS NOT NULL AND ctx_identity.id IS NULL)
  OR (public.user_role_in(p_organization) NOT IN ('OWNER','DIRECTOR') AND t.profesional_id IS DISTINCT FROM actor)
  OR (s.id IS NOT NULL AND public.user_role_in(p_organization)<>'OWNER' AND t.profesional_id IS DISTINCT FROM actor) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Clinical access changed during validation';
 END IF;
 IF p_context IS NULL OR jsonb_typeof(p_context)<>'object' OR NOT(p_context ?& ARRAY['profesional_id','inicio','member_especialidad','organization_especialidad','identity_id','fecha_nacimiento','identity_deleted_at']) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Validated clinical context is required';
 END IF;
 IF (p_context->>'profesional_id')::uuid IS DISTINCT FROM t.profesional_id
  OR (p_context->>'inicio')::timestamptz IS DISTINCT FROM t.inicio
  OR p_context->>'member_especialidad' IS DISTINCT FROM ctx_member.especialidad
  OR p_context->>'organization_especialidad' IS DISTINCT FROM ctx_org.especialidad
  OR (p_context->>'identity_id')::uuid IS DISTINCT FROM ctx_patient.identidad_id
  OR (p_context->>'fecha_nacimiento')::date IS DISTINCT FROM ctx_identity.fecha_nacimiento
  OR (p_context->>'identity_deleted_at')::timestamptz IS DISTINCT FROM ctx_identity.deleted_at THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Clinical context changed; preserve draft and review';
 END IF;
 INSERT INTO folio_session_private.authority(tx,turno_id,actor_id,mode) VALUES(txid_current(),p_turno,auth.uid(),'WRITE');
 closed:=p_intent='CLOSE';
 IF s.id IS NULL THEN
  INSERT INTO public.sesion(organization_id,turno_id,paciente_id,soap_s_cifrado,soap_o_cifrado,soap_a_cifrado,soap_p_cifrado,notas_cifrado,eva_antes,eva_despues,vertebras_json,tool_id,tool_data_cifrado,locked_at,locked_by_id)
  VALUES(p_organization,p_turno,p_paciente,(p_data->>'soap_s_cifrado')::bytea,(p_data->>'soap_o_cifrado')::bytea,(p_data->>'soap_a_cifrado')::bytea,(p_data->>'soap_p_cifrado')::bytea,(p_data->>'notas_cifrado')::bytea,
   (p_data->>'eva_antes')::smallint,(p_data->>'eva_despues')::smallint,coalesce(p_data->'vertebras_json','[]'::jsonb),p_data->>'tool_id',(p_data->>'tool_data_cifrado')::bytea,
   CASE WHEN closed THEN clock_timestamp() ELSE NULL END,CASE WHEN closed THEN actor ELSE NULL END) RETURNING * INTO s;
 ELSE
  UPDATE public.sesion SET
   soap_s_cifrado=CASE WHEN p_data?'soap_s_cifrado' THEN (p_data->>'soap_s_cifrado')::bytea ELSE s.soap_s_cifrado END,
   soap_o_cifrado=CASE WHEN p_data?'soap_o_cifrado' THEN (p_data->>'soap_o_cifrado')::bytea ELSE s.soap_o_cifrado END,
   soap_a_cifrado=CASE WHEN p_data?'soap_a_cifrado' THEN (p_data->>'soap_a_cifrado')::bytea ELSE s.soap_a_cifrado END,
   soap_p_cifrado=CASE WHEN p_data?'soap_p_cifrado' THEN (p_data->>'soap_p_cifrado')::bytea ELSE s.soap_p_cifrado END,
   notas_cifrado=CASE WHEN p_data?'notas_cifrado' THEN (p_data->>'notas_cifrado')::bytea ELSE s.notas_cifrado END,
   eva_antes=CASE WHEN p_data?'eva_antes' THEN (p_data->>'eva_antes')::smallint ELSE s.eva_antes END,
   eva_despues=CASE WHEN p_data?'eva_despues' THEN (p_data->>'eva_despues')::smallint ELSE s.eva_despues END,
   vertebras_json=CASE WHEN p_data?'vertebras_json' THEN p_data->'vertebras_json' ELSE s.vertebras_json END,
   tool_id=CASE WHEN p_data?'tool_id' THEN p_data->>'tool_id' ELSE s.tool_id END,
   tool_data_cifrado=CASE WHEN p_data?'tool_data_cifrado' THEN (p_data->>'tool_data_cifrado')::bytea ELSE s.tool_data_cifrado END,
   locked_at=CASE WHEN closed THEN clock_timestamp() ELSE NULL END,locked_by_id=CASE WHEN closed THEN actor ELSE NULL END
  WHERE id=s.id RETURNING * INTO s;
 END IF;
 IF p_intent='SAVE' THEN
  IF t.estado IN ('AGENDADO','CONFIRMADO') THEN UPDATE public.turno SET estado='EN_SALA',atendiendo_desde=NULL WHERE id=p_turno; END IF;
  IF t.estado IN ('AGENDADO','CONFIRMADO','EN_SALA') THEN UPDATE public.turno SET estado='ATENDIENDO',atendiendo_desde=clock_timestamp() WHERE id=p_turno; END IF;
 ELSIF closed THEN
  duration:=round(extract(epoch FROM (clock_timestamp()-t.atendiendo_desde))/60)::integer;
  UPDATE public.turno SET estado='CERRADO',atendiendo_desde=NULL,duracion_real_min=CASE WHEN duration BETWEEN 0 AND 480 THEN duration ELSE t.duracion_real_min END WHERE id=p_turno;
 END IF;
 outcome:=jsonb_build_object('id',s.id,'revision',s.revision,'updatedAt',s.updated_at,'closed',closed,'operationId',p_operation);
 INSERT INTO folio_session_private.receipt(actor_id,organization_id,operation_id,turno_id,paciente_id,expected_revision,intent,request_hash,result)
 VALUES(auth.uid(),p_organization,p_operation,p_turno,p_paciente,p_expected_revision,p_intent,p_request_hash,outcome);
 DELETE FROM folio_session_private.authority WHERE tx=txid_current() AND turno_id=p_turno;
 RETURN outcome;
END $$;
REVOKE ALL ON FUNCTION public.save_clinical_session(uuid,uuid,uuid,uuid,bigint,text,text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_clinical_session(uuid,uuid,uuid,uuid,bigint,text,text,jsonb,jsonb) TO authenticated;
COMMENT ON TABLE folio_session_private.receipt IS 'C2 operation metadata without clinical plaintext. No automatic expiry; preserve idempotency receipts until an approved retention policy exists.';
COMMIT;
