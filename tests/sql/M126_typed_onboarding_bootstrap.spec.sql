-- Synthetic, rollback-only typed bootstrap contract.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.bootstrap_org_typed_atomic(uuid,text,text,text,text,text,text,boolean)') IS NULL
 OR has_function_privilege('anon','public.bootstrap_org_typed_atomic(uuid,text,text,text,text,text,text,boolean)','EXECUTE')
 OR has_function_privilege('authenticated','public.bootstrap_org_typed_atomic(uuid,text,text,text,text,text,text,boolean)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.bootstrap_org_typed_atomic(uuid,text,text,text,text,text,text,boolean)','EXECUTE')
 OR has_function_privilege('anon','public.bootstrap_org_atomic(uuid,text,text,text,text,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.bootstrap_org_atomic(uuid,text,text,text,text,text)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.bootstrap_org_atomic(uuid,text,text,text,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'M126 execute grants or legacy RPC missing'; END IF;
END $$;

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('12600000-0000-4000-8000-000000000001','m126-clinic@synthetic.invalid',now()),
 ('12600000-0000-4000-8000-000000000002','m126-solo@synthetic.invalid',now()),
 ('12600000-0000-4000-8000-000000000003','m126-failure@synthetic.invalid',now()),
 ('12600000-0000-4000-8000-000000000004','m126-invite@synthetic.invalid',now());

SET LOCAL ROLE service_role;
DO $$ DECLARE first jsonb; repeated jsonb; old jsonb; solo jsonb; BEGIN
 first:=public.bootstrap_org_typed_atomic('12600000-0000-4000-8000-000000000001',
  'm126-clinic@synthetic.invalid','m126-clinic','bad ip','synthetic','v1','CLINICA',false);
 IF first->>'tipo'<>'CLINICA' OR (first->>'owner_tratante')::boolean IS DISTINCT FROM false
 OR (first->>'created')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'M126 clinic bootstrap %',first; END IF;
 repeated:=public.bootstrap_org_typed_atomic('12600000-0000-4000-8000-000000000001',
  'different@synthetic.invalid','different-slug',NULL,'synthetic','v2','INDEPENDIENTE',true);
 old:=public.bootstrap_org_atomic('12600000-0000-4000-8000-000000000001',
  'different@synthetic.invalid','different-slug',NULL,'synthetic','v2');
 IF first->>'organization_id' IS DISTINCT FROM repeated->>'organization_id'
 OR first->>'organization_id' IS DISTINCT FROM old->>'organization_id'
 OR (repeated->>'created')::boolean IS DISTINCT FROM false
 OR (old->>'created')::boolean IS DISTINCT FROM false
 OR repeated->>'tipo'<>'CLINICA' OR (repeated->>'owner_tratante')::boolean IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'M126 replay converted existing org/member'; END IF;
 old:=public.bootstrap_org_atomic('12600000-0000-4000-8000-000000000002',
  'm126-solo@synthetic.invalid','m126-clinic',NULL,'synthetic','v1');
 IF (old->>'created')::boolean IS DISTINCT FROM true OR old->>'slug'='m126-clinic'
 THEN RAISE EXCEPTION 'M126 legacy creation/collision %',old; END IF;
 BEGIN
  solo:=public.bootstrap_org_typed_atomic('12600000-0000-4000-8000-000000000003',
   'm126-failure@synthetic.invalid','m126-fail',NULL,'synthetic','v1','INDEPENDIENTE',false);
  RAISE EXCEPTION 'M126 accepted independent non-treating owner';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT tipo FROM public.organization WHERE slug='m126-clinic') <> 'CLINICA'
 OR (SELECT m.es_colegiado FROM public.member m JOIN public.organization o ON o.id=m.organization_id WHERE o.slug='m126-clinic') IS DISTINCT FROM false
 OR (SELECT email FROM public.profile WHERE id='12600000-0000-4000-8000-000000000001') IS DISTINCT FROM 'm126-clinic@synthetic.invalid'
 OR (SELECT count(*) FROM public.organization o JOIN public.member m ON m.organization_id=o.id
      WHERE m.profile_id='12600000-0000-4000-8000-000000000001')<>1
 OR (SELECT o.tipo FROM public.organization o JOIN public.member m ON m.organization_id=o.id
      WHERE m.profile_id='12600000-0000-4000-8000-000000000002')<>'INDEPENDIENTE'
 OR (SELECT m.es_colegiado FROM public.member m WHERE m.profile_id='12600000-0000-4000-8000-000000000002') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'M126 persisted modality, role, profile or idempotency mismatch'; END IF;
