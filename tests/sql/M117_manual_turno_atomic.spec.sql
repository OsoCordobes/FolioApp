BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.manual_uid',true),'')::uuid $$;
INSERT INTO auth.users(id,email) VALUES
 ('11700000-0000-4000-8000-000000000001','manual@synthetic.invalid'),
 ('11700000-0000-4000-8000-000000000002','other-manual@synthetic.invalid');
INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version) SELECT id,email,now(),'v1' FROM auth.users WHERE id IN ('11700000-0000-4000-8000-000000000001','11700000-0000-4000-8000-000000000002');
INSERT INTO organization(id,slug,nombre) VALUES
 ('11700000-0000-4000-8000-000000000010','m117-synthetic','Synthetic'),
 ('11700000-0000-4000-8000-000000000020','m117-other','Other synthetic');
INSERT INTO member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES
 ('11700000-0000-4000-8000-000000000011','11700000-0000-4000-8000-000000000010','11700000-0000-4000-8000-000000000001','OWNER',true,now()),
 ('11700000-0000-4000-8000-000000000021','11700000-0000-4000-8000-000000000020','11700000-0000-4000-8000-000000000002','OWNER',true,now());
INSERT INTO servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents) VALUES
 ('11700000-0000-4000-8000-000000000012','11700000-0000-4000-8000-000000000010','Synthetic',enum_first(null::tipo_servicio_canonico),30,12345),
 ('11700000-0000-4000-8000-000000000022','11700000-0000-4000-8000-000000000020','Other',enum_first(null::tipo_servicio_canonico),30,12345);
CREATE FUNCTION pg_temp.identity() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('nombre_cifrado','\x01','apellido_cifrado','\x02','telefono_cifrado','\x03','nombre_hash',repeat('a',64),'telefono_hash',repeat('b',64));
$$;
CREATE FUNCTION pg_temp.create_manual(p_op integer,p_time timestamptz DEFAULT '2026-10-11T12:00:00Z',p_patient uuid DEFAULT NULL,p_identity jsonb DEFAULT pg_temp.identity(),p_prof uuid DEFAULT '11700000-0000-4000-8000-000000000011',p_service uuid DEFAULT '11700000-0000-4000-8000-000000000012',p_hash text DEFAULT repeat('c',64)) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.create_manual_turno_atomic('11700000-0000-4000-8000-000000000010',('11700000-0000-4000-8000-'||lpad(p_op::text,12,'0'))::uuid,p_hash,p_patient,p_identity,p_prof,p_service,p_time,30,'WALK_IN');
$$;
SELECT set_config('test.manual_uid','11700000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;r2 jsonb;BEGIN
 r:=pg_temp.create_manual(100);r2:=pg_temp.create_manual(100);
 IF r->>'turnoId' IS DISTINCT FROM r2->>'turnoId' OR r->>'pacienteId' IS DISTINCT FROM r2->>'pacienteId' OR NOT (r2->>'reused')::boolean THEN RAISE EXCEPTION 'M117 replay duplicated visit';END IF;
 -- Re-encryption differs on a retry; stable intent still finds the same receipt.
 r2:=pg_temp.create_manual(100,p_identity=>pg_temp.identity()||'{"nombre_cifrado":"\\x04"}'::jsonb);
 IF r->>'pacienteId' IS DISTINCT FROM r2->>'pacienteId' THEN RAISE EXCEPTION 'M117 random ciphertext changed retry';END IF;
 BEGIN PERFORM pg_temp.create_manual(100,p_time=>'2026-10-11T13:00:00Z');RAISE EXCEPTION 'M117 changed time reused operation';EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN PERFORM pg_temp.create_manual(100,p_hash=>repeat('d',64));RAISE EXCEPTION 'M117 changed fingerprint accepted';EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN PERFORM pg_temp.create_manual(101);RAISE EXCEPTION 'M117 overlap accepted';EXCEPTION WHEN exclusion_violation THEN NULL;END;
 BEGIN PERFORM pg_temp.create_manual(102,p_time=>'2026-10-11T13:00:00Z',p_prof=>'11700000-0000-4000-8000-000000000021');RAISE EXCEPTION 'M117 foreign professional accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN PERFORM pg_temp.create_manual(103,p_time=>'2026-10-11T13:00:00Z',p_service=>'11700000-0000-4000-8000-000000000022');RAISE EXCEPTION 'M117 foreign service accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN PERFORM pg_temp.create_manual(104,p_time=>'2026-10-11T13:00:00Z',p_identity=>NULL);RAISE EXCEPTION 'M117 absent patient source accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM pg_temp.create_manual(105,p_time=>'2026-10-11T13:00:00Z',p_patient=>(r->>'pacienteId')::uuid);RAISE EXCEPTION 'M117 ambiguous patient source accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM pg_temp.create_manual(106,p_time=>'2026-10-11T13:00:00Z',p_identity=>pg_temp.identity()||'{"profile_id":"11700000-0000-4000-8000-000000000001"}'::jsonb);RAISE EXCEPTION 'M117 caller-linked identity accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 r2:=pg_temp.create_manual(107,p_time=>'2026-10-11T13:00:00Z');
 IF r->>'pacienteId'=r2->>'pacienteId' THEN RAISE EXCEPTION 'M117 family contact merged patients';END IF;
 r2:=pg_temp.create_manual(108,p_time=>'2026-10-11T14:00:00Z',p_patient=>(r->>'pacienteId')::uuid,p_identity=>NULL);
 IF r->>'pacienteId' IS DISTINCT FROM r2->>'pacienteId' THEN RAISE EXCEPTION 'M117 existing patient duplicated';END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM paciente WHERE organization_id='11700000-0000-4000-8000-000000000010')<>2
 OR (SELECT count(*) FROM paciente_identidad WHERE organization_id='11700000-0000-4000-8000-000000000010')<>2
 OR (SELECT count(*) FROM turno WHERE organization_id='11700000-0000-4000-8000-000000000010')<>3
 OR (SELECT count(*) FROM recordatorio_job WHERE organization_id='11700000-0000-4000-8000-000000000010')<>6
 OR (SELECT count(*) FROM folio_manual_visit_private.receipt WHERE organization_id='11700000-0000-4000-8000-000000000010')<>3
 OR EXISTS(SELECT 1 FROM turno WHERE organization_id='11700000-0000-4000-8000-000000000010' AND (precio_cents<>12345 OR origen<>'WALK_IN')) THEN RAISE EXCEPTION 'M117 wrong counts, orphan, duplicate effect or price';END IF;
