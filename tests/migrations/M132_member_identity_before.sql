-- RED-before assertion: passes only while M130 consent can be forged by an
-- OWNER swapping a member's Auth principal A -> B -> A. Synthetic, rollback-only.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m132_uid',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.m132_jwt',true),''),'{}')::jsonb $$;

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('13200000-0000-4000-8000-000000000001','owner-m132@spec.invalid',now()),
 ('13200000-0000-4000-8000-000000000002','professional-m132@spec.invalid',now()),
 ('13200000-0000-4000-8000-000000000003','substitute-m132@spec.invalid',now());
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES
 ('13200000-0000-4000-8000-000000000001','owner-m132@spec.invalid',now(),'v1'),
 ('13200000-0000-4000-8000-000000000002','professional-m132@spec.invalid',now(),'v1'),
 ('13200000-0000-4000-8000-000000000003','substitute-m132@spec.invalid',now(),'v1');
INSERT INTO public.organization(id,slug,nombre,tipo) VALUES
 ('13200000-0000-4000-8000-000000000010','m132-clinic','M132 clinic','CLINICA'),
 ('13200000-0000-4000-8000-000000000020','m132-other','M132 other','CLINICA');
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES
 ('13200000-0000-4000-8000-000000000011','13200000-0000-4000-8000-000000000010','13200000-0000-4000-8000-000000000001','OWNER',true,now()),
 ('13200000-0000-4000-8000-000000000012','13200000-0000-4000-8000-000000000010','13200000-0000-4000-8000-000000000002','PROFESIONAL',true,now()),
 ('13200000-0000-4000-8000-000000000021','13200000-0000-4000-8000-000000000020','13200000-0000-4000-8000-000000000003','PROFESIONAL',true,now());
INSERT INTO auth.mfa_factors(id,user_id,status) VALUES
 ('13200000-0000-4000-8000-000000000031','13200000-0000-4000-8000-000000000001','verified'),
 ('13200000-0000-4000-8000-000000000033','13200000-0000-4000-8000-000000000003','verified');
INSERT INTO auth.sessions(id,user_id,aal,factor_id) VALUES
 ('13200000-0000-4000-8000-000000000041','13200000-0000-4000-8000-000000000001','aal2','13200000-0000-4000-8000-000000000031'),
 ('13200000-0000-4000-8000-000000000043','13200000-0000-4000-8000-000000000003','aal2','13200000-0000-4000-8000-000000000033');
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
GRANT SELECT ON public.member,public.organization TO authenticated;

SELECT set_config('test.m132_uid','13200000-0000-4000-8000-000000000001',true);
SELECT set_config('test.m132_jwt','{"aal":"aal2","session_id":"13200000-0000-4000-8000-000000000041"}',true);
SET LOCAL ROLE authenticated;
UPDATE public.member SET profile_id='13200000-0000-4000-8000-000000000003'
 WHERE id='13200000-0000-4000-8000-000000000012';
RESET ROLE;
DO $$ BEGIN
 IF (SELECT profile_id FROM public.member WHERE id='13200000-0000-4000-8000-000000000012')
    <> '13200000-0000-4000-8000-000000000003'
 THEN RAISE EXCEPTION 'M132 RED: OWNER could not swap target identity'; END IF;
END $$;

SELECT set_config('test.m132_uid','13200000-0000-4000-8000-000000000003',true);
SELECT set_config('test.m132_jwt','{"aal":"aal2","session_id":"13200000-0000-4000-8000-000000000043"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.member_miniweb_consent(id,organization_id,enabled)
 VALUES('13200000-0000-4000-8000-000000000012','13200000-0000-4000-8000-000000000010',true);
RESET ROLE;

SELECT set_config('test.m132_uid','13200000-0000-4000-8000-000000000001',true);
SELECT set_config('test.m132_jwt','{"aal":"aal2","session_id":"13200000-0000-4000-8000-000000000041"}',true);
SET LOCAL ROLE authenticated;
UPDATE public.member SET profile_id='13200000-0000-4000-8000-000000000002'
 WHERE id='13200000-0000-4000-8000-000000000012';
RESET ROLE;
DO $$ BEGIN
 IF (SELECT profile_id FROM public.member WHERE id='13200000-0000-4000-8000-000000000012')
    <> '13200000-0000-4000-8000-000000000002'
    OR (SELECT enabled FROM public.member_miniweb_consent WHERE id='13200000-0000-4000-8000-000000000012') IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'M132 RED: forged opt-in was not retained after identity restore'; END IF;
END $$;
ROLLBACK;
