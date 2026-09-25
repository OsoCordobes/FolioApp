-- M137: synthetic private fragment lifecycle; no Storage object or PHI is used.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('13600000-0000-4000-8000-000000000001','owner-m137@spec.invalid');
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES
 ('13600000-0000-4000-8000-000000000001','owner-m137@spec.invalid',now(),'v1');
INSERT INTO public.organization(id,slug,nombre,tipo) VALUES
 ('13600000-0000-4000-8000-000000000010','m137-org','M137 Org','CLINICA');
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES
 ('13600000-0000-4000-8000-000000000011','13600000-0000-4000-8000-000000000010',
  '13600000-0000-4000-8000-000000000001','OWNER',true,now());
INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado) VALUES
 ('13600000-0000-4000-8000-000000000111','13600000-0000-4000-8000-000000000010',
  decode('aa','hex'),decode('bb','hex'),decode('cc','hex'));
INSERT INTO public.paciente(id,organization_id,identidad_id) VALUES
 ('13600000-0000-4000-8000-000000000101','13600000-0000-4000-8000-000000000010',
  '13600000-0000-4000-8000-000000000111');

DO $$ BEGIN
 IF has_function_privilege('authenticated',
   'public.export_package_finish(uuid,uuid,uuid,bigint,text,jsonb)','EXECUTE')
 OR has_schema_privilege('service_role','folio_export_private','USAGE')
 OR has_function_privilege('service_role',
   'folio_export_private.assert_lease(uuid,uuid,uuid,bigint)','EXECUTE')
 THEN RAISE EXCEPTION 'M137 private grants widened'; END IF;
END $$;

SET LOCAL ROLE service_role;
DO $$
DECLARE j uuid; t uuid; r bigint; e_json uuid; e_doc uuid; e_retired uuid;
  expected jsonb; wrong jsonb;
BEGIN
 j:=public.export_package_begin(
   '13600000-0000-4000-8000-000000000001','13600000-0000-4000-8000-000000000011',
   '13600000-0000-4000-8000-000000000010','13600000-0000-4000-8000-000000000101',
   '13600000-0000-4000-8000-000000000201',repeat('a',64),3);
 SELECT c.lease_token,c.revision INTO t,r FROM public.export_package_claim(j,
   '13600000-0000-4000-8000-000000000001',0) c;
 IF t IS NULL OR r<>1 THEN RAISE EXCEPTION 'claim failed'; END IF;
 SELECT q.entry_id INTO e_json FROM public.export_package_entry_register(j,
   '13600000-0000-4000-8000-000000000001',t,r,'json',
   '13600000-0000-4000-8000-000000000101',0::smallint,1,'not_applicable',NULL) q;
 SELECT q.entry_id INTO e_doc FROM public.export_package_entry_register(j,
   '13600000-0000-4000-8000-000000000001',t,r,'document',
   '13600000-0000-4000-8000-000000000301',0::smallint,2,'recorded',repeat('b',64)) q;
 SELECT q.entry_id INTO e_retired FROM public.export_package_entry_register(j,
   '13600000-0000-4000-8000-000000000001',t,r,'withdrawn_document',
   '13600000-0000-4000-8000-000000000302',0::smallint,0,'not_recorded',NULL) q;
 IF e_json IS NULL OR e_doc IS NULL OR e_retired IS NULL OR
   e_json IS DISTINCT FROM (SELECT q.entry_id FROM public.export_package_entry_register(j,
     '13600000-0000-4000-8000-000000000001',t,r,'json',
     '13600000-0000-4000-8000-000000000101',0::smallint,1,'not_applicable',NULL) q)
 THEN RAISE EXCEPTION 'entry replay failed'; END IF;
 BEGIN
   PERFORM public.export_package_entry_register(j,
     '13600000-0000-4000-8000-000000000001',t,r,'json',
     '13600000-0000-4000-8000-000000000101',0::smallint,2,'not_applicable',NULL);
   RAISE EXCEPTION 'changed entry replay accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF NOT public.export_package_fragment_register(j,
   '13600000-0000-4000-8000-000000000001',t,r,e_json,0,100,repeat('a',64))
 THEN RAISE EXCEPTION 'JSON fragment failed'; END IF;
 IF NOT public.export_package_fragment_register(j,
   '13600000-0000-4000-8000-000000000001',t,r,e_json,0,100,repeat('a',64))
 THEN RAISE EXCEPTION 'same fragment replay failed'; END IF;
 BEGIN
   PERFORM public.export_package_fragment_register(j,
     '13600000-0000-4000-8000-000000000001',t,r,e_json,0,100,repeat('c',64));
   RAISE EXCEPTION 'different fragment replay accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF NOT public.export_package_entry_verify(j,
   '13600000-0000-4000-8000-000000000001',t,r,e_json,repeat('a',64))
 THEN RAISE EXCEPTION 'JSON verification failed'; END IF;
 PERFORM public.export_package_fragment_register(j,
   '13600000-0000-4000-8000-000000000001',t,r,e_doc,0,3145728,repeat('d',64));
 BEGIN
   PERFORM public.export_package_entry_verify(j,
     '13600000-0000-4000-8000-000000000001',t,r,e_doc,repeat('b',64));
   RAISE EXCEPTION 'partial document verified';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM public.export_package_fragment_register(j,
   '13600000-0000-4000-8000-000000000001',t,r,e_doc,1,5,repeat('e',64));
 PERFORM public.export_package_entry_verify(j,
   '13600000-0000-4000-8000-000000000001',t,r,e_doc,repeat('b',64));
 expected:=jsonb_build_array(
   jsonb_build_object('kind','document','source_id','13600000-0000-4000-8000-000000000301',
     'source_index',0,'expected_fragments',2,'source_hash_kind','recorded','source_sha256',repeat('b',64)),
   jsonb_build_object('kind','json','source_id','13600000-0000-4000-8000-000000000101',
     'source_index',0,'expected_fragments',1,'source_hash_kind','not_applicable','source_sha256',NULL),
   jsonb_build_object('kind','withdrawn_document','source_id','13600000-0000-4000-8000-000000000302',
     'source_index',0,'expected_fragments',0,'source_hash_kind','not_recorded','source_sha256',NULL));
 wrong:=jsonb_set(expected,'{2,source_id}','"13600000-0000-4000-8000-000000000399"'::jsonb);
 BEGIN
   PERFORM public.export_package_finish(j,
     '13600000-0000-4000-8000-000000000001',t,r,repeat('a',64),wrong);
   RAISE EXCEPTION 'same-count wrong inventory reached READY';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF (SELECT state FROM public.export_package_read(j,
   '13600000-0000-4000-8000-000000000001'))<>'leased'
 THEN RAISE EXCEPTION 'failed finish changed state'; END IF;
 PERFORM set_config('test.m137_job',j::text,true);
 PERFORM set_config('test.m137_token',t::text,true);
 PERFORM set_config('test.m137_expected',expected::text,true);
