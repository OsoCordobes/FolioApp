-- M140: synthetic, rollback-only delivery metadata; no Storage bytes or PHI.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('14000000-0000-4000-8000-000000000001','owner-m140@spec.invalid');
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES
 ('14000000-0000-4000-8000-000000000001','owner-m140@spec.invalid',now(),'v1');
INSERT INTO public.organization(id,slug,nombre,tipo) VALUES
 ('14000000-0000-4000-8000-000000000010','m140-org','M140 Org','CLINICA');
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES
 ('14000000-0000-4000-8000-000000000011','14000000-0000-4000-8000-000000000010',
  '14000000-0000-4000-8000-000000000001','OWNER',true,now());
INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado) VALUES
 ('14000000-0000-4000-8000-000000000111','14000000-0000-4000-8000-000000000010',
  decode('aa','hex'),decode('bb','hex'),decode('cc','hex'));
INSERT INTO public.paciente(id,organization_id,identidad_id) VALUES
 ('14000000-0000-4000-8000-000000000101','14000000-0000-4000-8000-000000000010',
  '14000000-0000-4000-8000-000000000111');

DO $$ BEGIN
 IF has_schema_privilege('service_role','folio_export_private','USAGE')
 OR has_table_privilege('service_role','folio_export_private.entry','SELECT')
 OR has_function_privilege('authenticated',
   'public.export_package_delivery_page(uuid,uuid,integer,integer)','EXECUTE')
 OR has_function_privilege('authenticated',
   'public.export_package_delivery_fragment(uuid,uuid,uuid,integer)','EXECUTE')
 OR has_function_privilege('authenticated',
   'public.export_package_operation_read(uuid,uuid,uuid,uuid)','EXECUTE')
 OR has_function_privilege('service_role',
   'folio_export_private.assert_ready(uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'M140 private boundary widened'; END IF;
END $$;

SET LOCAL ROLE service_role;
DO $$
DECLARE j uuid; t uuid; r bigint; e_json uuid; e_doc uuid; e_retired uuid;
  other_job uuid; other_token uuid; other_revision bigint; other_entry uuid;
  expected jsonb; op record; page record; fragment record;
BEGIN
 j:=public.export_package_begin(
   '14000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000011',
   '14000000-0000-4000-8000-000000000010','14000000-0000-4000-8000-000000000101',
   '14000000-0000-4000-8000-000000000201',repeat('a',64),3);
 SELECT * INTO op FROM public.export_package_operation_read(
   '14000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000010',
   '14000000-0000-4000-8000-000000000101','14000000-0000-4000-8000-000000000201');
 IF op.job_id<>j OR op.expected_entries<>3 OR op.state<>'pending' OR op.lease_until IS NOT NULL
 THEN RAISE EXCEPTION 'operation recovery incorrect'; END IF;
 IF EXISTS (SELECT 1 FROM public.export_package_operation_read(
   '14000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000010',
   '14000000-0000-4000-8000-000000000199','14000000-0000-4000-8000-000000000201'))
 OR EXISTS (SELECT 1 FROM public.export_package_operation_read(
   '14000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000099',
   '14000000-0000-4000-8000-000000000101','14000000-0000-4000-8000-000000000201'))
 THEN RAISE EXCEPTION 'operation crossed patient or tenant'; END IF;
 BEGIN
   PERFORM public.export_package_delivery_page(j,
     '14000000-0000-4000-8000-000000000001',0,50);
   RAISE EXCEPTION 'pending job delivered inventory';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 SELECT c.lease_token,c.revision INTO t,r FROM public.export_package_claim(j,
   '14000000-0000-4000-8000-000000000001',0) c;
 SELECT x.entry_id INTO e_json FROM public.export_package_entry_register(j,
   '14000000-0000-4000-8000-000000000001',t,r,'json',
   '14000000-0000-4000-8000-000000000101',0::smallint,1,'not_applicable',NULL) x;
 SELECT x.entry_id INTO e_doc FROM public.export_package_entry_register(j,
   '14000000-0000-4000-8000-000000000001',t,r,'document',
   '14000000-0000-4000-8000-000000000301',0::smallint,2,'recorded',repeat('b',64)) x;
 SELECT x.entry_id INTO e_retired FROM public.export_package_entry_register(j,
   '14000000-0000-4000-8000-000000000001',t,r,'withdrawn_document',
   '14000000-0000-4000-8000-000000000302',0::smallint,0,'not_recorded',NULL) x;
 PERFORM public.export_package_fragment_register(j,
   '14000000-0000-4000-8000-000000000001',t,r,e_json,0,100,repeat('a',64));
 PERFORM public.export_package_fragment_register(j,
   '14000000-0000-4000-8000-000000000001',t,r,e_doc,0,3145728,repeat('d',64));
 PERFORM public.export_package_fragment_register(j,
   '14000000-0000-4000-8000-000000000001',t,r,e_doc,1,5,repeat('e',64));
 PERFORM public.export_package_entry_verify(j,
   '14000000-0000-4000-8000-000000000001',t,r,e_json,repeat('a',64));
 PERFORM public.export_package_entry_verify(j,
   '14000000-0000-4000-8000-000000000001',t,r,e_doc,repeat('b',64));
 expected:=jsonb_build_array(
   jsonb_build_object('kind','document','source_id','14000000-0000-4000-8000-000000000301',
     'source_index',0,'expected_fragments',2,'source_hash_kind','recorded','source_sha256',repeat('b',64)),
   jsonb_build_object('kind','json','source_id','14000000-0000-4000-8000-000000000101',
     'source_index',0,'expected_fragments',1,'source_hash_kind','not_applicable','source_sha256',NULL),
   jsonb_build_object('kind','withdrawn_document','source_id','14000000-0000-4000-8000-000000000302',
     'source_index',0,'expected_fragments',0,'source_hash_kind','not_recorded','source_sha256',NULL));
 IF NOT public.export_package_finish(j,
   '14000000-0000-4000-8000-000000000001',t,r,repeat('a',64),expected)
 THEN RAISE EXCEPTION 'ready failed'; END IF;
 IF (SELECT count(*) FROM public.export_package_delivery_page(j,
   '14000000-0000-4000-8000-000000000001',0,50))<>3
 THEN RAISE EXCEPTION 'delivery page incomplete'; END IF;
 SELECT * INTO page FROM public.export_package_delivery_page(j,
   '14000000-0000-4000-8000-000000000001',0,1);
 IF page.expected_entries<>3 OR page.prepared_at IS NULL OR page.kind<>'document'
   OR page.actual_fragments<>2 OR page.total_bytes<>3145733
 THEN RAISE EXCEPTION 'delivery metadata incorrect'; END IF;
 SELECT * INTO fragment FROM public.export_package_delivery_fragment(j,
   '14000000-0000-4000-8000-000000000001',e_doc,0);
 IF fragment.fragment_bytes<>3145728 OR fragment.fragment_sha256<>repeat('d',64)
   OR fragment.computed_sha256<>repeat('b',64)
 THEN RAISE EXCEPTION 'fragment metadata incorrect'; END IF;
 IF EXISTS (SELECT 1 FROM public.export_package_delivery_fragment(j,
   '14000000-0000-4000-8000-000000000001',e_retired,0))
 OR EXISTS (SELECT 1 FROM public.export_package_delivery_fragment(j,
   '14000000-0000-4000-8000-000000000001',e_doc,2))
 THEN RAISE EXCEPTION 'nonexistent or withdrawn bytes exposed'; END IF;
 BEGIN
   PERFORM public.export_package_delivery_page(j,
     '14000000-0000-4000-8000-000000000099',0,1);
   RAISE EXCEPTION 'other actor read page';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   PERFORM public.export_package_delivery_fragment(j,
     '14000000-0000-4000-8000-000000000099',e_doc,0);
   RAISE EXCEPTION 'other actor read fragment';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 other_job:=public.export_package_begin(
   '14000000-0000-4000-8000-000000000001','14000000-0000-4000-8000-000000000011',
   '14000000-0000-4000-8000-000000000010','14000000-0000-4000-8000-000000000101',
   '14000000-0000-4000-8000-000000000202',repeat('a',64),1);
 SELECT c.lease_token,c.revision INTO other_token,other_revision
 FROM public.export_package_claim(other_job,
   '14000000-0000-4000-8000-000000000001',0) c;
 SELECT x.entry_id INTO other_entry FROM public.export_package_entry_register(other_job,
   '14000000-0000-4000-8000-000000000001',other_token,other_revision,
   'json','14000000-0000-4000-8000-000000000101',0::smallint,1,'not_applicable',NULL) x;
 PERFORM public.export_package_fragment_register(other_job,
   '14000000-0000-4000-8000-000000000001',other_token,other_revision,
   other_entry,0,100,repeat('f',64));
 IF EXISTS (SELECT 1 FROM public.export_package_delivery_fragment(j,
   '14000000-0000-4000-8000-000000000001',other_entry,0))
 THEN RAISE EXCEPTION 'entry from another job read'; END IF;
 BEGIN
   PERFORM public.export_package_delivery_page(j,
     '14000000-0000-4000-8000-000000000001',0,51);
   RAISE EXCEPTION 'unbounded page accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM set_config('test.m140_job',j::text,true);
END $$;
RESET ROLE;

UPDATE public.member SET role='ASISTENTE',es_colegiado=false
WHERE id='14000000-0000-4000-8000-000000000011';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
   PERFORM public.export_package_delivery_page(current_setting('test.m140_job')::uuid,
     '14000000-0000-4000-8000-000000000001',0,1);
   RAISE EXCEPTION 'revoked role retained READY access';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.member SET role='OWNER',es_colegiado=true
WHERE id='14000000-0000-4000-8000-000000000011';

UPDATE folio_export_private.job SET created_at=now()-interval '2 days',
  expires_at=now()-interval '1 second'
WHERE id=current_setting('test.m140_job')::uuid;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
   PERFORM public.export_package_delivery_page(current_setting('test.m140_job')::uuid,
     '14000000-0000-4000-8000-000000000001',0,1);
   RAISE EXCEPTION 'expired job delivered inventory';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
