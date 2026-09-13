BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.import_uid',true),'')::uuid $$;
INSERT INTO auth.users(id,email) VALUES('11200000-0000-4000-8000-000000000001','import@synthetic.invalid');
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES('11200000-0000-4000-8000-000000000001','import@synthetic.invalid',now(),'synthetic');
INSERT INTO public.organization(id,slug,nombre,is_synthetic) VALUES('11200000-0000-4000-8000-000000000010','m112-synthetic','Synthetic',true);
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES('11200000-0000-4000-8000-000000000011','11200000-0000-4000-8000-000000000010','11200000-0000-4000-8000-000000000001','OWNER',true,now());
SELECT set_config('test.import_uid','11200000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE run_id uuid;again uuid;r jsonb;r2 jsonb;payload jsonb:='{"nombre_cifrado":"\\x01","apellido_cifrado":"\\x02","telefono_cifrado":"\\x03","telefono_hash":"shared-household"}';org uuid:='11200000-0000-4000-8000-000000000010';BEGIN
 run_id:=public.begin_patient_import(org,'11200000-0000-4000-8000-000000000020',repeat('a',64),4);
 again:=public.begin_patient_import(org,'11200000-0000-4000-8000-000000000021',repeat('a',64),4);
 IF run_id IS DISTINCT FROM again THEN RAISE EXCEPTION 'M112 same file did not resume';END IF;
 r:=public.import_patient_row(org,run_id,2,repeat('b',64),payload,'import',ARRAY[]::text[]);
 r2:=public.import_patient_row(org,run_id,2,repeat('b',64),payload,'import',ARRAY[]::text[]);
 IF r IS DISTINCT FROM r2 OR r->>'status'<>'imported' THEN RAISE EXCEPTION 'M112 row replay changed receipt';END IF;
 r:=public.import_patient_row(org,run_id,3,repeat('c',64),payload,'import',ARRAY[]::text[]);
 IF r->>'status'<>'imported' THEN RAISE EXCEPTION 'M112 family contact merged';END IF;
 BEGIN PERFORM public.import_patient_row(org,run_id,2,repeat('d',64),payload,'import',ARRAY[]::text[]);RAISE EXCEPTION 'M112 row overwrite allowed';EXCEPTION WHEN serialization_failure THEN NULL;END;
 r:=public.import_patient_row(org,run_id,4,repeat('d',64),NULL,'invalid',ARRAY[]::text[]);
 IF r->>'status'<>'invalid' THEN RAISE EXCEPTION 'M112 invalid row missing result';END IF;
END $$;
RESET ROLE;
DO $$ BEGIN IF (SELECT count(*) FROM public.paciente WHERE organization_id='11200000-0000-4000-8000-000000000010')<>2 THEN RAISE EXCEPTION 'M112 duplicates or missing family';END IF;END $$;
CREATE FUNCTION pg_temp.import_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='11200000-0000-4000-8000-000000000010' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='synthetic private failure';END IF;RETURN NEW;END $$;
CREATE TRIGGER m112_fail BEFORE INSERT ON public.paciente FOR EACH ROW EXECUTE FUNCTION pg_temp.import_failure();
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;BEGIN
 r:=public.import_patient_row('11200000-0000-4000-8000-000000000010','11200000-0000-4000-8000-000000000020',5,repeat('e',64),'{"nombre_cifrado":"\\x01","apellido_cifrado":"\\x02","telefono_cifrado":"\\x03"}','import',ARRAY[]::text[]);
 IF r->>'status'<>'failed' OR r::text LIKE '%private%' THEN RAISE EXCEPTION 'M112 failure incorrectly reported';END IF;
END $$;
RESET ROLE;
DROP TRIGGER m112_fail ON public.paciente;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.paciente_identidad WHERE organization_id='11200000-0000-4000-8000-000000000010')<>2 THEN RAISE EXCEPTION 'M112 orphan identity';END IF;
 IF has_function_privilege('anon','public.begin_patient_import(uuid,uuid,text,integer)','EXECUTE') OR has_function_privilege('service_role','public.import_patient_row(uuid,uuid,integer,text,jsonb,text,text[])','EXECUTE') THEN RAISE EXCEPTION 'M112 unauthorized API grant';END IF;
