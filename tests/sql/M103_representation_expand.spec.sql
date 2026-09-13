-- Authorization and evidence tests with synthetic Auth/Storage rows only.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m103_uid',true),'')::uuid $$;
GRANT USAGE ON SCHEMA public,auth,storage TO authenticated;
GRANT SELECT ON member,organization,paciente,paciente_identidad,plantilla_consentimiento TO authenticated;
GRANT SELECT,INSERT,UPDATE ON tutor_legal,consentimiento TO authenticated;
GRANT SELECT,INSERT ON storage.objects TO authenticated;
UPDATE folio_consent_private.policy SET enforced=false; -- Simulate the documented expansion phase inside rollback only.
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('10300000-0000-4000-8000-000000000001','m103-clinical@spec.invalid',now()),
 ('10300000-0000-4000-8000-000000000002','m103-patient@spec.invalid',now());
INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version)
 VALUES('10300000-0000-4000-8000-000000000001','m103-clinical@spec.invalid',now(),'v1');
INSERT INTO organization(id,slug,nombre) VALUES('10300000-0000-4000-8000-000000000010','m103-representation','M103 synthetic');
INSERT INTO member(id,organization_id,profile_id,role,accepted_at) VALUES
 ('10300000-0000-4000-8000-000000000011','10300000-0000-4000-8000-000000000010','10300000-0000-4000-8000-000000000001','OWNER',now());
INSERT INTO paciente_cuenta(id,auth_user_id,email,email_verificado_en) VALUES
 ('10300000-0000-4000-8000-000000000020','10300000-0000-4000-8000-000000000002','m103-patient@spec.invalid',now());
INSERT INTO paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado,fecha_nacimiento) VALUES
 ('10300000-0000-4000-8000-000000000030','10300000-0000-4000-8000-000000000010','\x01','\x02','\x03','2010-01-01');
INSERT INTO paciente(id,organization_id,identidad_id,profesional_principal_id,cuenta_id) VALUES
 ('10300000-0000-4000-8000-000000000040','10300000-0000-4000-8000-000000000010','10300000-0000-4000-8000-000000000030','10300000-0000-4000-8000-000000000011','10300000-0000-4000-8000-000000000020');
INSERT INTO plantilla_consentimiento(id,organization_id,tipo,titulo,version,texto_markdown) VALUES
 ('10300000-0000-4000-8000-000000000050',null,'TRATAMIENTO_MENOR','Synthetic reviewed act',1,repeat('Synthetic consent text version one. ',20));
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('consentimientos-firmados','10300000-0000-4000-8000-000000000010/10300000-0000-4000-8000-000000000040/patient.png'),
 ('consentimientos-firmados','10300000-0000-4000-8000-000000000010/10300000-0000-4000-8000-000000000040/representative.png');
SELECT set_config('test.m103_uid','10300000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE v uuid; BEGIN
 INSERT INTO consentimiento(organization_id,paciente_id,plantilla_id,tipo,firma_storage_path,participantes,evidencia_estado)
 VALUES('10300000-0000-4000-8000-000000000010','10300000-0000-4000-8000-000000000040','10300000-0000-4000-8000-000000000050','TRATAMIENTO_MENOR',
 'consentimientos-firmados/10300000-0000-4000-8000-000000000010/10300000-0000-4000-8000-000000000040/patient.png','[]','REGISTRADA') RETURNING id INTO v;
 IF NOT EXISTS(SELECT 1 FROM consentimiento WHERE id=v AND evidencia_estado='LEGADO_PENDIENTE' AND participantes IS NULL AND evaluacion_id IS NULL AND texto_snapshot IS NULL) THEN
  RAISE EXCEPTION 'M103 expand: old application cannot preserve an honest legacy record'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='consentimientos-firmados' AND name='10300000-0000-4000-8000-000000000010/10300000-0000-4000-8000-000000000040/patient.png') THEN
  RAISE EXCEPTION 'M103 expand: previous signature reader blocked before application deployment'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
