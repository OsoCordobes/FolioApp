-- M127 rollback-only contract: current MFA, membership, CAS, explicit patches,
-- and cross-table rollback. No clinical or patient data is involved.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.save_consultorio_atomic(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb)') IS NULL
 OR has_function_privilege('anon','public.save_consultorio_atomic(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb)','EXECUTE')
 OR has_function_privilege('service_role','public.save_consultorio_atomic(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.save_consultorio_atomic(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb)','EXECUTE')
 OR (SELECT prosecdef FROM pg_proc WHERE oid='public.save_consultorio_atomic(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb)'::regprocedure)
 THEN RAISE EXCEPTION 'M127 public wrapper or grants invalid'; END IF;
END $$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m127_uid',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.m127_jwt',true),''),'{}')::jsonb $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('12700000-0000-4000-8000-000000000001','m127-owner@synthetic.invalid',now()),
 ('12700000-0000-4000-8000-000000000002','m127-director@synthetic.invalid',now()),
 ('12700000-0000-4000-8000-000000000003','m127-professional@synthetic.invalid',now());
INSERT INTO public.profile(id,email,nombre_cifrado,apellido_cifrado,matricula,consent_pii_signed_at,consent_pii_text_version)
 VALUES
 ('12700000-0000-4000-8000-000000000001','m127-owner@synthetic.invalid',decode(repeat('11',32),'hex'),decode(repeat('12',32),'hex'),NULL,now(),'synthetic'),
 ('12700000-0000-4000-8000-000000000002','m127-director@synthetic.invalid',decode(repeat('21',32),'hex'),decode(repeat('22',32),'hex'),NULL,now(),'synthetic'),
 ('12700000-0000-4000-8000-000000000003','m127-professional@synthetic.invalid',decode(repeat('31',32),'hex'),decode(repeat('32',32),'hex'),NULL,now(),'synthetic');
INSERT INTO public.organization(id,slug,nombre,bio,is_synthetic)
 VALUES('12700000-0000-4000-8000-000000000010','m127-synthetic','Original','Bio existente',true);
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at)
 VALUES
 ('12700000-0000-4000-8000-000000000011','12700000-0000-4000-8000-000000000010','12700000-0000-4000-8000-000000000001','OWNER',true,now()),
 ('12700000-0000-4000-8000-000000000012','12700000-0000-4000-8000-000000000010','12700000-0000-4000-8000-000000000002','DIRECTOR',false,now()),
 ('12700000-0000-4000-8000-000000000013','12700000-0000-4000-8000-000000000010','12700000-0000-4000-8000-000000000003','PROFESIONAL',true,now());
INSERT INTO auth.mfa_factors(id,user_id,status) VALUES
 ('12700000-0000-4000-8000-000000000041','12700000-0000-4000-8000-000000000001','verified'),
 ('12700000-0000-4000-8000-000000000042','12700000-0000-4000-8000-000000000002','verified'),
 ('12700000-0000-4000-8000-000000000043','12700000-0000-4000-8000-000000000003','verified');
INSERT INTO auth.sessions(id,user_id,aal,factor_id) VALUES
 ('12700000-0000-4000-8000-000000000031','12700000-0000-4000-8000-000000000001','aal2','12700000-0000-4000-8000-000000000041'),
 ('12700000-0000-4000-8000-000000000032','12700000-0000-4000-8000-000000000002','aal2','12700000-0000-4000-8000-000000000042'),
 ('12700000-0000-4000-8000-000000000033','12700000-0000-4000-8000-000000000003','aal2','12700000-0000-4000-8000-000000000043');
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();

SELECT set_config('test.m127_uid','12700000-0000-4000-8000-000000000001',true);
SELECT set_config('test.m127_jwt','{"aal":"aal1","session_id":"12700000-0000-4000-8000-000000000031"}',true);
SELECT set_config('test.m127_org_rev',(SELECT updated_at::text FROM public.organization WHERE id='12700000-0000-4000-8000-000000000010'),true);
SELECT set_config('test.m127_profile_rev',(SELECT updated_at::text FROM public.profile WHERE id='12700000-0000-4000-8000-000000000001'),true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE org_rev timestamptz := current_setting('test.m127_org_rev')::timestamptz;
 profile_rev timestamptz := current_setting('test.m127_profile_rev')::timestamptz; BEGIN
 BEGIN
  PERFORM public.save_consultorio_atomic('12700000-0000-4000-8000-000000000010','12700000-0000-4000-8000-000000000011',
   org_rev,profile_rev,'{"nombre":"Forbidden"}'::jsonb,'{}'::jsonb);
  RAISE EXCEPTION 'M127 allowed disallowed MFA session';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT nombre FROM public.organization WHERE id='12700000-0000-4000-8000-000000000010') <> 'Original'
 THEN RAISE EXCEPTION 'M127 MFA rejection wrote organization'; END IF;
