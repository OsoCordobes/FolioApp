-- M113: additive availability revisions. Enforce only after new code and smoke.
BEGIN;
CREATE SCHEMA folio_availability_private;
REVOKE ALL ON SCHEMA folio_availability_private FROM PUBLIC,anon,authenticated;
CREATE TABLE folio_availability_private.revision (
 organization_id uuid NOT NULL,member_id uuid NOT NULL,revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 PRIMARY KEY(organization_id,member_id)
);
CREATE TABLE folio_availability_private.receipt (
 organization_id uuid NOT NULL,member_id uuid NOT NULL,operation_id uuid NOT NULL,actor_id uuid NOT NULL,
 request_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,member_id,operation_id)
);
CREATE TABLE folio_availability_private.authority (
 tx bigint NOT NULL,organization_id uuid NOT NULL,member_id uuid NOT NULL,actor_id uuid NOT NULL,
 PRIMARY KEY(tx,organization_id,member_id)
);
CREATE TABLE folio_availability_private.policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled_at timestamptz,reason text
);
INSERT INTO folio_availability_private.policy(singleton) VALUES(true);
ALTER TABLE folio_availability_private.revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_availability_private.receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_availability_private.authority ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_availability_private.policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA folio_availability_private FROM PUBLIC,anon,authenticated;
CREATE FUNCTION folio_availability_private.assert_access(p_org uuid,p_member uuid,p_write boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member;BEGIN
 PERFORM 1 FROM public.organization WHERE id=p_org AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current organization required';END IF;
 SELECT * INTO actor FROM public.member WHERE organization_id=p_org AND profile_id=auth.uid() AND deleted_at IS NULL AND (accepted_at IS NOT NULL OR invited_by_id IS NULL) FOR SHARE;
 IF NOT FOUND OR (actor.id<>p_member AND actor.role NOT IN('OWNER','DIRECTOR')) OR (p_write AND actor.role NOT IN('OWNER','DIRECTOR','PROFESIONAL')) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current availability access required';END IF;
 PERFORM 1 FROM public.member WHERE id=p_member AND organization_id=p_org AND deleted_at IS NULL AND (accepted_at IS NOT NULL OR invited_by_id IS NULL) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current scoped member required';END IF;
 RETURN actor.id;
END $$;
CREATE FUNCTION folio_availability_private.guard_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE org uuid:=CASE WHEN TG_OP='DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
 target_member uuid:=CASE WHEN TG_OP='DELETE' THEN OLD.member_id ELSE NEW.member_id END;
BEGIN
 IF current_setting('role',true)='authenticated' AND EXISTS(SELECT 1 FROM folio_availability_private.policy WHERE enabled_at IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM folio_availability_private.authority a WHERE a.tx=txid_current() AND a.organization_id=org AND a.member_id=target_member AND a.actor_id=auth.uid()) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Availability revision writer required';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER availability_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON public.disponibilidad_profesional FOR EACH ROW EXECUTE FUNCTION folio_availability_private.guard_write();
CREATE FUNCTION folio_availability_private.bump_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP IN('DELETE','UPDATE') THEN
  INSERT INTO folio_availability_private.revision(organization_id,member_id,revision) VALUES(OLD.organization_id,OLD.member_id,1)
   ON CONFLICT(organization_id,member_id) DO UPDATE SET revision=folio_availability_private.revision.revision+1;
 END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND ROW(NEW.organization_id,NEW.member_id) IS DISTINCT FROM ROW(OLD.organization_id,OLD.member_id)) THEN
  INSERT INTO folio_availability_private.revision(organization_id,member_id,revision) VALUES(NEW.organization_id,NEW.member_id,1)
   ON CONFLICT(organization_id,member_id) DO UPDATE SET revision=folio_availability_private.revision.revision+1;
 END IF;RETURN NULL;
