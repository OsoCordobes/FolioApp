-- Effective M102 + M104 SQL/RLS regression tests, rolled back after verification.
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.enable_clinical_attachments('Synthetic authenticated attachment smoke passed',repeat('a',40),'TEST:M102');
RESET ROLE;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m102_uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT ON member, organization, paciente, paciente_identidad, alergia TO authenticated;
GRANT INSERT, UPDATE ON organization TO authenticated;
GRANT SELECT, UPDATE ON organization TO service_role;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
 ('10200000-0000-4000-8000-000000000001', 'm102-owner@spec.test', now()),
 ('10200000-0000-4000-8000-000000000002', 'm102-prof@spec.test', now()),
 ('10200000-0000-4000-8000-000000000003', 'm102-patient@spec.test', now());
INSERT INTO profile (id,email,consent_pii_signed_at,consent_pii_text_version)
 SELECT id,email,now(),'v1' FROM auth.users WHERE id IN
 ('10200000-0000-4000-8000-000000000001','10200000-0000-4000-8000-000000000002');
INSERT INTO organization(id,slug,nombre) VALUES
 ('10200000-0000-4000-8000-000000000010','m102-boundaries','M102');
INSERT INTO member(id,organization_id,profile_id,role,accepted_at) VALUES
 ('10200000-0000-4000-8000-000000000011','10200000-0000-4000-8000-000000000010','10200000-0000-4000-8000-000000000001','OWNER',now()),
 ('10200000-0000-4000-8000-000000000012','10200000-0000-4000-8000-000000000010','10200000-0000-4000-8000-000000000002','PROFESIONAL',now());
INSERT INTO paciente_cuenta(id,auth_user_id,email,email_verificado_en) VALUES
 ('10200000-0000-4000-8000-000000000020','10200000-0000-4000-8000-000000000003','m102-patient@spec.test',now());
INSERT INTO paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado,fecha_nacimiento,email_hash,dni_hash) VALUES
 ('10200000-0000-4000-8000-000000000030','10200000-0000-4000-8000-000000000010','\x01','\x02','\x03','1990-01-01',repeat('a',64),repeat('b',64));
INSERT INTO paciente(id,organization_id,identidad_id,profesional_principal_id) VALUES
 ('10200000-0000-4000-8000-000000000040','10200000-0000-4000-8000-000000000010','10200000-0000-4000-8000-000000000030','10200000-0000-4000-8000-000000000011');
INSERT INTO alergia(organization_id,paciente_id,sustancia_cifrado,severidad,activa) VALUES
 ('10200000-0000-4000-8000-000000000010','10200000-0000-4000-8000-000000000040','\x01','SEVERA',true);