END $$;

SELECT set_config('test.m127_jwt','{"aal":"aal2","session_id":"12700000-0000-4000-8000-000000000031"}',true);
SELECT set_config('test.m127_org_rev',(SELECT updated_at::text FROM public.organization WHERE id='12700000-0000-4000-8000-000000000010'),true);
SELECT set_config('test.m127_profile_rev',(SELECT updated_at::text FROM public.profile WHERE id='12700000-0000-4000-8000-000000000001'),true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE org_rev timestamptz := current_setting('test.m127_org_rev')::timestamptz;
 profile_rev timestamptz := current_setting('test.m127_profile_rev')::timestamptz; receipt jsonb; BEGIN
 receipt:=public.save_consultorio_atomic('12700000-0000-4000-8000-000000000010','12700000-0000-4000-8000-000000000011',
   org_rev,profile_rev,'{"nombre":"Actualizado"}'::jsonb,'{"matricula":"MP 127"}'::jsonb);
 IF receipt->>'organizationUpdatedAt' IS NULL OR receipt->>'profileUpdatedAt' IS NULL
 THEN RAISE EXCEPTION 'M127 missing confirmation'; END IF;
 BEGIN
  PERFORM public.save_consultorio_atomic('12700000-0000-4000-8000-000000000010','12700000-0000-4000-8000-000000000011',
    org_rev - interval '1 second',profile_rev,'{"nombre":"Stale"}'::jsonb,'{}'::jsonb);
  RAISE EXCEPTION 'M127 ignored stale organization revision';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
  PERFORM public.save_consultorio_atomic('12700000-0000-4000-8000-000000000010','12700000-0000-4000-8000-000000000011',
    org_rev,profile_rev,'{"opt_out_public_listing":false}'::jsonb,'{}'::jsonb);
  RAISE EXCEPTION 'M127 accepted a field outside the public-editor allowlist';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT nombre FROM public.organization WHERE id='12700000-0000-4000-8000-000000000010') <> 'Actualizado'
 OR (SELECT bio FROM public.organization WHERE id='12700000-0000-4000-8000-000000000010') <> 'Bio existente'
 OR (SELECT matricula FROM public.profile WHERE id='12700000-0000-4000-8000-000000000001') <> 'MP 127'
 THEN RAISE EXCEPTION 'M127 omitted bio, CAS or profile failed'; END IF;
END $$;

SELECT set_config('test.m127_uid','12700000-0000-4000-8000-000000000002',true);
SELECT set_config('test.m127_jwt','{"aal":"aal2","session_id":"12700000-0000-4000-8000-000000000032"}',true);
SELECT set_config('test.m127_org_rev',(SELECT updated_at::text FROM public.organization WHERE id='12700000-0000-4000-8000-000000000010'),true);
SELECT set_config('test.m127_profile_rev',(SELECT updated_at::text FROM public.profile WHERE id='12700000-0000-4000-8000-000000000002'),true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE org_rev timestamptz := current_setting('test.m127_org_rev')::timestamptz;
 profile_rev timestamptz := current_setting('test.m127_profile_rev')::timestamptz; receipt jsonb; BEGIN
 receipt:=public.save_consultorio_atomic('12700000-0000-4000-8000-000000000010','12700000-0000-4000-8000-000000000012',
   org_rev,profile_rev,'{"bio":"Bio del director","especialidad":"kinesiologia"}'::jsonb,'{}'::jsonb);
 org_rev := (receipt->>'organizationUpdatedAt')::timestamptz;
 PERFORM public.save_consultorio_atomic('12700000-0000-4000-8000-000000000010','12700000-0000-4000-8000-000000000012',
   org_rev,profile_rev,'{"especialidad":"nutricion"}'::jsonb,'{}'::jsonb);
 BEGIN
  PERFORM public.save_consultorio_atomic('12700000-0000-4000-8000-000000000010','12700000-0000-4000-8000-000000000011',
   org_rev,profile_rev,'{"nombre":"Wrong member"}'::jsonb,'{}'::jsonb);
  RAISE EXCEPTION 'M127 allowed another member ID';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT bio FROM public.organization WHERE id='12700000-0000-4000-8000-000000000010') <> 'Bio del director'
 OR (SELECT especialidad FROM public.organization WHERE id='12700000-0000-4000-8000-000000000010') <> 'nutricion'
 THEN RAISE EXCEPTION 'M127 director or specialty failed'; END IF;
