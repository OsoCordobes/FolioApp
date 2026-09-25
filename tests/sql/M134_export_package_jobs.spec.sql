-- M134 private ledger: synthetic, rollback-only. No Storage bytes or real users.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('13400000-0000-4000-8000-000000000001','owner-a-m134@spec.invalid'),
 ('13400000-0000-4000-8000-000000000002','owner-b-m134@spec.invalid'),
 ('13400000-0000-4000-8000-000000000003','staff-m134@spec.invalid');
INSERT INTO public.profile(id,email) VALUES
 ('13400000-0000-4000-8000-000000000001','owner-a-m134@spec.invalid'),
 ('13400000-0000-4000-8000-000000000002','owner-b-m134@spec.invalid'),
 ('13400000-0000-4000-8000-000000000003','staff-m134@spec.invalid');
INSERT INTO public.organization(id,slug,nombre,tipo) VALUES
 ('13400000-0000-4000-8000-000000000010','m134-org-a','M134 A','CLINICA'),
 ('13400000-0000-4000-8000-000000000020','m134-org-b','M134 B','CLINICA');
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES
 ('13400000-0000-4000-8000-000000000011','13400000-0000-4000-8000-000000000010','13400000-0000-4000-8000-000000000001','OWNER',true,now()),
 ('13400000-0000-4000-8000-000000000021','13400000-0000-4000-8000-000000000020','13400000-0000-4000-8000-000000000002','OWNER',true,now()),
 ('13400000-0000-4000-8000-000000000012','13400000-0000-4000-8000-000000000010','13400000-0000-4000-8000-000000000003','ASISTENTE',false,now());
INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado) VALUES
 ('13400000-0000-4000-8000-000000000111','13400000-0000-4000-8000-000000000010',decode('aa','hex'),decode('bb','hex'),decode('cc','hex')),
 ('13400000-0000-4000-8000-000000000211','13400000-0000-4000-8000-000000000020',decode('aa','hex'),decode('bb','hex'),decode('cc','hex'));
INSERT INTO public.paciente(id,organization_id,identidad_id) VALUES
 ('13400000-0000-4000-8000-000000000101','13400000-0000-4000-8000-000000000010','13400000-0000-4000-8000-000000000111'),
 ('13400000-0000-4000-8000-000000000201','13400000-0000-4000-8000-000000000020','13400000-0000-4000-8000-000000000211');

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='folio-export-packages'
    AND public=false AND file_size_limit=3145728)
 OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage'
    AND tablename='objects' AND policyname='folio_export_package_no_client'
    AND permissive='RESTRICTIVE')
 OR has_schema_privilege('authenticated','folio_export_private','USAGE')
 OR has_schema_privilege('service_role','folio_export_private','USAGE')
 OR has_function_privilege('authenticated',
    'public.export_package_begin(uuid,uuid,uuid,uuid,uuid,text,integer)','EXECUTE')
 OR has_function_privilege('authenticated',
    'public.export_package_claim(uuid,uuid,bigint)','EXECUTE')
 THEN RAISE EXCEPTION 'M134 private boundary incomplete'; END IF;
END $$;