END $$;
RESET ROLE;

-- A lost worker's verified fragments survive lease replacement.
UPDATE folio_export_private.job SET lease_until=now()-interval '1 second'
 WHERE id=current_setting('test.m137_job')::uuid;
SET LOCAL ROLE service_role;
DO $$
DECLARE j uuid:=current_setting('test.m137_job')::uuid;
  old_token uuid:=current_setting('test.m137_token')::uuid;
  new_token uuid; r bigint;
BEGIN
 SELECT c.lease_token,c.revision INTO new_token,r FROM public.export_package_claim(j,
   '13600000-0000-4000-8000-000000000001',1) c;
 IF new_token IS NULL OR new_token=old_token OR r<>2
 THEN RAISE EXCEPTION 'lease replacement failed'; END IF;
 BEGIN
   PERFORM public.export_package_renew(j,
     '13600000-0000-4000-8000-000000000001',old_token,1);
   RAISE EXCEPTION 'stale token renewed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF NOT public.export_package_renew(j,
   '13600000-0000-4000-8000-000000000001',new_token,r)
 THEN RAISE EXCEPTION 'current lease not renewed'; END IF;
 IF NOT public.export_package_finish(j,
   '13600000-0000-4000-8000-000000000001',new_token,r,repeat('a',64),
   current_setting('test.m137_expected')::jsonb)
 THEN RAISE EXCEPTION 'complete inventory did not finish'; END IF;
 BEGIN
   PERFORM public.export_package_renew(j,
     '13600000-0000-4000-8000-000000000001',new_token,r);
   RAISE EXCEPTION 'READY lease renewed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

DO $$ BEGIN
 IF (SELECT state FROM folio_export_private.job
   WHERE id=current_setting('test.m137_job')::uuid)<>'ready'
 THEN RAISE EXCEPTION 'ready state not persisted'; END IF;
