-- Full migration installation must preserve legacy until an audited activation.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('test.m104_uid',true),'')::uuid
$$;
CREATE OR REPLACE FUNCTION public.mfa_access_allowed() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;
GRANT SELECT ON member,organization,paciente,paciente_identidad TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
GRANT SELECT,INSERT,UPDATE ON documento_clinico TO authenticated,service_role;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
INSERT INTO auth.users(id,email) VALUES('10400000-0000-4000-8000-000000000001','m104@synthetic.invalid');
INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version)
 VALUES('10400000-0000-4000-8000-000000000001','m104@synthetic.invalid',now(),'v1');
INSERT INTO organization(id,slug,nombre) VALUES('10400000-0000-4000-8000-000000000010','m104-rollout','Synthetic');
INSERT INTO member(id,organization_id,profile_id,role,accepted_at)
 VALUES('10400000-0000-4000-8000-000000000011','10400000-0000-4000-8000-000000000010','10400000-0000-4000-8000-000000000001','OWNER',now());
INSERT INTO paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado)
 VALUES('10400000-0000-4000-8000-000000000020','10400000-0000-4000-8000-000000000010','\x01','\x02','\x03');
INSERT INTO paciente(id,organization_id,identidad_id,profesional_principal_id)
 VALUES('10400000-0000-4000-8000-000000000030','10400000-0000-4000-8000-000000000010','10400000-0000-4000-8000-000000000020','10400000-0000-4000-8000-000000000011');
INSERT INTO storage.objects(id,bucket_id,name) VALUES('10400000-0000-4000-8000-000000000040','documentos-clinicos','10400000-0000-4000-8000-000000000010/10400000-0000-4000-8000-000000000030/legacy.png');
SELECT set_config('test.m104_uid','10400000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE id='10400000-0000-4000-8000-000000000040') THEN RAISE EXCEPTION 'M104 RED: installation alone blocks legacy SDK'; END IF;
 INSERT INTO storage.objects(bucket_id,name) VALUES('documentos-clinicos','10400000-0000-4000-8000-000000000010/10400000-0000-4000-8000-000000000030/new-legacy.png');
 INSERT INTO documento_clinico(id,organization_id,paciente_id,tipo,storage_path,mime_type,tamanio_bytes,subido_por_id)
 VALUES('10400000-0000-4000-8000-000000000050','10400000-0000-4000-8000-000000000010','10400000-0000-4000-8000-000000000030','RADIOGRAFIA','documentos-clinicos/10400000-0000-4000-8000-000000000010/10400000-0000-4000-8000-000000000030/legacy.png','image/png',1,'10400000-0000-4000-8000-000000000011');
 UPDATE documento_clinico SET fecha_estudio='2026-09-01' WHERE id='10400000-0000-4000-8000-000000000050';
 BEGIN
  PERFORM public.enable_clinical_attachments('Reviewed synthetic rollout before pilot',repeat('a',40),'TEST:M104');
  RAISE EXCEPTION 'M104: OWNER activated enforcement';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE folio_attachments_private.policy SET enabled=true;
  RAISE EXCEPTION 'M104: OWNER wrote private policy';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"role":"service_role","user_metadata":{"enabled":true}}',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.enable_clinical_attachments('Reviewed synthetic rollout before pilot',repeat('a',40),'TEST:M104');
  RAISE EXCEPTION 'M104: metadata activated enforcement';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM public.enable_clinical_attachments('Reviewed synthetic rollout before pilot',repeat('a',40),'TEST:M104');
  RAISE EXCEPTION 'M104: anon activated enforcement';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM folio_attachments_private.policy WHERE NOT enabled AND enabled_at IS NULL) THEN RAISE EXCEPTION 'M104: enabled by install'; END IF;
 IF EXISTS(SELECT 1 FROM folio_attachments_private.policy_history) THEN RAISE EXCEPTION 'M104: fabricated activation'; END IF;
END $$;
-- Failure to persist the activation receipt rolls back the policy and bucket.
UPDATE storage.buckets SET public=true WHERE id='documentos-clinicos';
CREATE FUNCTION pg_temp.m104_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Synthetic receipt failure';
END $$;
CREATE TRIGGER m104_reject_receipt BEFORE INSERT ON folio_attachments_private.policy_history
 FOR EACH ROW EXECUTE FUNCTION pg_temp.m104_reject_receipt();
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
  PERFORM public.enable_clinical_attachments('Reviewed synthetic rollout before pilot',repeat('a',40),'TEST:M104');
  RAISE EXCEPTION 'M104: failed receipt accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM folio_attachments_private.policy WHERE enabled) THEN RAISE EXCEPTION 'M104: failed receipt left policy enabled'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='documentos-clinicos' AND public) THEN RAISE EXCEPTION 'M104: failed receipt partially closed bucket'; END IF;
END $$;
DROP TRIGGER m104_reject_receipt ON folio_attachments_private.policy_history;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
  PERFORM public.enable_clinical_attachments('short',repeat('a',40),'TEST:M104');
  RAISE EXCEPTION 'M104: short reason accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.enable_clinical_attachments('Reviewed synthetic rollout before pilot','not-a-build','TEST:M104');
  RAISE EXCEPTION 'M104: invalid build accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.enable_clinical_attachments('Reviewed synthetic rollout before pilot',repeat('a',40),'url?token=secret');
  RAISE EXCEPTION 'M104: invalid reference accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT public.enable_clinical_attachments('Reviewed synthetic rollout before pilot',repeat('a',40),'TEST:M104');
SELECT public.enable_clinical_attachments('Repeated activation preserves initial receipt',repeat('b',40),'TEST:REPEAT');
DO $$ BEGIN
 BEGIN
  UPDATE folio_attachments_private.policy SET enabled=false;
  RAISE EXCEPTION 'M104: service API directly disabled policy';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM folio_attachments_private.policy WHERE enabled AND build_sha=repeat('a',40) AND reference='TEST:M104' AND enabled_at IS NOT NULL) THEN RAISE EXCEPTION 'M104: activation receipt overwritten'; END IF;
 IF (SELECT count(*) FROM folio_attachments_private.policy_history)<>1 THEN RAISE EXCEPTION 'M104: activation history not exactly once'; END IF;
 IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='documentos-clinicos' AND public) THEN RAISE EXCEPTION 'M104: clinical bucket public'; END IF;
 IF NOT EXISTS(SELECT 1 FROM documento_clinico WHERE id='10400000-0000-4000-8000-000000000050' AND content_sha256 IS NULL AND validated_at IS NULL) THEN RAISE EXCEPTION 'M104: legacy metadata rewritten'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('folio_attachments.enabled','false',true);
DO $$ DECLARE n integer; BEGIN
 IF EXISTS(SELECT 1 FROM storage.objects WHERE id='10400000-0000-4000-8000-000000000040') THEN RAISE EXCEPTION 'M104: activated SDK still readable'; END IF;
 UPDATE storage.objects SET name='tampered.png' WHERE id='10400000-0000-4000-8000-000000000040';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'M104: activated SDK update'; END IF;
 DELETE FROM storage.objects WHERE id='10400000-0000-4000-8000-000000000040';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'M104: activated SDK delete'; END IF;
 UPDATE documento_clinico SET fecha_estudio='2026-09-02' WHERE id='10400000-0000-4000-8000-000000000050';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'M104: activated metadata update'; END IF;
 BEGIN
  INSERT INTO storage.objects(bucket_id,name) VALUES('documentos-clinicos','10400000-0000-4000-8000-000000000010/10400000-0000-4000-8000-000000000030/forged.png');
  RAISE EXCEPTION 'M104: activated SDK insert';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
