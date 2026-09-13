-- SQL authorization fixtures only; real Auth/browser coverage is a separate run.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.agenda_recepcion_dia(uuid,date,uuid)') IS NULL THEN
  RAISE EXCEPTION 'M122 missing operational reception reader';
 END IF;
END $$;
-- Reuse the complete, rollback-only owner/professional/reception/foreign fixture.
\ir ../fixtures/M121_payment_settlement.sql
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.m122_jwt',true),''),'{}')::jsonb $$;
INSERT INTO auth.mfa_factors(id,user_id,status)
 SELECT pg_temp.m121_id(800+n),pg_temp.m121_id(n),'verified' FROM generate_series(1,7) n;
INSERT INTO auth.sessions(id,user_id,aal,factor_id)
 SELECT pg_temp.m121_id(900+n),pg_temp.m121_id(n),'aal2',pg_temp.m121_id(800+n) FROM generate_series(1,7) n;
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
CREATE FUNCTION pg_temp.m122_login(n integer,aal text DEFAULT 'aal2') RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('test.m121_uid',pg_temp.m121_id(n)::text,true);
 PERFORM set_config('test.m122_jwt',jsonb_build_object('aal',aal,'session_id',pg_temp.m121_id(900+n))::text,true);
END $$;
SELECT pg_temp.m122_login(1);
UPDATE organization SET timezone='America/Argentina/Cordoba' WHERE id=pg_temp.m121_id(10);
-- The UTC day and the organization's day differ at the two boundaries.
UPDATE turno SET inicio='2035-01-01T13:00:00Z',profesional_id=pg_temp.m121_id(31) WHERE id=pg_temp.m121_id(101);
UPDATE turno SET inicio='2035-01-02T02:30:00Z' WHERE id=pg_temp.m121_id(104);
UPDATE turno SET inicio='2035-01-02T03:00:00Z' WHERE id=pg_temp.m121_id(105);
GRANT SELECT ON turno_extendido,servicio TO authenticated;

DO $$ BEGIN
 IF has_table_privilege('authenticated','folio_agenda_private.revision','SELECT')
 OR has_function_privilege('authenticated','folio_agenda_private.record_change()','EXECUTE')
 OR has_function_privilege('authenticated','folio_agenda_private.revision_at(uuid,timestamptz)','EXECUTE')
 THEN RAISE EXCEPTION 'M122 widened M111 private object privileges'; END IF;
 IF has_function_privilege('anon','public.agenda_recepcion_dia(uuid,date,uuid)','EXECUTE')
 OR has_function_privilege('service_role','public.agenda_recepcion_dia(uuid,date,uuid)','EXECUTE')
 OR has_function_privilege('anon','folio_agenda_private.recepcion_dia(uuid,date,uuid)','EXECUTE')
 OR has_function_privilege('service_role','folio_agenda_private.recepcion_dia(uuid,date,uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.agenda_recepcion_dia(uuid,date,uuid)','EXECUTE')
 OR (SELECT prosecdef FROM pg_proc WHERE oid='public.agenda_recepcion_dia(uuid,date,uuid)'::regprocedure)
 OR NOT (SELECT prosecdef FROM pg_proc WHERE oid='folio_agenda_private.recepcion_dia(uuid,date,uuid)'::regprocedure)
 OR EXISTS(SELECT 1 FROM pg_proc WHERE oid IN('public.agenda_recepcion_dia(uuid,date,uuid)'::regprocedure,'folio_agenda_private.recepcion_dia(uuid,date,uuid)'::regprocedure)
   AND (provolatile<>'s' OR NOT proretset OR NOT ('search_path=pg_catalog'=ANY(proconfig))))
 THEN RAISE EXCEPTION 'M122 unsafe privilege or function boundary'; END IF;
 IF (SELECT proargnames[1:3] FROM pg_proc WHERE oid='public.agenda_recepcion_dia(uuid,date,uuid)'::regprocedure)
  IS DISTINCT FROM ARRAY['p_org','p_fecha','p_profesional']::text[] THEN RAISE EXCEPTION 'M122 RPC argument contract drift';END IF;
END $$;