END $$;
CREATE TRIGGER availability_revision_marker AFTER INSERT OR UPDATE OR DELETE ON public.disponibilidad_profesional FOR EACH ROW EXECUTE FUNCTION folio_availability_private.bump_revision();
CREATE FUNCTION public.read_availability_snapshot(p_org uuid,p_member uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE version bigint;today date:=(now() AT TIME ZONE 'America/Argentina/Cordoba')::date;BEGIN
 PERFORM folio_mfa_private.assert_access();PERFORM folio_availability_private.assert_access(p_org,p_member,false);
 INSERT INTO folio_availability_private.revision(organization_id,member_id) VALUES(p_org,p_member) ON CONFLICT DO NOTHING;
 SELECT revision INTO version FROM folio_availability_private.revision WHERE organization_id=p_org AND member_id=p_member FOR SHARE;
 RETURN jsonb_build_object('revision',version,'protectedDates',EXISTS(SELECT 1 FROM public.disponibilidad_profesional WHERE organization_id=p_org AND member_id=p_member AND activa AND (vigencia_desde>today OR vigencia_hasta>=today)),
  'franjas',coalesce((SELECT jsonb_agg(jsonb_build_object('dia_semana',dia_semana,'hora_inicio',hora_inicio,'hora_fin',hora_fin) ORDER BY dia_semana,hora_inicio,hora_fin)
   FROM public.disponibilidad_profesional WHERE organization_id=p_org AND member_id=p_member AND activa AND vigencia_desde<=today AND (vigencia_hasta IS NULL OR vigencia_hasta>=today)),'[]'::jsonb));
END $$;
CREATE FUNCTION public.save_availability_revision(p_org uuid,p_member uuid,p_expected_revision bigint,p_operation uuid,p_hash text,p_franjas jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid;version bigint;prior folio_availability_private.receipt;result jsonb;bound_hash text;today date:=(now() AT TIME ZONE 'America/Argentina/Cordoba')::date;BEGIN
 PERFORM folio_mfa_private.assert_access();actor:=folio_availability_private.assert_access(p_org,p_member,true);
 IF p_expected_revision IS NULL OR p_expected_revision<0 OR p_operation IS NULL OR coalesce(p_hash,'')!~'^[a-f0-9]{64}$' OR p_franjas IS NULL OR jsonb_typeof(p_franjas)<>'array' OR jsonb_array_length(p_franjas)>84 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Versioned availability command required';END IF;
 INSERT INTO folio_availability_private.revision(organization_id,member_id) VALUES(p_org,p_member) ON CONFLICT DO NOTHING;
 SELECT revision INTO version FROM folio_availability_private.revision WHERE organization_id=p_org AND member_id=p_member FOR UPDATE;
 bound_hash:=p_hash||':'||encode(sha256(convert_to(jsonb_build_array(p_expected_revision,p_franjas)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM folio_availability_private.receipt WHERE organization_id=p_org AND member_id=p_member AND operation_id=p_operation;
 IF FOUND THEN
  IF prior.actor_id<>actor OR prior.request_hash<>bound_hash THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Availability operation changed';END IF;
  RETURN prior.result;
 END IF;
 IF version<>p_expected_revision THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Availability changed since reading';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_franjas) AS f(dia_semana int,hora_inicio text,hora_fin text)
  WHERE dia_semana IS NULL OR dia_semana NOT BETWEEN 0 AND 6 OR hora_inicio IS NULL OR hora_fin IS NULL OR hora_inicio!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' OR hora_fin!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' OR hora_inicio>=hora_fin) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Valid ordered availability intervals required';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_franjas) WITH ORDINALITY a(f,n) JOIN jsonb_array_elements(p_franjas) WITH ORDINALITY b(f,n) ON a.n<b.n
  WHERE (a.f->>'dia_semana')::int=(b.f->>'dia_semana')::int AND a.f->>'hora_inicio'<b.f->>'hora_fin' AND b.f->>'hora_inicio'<a.f->>'hora_fin') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Availability intervals cannot overlap';END IF;
 IF EXISTS(SELECT 1 FROM public.disponibilidad_profesional WHERE organization_id=p_org AND member_id=p_member AND activa AND (vigencia_desde>today OR vigencia_hasta>=today)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dated availability requires explicit review';END IF;
 INSERT INTO folio_availability_private.authority(tx,organization_id,member_id,actor_id) VALUES(txid_current(),p_org,p_member,auth.uid());
 DELETE FROM public.disponibilidad_profesional WHERE organization_id=p_org AND member_id=p_member AND activa AND vigencia_desde<=today AND (vigencia_hasta IS NULL OR vigencia_hasta>=today);
 INSERT INTO public.disponibilidad_profesional(organization_id,member_id,dia_semana,hora_inicio,hora_fin,vigencia_desde)
 SELECT p_org,p_member,f.dia_semana,f.hora_inicio,f.hora_fin,today FROM jsonb_to_recordset(p_franjas) AS f(dia_semana smallint,hora_inicio text,hora_fin text);
 UPDATE folio_availability_private.revision SET revision=revision+1 WHERE organization_id=p_org AND member_id=p_member RETURNING revision INTO version;
 DELETE FROM folio_availability_private.authority WHERE tx=txid_current() AND organization_id=p_org AND member_id=p_member;
 result:=jsonb_build_object('revision',version,'count',jsonb_array_length(p_franjas));
 INSERT INTO folio_availability_private.receipt(organization_id,member_id,operation_id,actor_id,request_hash,result) VALUES(p_org,p_member,p_operation,actor,bound_hash,result);
 RETURN result;
END $$;
-- Setup uses the same receipt/CAS writer; the organization lock also serializes finalization.
CREATE FUNCTION public.read_onboarding_availability(p_org uuid,p_member uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM folio_mfa_private.assert_access();
 PERFORM 1 FROM public.organization o WHERE o.id=p_org AND o.deleted_at IS NULL AND NOT o.onboarding_completed
 AND EXISTS(SELECT 1 FROM public.member m WHERE m.id=p_member AND m.organization_id=o.id AND m.profile_id=auth.uid() AND m.role='OWNER' AND m.deleted_at IS NULL AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current setup owner required';END IF;
 PERFORM folio_availability_private.assert_access(p_org,p_member,false);
 IF NOT EXISTS(SELECT 1 FROM public.member WHERE id=p_member AND role='OWNER') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current owner required';END IF;
 RETURN public.read_availability_snapshot(p_org,p_member);
END $$;
CREATE FUNCTION public.save_onboarding_availability(p_org uuid,p_member uuid,p_expected_revision bigint,p_operation uuid,p_hash text,p_franjas jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE result jsonb;BEGIN
 PERFORM folio_mfa_private.assert_access();
 PERFORM 1 FROM public.organization o WHERE o.id=p_org AND o.deleted_at IS NULL AND NOT o.onboarding_completed AND o.onboarding_step_max>=4
 AND EXISTS(SELECT 1 FROM public.member m WHERE m.id=p_member AND m.organization_id=o.id AND m.profile_id=auth.uid() AND m.role='OWNER' AND m.deleted_at IS NULL AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current setup owner and completed previous step required';END IF;
 PERFORM folio_availability_private.assert_access(p_org,p_member,true);
 IF NOT EXISTS(SELECT 1 FROM public.member WHERE id=p_member AND role='OWNER') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current owner required';END IF;
 IF p_franjas IS NULL OR jsonb_typeof(p_franjas)<>'array' OR jsonb_array_length(p_franjas)=0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Initial availability required';END IF;
 result:=public.save_availability_revision(p_org,p_member,p_expected_revision,p_operation,p_hash,p_franjas);
 UPDATE public.organization SET onboarding_step_max=5 WHERE id=p_org AND onboarding_step_max<5;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_onboarding_availability(uuid,uuid),public.save_onboarding_availability(uuid,uuid,bigint,uuid,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_onboarding_availability(uuid,uuid),public.save_onboarding_availability(uuid,uuid,bigint,uuid,text,jsonb) TO authenticated;
CREATE FUNCTION public.enable_availability_revision(p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF length(trim(coalesce(p_reason,'')))<12 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Auditable rollout reason required';END IF;
 UPDATE folio_availability_private.policy SET enabled_at=coalesce(enabled_at,now()),reason=p_reason WHERE singleton;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA folio_availability_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.read_availability_snapshot(uuid,uuid),public.save_availability_revision(uuid,uuid,bigint,uuid,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_availability_snapshot(uuid,uuid),public.save_availability_revision(uuid,uuid,bigint,uuid,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.enable_availability_revision(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enable_availability_revision(text) TO service_role;
COMMIT;
