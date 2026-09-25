-- Rollback-only synthetic checks for the M132 identity boundary.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m132_uid',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.m132_jwt',true),''),'{}')::jsonb $$;

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('13200000-0000-4000-8000-000000000001','owner-green-m132@spec.invalid',now()),
 ('13200000-0000-4000-8000-000000000002','professional-green-m132@spec.invalid',now()),
 ('13200000-0000-4000-8000-000000000003','substitute-green-m132@spec.invalid',now());
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES
 ('13200000-0000-4000-8000-000000000001','owner-green-m132@spec.invalid',now(),'v1'),
 ('13200000-0000-4000-8000-000000000002','professional-green-m132@spec.invalid',now(),'v1'),
 ('13200000-0000-4000-8000-000000000003','substitute-green-m132@spec.invalid',now(),'v1');
INSERT INTO public.organization(id,slug,nombre,tipo) VALUES
 ('13200000-0000-4000-8000-000000000010','m132-green-clinic','M132 clinic','CLINICA'),
 ('13200000-0000-4000-8000-000000000020','m132-green-other','M132 other','CLINICA');
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES
 ('13200000-0000-4000-8000-000000000011','13200000-0000-4000-8000-000000000010','13200000-0000-4000-8000-000000000001','OWNER',true,now()),
 ('13200000-0000-4000-8000-000000000012','13200000-0000-4000-8000-000000000010','13200000-0000-4000-8000-000000000002','PROFESIONAL',true,now());
INSERT INTO auth.mfa_factors(id,user_id,status) VALUES
 ('13200000-0000-4000-8000-000000000031','13200000-0000-4000-8000-000000000001','verified');
INSERT INTO auth.sessions(id,user_id,aal,factor_id) VALUES
 ('13200000-0000-4000-8000-000000000041','13200000-0000-4000-8000-000000000001','aal2','13200000-0000-4000-8000-000000000031');
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
GRANT SELECT ON public.member,public.organization TO authenticated;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.member'::regclass
    AND tgname='member_identity_immutable_guard' AND NOT tgisinternal)
    OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.member_identity_immutable()'::regprocedure
      AND NOT prosecdef AND proconfig=ARRAY['search_path=pg_catalog'])
    OR has_function_privilege('authenticated','public.member_identity_immutable()','EXECUTE')
 THEN RAISE EXCEPTION 'M132 trigger or function boundary missing'; END IF;
END $$;

SELECT set_config('test.m132_uid','13200000-0000-4000-8000-000000000001',true);
SELECT set_config('test.m132_jwt','{"aal":"aal2","session_id":"13200000-0000-4000-8000-000000000041"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  UPDATE public.member SET profile_id='13200000-0000-4000-8000-000000000003'
   WHERE id='13200000-0000-4000-8000-000000000012';
  RAISE EXCEPTION 'M132 OWNER reassigned Auth identity';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'Member identity cannot be reassigned' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE public.member SET organization_id='13200000-0000-4000-8000-000000000020'
   WHERE id='13200000-0000-4000-8000-000000000012';
  RAISE EXCEPTION 'M132 OWNER reassigned tenant';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'Member identity cannot be reassigned' THEN RAISE; END IF;
 END;
END $$;
-- Existing owner permissions still allow non-identity edits.
UPDATE public.member SET role='DIRECTOR', deleted_at=now()
 WHERE id='13200000-0000-4000-8000-000000000012';
RESET ROLE;

SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
  UPDATE public.member SET profile_id='13200000-0000-4000-8000-000000000003'
   WHERE id='13200000-0000-4000-8000-000000000012';
  RAISE EXCEPTION 'M132 service role reassigned Auth identity';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'Member identity cannot be reassigned' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE public.member SET organization_id='13200000-0000-4000-8000-000000000020'
   WHERE id='13200000-0000-4000-8000-000000000012';
  RAISE EXCEPTION 'M132 service role reassigned tenant';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'Member identity cannot be reassigned' THEN RAISE; END IF;
 END;
END $$;
-- M49's invitation acceptance shape revives the same org/profile pair.
INSERT INTO public.member(organization_id,profile_id,role,es_colegiado,accepted_at)
 VALUES('13200000-0000-4000-8000-000000000010','13200000-0000-4000-8000-000000000002','PROFESIONAL',true,now())
 ON CONFLICT (organization_id,profile_id) DO UPDATE SET
  role=EXCLUDED.role,es_colegiado=EXCLUDED.es_colegiado,
  deleted_at=NULL,accepted_at=COALESCE(member.accepted_at,now());
-- A new invite can still insert a different principal as a different member.
INSERT INTO public.member(organization_id,profile_id,role,es_colegiado,accepted_at)
 VALUES('13200000-0000-4000-8000-000000000010','13200000-0000-4000-8000-000000000003','PROFESIONAL',true,now());
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.member WHERE organization_id='13200000-0000-4000-8000-000000000010')<>3
    OR (SELECT profile_id FROM public.member WHERE id='13200000-0000-4000-8000-000000000012')
       <> '13200000-0000-4000-8000-000000000002'
    OR (SELECT deleted_at FROM public.member WHERE id='13200000-0000-4000-8000-000000000012') IS NOT NULL
    OR (SELECT role FROM public.member WHERE id='13200000-0000-4000-8000-000000000012') <> 'PROFESIONAL'
 THEN RAISE EXCEPTION 'M132 invitation, revive or original identity changed'; END IF;
END $$;
ROLLBACK;