END $$;
-- A failure after creating identity and patient must undo both and its receipt.
CREATE FUNCTION pg_temp.fail_manual() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.organization_id='11700000-0000-4000-8000-000000000010' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Synthetic failure after new patient';END IF;RETURN NEW;END $$;
CREATE TRIGGER m117_injected_failure BEFORE INSERT ON public.recordatorio_job FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_manual();
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM pg_temp.create_manual(109,p_time=>'2026-10-11T15:00:00Z');RAISE EXCEPTION 'M117 partial write survived failure';EXCEPTION WHEN check_violation THEN NULL;END;
END $$;
RESET ROLE;
DROP TRIGGER m117_injected_failure ON public.recordatorio_job;
DO $$ BEGIN
 IF (SELECT count(*) FROM paciente WHERE organization_id='11700000-0000-4000-8000-000000000010')<>2
 OR (SELECT count(*) FROM paciente_identidad WHERE organization_id='11700000-0000-4000-8000-000000000010')<>2
 OR (SELECT count(*) FROM turno WHERE organization_id='11700000-0000-4000-8000-000000000010')<>3
 OR (SELECT count(*) FROM folio_manual_visit_private.receipt WHERE organization_id='11700000-0000-4000-8000-000000000010')<>3 THEN RAISE EXCEPTION 'M117 late failure did not roll back';END IF;
 IF has_function_privilege('anon','public.create_manual_turno_atomic(uuid,uuid,text,uuid,jsonb,uuid,uuid,timestamptz,integer,text)','EXECUTE')
 OR has_function_privilege('service_role','public.create_manual_turno_atomic(uuid,uuid,text,uuid,jsonb,uuid,uuid,timestamptz,integer,text)','EXECUTE')
 OR has_table_privilege('authenticated','folio_manual_visit_private.receipt','SELECT')
 OR (SELECT prosecdef FROM pg_proc WHERE oid='public.create_manual_turno_atomic(uuid,uuid,text,uuid,jsonb,uuid,uuid,timestamptz,integer,text)'::regprocedure) THEN RAISE EXCEPTION 'M117 privilege boundary broken';END IF;