END $$;

UPDATE public.member SET accepted_at=NULL, invited_by_id='12700000-0000-4000-8000-000000000001'
 WHERE id='12700000-0000-4000-8000-000000000012';
SELECT set_config('test.m127_org_rev',(SELECT updated_at::text FROM public.organization WHERE id='12700000-0000-4000-8000-000000000010'),true);
SELECT set_config('test.m127_profile_rev',(SELECT updated_at::text FROM public.profile WHERE id='12700000-0000-4000-8000-000000000002'),true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE org_rev timestamptz := current_setting('test.m127_org_rev')::timestamptz;
 profile_rev timestamptz := current_setting('test.m127_profile_rev')::timestamptz; BEGIN
 BEGIN
  PERFORM public.save_consultorio_atomic('12700000-0000-4000-8000-000000000010','12700000-0000-4000-8000-000000000012',
   org_rev,profile_rev,'{"bio":"Invitación pendiente"}'::jsonb,'{}'::jsonb);
  RAISE EXCEPTION 'M127 allowed an unaccepted director invitation';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.member SET accepted_at=now(), invited_by_id=NULL
 WHERE id='12700000-0000-4000-8000-000000000012';

SELECT set_config('test.m127_uid','12700000-0000-4000-8000-000000000003',true);
SELECT set_config('test.m127_jwt','{"aal":"aal2","session_id":"12700000-0000-4000-8000-000000000033"}',true);
SELECT set_config('test.m127_org_rev',(SELECT updated_at::text FROM public.organization WHERE id='12700000-0000-4000-8000-000000000010'),true);
SELECT set_config('test.m127_profile_rev',(SELECT updated_at::text FROM public.profile WHERE id='12700000-0000-4000-8000-000000000003'),true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE org_rev timestamptz := current_setting('test.m127_org_rev')::timestamptz;
 profile_rev timestamptz := current_setting('test.m127_profile_rev')::timestamptz; BEGIN
 BEGIN
  PERFORM public.save_consultorio_atomic('12700000-0000-4000-8000-000000000010','12700000-0000-4000-8000-000000000013',
   org_rev,profile_rev,'{"bio":"Forbidden"}'::jsonb,'{}'::jsonb);
  RAISE EXCEPTION 'M127 allowed professional organization edit';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

CREATE FUNCTION pg_temp.m127_fail_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id='12700000-0000-4000-8000-000000000001' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='synthetic profile failure';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER m127_fail_profile BEFORE UPDATE ON public.profile
 FOR EACH ROW EXECUTE FUNCTION pg_temp.m127_fail_profile();
SELECT set_config('test.m127_uid','12700000-0000-4000-8000-000000000001',true);
SELECT set_config('test.m127_jwt','{"aal":"aal2","session_id":"12700000-0000-4000-8000-000000000031"}',true);
SELECT set_config('test.m127_org_rev',(SELECT updated_at::text FROM public.organization WHERE id='12700000-0000-4000-8000-000000000010'),true);
SELECT set_config('test.m127_profile_rev',(SELECT updated_at::text FROM public.profile WHERE id='12700000-0000-4000-8000-000000000001'),true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE org_rev timestamptz := current_setting('test.m127_org_rev')::timestamptz;
 profile_rev timestamptz := current_setting('test.m127_profile_rev')::timestamptz; BEGIN
 BEGIN
  PERFORM public.save_consultorio_atomic('12700000-0000-4000-8000-000000000010','12700000-0000-4000-8000-000000000011',
   org_rev,profile_rev,'{"nombre":"Should roll back"}'::jsonb,'{"matricula":"Would fail"}'::jsonb);
  RAISE EXCEPTION 'M127 ignored profile trigger failure';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT nombre FROM public.organization WHERE id='12700000-0000-4000-8000-000000000010') <> 'Actualizado'
 THEN RAISE EXCEPTION 'M127 left a partial organization edit'; END IF;
END $$;
ROLLBACK;