END $$;
UPDATE folio_export_private.job SET created_at=now()-interval '1 day',
  expires_at=now()-interval '10 minutes'
 WHERE id=current_setting('test.m137_job')::uuid;
SET LOCAL ROLE service_role;
DO $$
DECLARE j uuid:=current_setting('test.m137_job')::uuid;
  t uuid; r bigint; e record;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.export_package_expire_due(1) WHERE job_id=j)
 THEN RAISE EXCEPTION 'ready job did not expire'; END IF;
 IF public.export_package_cleanup_confirm(j)
 THEN RAISE EXCEPTION 'old unleased cleanup confirmed job with entries'; END IF;
 SELECT d.revision INTO r FROM public.export_package_cleanup_due(1) d WHERE d.job_id=j;
 IF r IS NULL THEN RAISE EXCEPTION 'cleanup grace not satisfied'; END IF;
 BEGIN
   PERFORM public.export_package_cleanup_renew(j,NULL,r);
   RAISE EXCEPTION 'NULL token renewed unclaimed cleanup';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   PERFORM public.export_package_cleanup_entry_read(j,NULL,r);
   RAISE EXCEPTION 'NULL token read unclaimed cleanup';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   PERFORM public.export_package_cleanup_confirm(j,NULL,r);
   RAISE EXCEPTION 'NULL token confirmed unclaimed cleanup';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 SELECT c.cleanup_token,c.revision INTO t,r FROM public.export_package_cleanup_claim(j,r) c;
 IF t IS NULL THEN RAISE EXCEPTION 'cleanup claim failed'; END IF;
 IF public.export_package_cleanup_confirm(j,t,r)
 THEN RAISE EXCEPTION 'cleanup confirmed unscanned entries'; END IF;
 FOR e IN SELECT * FROM public.export_package_cleanup_entry_read(j,t,r) LOOP
   IF public.export_package_cleanup_entry_confirm(j,t,r,e.entry_id,true)
   THEN RAISE EXCEPTION 'first empty scan cleaned entry'; END IF;
 END LOOP;
 PERFORM set_config('test.m137_cleanup_token',t::text,true);
 PERFORM set_config('test.m137_cleanup_rev',r::text,true);
END $$;
RESET ROLE;
UPDATE folio_export_private.entry SET cleanup_empty_at=now()-interval '61 seconds'
 WHERE job_id=current_setting('test.m137_job')::uuid;
SET LOCAL ROLE service_role;
DO $$
DECLARE j uuid:=current_setting('test.m137_job')::uuid;
  t uuid:=current_setting('test.m137_cleanup_token')::uuid;
  r bigint:=current_setting('test.m137_cleanup_rev')::bigint; e record;
BEGIN
 FOR e IN SELECT * FROM public.export_package_cleanup_entry_read(j,t,r) LOOP
   IF NOT public.export_package_cleanup_entry_confirm(j,t,r,e.entry_id,true)
   THEN RAISE EXCEPTION 'second empty scan did not clean entry'; END IF;
 END LOOP;
 IF NOT public.export_package_cleanup_confirm(j,t,r)
 THEN RAISE EXCEPTION 'complete cleanup did not confirm'; END IF;
 BEGIN
   PERFORM public.export_package_cleanup_renew(j,t,r);
   RAISE EXCEPTION 'cleaned job accepted stale cleanup token';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
DECLARE j uuid; t uuid; r bigint;
BEGIN
 j:=public.export_package_begin(
   '13600000-0000-4000-8000-000000000001','13600000-0000-4000-8000-000000000011',
   '13600000-0000-4000-8000-000000000010','13600000-0000-4000-8000-000000000101',
   '13600000-0000-4000-8000-000000000202',repeat('a',64),1);
 SELECT c.lease_token,c.revision INTO t,r FROM public.export_package_claim(j,
   '13600000-0000-4000-8000-000000000001',0) c;
 PERFORM set_config('test.m137_revoked_job',j::text,true);
 PERFORM set_config('test.m137_revoked_token',t::text,true);
END $$;
RESET ROLE;
UPDATE public.member SET deleted_at=now()
 WHERE id='13600000-0000-4000-8000-000000000011';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
   PERFORM public.export_package_entry_register(
     current_setting('test.m137_revoked_job')::uuid,
     '13600000-0000-4000-8000-000000000001',
     current_setting('test.m137_revoked_token')::uuid,1,'json',
     '13600000-0000-4000-8000-000000000101',0::smallint,1,'not_applicable',NULL);
   RAISE EXCEPTION 'revoked actor registered entry';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
