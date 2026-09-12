-- Real PostgreSQL transactions with CI Auth stubs; not hosted Auth/Storage E2E.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('test.reschedule_uid',true),'')::uuid
$$;
CREATE FUNCTION pg_temp.m119_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('11900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO auth.users(id,email) SELECT pg_temp.m119_id(n),'m119-'||n||'@synthetic.invalid' FROM generate_series(1,4) n;
INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version)
 SELECT id,email,now(),'v1' FROM auth.users WHERE id IN(SELECT pg_temp.m119_id(n) FROM generate_series(1,4) n);
INSERT INTO organization(id,slug,nombre) VALUES
 (pg_temp.m119_id(10),'m119-synthetic','Synthetic rescheduling'),
 (pg_temp.m119_id(20),'m119-foreign','Synthetic other tenant');
INSERT INTO member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES
 (pg_temp.m119_id(11),pg_temp.m119_id(10),pg_temp.m119_id(1),'OWNER',true,now()),
 (pg_temp.m119_id(21),pg_temp.m119_id(20),pg_temp.m119_id(2),'OWNER',true,now()),
 (pg_temp.m119_id(31),pg_temp.m119_id(10),pg_temp.m119_id(3),'PROFESIONAL',true,now()),
 (pg_temp.m119_id(41),pg_temp.m119_id(10),pg_temp.m119_id(4),'PROFESIONAL',true,now());
INSERT INTO servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents)
 VALUES(pg_temp.m119_id(12),pg_temp.m119_id(10),'Synthetic current service',enum_first(null::tipo_servicio_canonico),30,99999);
INSERT INTO paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,tipo_doc,telefono_cifrado)
 VALUES(pg_temp.m119_id(13),pg_temp.m119_id(10),'\x01','\x02','DNI','\x03');
INSERT INTO paciente(id,organization_id,identidad_id,profesional_principal_id)
 VALUES(pg_temp.m119_id(14),pg_temp.m119_id(10),pg_temp.m119_id(13),pg_temp.m119_id(11));
-- Entire database is an isolated fixture: no provider workers or real tokens.
INSERT INTO integration(id,organization_id,profesional_id,proveedor,access_token_cifrado,refresh_token_cifrado)
 VALUES(pg_temp.m119_id(15),pg_temp.m119_id(10),pg_temp.m119_id(11),'GOOGLE_CALENDAR','\x04','\x05');
INSERT INTO turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents,origen,estado,nota_reserva_cifrado,modalidad,sala_url_cifrado,sala_provider_room_id,sala_expira_ts,gcal_event_id)
 SELECT pg_temp.m119_id(n),pg_temp.m119_id(10),pg_temp.m119_id(14),pg_temp.m119_id(12),pg_temp.m119_id(11),
  '2026-10-11T12:00:00Z'::timestamptz+make_interval(days=>n-100),60,12345,'BOOKING','AGENDADO','\x06','telemedicina','\x07','synthetic-room',now()+interval '1 day','legacy-m119-'||n
 FROM generate_series(100,105) n;
INSERT INTO recordatorio_job(organization_id,turno_id,tipo,scheduled_ts)
 SELECT pg_temp.m119_id(10),pg_temp.m119_id(n),'CONFIRMACION_24H','2026-10-10T12:00:00Z'::timestamptz+make_interval(days=>n-100) FROM generate_series(100,105) n;
UPDATE recordatorio_job SET delivery_state='leased',lease_token=pg_temp.m119_id(900),lease_until=now()+interval '1 minute',external_started_at=now()
 WHERE turno_id=pg_temp.m119_id(100);