CREATE OR REPLACE FUNCTION public.mfa_access_allowed() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT, INSERT, UPDATE ON documento_clinico TO authenticated, service_role;
INSERT INTO storage.objects(id,bucket_id,name) VALUES ('10200000-0000-4000-8000-000000000060','documentos-clinicos','10200000-0000-4000-8000-000000000010/10200000-0000-4000-8000-000000000040/scan.png');
SELECT set_config('test.m102_uid','10200000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM paciente WHERE id='10200000-0000-4000-8000-000000000040') <> 1 THEN RAISE EXCEPTION 'M102 SETUP: owner must see patient'; END IF;
 IF EXISTS(SELECT 1 FROM storage.objects WHERE id='10200000-0000-4000-8000-000000000060') THEN RAISE EXCEPTION 'M102 FAIL: direct object read/sign remains allowed'; END IF;
 BEGIN
  INSERT INTO storage.objects(bucket_id,name) VALUES('documentos-clinicos','10200000-0000-4000-8000-000000000010/10200000-0000-4000-8000-000000000040/forged.png');
  RAISE EXCEPTION 'M102 FAIL: direct unvalidated upload accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO documento_clinico(organization_id,paciente_id,tipo,storage_path,mime_type,tamanio_bytes,subido_por_id)
  VALUES('10200000-0000-4000-8000-000000000010','10200000-0000-4000-8000-000000000040','RADIOGRAFIA','documentos-clinicos/10200000-0000-4000-8000-000000000010/10200000-0000-4000-8000-000000000040/forged.png','image/png',1,'10200000-0000-4000-8000-000000000011');
  RAISE EXCEPTION 'M102 FAIL: unvalidated metadata insertion accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

DO $$ BEGIN
 BEGIN
  INSERT INTO documento_clinico(organization_id,paciente_id,tipo,storage_path,mime_type,tamanio_bytes,subido_por_id)
  VALUES('10200000-0000-4000-8000-000000000010','10200000-0000-4000-8000-000000000040','RADIOGRAFIA','documentos-clinicos/10200000-0000-4000-8000-000000000010/10200000-0000-4000-8000-000000000099/scan.png','image/png',1,'10200000-0000-4000-8000-000000000011');
  RAISE EXCEPTION 'M102 FAIL: path patient mismatch accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO documento_clinico(organization_id,paciente_id,tipo,storage_path,mime_type,tamanio_bytes,subido_por_id)
  VALUES('10200000-0000-4000-8000-000000000010','10200000-0000-4000-8000-000000000040','RADIOGRAFIA','documentos-clinicos/10200000-0000-4000-8000-000000000010/10200000-0000-4000-8000-000000000040/..png','image/png',1,'10200000-0000-4000-8000-000000000011');
  RAISE EXCEPTION 'M102 FAIL: traversal filename accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
-- Related ids must be coherently tied to the same patient and organization.
DO $$ BEGIN
 BEGIN
  INSERT INTO documento_clinico(organization_id,paciente_id,tipo,storage_path,mime_type,tamanio_bytes,subido_por_id,sesion_id)
  VALUES('10200000-0000-4000-8000-000000000010','10200000-0000-4000-8000-000000000040','RADIOGRAFIA','documentos-clinicos/10200000-0000-4000-8000-000000000010/10200000-0000-4000-8000-000000000040/session.png','image/png',1,'10200000-0000-4000-8000-000000000011','10200000-0000-4000-8000-000000000099');
  RAISE EXCEPTION 'M102 FAIL: unrelated session accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO documento_clinico(organization_id,paciente_id,tipo,storage_path,mime_type,tamanio_bytes,subido_por_id)
  VALUES('10200000-0000-4000-8000-000000000010','10200000-0000-4000-8000-000000000040','RADIOGRAFIA','documentos-clinicos/10200000-0000-4000-8000-000000000010/10200000-0000-4000-8000-000000000040/author.png','image/png',1,'10200000-0000-4000-8000-000000000099');
  RAISE EXCEPTION 'M102 FAIL: unrelated author accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO documento_clinico(organization_id,paciente_id,tipo,storage_path,mime_type,tamanio_bytes,subido_por_id,validated_at)
  VALUES('10200000-0000-4000-8000-000000000010','10200000-0000-4000-8000-000000000040','RADIOGRAFIA','documentos-clinicos/10200000-0000-4000-8000-000000000010/10200000-0000-4000-8000-000000000040/partial-validation.png','image/png',1,'10200000-0000-4000-8000-000000000011',now());
  RAISE EXCEPTION 'M102 FAIL: partial validation metadata accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
INSERT INTO documento_clinico(id,organization_id,paciente_id,tipo,storage_path,mime_type,tamanio_bytes,subido_por_id,content_sha256,validated_at)
VALUES('10200000-0000-4000-8000-000000000070','10200000-0000-4000-8000-000000000010','10200000-0000-4000-8000-000000000040','RADIOGRAFIA','documentos-clinicos/10200000-0000-4000-8000-000000000010/10200000-0000-4000-8000-000000000040/scan.png','image/png',1,'10200000-0000-4000-8000-000000000011',repeat('a',64),now());
SET LOCAL ROLE authenticated;
DO $$ DECLARE n int; BEGIN
 IF NOT EXISTS(SELECT 1 FROM documento_clinico WHERE id='10200000-0000-4000-8000-000000000070') THEN RAISE EXCEPTION 'M102 FAIL: authorized metadata lost'; END IF;
 UPDATE documento_clinico SET mime_type='text/html' WHERE id='10200000-0000-4000-8000-000000000070';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'M102 FAIL: metadata can be replaced directly'; END IF;
END $$;
RESET ROLE;
UPDATE paciente SET caja_fuerte_profesional='10200000-0000-4000-8000-000000000012' WHERE id='10200000-0000-4000-8000-000000000040';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM documento_clinico WHERE id='10200000-0000-4000-8000-000000000070') THEN RAISE EXCEPTION 'M102 FAIL: locked patient metadata exposed to owner'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