END $$;

UPDATE public.organization SET onboarding_completed=true WHERE slug='m126-clinic';
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES
 ('12600000-0000-4000-8000-000000000004','m126-invite@synthetic.invalid',now(),'synthetic');
INSERT INTO public.member(organization_id,profile_id,role,es_colegiado,accepted_at,invited_by_id)
 SELECT o.id,'12600000-0000-4000-8000-000000000004','PROFESIONAL',true,NULL,owner.profile_id
 FROM public.organization o JOIN public.member owner ON owner.organization_id=o.id
 WHERE o.slug='m126-clinic' AND owner.role='OWNER';
SET LOCAL ROLE service_role;
DO $$ DECLARE completed jsonb; invited jsonb; BEGIN
 completed:=public.bootstrap_org_typed_atomic('12600000-0000-4000-8000-000000000001',
  'm126-clinic@synthetic.invalid','m126-forged',NULL,'synthetic','v2','INDEPENDIENTE',true);
 IF (completed->>'created')::boolean IS DISTINCT FROM false OR completed->>'tipo'<>'CLINICA'
 OR (completed->>'onboarding_completed')::boolean IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'M126 completed org changed on replay: %',completed; END IF;
 invited:=public.bootstrap_org_typed_atomic('12600000-0000-4000-8000-000000000004',
  'm126-invite@synthetic.invalid','m126-invite-own',NULL,'synthetic','v1','INDEPENDIENTE',true);
 IF (invited->>'created')::boolean IS DISTINCT FROM true OR invited->>'slug'<>'m126-invite-own'
 THEN RAISE EXCEPTION 'M126 selected an unaccepted foreign membership: %',invited; END IF;
END $$;
RESET ROLE;
UPDATE public.organization SET deleted_at=now() WHERE slug='m126-clinic';
SET LOCAL ROLE service_role;
DO $$ DECLARE fresh jsonb; BEGIN
 fresh:=public.bootstrap_org_typed_atomic('12600000-0000-4000-8000-000000000001',
  'm126-clinic@synthetic.invalid','m126-reborn',NULL,'synthetic','v1','CLINICA',false);
 IF (fresh->>'created')::boolean IS DISTINCT FROM true OR fresh->>'slug'<>'m126-reborn'
 THEN RAISE EXCEPTION 'M126 reused a soft-deleted organization: %',fresh; END IF;
END $$;
RESET ROLE;

CREATE FUNCTION pg_temp.m126_fail_member() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.profile_id='12600000-0000-4000-8000-000000000003' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='synthetic member failure';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER m126_fail_member BEFORE INSERT ON public.member
 FOR EACH ROW EXECUTE FUNCTION pg_temp.m126_fail_member();
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
  PERFORM public.bootstrap_org_typed_atomic('12600000-0000-4000-8000-000000000003',
   'm126-failure@synthetic.invalid','m126-fail',NULL,'synthetic','v1','CLINICA',false);
  RAISE EXCEPTION 'M126 unexpectedly committed member failure';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.profile WHERE id='12600000-0000-4000-8000-000000000003')
 OR EXISTS(SELECT 1 FROM public.organization WHERE slug='m126-fail')
 THEN RAISE EXCEPTION 'M126 partial bootstrap remained after member failure'; END IF;
END $$;
ROLLBACK;