CREATE FUNCTION pg_temp.m119_move(op integer,old_id integer DEFAULT 100,new_start timestamptz DEFAULT '2026-10-11T12:15:00Z',duration integer DEFAULT 45) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.reschedule_turno_atomic(pg_temp.m119_id(10),pg_temp.m119_id(op),pg_temp.m119_id(old_id),new_start,duration)
$$;
-- M119 CONCURRENCY SEED END
SELECT set_config('test.reschedule_uid',pg_temp.m119_id(1)::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;r2 jsonb;BEGIN
 r:=pg_temp.m119_move(200);r2:=pg_temp.m119_move(200);
 IF r->>'nuevoTurnoId' IS DISTINCT FROM r2->>'nuevoTurnoId' OR NOT (r2->>'reused')::boolean THEN RAISE EXCEPTION 'M119 repeated operation created another replacement';END IF;
 BEGIN PERFORM pg_temp.m119_move(200,new_start=>'2026-10-11T15:00:00Z');RAISE EXCEPTION 'M119 changed intent reused operation';EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN PERFORM pg_temp.m119_move(201);RAISE EXCEPTION 'M119 another operation moved original twice';EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;END;
 BEGIN PERFORM pg_temp.m119_move(202,101,'2026-10-11T12:30:00Z');RAISE EXCEPTION 'M119 occupied destination accepted';EXCEPTION WHEN exclusion_violation THEN NULL;END;
 BEGIN PERFORM pg_temp.m119_move(203,101,'infinity');RAISE EXCEPTION 'M119 infinite date accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM pg_temp.m119_move(204,101,duration=>4);RAISE EXCEPTION 'M119 invalid duration accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END $$;
RESET ROLE;
DO $$ DECLARE r folio_reschedule_private.receipt;t public.turno;BEGIN
 SELECT * INTO r FROM folio_reschedule_private.receipt WHERE operation_id=pg_temp.m119_id(200);
 SELECT * INTO t FROM turno WHERE id=r.replacement_turno_id;
 IF (SELECT estado FROM turno WHERE id=pg_temp.m119_id(100))<>'REAGENDADO'
  OR t.estado<>'AGENDADO' OR t.precio_cents<>12345 OR t.duracion_min<>45 OR t.inicio<>'2026-10-11T12:15:00Z'::timestamptz
  OR t.paciente_id<>pg_temp.m119_id(14) OR t.servicio_id<>pg_temp.m119_id(12) OR t.profesional_id<>pg_temp.m119_id(11)
  OR t.nota_reserva_cifrado IS DISTINCT FROM '\x06'::bytea OR t.modalidad<>'telemedicina' OR t.origen<>'MANUAL'
  OR t.sala_url_cifrado IS NOT NULL OR t.sala_provider_room_id IS NOT NULL OR t.sala_expira_ts IS NOT NULL OR t.gcal_event_id IS NOT NULL
  THEN RAISE EXCEPTION 'M119 replacement lost snapshot or copied private room/event';END IF;
 IF (SELECT count(*) FROM recordatorio_job WHERE turno_id=t.id)<>2
  OR NOT EXISTS(SELECT 1 FROM recordatorio_job WHERE turno_id=pg_temp.m119_id(100) AND delivery_state='terminal' AND lease_token IS NULL AND lease_until IS NULL AND external_started_at IS NOT NULL)
  OR NOT EXISTS(SELECT 1 FROM google_outbound_job WHERE turno_id=pg_temp.m119_id(100) AND desired_version=2)
  OR NOT EXISTS(SELECT 1 FROM google_outbound_job WHERE turno_id=t.id AND desired_version=1)
  OR (SELECT count(*) FROM folio_reschedule_private.receipt)<>1
  OR (SELECT estado FROM turno WHERE id=pg_temp.m119_id(101))<>'AGENDADO'
  THEN RAISE EXCEPTION 'M119 reminders, Google intents or receipt inconsistent';END IF;
 IF has_function_privilege('anon','public.reschedule_turno_atomic(uuid,uuid,uuid,timestamptz,integer)','EXECUTE')
  OR has_function_privilege('service_role','public.reschedule_turno_atomic(uuid,uuid,uuid,timestamptz,integer)','EXECUTE')
  OR has_table_privilege('authenticated','folio_reschedule_private.receipt','SELECT')
  OR (SELECT prosecdef FROM pg_proc WHERE oid='public.reschedule_turno_atomic(uuid,uuid,uuid,timestamptz,integer)'::regprocedure)
  THEN RAISE EXCEPTION 'M119 exposed privileged function or receipts';END IF;
END $$;
-- Injection occurs after original change, replacement + Google and cancellation.
CREATE FUNCTION pg_temp.m119_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.organization_id=pg_temp.m119_id(10) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Synthetic late reminder insertion failure';END IF;RETURN NEW;END $$;
CREATE TRIGGER m119_fail_late BEFORE INSERT ON recordatorio_job FOR EACH ROW EXECUTE FUNCTION pg_temp.m119_fail();
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM pg_temp.m119_move(205,101,'2026-10-12T15:00:00Z');RAISE EXCEPTION 'M119 late failure accepted';EXCEPTION WHEN check_violation THEN NULL;END;
END $$;
RESET ROLE;
DROP TRIGGER m119_fail_late ON recordatorio_job;
DO $$ BEGIN
 IF (SELECT estado FROM turno WHERE id=pg_temp.m119_id(101))<>'AGENDADO'
  OR (SELECT count(*) FROM turno WHERE organization_id=pg_temp.m119_id(10))<>7
  OR (SELECT count(*) FROM google_outbound_job WHERE organization_id=pg_temp.m119_id(10))<>7
  OR (SELECT desired_version FROM google_outbound_job WHERE turno_id=pg_temp.m119_id(101))<>1
  OR (SELECT delivery_state FROM recordatorio_job WHERE turno_id=pg_temp.m119_id(101))<>'pending'
  OR EXISTS(SELECT 1 FROM folio_reschedule_private.receipt WHERE operation_id=pg_temp.m119_id(205))
  THEN RAISE EXCEPTION 'M119 late failure left a partial change';END IF;
END $$;
-- Same failed operation can be retried after the known transaction rejection.
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM pg_temp.m119_move(205,101,'2026-10-12T15:00:00Z');END $$;
RESET ROLE;
-- Never allow a clinician with TODOS to move a colleague's agenda or receipt.
UPDATE member SET role='PROFESIONAL',alcance='TODOS' WHERE id=pg_temp.m119_id(11);
UPDATE turno SET profesional_id=pg_temp.m119_id(31) WHERE id=pg_temp.m119_id(102);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM pg_temp.m119_move(206,102,'2026-10-13T15:00:00Z');RAISE EXCEPTION 'M119 clinician moved colleague';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM pg_temp.m119_move(200);
END $$;
RESET ROLE;
-- Administrative staff is constrained by the explicit delegated agenda list.
UPDATE member SET role='ASISTENTE',es_colegiado=false,alcance='LISTA_PROFESIONALES',profesionales_gestionados=ARRAY[pg_temp.m119_id(31)] WHERE id=pg_temp.m119_id(11);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM pg_temp.m119_move(207,102,'2026-10-13T15:00:00Z');
 BEGIN PERFORM pg_temp.m119_move(208,103,'2026-10-14T15:00:00Z');RAISE EXCEPTION 'M119 assistant moved outside list';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM pg_temp.m119_move(200);RAISE EXCEPTION 'M119 assistant recovered outside list';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
UPDATE member SET role='OWNER',es_colegiado=true,alcance='TODOS',profesionales_gestionados='{}' WHERE id=pg_temp.m119_id(11);
-- Every restoration is checked with a positive receipt, so later negatives do
-- not pass merely because a previous fixture revocation remained in place.
SAVEPOINT valid_scope;
UPDATE member SET deleted_at=now() WHERE id=pg_temp.m119_id(11);
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM pg_temp.m119_move(200);RAISE EXCEPTION 'M119 revoked staff recovered receipt';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT valid_scope;
UPDATE paciente SET caja_fuerte_profesional=pg_temp.m119_id(31) WHERE id=pg_temp.m119_id(14);
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM pg_temp.m119_move(200);RAISE EXCEPTION 'M119 vault scope bypass';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT valid_scope;
SELECT set_config('test.reschedule_uid',pg_temp.m119_id(2)::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM pg_temp.m119_move(200);RAISE EXCEPTION 'M119 foreign tenant recovered receipt';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT valid_scope;
UPDATE turno SET profesional_id=pg_temp.m119_id(31)
 WHERE id=(SELECT replacement_turno_id FROM folio_reschedule_private.receipt WHERE operation_id=pg_temp.m119_id(200));
UPDATE member SET es_colegiado=false WHERE id=pg_temp.m119_id(31);
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM pg_temp.m119_move(200);RAISE EXCEPTION 'M119 inactive replacement professional recovered receipt';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT valid_scope;
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF NOT (pg_temp.m119_move(200)->>'reused')::boolean THEN RAISE EXCEPTION 'M119 fixture did not restore valid receipt';END IF;END $$;
RESET ROLE;
UPDATE turno SET estado='NO_ASISTIO' WHERE id=pg_temp.m119_id(104);
SET LOCAL ROLE authenticated;
DO $$ BEGIN PERFORM pg_temp.m119_move(209,104,'2026-10-15T15:00:00Z',NULL);END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT duracion_min FROM turno WHERE id=(SELECT replacement_turno_id FROM folio_reschedule_private.receipt WHERE operation_id=pg_temp.m119_id(209)))<>60 THEN RAISE EXCEPTION 'M119 default duration changed';END IF;
END $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"aal":"aal1"}'::jsonb $$;
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM pg_temp.m119_move(200);RAISE EXCEPTION 'M119 receipt bypassed MFA';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
ROLLBACK;