END $$;
-- Current actor, organization and MFA checks also run BEFORE receipt recovery.
UPDATE public.member SET deleted_at=now() WHERE id='11700000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM pg_temp.create_manual(100);RAISE EXCEPTION 'M117 revoked member replayed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
UPDATE public.member SET deleted_at=NULL WHERE id='11700000-0000-4000-8000-000000000011';
SELECT set_config('test.manual_uid','11700000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM pg_temp.create_manual(100);RAISE EXCEPTION 'M117 foreign actor replayed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
SELECT set_config('test.manual_uid','11700000-0000-4000-8000-000000000001',true);
SAVEPOINT organization_revocation;
UPDATE public.organization SET deleted_at=now() WHERE id='11700000-0000-4000-8000-000000000010';
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM pg_temp.create_manual(100);RAISE EXCEPTION 'M117 deleted organization replayed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
-- Organization revocation cascades to its members. Roll the fixture back too,
-- otherwise every later negative test would pass merely because staff stayed revoked.
ROLLBACK TO SAVEPOINT organization_revocation;
UPDATE public.paciente SET deleted_at=now() WHERE id=(SELECT paciente_id FROM folio_manual_visit_private.receipt WHERE operation_id='11700000-0000-4000-8000-000000000100');
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM pg_temp.create_manual(100);RAISE EXCEPTION 'M117 deleted patient replayed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
UPDATE public.paciente SET deleted_at=NULL WHERE organization_id='11700000-0000-4000-8000-000000000010';
UPDATE public.member SET invited_by_id=profile_id,accepted_at=NULL WHERE id='11700000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM pg_temp.create_manual(100);RAISE EXCEPTION 'M117 unaccepted staff replayed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
UPDATE public.member SET invited_by_id=NULL,accepted_at=now() WHERE id='11700000-0000-4000-8000-000000000011';
-- Broad member.alcance is not permission for a clinician to book a colleague.
-- Exercise the exposed RPC as authenticated, including receipts created before
-- a role change. Keep the receipt patient assigned to the actor so that the
-- destination check, rather than the separate patient guard, rejects replay.
INSERT INTO auth.users(id,email) VALUES ('11700000-0000-4000-8000-000000000003','third-manual@synthetic.invalid');
INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version)
 SELECT id,email,now(),'v1' FROM auth.users WHERE id='11700000-0000-4000-8000-000000000003';
INSERT INTO member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES
 ('11700000-0000-4000-8000-000000000031','11700000-0000-4000-8000-000000000010','11700000-0000-4000-8000-000000000002','PROFESIONAL',true,now()),
 ('11700000-0000-4000-8000-000000000032','11700000-0000-4000-8000-000000000010','11700000-0000-4000-8000-000000000003','PROFESIONAL',true,now());
SET LOCAL ROLE authenticated;
SELECT pg_temp.create_manual(300,p_time=>'2026-10-15T12:00:00Z',p_prof=>'11700000-0000-4000-8000-000000000031');
SELECT pg_temp.create_manual(306,p_time=>'2026-10-15T12:00:00Z',p_prof=>'11700000-0000-4000-8000-000000000032');
RESET ROLE;
UPDATE public.paciente SET profesional_principal_id='11700000-0000-4000-8000-000000000011'
 WHERE id IN (SELECT paciente_id FROM folio_manual_visit_private.receipt WHERE operation_id IN
 ('11700000-0000-4000-8000-000000000300','11700000-0000-4000-8000-000000000306'));