SELECT pg_temp.m122_login(4);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r record; BEGIN
 IF NOT public.user_has_scope_over(pg_temp.m121_id(10),pg_temp.m121_id(11)) THEN RAISE EXCEPTION 'M122 fixture scope missing';END IF;
 IF EXISTS(SELECT 1 FROM paciente WHERE id=pg_temp.m121_id(14)) OR EXISTS(SELECT 1 FROM sesion WHERE turno_id=pg_temp.m121_id(100))
 OR EXISTS(SELECT 1 FROM turno_extendido WHERE id=pg_temp.m121_id(100)) THEN RAISE EXCEPTION 'M122 clinical RLS unexpectedly widened';END IF;
 IF (SELECT count(*) FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),'2035-01-01'))<>3 THEN RAISE EXCEPTION 'M122 assistant cannot read full local day';END IF;
 SELECT * INTO STRICT r FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),'2035-01-01') WHERE id=pg_temp.m121_id(100);
 IF r.paciente_nombre_cifrado IS DISTINCT FROM '\x01'::bytea OR r.paciente_apellido_cifrado IS DISTINCT FROM '\x02'::bytea
 OR r.paciente_telefono_cifrado IS DISTINCT FROM '\x03'::bytea OR r.precio_cents IS DISTINCT FROM 1200
 OR r.pago_id IS DISTINCT FROM pg_temp.m121_id(200) OR r.pago_monto_cents IS DISTINCT FROM 1200
 OR r.pago_estado IS DISTINCT FROM 'PENDIENTE' OR r.pago_metodo IS DISTINCT FROM 'EFECTIVO' OR r.pago_updated_at IS NULL
 OR r.pago_pagado_ts IS NOT NULL THEN RAISE EXCEPTION 'M122 assistant operational identity/payment snapshot changed';END IF;
 IF r.paciente_tipo IS NOT NULL OR r.paciente_tags IS NOT NULL OR r.paciente_alerta_alergia IS DISTINCT FROM false
 OR r.nota_reserva_cifrado IS NOT NULL THEN RAISE EXCEPTION 'M122 reception received clinical data';END IF;
 IF (SELECT count(*) FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),'2035-01-01',pg_temp.m121_id(11)))<>2
 OR EXISTS(SELECT 1 FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),'2035-01-01') WHERE id=pg_temp.m121_id(105))
 OR NOT EXISTS(SELECT 1 FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),'2035-01-02') WHERE id=pg_temp.m121_id(105))
 THEN RAISE EXCEPTION 'M122 professional or local midnight filter broken';END IF;
 -- SETOF count/filter/order/offset compose without truncating the day.
 IF (SELECT id FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),'2035-01-01') ORDER BY inicio,id LIMIT 1 OFFSET 2)
  IS DISTINCT FROM pg_temp.m121_id(104) THEN RAISE EXCEPTION 'M122 pagination contract broken';END IF;
 PERFORM pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_dia(pg_temp.m121_id(20),''2035-01-01'')','42501');
 PERFORM pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),''2035-01-01'',pg_temp.m121_id(21))','42501');
 PERFORM pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_dia(NULL,''2035-01-01'')','22023');
 PERFORM pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),NULL)','22023');
 PERFORM pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),''infinity'')','22023');
END $$;
RESET ROLE;

SELECT pg_temp.m122_login(5);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),'2035-01-01'))<>3 THEN RAISE EXCEPTION 'M122 coordinator lost appointment rows';END IF;
 IF EXISTS(SELECT 1 FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),'2035-01-01')
  WHERE precio_cents IS NOT NULL OR pago_id IS NOT NULL OR pago_monto_cents IS NOT NULL OR pago_estado IS NOT NULL
   OR pago_pagado_ts IS NOT NULL OR pago_metodo IS NOT NULL OR pago_updated_at IS NOT NULL
   OR paciente_tipo IS NOT NULL OR paciente_tags IS NOT NULL OR paciente_alerta_alergia OR nota_reserva_cifrado IS NOT NULL)
 THEN RAISE EXCEPTION 'M122 coordinator received money or clinical fields';END IF;
 IF EXISTS(SELECT 1 FROM paciente WHERE id=pg_temp.m121_id(14)) THEN RAISE EXCEPTION 'M122 coordinator reads clinical patient';END IF;
END $$;
RESET ROLE;

-- Current scope updates take effect immediately, not from stale JWT role data.
UPDATE member SET alcance='LISTA_PROFESIONALES',profesionales_gestionados=ARRAY[pg_temp.m121_id(31)::text] WHERE id=pg_temp.m121_id(41);
SELECT pg_temp.m122_login(4);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),'2035-01-01'))<>1 THEN RAISE EXCEPTION 'M122 out-of-scope appointments exposed';END IF;
 PERFORM pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),''2035-01-01'',pg_temp.m121_id(11))','42501');
