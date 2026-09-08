-- Authorization and evidence tests with synthetic Auth/Storage rows only.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m103_uid',true),'')::uuid $$;
GRANT USAGE ON SCHEMA public,auth,storage TO authenticated;
GRANT SELECT ON member,organization,paciente,paciente_identidad,plantilla_consentimiento TO authenticated;
GRANT SELECT,INSERT,UPDATE ON tutor_legal,consentimiento TO authenticated;
GRANT SELECT,INSERT ON storage.objects TO authenticated;
SELECT public.consent_enable_reviewed_signatures('Synthetic deployed consent UI review and activation');
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
DO $$ DECLARE bad jsonb; ev uuid; ev_pending uuid; ev_assisted uuid; consent uuid; p text:='consentimientos-firmados/10300000-0000-4000-8000-000000000010/10300000-0000-4000-8000-000000000040/'; BEGIN
 BEGIN
  INSERT INTO consentimiento(organization_id,paciente_id,plantilla_id,tipo,firma_storage_path)
  VALUES('10300000-0000-4000-8000-000000000010','10300000-0000-4000-8000-000000000040','10300000-0000-4000-8000-000000000050','GENERAL',p||'patient.png');
  RAISE EXCEPTION 'M103: unexplained signature accepted without assessment';
 EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO tutor_legal(id,organization_id,paciente_id,nombre_cifrado,numero_doc_cifrado,telefono_cifrado,vinculo,es_principal,vigencia_desde,vigencia_hasta,alcances,evidencia_verificacion_cifrado)
 VALUES('10300000-0000-4000-8000-000000000060','10300000-0000-4000-8000-000000000010','10300000-0000-4000-8000-000000000040','\x01','\x02','\x03','MADRE',false,current_date-1,current_date+30,ARRAY['CONSENTIMIENTO'],'\x01');
 BEGIN
  UPDATE tutor_legal SET estado_verificacion='VERIFICADA' WHERE id='10300000-0000-4000-8000-000000000060';
  RAISE EXCEPTION 'M103: missing identity/relationship checks accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE tutor_legal SET estado_verificacion='VERIFICADA',identidad_verificada=true,vinculo_verificado=true,restricciones_cifrado='\x01' WHERE id='10300000-0000-4000-8000-000000000060';
 BEGIN
  UPDATE tutor_legal SET estado_verificacion='PENDIENTE' WHERE id='10300000-0000-4000-8000-000000000060';
  RAISE EXCEPTION 'M103: verified representation demoted to rewrite its identity';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE tutor_legal SET numero_doc_cifrado='\x99' WHERE id='10300000-0000-4000-8000-000000000060';
  RAISE EXCEPTION 'M103: verified representative identity rewritten';
 EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO consentimiento_evaluacion(organization_id,paciente_id,plantilla_id,modo,riesgo,fundamento_cifrado,participacion_cifrado,texto_snapshot,version_snapshot,tipo,evaluado_por,vigente_hasta)
 VALUES('10300000-0000-4000-8000-000000000010','10300000-0000-4000-8000-000000000040','10300000-0000-4000-8000-000000000050','AUTONOMO','EVALUADO','\x01','\x02',repeat('Synthetic consent text version one. ',20),1,'GENERAL','10300000-0000-4000-8000-000000000011',now()+interval '1 day') RETURNING id INTO ev;
 -- Missing hashes, wrong patient paths and absent objects never become evidence.
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
  jsonb_build_object('rol','PACIENTE','path',p||'patient.png'),
  jsonb_build_object('rol','PACIENTE','path',p||'patient.png','sha256',null),
  jsonb_build_object('rol','PACIENTE','path',p||'absent.png','sha256',repeat('a',64)),
  jsonb_build_object('rol','PACIENTE','path','consentimientos-firmados/other/patient.png','sha256',repeat('a',64))
 )) LOOP
  BEGIN
   INSERT INTO consentimiento(organization_id,paciente_id,plantilla_id,tipo,firma_storage_path,evaluacion_id,participantes)
   VALUES('10300000-0000-4000-8000-000000000010','10300000-0000-4000-8000-000000000040','10300000-0000-4000-8000-000000000050','GENERAL',bad->>'path',ev,jsonb_build_array(bad));
   RAISE EXCEPTION 'M103: missing or cross-scope evidence accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
 END LOOP;
 -- A reviewed autonomous adolescent is not forced to use a guardian by age/type.
 INSERT INTO consentimiento(organization_id,paciente_id,plantilla_id,tipo,firma_storage_path,evaluacion_id,participantes)
 VALUES('10300000-0000-4000-8000-000000000010','10300000-0000-4000-8000-000000000040','10300000-0000-4000-8000-000000000050','GENERAL',p||'patient.png',ev,jsonb_build_array(jsonb_build_object('rol','PACIENTE','path',p||'patient.png','sha256',repeat('a',64)))) RETURNING id INTO consent;
 IF NOT EXISTS(SELECT 1 FROM consentimiento WHERE id=consent AND evidencia_estado='REGISTRADA' AND tipo='TRATAMIENTO_MENOR' AND version_snapshot=1 AND firmado_por_tutor_id IS NULL AND registrado_por_auth_uid=auth.uid() AND participantes->0->>'persona_ref'='10300000-0000-4000-8000-000000000040' AND texto_snapshot=repeat('Synthetic consent text version one. ',20)) THEN RAISE EXCEPTION 'M103: text/version/actor snapshot missing'; END IF;
 BEGIN UPDATE consentimiento SET participantes='[]' WHERE id=consent; RAISE EXCEPTION 'M103: signed participants changed'; EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO consentimiento_evaluacion(organization_id,paciente_id,plantilla_id,modo,riesgo,fundamento_cifrado,participacion_cifrado,texto_snapshot,version_snapshot,tipo,evaluado_por,vigente_hasta)
 VALUES('10300000-0000-4000-8000-000000000010','10300000-0000-4000-8000-000000000040','10300000-0000-4000-8000-000000000050','PENDIENTE','REQUIERE_REVISION','\x01','\x02',repeat('Synthetic consent text version one. ',20),1,'GENERAL','10300000-0000-4000-8000-000000000011',now()+interval '1 day') RETURNING id INTO ev_pending;
 BEGIN
  INSERT INTO consentimiento(organization_id,paciente_id,plantilla_id,tipo,firma_storage_path,evaluacion_id,participantes)
  VALUES('10300000-0000-4000-8000-000000000010','10300000-0000-4000-8000-000000000040','10300000-0000-4000-8000-000000000050','GENERAL',p||'patient.png',ev_pending,jsonb_build_array(jsonb_build_object('rol','PACIENTE','path',p||'patient.png','sha256',repeat('a',64))));
  RAISE EXCEPTION 'M103: pending assessment became a signature';
 EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO consentimiento_evaluacion(organization_id,paciente_id,plantilla_id,modo,riesgo,fundamento_cifrado,participacion_cifrado,representante_id,texto_snapshot,version_snapshot,tipo,evaluado_por,vigente_hasta)
 VALUES('10300000-0000-4000-8000-000000000010','10300000-0000-4000-8000-000000000040','10300000-0000-4000-8000-000000000050','ASISTIDO','EVALUADO','\x01','\x02','10300000-0000-4000-8000-000000000060',repeat('Synthetic consent text version one. ',20),1,'GENERAL','10300000-0000-4000-8000-000000000011',now()+interval '1 day') RETURNING id INTO ev_assisted;
 BEGIN
  INSERT INTO consentimiento(organization_id,paciente_id,plantilla_id,tipo,firma_storage_path,evaluacion_id,participantes)
  VALUES('10300000-0000-4000-8000-000000000010','10300000-0000-4000-8000-000000000040','10300000-0000-4000-8000-000000000050','GENERAL',p||'patient.png',ev_assisted,jsonb_build_array(jsonb_build_object('rol','PACIENTE','path',p||'patient.png','sha256',repeat('a',64))));
  RAISE EXCEPTION 'M103: assisted consent lost representative participation';
 EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO consentimiento(organization_id,paciente_id,plantilla_id,tipo,firma_storage_path,evaluacion_id,participantes)
 VALUES('10300000-0000-4000-8000-000000000010','10300000-0000-4000-8000-000000000040','10300000-0000-4000-8000-000000000050','GENERAL',p||'patient.png',ev_assisted,jsonb_build_array(jsonb_build_object('rol','PACIENTE','path',p||'patient.png','sha256',repeat('a',64)),jsonb_build_object('rol','REPRESENTANTE','path',p||'representative.png','sha256',repeat('b',64))));
 -- Assessment text/version cannot be revised after a participant has read it.
 BEGIN UPDATE consentimiento_evaluacion SET texto_snapshot='substituted text' WHERE id=ev;
  RAISE EXCEPTION 'M103: assessment text overwritten'; EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE tutor_legal SET estado_verificacion='REVOCADA',revocacion_motivo_cifrado='\x03' WHERE id='10300000-0000-4000-8000-000000000060';
 BEGIN UPDATE tutor_legal SET estado_verificacion='VERIFICADA' WHERE id='10300000-0000-4000-8000-000000000060'; RAISE EXCEPTION 'M103: revoked representation reactivated'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO consentimiento(organization_id,paciente_id,plantilla_id,tipo,firma_storage_path,evaluacion_id,participantes)
  VALUES('10300000-0000-4000-8000-000000000010','10300000-0000-4000-8000-000000000040','10300000-0000-4000-8000-000000000050','GENERAL',p||'patient.png',ev_assisted,jsonb_build_array(jsonb_build_object('rol','PACIENTE','path',p||'patient.png','sha256',repeat('a',64)),jsonb_build_object('rol','REPRESENTANTE','path',p||'representative.png','sha256',repeat('b',64))));
  RAISE EXCEPTION 'M103: revoked representative can still sign';
 EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE consentimiento_evaluacion SET revocado_en=now(),revocacion_motivo_cifrado='\x03' WHERE id=ev;
 BEGIN
  INSERT INTO consentimiento(organization_id,paciente_id,plantilla_id,tipo,firma_storage_path,evaluacion_id,participantes)
  VALUES('10300000-0000-4000-8000-000000000010','10300000-0000-4000-8000-000000000040','10300000-0000-4000-8000-000000000050','GENERAL',p||'patient.png',ev,jsonb_build_array(jsonb_build_object('rol','PACIENTE','path',p||'patient.png','sha256',repeat('a',64))));
  RAISE EXCEPTION 'M103: revoked assessment can still sign';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN PERFORM public.consent_enable_reviewed_signatures('Authenticated user attempting activation');
  RAISE EXCEPTION 'M103: authenticated user can change rollout policy'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='consentimientos-firmados' AND name LIKE '10300000%') THEN RAISE EXCEPTION 'M103: user can mint bearer URLs bypassing revocation'; END IF;
END $$;
RESET ROLE;
SELECT set_config('test.m103_uid','10300000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  INSERT INTO consentimiento_evaluacion(organization_id,paciente_id,plantilla_id,modo,riesgo,fundamento_cifrado,participacion_cifrado,texto_snapshot,version_snapshot,tipo,evaluado_por,vigente_hasta)
  VALUES('10300000-0000-4000-8000-000000000010','10300000-0000-4000-8000-000000000040','10300000-0000-4000-8000-000000000050','AUTONOMO','EVALUADO','\x01','\x02',repeat('Synthetic consent text version one. ',20),1,'GENERAL','10300000-0000-4000-8000-000000000011',now()+interval '1 day');
  RAISE EXCEPTION 'M103: portal self-approves its own clinical assessment';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF EXISTS(SELECT 1 FROM consentimiento_evaluacion WHERE modo<>'AUTONOMO') THEN RAISE EXCEPTION 'M103: portal sees representation assessment details'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
