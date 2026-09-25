-- M138 metadata-only reader. Synthetic rows and auth claims; rollback-only.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m138_uid',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.m138_jwt',true),''),'{}')::jsonb $$;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('test.m138_jwt','{"aal":"aal1"}',true);

INSERT INTO auth.users(id,email) VALUES
 ('13800000-0000-4000-8000-000000000001','owner-m138@spec.invalid'),
 ('13800000-0000-4000-8000-000000000002','pro-m138@spec.invalid'),
 ('13800000-0000-4000-8000-000000000003','assistant-m138@spec.invalid'),
 ('13800000-0000-4000-8000-000000000004','foreign-m138@spec.invalid'),
 ('13800000-0000-4000-8000-000000000005','director-m138@spec.invalid');
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES
 ('13800000-0000-4000-8000-000000000001','owner-m138@spec.invalid',now(),'v1'),
 ('13800000-0000-4000-8000-000000000002','pro-m138@spec.invalid',now(),'v1'),
 ('13800000-0000-4000-8000-000000000003','assistant-m138@spec.invalid',now(),'v1'),
 ('13800000-0000-4000-8000-000000000004','foreign-m138@spec.invalid',now(),'v1'),
 ('13800000-0000-4000-8000-000000000005','director-m138@spec.invalid',now(),'v1');
INSERT INTO public.organization(id,slug,nombre,tipo) VALUES
 ('13800000-0000-4000-8000-000000000010','m138-org-a','M138 A','CLINICA'),
 ('13800000-0000-4000-8000-000000000020','m138-org-b','M138 B','CLINICA');
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES
 ('13800000-0000-4000-8000-000000000011','13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000001','OWNER',true,now()),
 ('13800000-0000-4000-8000-000000000012','13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000002','PROFESIONAL',true,now()),
 ('13800000-0000-4000-8000-000000000013','13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000003','ASISTENTE',false,now()),
 ('13800000-0000-4000-8000-000000000021','13800000-0000-4000-8000-000000000020','13800000-0000-4000-8000-000000000004','OWNER',true,now()),
 ('13800000-0000-4000-8000-000000000015','13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000005','DIRECTOR',true,now());
INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado) VALUES
 ('13800000-0000-4000-8000-000000000111','13800000-0000-4000-8000-000000000010',decode('aa','hex'),decode('bb','hex'),decode('cc','hex')),
 ('13800000-0000-4000-8000-000000000211','13800000-0000-4000-8000-000000000020',decode('aa','hex'),decode('bb','hex'),decode('cc','hex'));
INSERT INTO public.paciente(id,organization_id,identidad_id,profesional_principal_id) VALUES
 ('13800000-0000-4000-8000-000000000101','13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000111','13800000-0000-4000-8000-000000000012'),
 ('13800000-0000-4000-8000-000000000201','13800000-0000-4000-8000-000000000020','13800000-0000-4000-8000-000000000211',NULL);
INSERT INTO public.documento_clinico(id,organization_id,paciente_id,tipo,storage_path,mime_type,tamanio_bytes,subido_por_id,content_sha256,validated_at,deleted_at) VALUES
 ('13800000-0000-4000-8000-000000000301','13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000101','INFORME_EXTERNO','documentos-clinicos/13800000-0000-4000-8000-000000000010/13800000-0000-4000-8000-000000000101/live.pdf','application/pdf',100,'13800000-0000-4000-8000-000000000011',repeat('a',64),now(),NULL),
 ('13800000-0000-4000-8000-000000000302','13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000101','INFORME_EXTERNO','documentos-clinicos/13800000-0000-4000-8000-000000000010/13800000-0000-4000-8000-000000000101/old.pdf','application/pdf',200,'13800000-0000-4000-8000-000000000011',repeat('b',64),now(),now());

DO $$ BEGIN
 IF has_function_privilege('anon','public.export_retired_document_metadata(uuid,uuid,integer,integer)','EXECUTE')
 OR has_function_privilege('service_role','public.export_retired_document_metadata(uuid,uuid,integer,integer)','EXECUTE')
 OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
   AND policyname='clinical_attachments_server_only' AND permissive='RESTRICTIVE')
 THEN RAISE EXCEPTION 'M138 permission or Storage boundary changed'; END IF;
END $$;