END $$;
RESET ROLE;
UPDATE member SET alcance='TODOS',profesionales_gestionados=ARRAY[]::text[] WHERE id=pg_temp.m121_id(41);

-- Preserve M31 identity vault restrictions; no operational row exposes a VIP.
SELECT pg_temp.m122_login(1);
SAVEPOINT vault;
UPDATE paciente SET caja_fuerte_profesional=pg_temp.m121_id(11) WHERE id=pg_temp.m121_id(14);
SELECT pg_temp.m122_login(4);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),'2035-01-01')) THEN RAISE EXCEPTION 'M122 vault identity exposed';END IF;END $$;
RESET ROLE;
ROLLBACK TO vault;
SAVEPOINT deleted_patient;
UPDATE paciente SET deleted_at=now() WHERE id=pg_temp.m121_id(14);
SELECT pg_temp.m122_login(4);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),'2035-01-01')) THEN RAISE EXCEPTION 'M122 deleted patient exposed';END IF;END $$;
RESET ROLE;
ROLLBACK TO deleted_patient;
SAVEPOINT deleted_identity;
UPDATE paciente_identidad SET deleted_at=now() WHERE id=pg_temp.m121_id(13);
SELECT pg_temp.m122_login(4);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),'2035-01-01')) THEN RAISE EXCEPTION 'M122 deleted identity exposed';END IF;END $$;
RESET ROLE;
ROLLBACK TO deleted_identity;
SAVEPOINT pseudonymized;
UPDATE paciente SET identidad_id=NULL,pseudonimizado_en=now() WHERE id=pg_temp.m121_id(14);
SELECT pg_temp.m122_login(4);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),'2035-01-01')) THEN RAISE EXCEPTION 'M122 pseudonymized patient exposed';END IF;END $$;
RESET ROLE;
ROLLBACK TO pseudonymized;
SAVEPOINT deleted_turno;
UPDATE turno SET deleted_at=now() WHERE id=pg_temp.m121_id(100);
SELECT pg_temp.m122_login(4);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF (SELECT count(*) FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),'2035-01-01'))<>2 THEN RAISE EXCEPTION 'M122 deleted appointment exposed';END IF;END $$;
RESET ROLE;
ROLLBACK TO deleted_turno;

-- Invalid or revoked Auth and memberships cannot use the new privileged read.
SELECT pg_temp.m122_login(4,'aal1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),''2035-01-01'')','42501');
RESET ROLE;
SELECT pg_temp.m122_login(4);
SAVEPOINT revoked_session;
DELETE FROM auth.sessions WHERE id=pg_temp.m121_id(904);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),''2035-01-01'')','42501');
RESET ROLE;
ROLLBACK TO revoked_session;
SAVEPOINT expired_session;
UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=pg_temp.m121_id(904);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),''2035-01-01'')','42501');
RESET ROLE;
ROLLBACK TO expired_session;
SAVEPOINT unverified_factor;
UPDATE auth.mfa_factors SET status='unverified' WHERE id=pg_temp.m121_id(804);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),''2035-01-01'')','42501');
RESET ROLE;
ROLLBACK TO unverified_factor;
SAVEPOINT revoked_member;
UPDATE member SET deleted_at=now() WHERE id=pg_temp.m121_id(41);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),''2035-01-01'')','42501');
RESET ROLE;
ROLLBACK TO revoked_member;
SAVEPOINT unaccepted_member;
UPDATE member SET accepted_at=NULL,invited_by_id=pg_temp.m121_id(1) WHERE id=pg_temp.m121_id(41);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),''2035-01-01'')','42501');
RESET ROLE;
ROLLBACK TO unaccepted_member;
SAVEPOINT revoked_org;
UPDATE organization SET deleted_at=now() WHERE id=pg_temp.m121_id(10);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),''2035-01-01'')','42501');
RESET ROLE;
ROLLBACK TO revoked_org;
DO $$ DECLARE actor integer; BEGIN FOREACH actor IN ARRAY ARRAY[1,2,3,6,7] LOOP
 PERFORM pg_temp.m122_login(actor);
 PERFORM pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),''2035-01-01'')','42501');
 END LOOP;END $$;
SELECT pg_temp.m122_login(4);
SET LOCAL ROLE anon;
SELECT pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),''2035-01-01'')','42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),''2035-01-01'')','42501');
RESET ROLE;
SELECT 'M122 PASS: operational roles/scope/PII/vault/local-day/financial-redaction/Auth boundaries';
ROLLBACK;
