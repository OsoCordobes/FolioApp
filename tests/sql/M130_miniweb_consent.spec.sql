-- Rollback-only synthetic identities exercise direct Data API privileges/RLS.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m130_uid',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.m130_jwt',true),''),'{}')::jsonb $$;

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('13000000-0000-4000-8000-000000000001','owner-m130@spec.invalid',now()),
 ('13000000-0000-4000-8000-000000000002','member-m130@spec.invalid',now()),
 ('13000000-0000-4000-8000-000000000003','other-m130@spec.invalid',now());
INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES
 ('13000000-0000-4000-8000-000000000001','owner-m130@spec.invalid',now(),'v1'),
 ('13000000-0000-4000-8000-000000000002','member-m130@spec.invalid',now(),'v1'),
 ('13000000-0000-4000-8000-000000000003','other-m130@spec.invalid',now(),'v1');
INSERT INTO organization(id,slug,nombre,tipo,direccion_completa) VALUES
 ('13000000-0000-4000-8000-000000000010','m130-clinic','M130 clinic','CLINICA','Calle Uno 100'),
 ('13000000-0000-4000-8000-000000000020','m130-other','M130 other','CLINICA','Calle Dos 200');
INSERT INTO member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES
 ('13000000-0000-4000-8000-000000000011','13000000-0000-4000-8000-000000000010','13000000-0000-4000-8000-000000000001','OWNER',true,now()),
 ('13000000-0000-4000-8000-000000000012','13000000-0000-4000-8000-000000000010','13000000-0000-4000-8000-000000000002','PROFESIONAL',true,now()),
 ('13000000-0000-4000-8000-000000000021','13000000-0000-4000-8000-000000000020','13000000-0000-4000-8000-000000000003','PROFESIONAL',true,now());
INSERT INTO auth.mfa_factors(id,user_id,status) VALUES
 ('13000000-0000-4000-8000-000000000031','13000000-0000-4000-8000-000000000001','verified'),
 ('13000000-0000-4000-8000-000000000032','13000000-0000-4000-8000-000000000002','verified');
INSERT INTO auth.sessions(id,user_id,aal,factor_id) VALUES
 ('13000000-0000-4000-8000-000000000041','13000000-0000-4000-8000-000000000001','aal2','13000000-0000-4000-8000-000000000031'),
 ('13000000-0000-4000-8000-000000000042','13000000-0000-4000-8000-000000000002','aal2','13000000-0000-4000-8000-000000000032');
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
GRANT SELECT ON public.member,public.organization TO authenticated;

DO $$ BEGIN
 IF NOT has_column_privilege('authenticated','public.member_miniweb_consent','enabled','UPDATE')
    OR has_column_privilege('authenticated','public.member_miniweb_consent','id','UPDATE')
    OR has_table_privilege('anon','public.member_miniweb_consent','SELECT')
 THEN RAISE EXCEPTION 'M130 consent grants too broad or too narrow'; END IF;
END $$;

SELECT set_config('test.m130_uid','13000000-0000-4000-8000-000000000001',true);
SELECT set_config('test.m130_jwt','{"aal":"aal2","session_id":"13000000-0000-4000-8000-000000000041"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO member_miniweb_consent(id,organization_id,enabled)
VALUES('13000000-0000-4000-8000-000000000011','13000000-0000-4000-8000-000000000010',true);
DO $$ BEGIN
 BEGIN
  INSERT INTO member_miniweb_consent(id,organization_id,enabled)
  VALUES('13000000-0000-4000-8000-000000000012','13000000-0000-4000-8000-000000000010',true);
  RAISE EXCEPTION 'M130 OWNER published another professional';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO member_miniweb_consent(id,organization_id,enabled)
  VALUES('13000000-0000-4000-8000-000000000021','13000000-0000-4000-8000-000000000020',true);
  RAISE EXCEPTION 'M130 cross-tenant consent succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SELECT set_config('test.m130_uid','13000000-0000-4000-8000-000000000002',true);
SELECT set_config('test.m130_jwt','{"aal":"aal2","session_id":"13000000-0000-4000-8000-000000000042"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO member_miniweb_consent(id,organization_id,enabled)
VALUES('13000000-0000-4000-8000-000000000012','13000000-0000-4000-8000-000000000010',true);
UPDATE member_miniweb_consent SET enabled=true WHERE id='13000000-0000-4000-8000-000000000012';
UPDATE member_miniweb_consent SET enabled=false WHERE id='13000000-0000-4000-8000-000000000012';
RESET ROLE;
SELECT set_config('test.m130_uid','13000000-0000-4000-8000-000000000001',true);
SELECT set_config('test.m130_jwt','{"aal":"aal2","session_id":"13000000-0000-4000-8000-000000000041"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 UPDATE member_miniweb_consent SET enabled=true WHERE id='13000000-0000-4000-8000-000000000012';
 IF FOUND THEN RAISE EXCEPTION 'M130 OWNER changed another professional consent'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM audit_log WHERE resource_type='member_miniweb_consent'
     AND resource_id='13000000-0000-4000-8000-000000000012') <> 2
 THEN RAISE EXCEPTION 'M130 repeated value created audit event or revocation missing'; END IF;
END $$;

SELECT set_config('test.m130_uid','13000000-0000-4000-8000-000000000002',true);
SELECT set_config('test.m130_jwt','{"aal":"aal1","session_id":"13000000-0000-4000-8000-000000000042"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM member_miniweb_consent WHERE id='13000000-0000-4000-8000-000000000012')
 THEN RAISE EXCEPTION 'M130 AAL1 read consent'; END IF;
 UPDATE member_miniweb_consent SET enabled=true WHERE id='13000000-0000-4000-8000-000000000012';
 IF FOUND THEN RAISE EXCEPTION 'M130 AAL1 changed consent'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT enabled FROM member_miniweb_consent WHERE id='13000000-0000-4000-8000-000000000012')
 THEN RAISE EXCEPTION 'M130 revocation lost'; END IF;
END $$;

UPDATE organization SET maps_embed_url='https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d123.45',
 maps_confirmed_address='Calle Uno 100' WHERE id='13000000-0000-4000-8000-000000000010';
UPDATE organization SET direccion_completa='Calle Uno 200' WHERE id='13000000-0000-4000-8000-000000000010';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM organization WHERE id='13000000-0000-4000-8000-000000000010'
   AND (maps_embed_url IS NOT NULL OR maps_confirmed_address IS NOT NULL))
 THEN RAISE EXCEPTION 'M130 address change retained confirmed map'; END IF;
END $$;
ROLLBACK;
