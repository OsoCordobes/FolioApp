BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.c2_uid',true),'')::uuid$$;
INSERT INTO auth.users(id,email) VALUES('10600000-0000-4000-8000-000000000010','m106-owner@spec.invalid'),('10600000-0000-4000-8000-000000000020','m106-other@spec.invalid');
INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES
 ('10600000-0000-4000-8000-000000000010','m106-owner@spec.invalid',now(),'v1'),('10600000-0000-4000-8000-000000000020','m106-other@spec.invalid',now(),'v1');
INSERT INTO organization(id,slug,nombre) VALUES('10600000-0000-4000-8000-000000000001','m106-synthetic','M106 synthetic');
INSERT INTO member(id,organization_id,profile_id,role,accepted_at) VALUES
 ('10600000-0000-4000-8000-000000000011','10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000010','OWNER',now()),
 ('10600000-0000-4000-8000-000000000021','10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000020','PROFESIONAL',now());
INSERT INTO paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado,fecha_nacimiento)
 VALUES('10600000-0000-4000-8000-000000000002','10600000-0000-4000-8000-000000000001','\x01','\x02','\x03','1990-01-01');
INSERT INTO paciente(id,organization_id,identidad_id,profesional_principal_id)
 VALUES('10600000-0000-4000-8000-000000000003','10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000002','10600000-0000-4000-8000-000000000011');
INSERT INTO servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents)
 VALUES('10600000-0000-4000-8000-000000000012','10600000-0000-4000-8000-000000000001','Synthetic',enum_first(null::tipo_servicio_canonico),30,100);
INSERT INTO turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents) VALUES
 ('10600000-0000-4000-8000-000000000013','10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000003','10600000-0000-4000-8000-000000000012','10600000-0000-4000-8000-000000000011',now()+interval '1 day',30,100);
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON sesion,turno TO authenticated;
GRANT SELECT ON organization,member,paciente,paciente_identidad TO authenticated;
SELECT set_config('test.c2_uid','10600000-0000-4000-8000-000000000010',true);
SET LOCAL ROLE authenticated;
INSERT INTO sesion(organization_id,turno_id,paciente_id,soap_s_cifrado)
VALUES('10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000013','10600000-0000-4000-8000-000000000003','\x01');
UPDATE sesion SET soap_s_cifrado='\x02',revision=999 WHERE turno_id='10600000-0000-4000-8000-000000000013';
DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM sesion WHERE turno_id='10600000-0000-4000-8000-000000000013' AND revision=2 AND soap_s_cifrado='\x02') THEN RAISE EXCEPTION 'M106 expansion: old writer broken or controls revision';END IF;END$$;
RESET ROLE;
SELECT public.enable_session_atomic_writes('Synthetic staged rollout editor confirmed compatible');
SET LOCAL ROLE authenticated;
-- The scheduling path locks only already persisted content.
UPDATE turno SET estado='EN_SALA' WHERE id='10600000-0000-4000-8000-000000000013';
UPDATE turno SET estado='ATENDIENDO',atendiendo_desde=clock_timestamp() WHERE id='10600000-0000-4000-8000-000000000013';
RESET ROLE;
INSERT INTO auth.users(id,email) VALUES('10600000-0000-4000-8000-000000000030','m106-agenda@spec.invalid');
INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES('10600000-0000-4000-8000-000000000030','m106-agenda@spec.invalid',now(),'v1');
INSERT INTO member(id,organization_id,profile_id,role,accepted_at) VALUES('10600000-0000-4000-8000-000000000031','10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000030','ASISTENTE',now());
SELECT set_config('test.c2_uid','10600000-0000-4000-8000-000000000030',true);
SET LOCAL ROLE authenticated;
DO $$BEGIN IF EXISTS(SELECT 1 FROM sesion WHERE turno_id='10600000-0000-4000-8000-000000000013') THEN RAISE EXCEPTION 'M106: scheduling actor gained clinical read';END IF;END$$;
UPDATE turno SET estado='CERRADO',atendiendo_desde=NULL WHERE id='10600000-0000-4000-8000-000000000013';
RESET ROLE;
DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM sesion WHERE turno_id='10600000-0000-4000-8000-000000000013' AND revision=3 AND locked_at IS NOT NULL AND soap_s_cifrado='\x02') THEN RAISE EXCEPTION 'M106: scheduling close changed content or failed to lock saved revision';END IF;END$$;
ROLLBACK;