SET LOCAL ROLE service_role;
DO $$
DECLARE a uuid; b uuid; token uuid; rev bigint;
BEGIN
 -- No direct table access, even with service_role's RLS bypass.
 BEGIN
   PERFORM count(*) FROM folio_export_private.job;
   RAISE EXCEPTION 'service_role read private ledger directly';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;

 a:=public.export_package_begin(
   '13400000-0000-4000-8000-000000000001','13400000-0000-4000-8000-000000000011',
   '13400000-0000-4000-8000-000000000010','13400000-0000-4000-8000-000000000101',
   '13400000-0000-4000-8000-000000000301',repeat('a',64),2);
 b:=public.export_package_begin(
   '13400000-0000-4000-8000-000000000002','13400000-0000-4000-8000-000000000021',
   '13400000-0000-4000-8000-000000000020','13400000-0000-4000-8000-000000000201',
   '13400000-0000-4000-8000-000000000304',repeat('c',64),1);
 IF b IS NULL OR b=a THEN RAISE EXCEPTION 'second organization did not isolate job'; END IF;
 IF a IS DISTINCT FROM public.export_package_begin(
   '13400000-0000-4000-8000-000000000001','13400000-0000-4000-8000-000000000011',
   '13400000-0000-4000-8000-000000000010','13400000-0000-4000-8000-000000000101',
   '13400000-0000-4000-8000-000000000301',repeat('a',64),2)
 THEN RAISE EXCEPTION 'same operation did not replay'; END IF;
 BEGIN
   PERFORM public.export_package_begin(
     '13400000-0000-4000-8000-000000000001','13400000-0000-4000-8000-000000000011',
     '13400000-0000-4000-8000-000000000010','13400000-0000-4000-8000-000000000101',
     '13400000-0000-4000-8000-000000000301',repeat('b',64),2);
   RAISE EXCEPTION 'changed payload reused idempotency key';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
   PERFORM public.export_package_begin(
     '13400000-0000-4000-8000-000000000002','13400000-0000-4000-8000-000000000021',
     '13400000-0000-4000-8000-000000000010','13400000-0000-4000-8000-000000000101',
     '13400000-0000-4000-8000-000000000302',repeat('a',64),1);
   RAISE EXCEPTION 'cross-org principal created job';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   PERFORM public.export_package_begin(
     '13400000-0000-4000-8000-000000000003','13400000-0000-4000-8000-000000000012',
     '13400000-0000-4000-8000-000000000010','13400000-0000-4000-8000-000000000101',
     '13400000-0000-4000-8000-000000000303',repeat('a',64),1);
   RAISE EXCEPTION 'assistant created job';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF EXISTS (SELECT 1 FROM public.export_package_read(a,
    '13400000-0000-4000-8000-000000000002'))
 THEN RAISE EXCEPTION 'different principal read job'; END IF;
 SELECT c.lease_token,c.revision INTO token,rev FROM public.export_package_claim(a,
   '13400000-0000-4000-8000-000000000001',0) c;
 IF token IS NULL OR rev<>1 THEN RAISE EXCEPTION 'lease claim failed'; END IF;
 IF EXISTS (SELECT 1 FROM public.export_package_claim(a,
   '13400000-0000-4000-8000-000000000001',0))
 OR EXISTS (SELECT 1 FROM public.export_package_claim(a,
   '13400000-0000-4000-8000-000000000001',1))
 THEN RAISE EXCEPTION 'stale revision or active lease won'; END IF;
 IF public.export_package_fail(a,'13400000-0000-4000-8000-000000000001',
   gen_random_uuid(),1,'storage_failed') THEN RAISE EXCEPTION 'wrong lease failed job'; END IF;
 -- Save IDs for owner-side expiry and revocation checks after role reset.
 PERFORM set_config('test.m134_job',a::text,true);
 PERFORM set_config('test.m134_job_b',b::text,true);
 PERFORM set_config('test.m134_lease',token::text,true);
END $$;
RESET ROLE;

-- Time and membership changes are synthetic owner-side manipulations only.
UPDATE folio_export_private.job SET lease_until=now()-interval '1 second'
 WHERE id=current_setting('test.m134_job')::uuid;
SET LOCAL ROLE service_role;
DO $$
DECLARE token uuid; rev bigint;
BEGIN
 SELECT c.lease_token,c.revision INTO token,rev FROM public.export_package_claim(
   current_setting('test.m134_job')::uuid,
   '13400000-0000-4000-8000-000000000001',1) c;
 IF token IS NULL OR rev<>2 OR token=current_setting('test.m134_lease')::uuid
 THEN RAISE EXCEPTION 'expired lease did not CAS to a new token'; END IF;
 IF public.export_package_fail(current_setting('test.m134_job')::uuid,
   '13400000-0000-4000-8000-000000000001',
   current_setting('test.m134_lease')::uuid,1,'storage_failed')
 THEN RAISE EXCEPTION 'old worker completed after lease replacement'; END IF;
END $$;
RESET ROLE;
UPDATE public.member SET deleted_at=now()
 WHERE id='13400000-0000-4000-8000-000000000011';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
   PERFORM public.export_package_claim(current_setting('test.m134_job')::uuid,
     '13400000-0000-4000-8000-000000000001',2);
   RAISE EXCEPTION 'revoked membership claimed work';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE folio_export_private.job SET created_at=now()-interval '2 days',
  expires_at=now()-interval '1 second'
 WHERE id=current_setting('test.m134_job')::uuid;
-- Model a B06b2-completed job only to prove READY's historical timestamp is
-- retained when expiry makes the bytes inaccessible.
UPDATE folio_export_private.job SET state='ready',ready_at=now()-interval '1 minute',
  created_at=now()-interval '2 days',
  expires_at=now()-interval '1 second'
 WHERE id=current_setting('test.m134_job_b')::uuid;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
   PERFORM public.export_package_expire_due(NULL);
   RAISE EXCEPTION 'null expiry limit scanned all jobs';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF NOT EXISTS (SELECT 1 FROM public.export_package_expire_due(2)
    WHERE job_id=current_setting('test.m134_job')::uuid)
 THEN RAISE EXCEPTION 'expired work was not marked'; END IF;
 IF NOT public.export_package_cleanup_confirm(current_setting('test.m134_job')::uuid)
 THEN RAISE EXCEPTION 'bounded cleanup confirmation failed'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM folio_export_private.job WHERE state='ready')
 OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='export_package_ready')
 THEN RAISE EXCEPTION 'B06b1 must have no READY transition'; END IF;
 IF NOT EXISTS (SELECT 1 FROM folio_export_private.job
   WHERE id=current_setting('test.m134_job_b')::uuid
    AND state='expired' AND ready_at IS NOT NULL)
 THEN RAISE EXCEPTION 'expiry erased READY history'; END IF;
END $$;
ROLLBACK;
