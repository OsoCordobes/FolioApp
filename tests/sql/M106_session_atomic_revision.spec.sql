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
CREATE FUNCTION pg_temp.c2_context(p_turn uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('profesional_id',t.profesional_id,'inicio',t.inicio,'member_especialidad',m.especialidad,'organization_especialidad',o.especialidad,
 'identity_id',p.identidad_id,'fecha_nacimiento',pi.fecha_nacimiento,'identity_deleted_at',pi.deleted_at)
 FROM public.turno t JOIN public.organization o ON o.id=t.organization_id LEFT JOIN public.member m ON m.id=t.profesional_id
 JOIN public.paciente p ON p.id=t.paciente_id LEFT JOIN public.paciente_identidad pi ON pi.id=p.identidad_id WHERE t.id=p_turn;
$$;
-- FIXTURES END (the separate two-client test commits only this synthetic setup).
SELECT public.enable_session_atomic_writes('Synthetic editor rollout verified before enforcement');
SELECT set_config('test.c2_uid','10600000-0000-4000-8000-000000000010',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb;again jsonb;op uuid:=gen_random_uuid();BEGIN
 BEGIN
  PERFORM public.save_clinical_session('10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000013','10600000-0000-4000-8000-000000000003',gen_random_uuid(),0,'SAVE',repeat('0',64),'{}');
  RAISE EXCEPTION 'M106: missing validated context was accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 result:=public.save_clinical_session('10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000013','10600000-0000-4000-8000-000000000003',op,0,'SAVE',repeat('a',64),'{"soap_s_cifrado":"\\x01"}',pg_temp.c2_context('10600000-0000-4000-8000-000000000013'));
 IF (result->>'revision')::int<>1 OR (SELECT estado FROM turno WHERE id='10600000-0000-4000-8000-000000000013')<>'ATENDIENDO' THEN RAISE EXCEPTION 'M106: creation and start were not atomic'; END IF;
 again:=public.save_clinical_session('10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000013','10600000-0000-4000-8000-000000000003',op,0,'SAVE',repeat('a',64),null,pg_temp.c2_context('10600000-0000-4000-8000-000000000013'));
 IF again IS DISTINCT FROM result THEN RAISE EXCEPTION 'M106: lost-response receipt mismatch'; END IF;
 BEGIN
  PERFORM public.save_clinical_session('10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000013','10600000-0000-4000-8000-000000000003',op,0,'SAVE',repeat('b',64),'{"soap_s_cifrado":"\\x02"}',pg_temp.c2_context('10600000-0000-4000-8000-000000000013'));
  RAISE EXCEPTION 'M106: reused operation accepted changed draft'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
  PERFORM public.save_clinical_session('10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000013','10600000-0000-4000-8000-000000000003',gen_random_uuid(),0,'SAVE',repeat('b',64),'{"soap_s_cifrado":"\\x02"}',pg_temp.c2_context('10600000-0000-4000-8000-000000000013'));
  RAISE EXCEPTION 'M106: stale creation overwrote existing session'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
  PERFORM set_config('folio.session_write','true',true);
  UPDATE sesion SET soap_s_cifrado='\x99' WHERE turno_id='10600000-0000-4000-8000-000000000013';
  RAISE EXCEPTION 'M106: direct/GUC clinical update bypasses revision'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM sesion WHERE turno_id='10600000-0000-4000-8000-000000000013';RAISE EXCEPTION 'M106: direct deletion bypasses durable revisions';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.enable_session_atomic_writes('Unauthorized activation from authenticated');RAISE EXCEPTION 'M106: actor activated policy';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM 1 FROM folio_session_private.receipt;RAISE EXCEPTION 'M106: private receipts exposed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
-- A clinical director may read other professionals' originals, but M39 only
-- authorizes the owner or assigned professional to update an existing original.
UPDATE member SET role='DIRECTOR',es_colegiado=true WHERE id='10600000-0000-4000-8000-000000000021';
SELECT set_config('test.c2_uid','10600000-0000-4000-8000-000000000020',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE changed integer;BEGIN
 UPDATE sesion SET soap_s_cifrado='\x77' WHERE turno_id='10600000-0000-4000-8000-000000000013';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>0 THEN RAISE EXCEPTION 'M106: baseline director update scope unexpectedly broadened'; END IF;
 BEGIN
  PERFORM public.save_clinical_session('10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000013','10600000-0000-4000-8000-000000000003',gen_random_uuid(),1,'SAVE',repeat('f',64),'{}',pg_temp.c2_context('10600000-0000-4000-8000-000000000013'));
  RAISE EXCEPTION 'M106: director RPC bypasses existing-original assignment';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
UPDATE member SET role='PROFESIONAL' WHERE id='10600000-0000-4000-8000-000000000021';
SELECT set_config('test.c2_uid','10600000-0000-4000-8000-000000000010',true);
-- Context captured by validation cannot be used after reassignment, rescheduling,
-- specialty change, or corrected birth date, even by the organization owner.
DO $$ DECLARE captured jsonb;kind text;BEGIN
 FOREACH kind IN ARRAY ARRAY['assignment','date','specialty','birth'] LOOP
  captured:=pg_temp.c2_context('10600000-0000-4000-8000-000000000013');
  BEGIN
   IF kind='assignment' THEN UPDATE turno SET profesional_id='10600000-0000-4000-8000-000000000021' WHERE id='10600000-0000-4000-8000-000000000013';
   ELSIF kind='date' THEN UPDATE turno SET inicio=inicio+interval '1 day' WHERE id='10600000-0000-4000-8000-000000000013';
   ELSIF kind='specialty' THEN UPDATE member SET especialidad='cardiologia' WHERE id='10600000-0000-4000-8000-000000000011';
   ELSE UPDATE paciente_identidad SET fecha_nacimiento='2015-01-01' WHERE id='10600000-0000-4000-8000-000000000002';END IF;
   BEGIN
    PERFORM public.save_clinical_session('10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000013','10600000-0000-4000-8000-000000000003',gen_random_uuid(),1,'SAVE',repeat('9',64),'{}',captured);
    RAISE EXCEPTION 'M106: stale % context was accepted',kind;
   EXCEPTION WHEN serialization_failure THEN NULL;END;
   RAISE EXCEPTION 'rollback synthetic context change' USING ERRCODE='22000';
  EXCEPTION WHEN data_exception THEN NULL;END;
 END LOOP;
END $$;
-- Simulate failure after the session UPDATE but before the close can commit.
CREATE FUNCTION public.m106_fixture_fail_close() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.estado='CERRADO' THEN RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Synthetic close failure';END IF;RETURN NEW;END$$;
CREATE TRIGGER m106_fixture_fail_close BEFORE UPDATE ON turno FOR EACH ROW EXECUTE FUNCTION public.m106_fixture_fail_close();
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.save_clinical_session('10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000013','10600000-0000-4000-8000-000000000003',gen_random_uuid(),1,'CLOSE',repeat('c',64),'{"soap_s_cifrado":"\\x03"}',pg_temp.c2_context('10600000-0000-4000-8000-000000000013'));
  RAISE EXCEPTION 'M106: failing close unexpectedly committed'; EXCEPTION WHEN data_exception THEN NULL; END;
 IF NOT EXISTS(SELECT 1 FROM sesion WHERE turno_id='10600000-0000-4000-8000-000000000013' AND revision=1 AND soap_s_cifrado='\x01' AND locked_at IS NULL)
  OR (SELECT estado FROM turno WHERE id='10600000-0000-4000-8000-000000000013')<>'ATENDIENDO' THEN RAISE EXCEPTION 'M106: close failure left partial clinical data'; END IF;
END $$;
RESET ROLE;
DROP TRIGGER m106_fixture_fail_close ON turno;
DROP FUNCTION public.m106_fixture_fail_close();
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb;op uuid:='10600000-0000-4000-8000-000000000099';BEGIN
 result:=public.save_clinical_session('10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000013','10600000-0000-4000-8000-000000000003',op,1,'CLOSE',repeat('d',64),'{"soap_s_cifrado":"\\x04"}',pg_temp.c2_context('10600000-0000-4000-8000-000000000013'));
 IF (result->>'revision')::int<>2 OR NOT(result->>'closed')::boolean OR NOT EXISTS(SELECT 1 FROM sesion WHERE turno_id='10600000-0000-4000-8000-000000000013' AND locked_at IS NOT NULL AND soap_s_cifrado='\x04') THEN RAISE EXCEPTION 'M106: close did not atomically lock submitted original';END IF;
 IF public.save_clinical_session('10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000013','10600000-0000-4000-8000-000000000003',op,1,'CLOSE',repeat('d',64),null,pg_temp.c2_context('10600000-0000-4000-8000-000000000013')) IS DISTINCT FROM result THEN RAISE EXCEPTION 'M106: closed receipt cannot be recovered';END IF;
 BEGIN PERFORM public.save_clinical_session('10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000013','10600000-0000-4000-8000-000000000003',gen_random_uuid(),2,'SAVE',repeat('e',64),'{}',pg_temp.c2_context('10600000-0000-4000-8000-000000000013'));
  RAISE EXCEPTION 'M106: locked original overwritten';EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;END;
END $$;
RESET ROLE;
SELECT set_config('test.c2_uid','10600000-0000-4000-8000-000000000020',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.save_clinical_session('10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000013','10600000-0000-4000-8000-000000000003','10600000-0000-4000-8000-000000000099',1,'CLOSE',repeat('d',64),null,pg_temp.c2_context('10600000-0000-4000-8000-000000000013'));
  RAISE EXCEPTION 'M106: unrelated professional retrieved foreign operation';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM folio_session_private.authority) THEN RAISE EXCEPTION 'M106: transaction authority leaked';END IF;END$$;
-- The new writer must enforce MFA itself, including read-only receipt probes.
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"aal":"aal1"}'::jsonb $$;
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
SELECT set_config('test.c2_uid','10600000-0000-4000-8000-000000000010',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.save_clinical_session('10600000-0000-4000-8000-000000000001','10600000-0000-4000-8000-000000000013','10600000-0000-4000-8000-000000000003','10600000-0000-4000-8000-000000000099',1,'CLOSE',repeat('d',64),null);
  RAISE EXCEPTION 'M106: receipt probe bypassed MFA';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
ROLLBACK;