END $$;
-- Same content or DNI in another run is a review result, never patient adoption.
SET LOCAL ROLE authenticated;
DO $$ DECLARE run_id uuid;r jsonb;org uuid:='11200000-0000-4000-8000-000000000010';payload jsonb:='{"nombre_cifrado":"\\x01","apellido_cifrado":"\\x02","telefono_cifrado":"\\x03","dni_hash":"synthetic-dni"}';BEGIN
 run_id:=public.begin_patient_import(org,'11200000-0000-4000-8000-000000000030',repeat('f',64),4);
 r:=public.import_patient_row(org,run_id,2,repeat('b',64),payload,'import',ARRAY[]::text[]);
 IF r->>'status'<>'review_previous' THEN RAISE EXCEPTION 'M112 previous exact row recreated';END IF;
 r:=public.import_patient_row(org,run_id,3,repeat('1',64),payload,'import',ARRAY[]::text[]);
 IF r->>'status'<>'imported' THEN RAISE EXCEPTION 'M112 valid DNI row not created';END IF;
 r:=public.import_patient_row(org,run_id,4,repeat('2',64),payload,'import',ARRAY['synthetic-dni']);
 IF r->>'status'<>'review_dni' THEN RAISE EXCEPTION 'M112 DNI match not queued for review';END IF;
 r:=public.import_patient_row(org,run_id,5,repeat('3',64),NULL,'duplicate_file',ARRAY[]::text[]);
 IF r->>'status'<>'review_file' THEN RAISE EXCEPTION 'M112 repeated file DNI missing review';END IF;
 BEGIN PERFORM public.patient_import_status('11200000-0000-4000-8000-000000000099',run_id);RAISE EXCEPTION 'M112 foreign organization read';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
-- A different professional cannot take over another author's partial run.
INSERT INTO auth.users(id,email) VALUES('11200000-0000-4000-8000-000000000002','second-import@synthetic.invalid');
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES('11200000-0000-4000-8000-000000000002','second-import@synthetic.invalid',now(),'synthetic');
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES('11200000-0000-4000-8000-000000000012','11200000-0000-4000-8000-000000000010','11200000-0000-4000-8000-000000000002','PROFESIONAL',true,now());
SELECT set_config('test.import_uid','11200000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.begin_patient_import('11200000-0000-4000-8000-000000000010',gen_random_uuid(),repeat('a',64),4);RAISE EXCEPTION 'M112 other author took over run';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.patient_import_status('11200000-0000-4000-8000-000000000010','11200000-0000-4000-8000-000000000020');RAISE EXCEPTION 'M112 other author read run';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SELECT set_config('test.import_uid','11200000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.begin_patient_import('11200000-0000-4000-8000-000000000010','11200000-0000-4000-8000-000000000050',repeat('7',64),1);
RESET ROLE;
-- Director without clinical read access may create under the existing M03 capability.
UPDATE public.member SET role='DIRECTOR',es_colegiado=false WHERE id='11200000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.import_patient_row('11200000-0000-4000-8000-000000000010','11200000-0000-4000-8000-000000000050',2,repeat('8',64),'{"nombre_cifrado":"\\x01","apellido_cifrado":"\\x02","telefono_cifrado":"\\x03"}','import',ARRAY[]::text[]);RAISE EXCEPTION 'M112 professional context changed silently';EXCEPTION WHEN serialization_failure THEN NULL;END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ DECLARE run_id uuid;r jsonb;org uuid:='11200000-0000-4000-8000-000000000010';BEGIN
 run_id:=public.begin_patient_import(org,'11200000-0000-4000-8000-000000000040',repeat('4',64),1);
 r:=public.import_patient_row(org,run_id,2,repeat('5',64),'{"nombre_cifrado":"\\x01","apellido_cifrado":"\\x02","telefono_cifrado":"\\x03"}','import',ARRAY[]::text[]);
 IF r->>'status'<>'imported' OR r ? 'paciente_id' THEN RAISE EXCEPTION 'M112 director capability changed or clinical references exposed';END IF;
END $$;
RESET ROLE;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.paciente WHERE organization_id='11200000-0000-4000-8000-000000000010' AND profesional_principal_id IS NULL) THEN RAISE EXCEPTION 'M112 non-clinician assigned as professional';END IF;END $$;
UPDATE public.member SET role='ASISTENTE' WHERE id='11200000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.begin_patient_import('11200000-0000-4000-8000-000000000010',gen_random_uuid(),repeat('6',64),1);RAISE EXCEPTION 'M112 assistant created clinical import';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.patient_import_status('11200000-0000-4000-8000-000000000010','11200000-0000-4000-8000-000000000020');RAISE EXCEPTION 'M112 assistant read clinical import';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
UPDATE public.member SET role='OWNER',deleted_at=now() WHERE id='11200000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.patient_import_status('11200000-0000-4000-8000-000000000010','11200000-0000-4000-8000-000000000020');RAISE EXCEPTION 'M112 removed member read receipts';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
UPDATE public.member SET deleted_at=NULL WHERE id='11200000-0000-4000-8000-000000000011';
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"aal":"aal1"}'::jsonb $$;
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.patient_import_status('11200000-0000-4000-8000-000000000010','11200000-0000-4000-8000-000000000020');RAISE EXCEPTION 'M112 MFA bypass on receipt';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
ROLLBACK;