UPDATE public.member SET role='PROFESIONAL',alcance='TODOS' WHERE id='11700000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;BEGIN
 BEGIN PERFORM pg_temp.create_manual(301,p_time=>'2026-10-15T13:00:00Z',p_prof=>'11700000-0000-4000-8000-000000000031');RAISE EXCEPTION 'M117 PROFESIONAL/TODOS booked a colleague';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM pg_temp.create_manual(300,p_time=>'2026-10-15T12:00:00Z',p_prof=>'11700000-0000-4000-8000-000000000031');RAISE EXCEPTION 'M117 PROFESIONAL/TODOS recovered a colleague receipt';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 r:=pg_temp.create_manual(302,p_time=>'2026-10-15T13:00:00Z');
 IF (r->>'reused')::boolean OR NOT (pg_temp.create_manual(302,p_time=>'2026-10-15T13:00:00Z')->>'reused')::boolean THEN RAISE EXCEPTION 'M117 own clinician create/replay denied';END IF;
END $$;
RESET ROLE;
UPDATE public.member SET role='ASISTENTE',es_colegiado=false,alcance='LISTA_PROFESIONALES',profesionales_gestionados=ARRAY['11700000-0000-4000-8000-000000000031']
 WHERE id='11700000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM pg_temp.create_manual(303,p_time=>'2026-10-15T14:00:00Z',p_prof=>'11700000-0000-4000-8000-000000000031');
 IF NOT (pg_temp.create_manual(300,p_time=>'2026-10-15T12:00:00Z',p_prof=>'11700000-0000-4000-8000-000000000031')->>'reused')::boolean THEN RAISE EXCEPTION 'M117 scoped assistant receipt denied';END IF;
 BEGIN PERFORM pg_temp.create_manual(304,p_time=>'2026-10-15T15:00:00Z',p_prof=>'11700000-0000-4000-8000-000000000032');RAISE EXCEPTION 'M117 assistant booked outside list';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM pg_temp.create_manual(306,p_time=>'2026-10-15T12:00:00Z',p_prof=>'11700000-0000-4000-8000-000000000032');RAISE EXCEPTION 'M117 assistant recovered outside-list receipt';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
UPDATE public.member SET role='COORDINADOR' WHERE id='11700000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM pg_temp.create_manual(305,p_time=>'2026-10-15T16:00:00Z',p_prof=>'11700000-0000-4000-8000-000000000031');
 IF NOT (pg_temp.create_manual(303,p_time=>'2026-10-15T14:00:00Z',p_prof=>'11700000-0000-4000-8000-000000000031')->>'reused')::boolean THEN RAISE EXCEPTION 'M117 coordinator receipt denied';END IF;
 BEGIN PERFORM pg_temp.create_manual(307,p_time=>'2026-10-15T17:00:00Z',p_prof=>'11700000-0000-4000-8000-000000000032');RAISE EXCEPTION 'M117 coordinator booked outside list';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM folio_manual_visit_private.receipt WHERE operation_id IN
 ('11700000-0000-4000-8000-000000000301','11700000-0000-4000-8000-000000000304','11700000-0000-4000-8000-000000000307'))
 OR (SELECT count(*) FROM public.paciente WHERE organization_id='11700000-0000-4000-8000-000000000010')<>7
 OR (SELECT count(*) FROM public.paciente_identidad WHERE organization_id='11700000-0000-4000-8000-000000000010')<>7
 OR (SELECT count(*) FROM public.turno WHERE organization_id='11700000-0000-4000-8000-000000000010')<>8
 OR (SELECT count(*) FROM public.recordatorio_job WHERE organization_id='11700000-0000-4000-8000-000000000010')<>16
 THEN RAISE EXCEPTION 'M117 denied role left side effects';END IF;
END $$;
UPDATE public.member SET role='OWNER',es_colegiado=true,alcance='TODOS',profesionales_gestionados='{}' WHERE id='11700000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF NOT (pg_temp.create_manual(100)->>'reused')::boolean THEN RAISE EXCEPTION 'M117 restored fixture cannot recover receipt before MFA test';END IF;END $$;
RESET ROLE;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"aal":"aal1"}'::jsonb $$;
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM pg_temp.create_manual(100);RAISE EXCEPTION 'M117 receipt bypassed MFA';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
ROLLBACK;