SELECT set_config('test.m138_uid','13800000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.export_retired_document_metadata(
  '13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000101',0,500);
 IF (result->>'total')::integer<>1 OR (result->>'all_total')::integer<>2
 OR jsonb_array_length(result->'rows')<>1
 OR result->'rows'->0->>'id'<>'13800000-0000-4000-8000-000000000302'
 OR result->'rows'->0->>'content_sha256'<>repeat('b',64)
 OR result::text ~ '(storage_path|storage_bucket|old[.]pdf|download_url)'
 THEN RAISE EXCEPTION 'M138 metadata contract incorrect'; END IF;
 IF (SELECT count(*) FROM public.documento_clinico
   WHERE paciente_id='13800000-0000-4000-8000-000000000101')<>1
 THEN RAISE EXCEPTION 'M08 ordinary RLS now reveals retired document'; END IF;
 result:=public.export_retired_document_metadata(
  '13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000101',1,500);
 IF (result->>'total')::integer<>1 OR (result->>'all_total')::integer<>2
 OR jsonb_array_length(result->'rows')<>0
 THEN RAISE EXCEPTION 'M138 pagination total changed'; END IF;
 BEGIN
  PERFORM public.export_retired_document_metadata(
   '13800000-0000-4000-8000-000000000020','13800000-0000-4000-8000-000000000201',0,500);
  RAISE EXCEPTION 'M138 cross-tenant metadata allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SELECT set_config('test.m138_uid','13800000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (public.export_retired_document_metadata(
   '13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000101',0,500)->>'total')::integer<>1
 THEN RAISE EXCEPTION 'M138 assigned professional cannot read metadata'; END IF;
END $$;
RESET ROLE;

UPDATE public.paciente SET profesional_principal_id=NULL
 WHERE id='13800000-0000-4000-8000-000000000101';
SELECT set_config('test.m138_uid','13800000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.export_retired_document_metadata(
   '13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000101',0,500);
  RAISE EXCEPTION 'M138 unrelated professional read metadata';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.paciente SET profesional_principal_id='13800000-0000-4000-8000-000000000012'
 WHERE id='13800000-0000-4000-8000-000000000101';

SELECT set_config('test.m138_uid','13800000-0000-4000-8000-000000000005',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (public.export_retired_document_metadata(
   '13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000101',0,500)->>'total')::integer<>1
 THEN RAISE EXCEPTION 'M138 colegiado director cannot read metadata'; END IF;
END $$;
RESET ROLE;

UPDATE public.member SET es_colegiado=false
 WHERE id='13800000-0000-4000-8000-000000000015';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.export_retired_document_metadata(
   '13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000101',0,500);
  RAISE EXCEPTION 'M138 non-colegiado director read metadata';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.member SET es_colegiado=true
 WHERE id='13800000-0000-4000-8000-000000000015';

SELECT set_config('test.m138_uid','13800000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.export_retired_document_metadata(
   '13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000101',0,500);
  RAISE EXCEPTION 'M138 assistant read retired metadata';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

SELECT set_config('test.m138_uid','13800000-0000-4000-8000-000000000001',true);
UPDATE public.paciente SET deleted_at=now()
 WHERE id='13800000-0000-4000-8000-000000000101';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.export_retired_document_metadata(
   '13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000101',0,500);
  RAISE EXCEPTION 'M138 retired patient read metadata';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.paciente SET deleted_at=NULL
 WHERE id='13800000-0000-4000-8000-000000000101';

UPDATE public.paciente_identidad SET deleted_at=now()
 WHERE id='13800000-0000-4000-8000-000000000111';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.export_retired_document_metadata(
   '13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000101',0,500);
  RAISE EXCEPTION 'M138 retired identity read metadata';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.paciente_identidad SET deleted_at=NULL
 WHERE id='13800000-0000-4000-8000-000000000111';

UPDATE public.paciente SET identidad_id=NULL,pseudonimizado_en=now()
 WHERE id='13800000-0000-4000-8000-000000000101';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.export_retired_document_metadata(
   '13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000101',0,500);
  RAISE EXCEPTION 'M138 pseudonymized patient read metadata';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.paciente SET identidad_id='13800000-0000-4000-8000-000000000111',pseudonimizado_en=NULL
 WHERE id='13800000-0000-4000-8000-000000000101';

UPDATE public.paciente SET caja_fuerte_profesional='13800000-0000-4000-8000-000000000012'
 WHERE id='13800000-0000-4000-8000-000000000101';
SELECT set_config('test.m138_uid','13800000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.export_retired_document_metadata(
   '13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000101',0,500);
  RAISE EXCEPTION 'M138 owner bypassed patient vault';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

UPDATE public.member SET deleted_at=now() WHERE id='13800000-0000-4000-8000-000000000012';
SELECT set_config('test.m138_uid','13800000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.export_retired_document_metadata(
   '13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000101',0,500);
  RAISE EXCEPTION 'M138 revoked professional read metadata';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

UPDATE public.paciente SET caja_fuerte_profesional=NULL
 WHERE id='13800000-0000-4000-8000-000000000101';
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
SELECT set_config('test.m138_uid','13800000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.export_retired_document_metadata(
   '13800000-0000-4000-8000-000000000010','13800000-0000-4000-8000-000000000101',0,500);
  RAISE EXCEPTION 'M138 AAL1 bypassed active MFA policy';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
