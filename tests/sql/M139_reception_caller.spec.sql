-- Synthetic authorization and durability fixture only. Nothing leaves this transaction.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.caller_screen_read(uuid,text,bigint)') IS NULL THEN
  RAISE EXCEPTION 'M139 caller RPC missing';
 END IF;
 IF has_table_privilege('anon','folio_caller_private.screen','SELECT')
  OR has_table_privilege('authenticated','folio_caller_private.call_event','SELECT')
  OR has_function_privilege('authenticated','public.caller_screen_read(uuid,text,bigint)','EXECUTE')
  OR has_function_privilege('anon','public.caller_call(uuid,uuid,uuid,text,integer)','EXECUTE')
  OR NOT has_function_privilege('anon','public.caller_screen_read(uuid,text,bigint)','EXECUTE') THEN
  RAISE EXCEPTION 'M139 grant boundary changed';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m139_uid',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.m139_jwt',true),''),'{}')::jsonb $$;
CREATE FUNCTION pg_temp.m139_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('13900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.m139_login(n integer,aal text DEFAULT 'aal2') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('test.m139_uid',pg_temp.m139_id(n)::text,true);
 PERFORM set_config('test.m139_jwt',jsonb_build_object('aal',aal,'session_id',pg_temp.m139_id(900+n))::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
END $$;
CREATE FUNCTION pg_temp.m139_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('test.m139_uid','',true);
 PERFORM set_config('test.m139_jwt','{}',true);
 PERFORM set_config('request.jwt.claim.role','anon',true);
END $$;
CREATE FUNCTION pg_temp.m139_expect(query text,code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE query;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE=code THEN RETURN;END IF;
  RAISE EXCEPTION 'M139 expected %, got %: %',code,SQLSTATE,SQLERRM;
 END;
 RAISE EXCEPTION 'M139 expected failure %, statement succeeded',code;
END $$;
CREATE FUNCTION pg_temp.m139_noon() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$
 SELECT ((timezone('America/Argentina/Cordoba',clock_timestamp())::date)::timestamp + interval '12 hours')
   AT TIME ZONE 'America/Argentina/Cordoba'
$$;
INSERT INTO auth.users(id,email) SELECT pg_temp.m139_id(n),'m139-'||n||'@synthetic.invalid'
 FROM generate_series(1,8) n;
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version)
 SELECT pg_temp.m139_id(n),'m139-'||n||'@synthetic.invalid',now(),'v1'
 FROM generate_series(1,8) n;
INSERT INTO public.organization(id,slug,nombre,timezone) VALUES
 (pg_temp.m139_id(10),'m139-one','Synthetic One','America/Argentina/Cordoba'),
 (pg_temp.m139_id(20),'m139-two','Synthetic Two','America/Argentina/Cordoba');
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at,alcance,profesionales_gestionados) VALUES
 (pg_temp.m139_id(11),pg_temp.m139_id(10),pg_temp.m139_id(1),'OWNER',true,now(),'TODOS','{}'),
 (pg_temp.m139_id(12),pg_temp.m139_id(10),pg_temp.m139_id(2),'DIRECTOR',false,now(),'TODOS','{}'),
 (pg_temp.m139_id(13),pg_temp.m139_id(10),pg_temp.m139_id(3),'PROFESIONAL',true,now(),'TODOS','{}'),
 (pg_temp.m139_id(14),pg_temp.m139_id(10),pg_temp.m139_id(4),'ASISTENTE',false,now(),'LISTA_PROFESIONALES',ARRAY[pg_temp.m139_id(13)::text]),
 (pg_temp.m139_id(15),pg_temp.m139_id(10),pg_temp.m139_id(5),'COORDINADOR',false,now(),'LISTA_PROFESIONALES',ARRAY[pg_temp.m139_id(13)::text]),
 (pg_temp.m139_id(16),pg_temp.m139_id(20),pg_temp.m139_id(6),'OWNER',true,now(),'TODOS','{}'),
 (pg_temp.m139_id(17),pg_temp.m139_id(10),pg_temp.m139_id(7),'PROFESIONAL',true,now(),'TODOS','{}');
INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents)
 VALUES(pg_temp.m139_id(30),pg_temp.m139_id(10),'Synthetic',enum_first(null::public.tipo_servicio_canonico),30,1000);
INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado)
 VALUES(pg_temp.m139_id(31),pg_temp.m139_id(10),'\x01','\x02','\x03');
INSERT INTO public.paciente(id,organization_id,identidad_id,profesional_principal_id)
 VALUES(pg_temp.m139_id(32),pg_temp.m139_id(10),pg_temp.m139_id(31),pg_temp.m139_id(13));
INSERT INTO public.turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents,estado) VALUES
 (pg_temp.m139_id(40),pg_temp.m139_id(10),pg_temp.m139_id(32),pg_temp.m139_id(30),pg_temp.m139_id(13),pg_temp.m139_noon(),30,1000,'EN_SALA'),
 (pg_temp.m139_id(41),pg_temp.m139_id(10),pg_temp.m139_id(32),pg_temp.m139_id(30),pg_temp.m139_id(17),pg_temp.m139_noon()+interval '1 hour',30,1000,'EN_SALA');
INSERT INTO auth.mfa_factors(id,user_id,status)
 SELECT pg_temp.m139_id(800+n),pg_temp.m139_id(n),'verified' FROM generate_series(1,7) n;
INSERT INTO auth.sessions(id,user_id,aal,factor_id)
 SELECT pg_temp.m139_id(900+n),pg_temp.m139_id(n),'aal2',pg_temp.m139_id(800+n)
 FROM generate_series(1,7) n;
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();

-- Owner and director can operate; code stays bound to the same turn/day.
SELECT pg_temp.m139_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE first jsonb; again jsonb; called jsonb; replay jsonb; second jsonb;
BEGIN
 first:=public.caller_issue_code(pg_temp.m139_id(10),pg_temp.m139_id(40));
 again:=public.caller_issue_code(pg_temp.m139_id(10),pg_temp.m139_id(40));
 IF first->>'code' IS DISTINCT FROM 'A0001' OR (again->>'reused')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'M139 code issue/replay changed';
 END IF;
 called:=public.caller_call(pg_temp.m139_id(10),pg_temp.m139_id(500),pg_temp.m139_id(40),'CONSULTORIO',4);
 replay:=public.caller_call(pg_temp.m139_id(10),pg_temp.m139_id(500),pg_temp.m139_id(40),'CONSULTORIO',4);
 second:=public.caller_call(pg_temp.m139_id(10),pg_temp.m139_id(501),pg_temp.m139_id(40),'CONSULTORIO',4);
 IF called->>'code' IS DISTINCT FROM 'A0001' OR called->>'destination' IS DISTINCT FROM 'Consultorio 4'
  OR called->>'cursor' IS DISTINCT FROM replay->>'cursor' OR (replay->>'reused')::boolean IS DISTINCT FROM true
  OR (second->>'cursor')::bigint<>(called->>'cursor')::bigint+1 THEN
  RAISE EXCEPTION 'M139 call replay or unchanged visit failed';
 END IF;
 PERFORM pg_temp.m139_expect('SELECT public.caller_call(pg_temp.m139_id(10),pg_temp.m139_id(500),pg_temp.m139_id(40),''RECEPCION'',NULL)','40001');
 PERFORM pg_temp.m139_expect('SELECT public.caller_call(pg_temp.m139_id(10),pg_temp.m139_id(502),pg_temp.m139_id(40),''CONSULTORIO'',NULL)','22023');
 PERFORM pg_temp.m139_expect('SELECT public.caller_issue_code(pg_temp.m139_id(20),pg_temp.m139_id(40))','42501');
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM folio_caller_private.ticket WHERE organization_id=pg_temp.m139_id(10))<>1
  OR (SELECT count(*) FROM folio_caller_private.call_event WHERE organization_id=pg_temp.m139_id(10))<>2
  OR (SELECT estado::text FROM public.turno WHERE id=pg_temp.m139_id(40)) IS DISTINCT FROM 'EN_SALA' THEN
  RAISE EXCEPTION 'M139 private event count or clinical state changed';
 END IF;
END $$;
-- A lost reply is recoverable with the same receipt after the appointment
-- leaves EN_SALA; a new operation cannot create another call in that state.
SAVEPOINT after_call_canceled;
UPDATE public.turno SET estado='CANCELADO' WHERE id=pg_temp.m139_id(40);
SET LOCAL ROLE authenticated;
DO $$ DECLARE replay jsonb;
BEGIN
 replay:=public.caller_call(pg_temp.m139_id(10),pg_temp.m139_id(500),pg_temp.m139_id(40),'CONSULTORIO',4);
 IF replay->>'code' IS DISTINCT FROM 'A0001' OR replay->>'cursor' IS DISTINCT FROM '1'
  OR (replay->>'reused')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'M139 lost response could not recover original call';
 END IF;
 PERFORM pg_temp.m139_expect('SELECT public.caller_call(pg_temp.m139_id(10),pg_temp.m139_id(508),pg_temp.m139_id(40),''CONSULTORIO'',4)','55000');
 PERFORM pg_temp.m139_expect('SELECT public.caller_call(pg_temp.m139_id(10),pg_temp.m139_id(500),pg_temp.m139_id(40),''RECEPCION'',NULL)','40001');
END $$;
RESET ROLE;
ROLLBACK TO after_call_canceled;
SELECT pg_temp.m139_login(2);
SET LOCAL ROLE authenticated;
SELECT public.caller_issue_code(pg_temp.m139_id(10),pg_temp.m139_id(41));
RESET ROLE;
SELECT pg_temp.m139_login(3);
SET LOCAL ROLE authenticated;
SELECT public.caller_call(pg_temp.m139_id(10),pg_temp.m139_id(503),pg_temp.m139_id(40),'RECEPCION',NULL);
SELECT pg_temp.m139_expect('SELECT public.caller_call(pg_temp.m139_id(10),pg_temp.m139_id(504),pg_temp.m139_id(41),''RECEPCION'',NULL)','42501');
RESET ROLE;
SELECT pg_temp.m139_login(4);
SET LOCAL ROLE authenticated;
SELECT public.caller_call(pg_temp.m139_id(10),pg_temp.m139_id(505),pg_temp.m139_id(40),'RECEPCION',NULL);
SELECT pg_temp.m139_expect('SELECT public.caller_call(pg_temp.m139_id(10),pg_temp.m139_id(506),pg_temp.m139_id(41),''RECEPCION'',NULL)','42501');
RESET ROLE;
SELECT pg_temp.m139_login(4,'aal1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.m139_expect('SELECT public.caller_issue_code(pg_temp.m139_id(10),pg_temp.m139_id(40))','42501');
RESET ROLE;
SELECT pg_temp.m139_login(4);
SAVEPOINT scope_revoked;
UPDATE public.member SET profesionales_gestionados=ARRAY[pg_temp.m139_id(17)::text]
 WHERE id=pg_temp.m139_id(14);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m139_expect('SELECT public.caller_call(pg_temp.m139_id(10),pg_temp.m139_id(507),pg_temp.m139_id(40),''RECEPCION'',NULL)','42501');
RESET ROLE;
ROLLBACK TO scope_revoked;

-- The pairing code is only returned once; anonymous screen receives token once.
SELECT pg_temp.m139_login(1,'aal1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.m139_expect('SELECT public.caller_create_pair(pg_temp.m139_id(10),pg_temp.m139_id(699))','42501');
RESET ROLE;
SELECT pg_temp.m139_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE issued jsonb; replay jsonb;
BEGIN
 issued:=public.caller_create_pair(pg_temp.m139_id(10),pg_temp.m139_id(600));
 replay:=public.caller_create_pair(pg_temp.m139_id(10),pg_temp.m139_id(600));
 IF length(issued->>'pairCode')<>16 OR replay ? 'pairCode' OR
  (replay->>'alreadyIssued')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'M139 pairing replay reissued secret';
 END IF;
 PERFORM set_config('test.m139_pair_code',issued->>'pairCode',true);
 PERFORM set_config('test.m139_screen_id',issued->>'screenId',true);
END $$;
RESET ROLE;
SELECT pg_temp.m139_anon();
SET LOCAL ROLE anon;
DO $$ DECLARE paired jsonb; snapshot jsonb; reconnect jsonb;
BEGIN
 paired:=public.caller_pair(current_setting('test.m139_pair_code'));
 PERFORM set_config('test.m139_screen_token',paired->>'token',true);
 IF length(paired->>'token')<>64 THEN RAISE EXCEPTION 'M139 token entropy contract changed';END IF;
 PERFORM pg_temp.m139_expect('SELECT public.caller_pair(current_setting(''test.m139_pair_code''))','42501');
 snapshot:=public.caller_screen_read(pg_temp.m139_id(10),paired->>'token',NULL);
 reconnect:=public.caller_screen_read(pg_temp.m139_id(10),paired->>'token',(snapshot->>'cursor')::bigint);
 IF (snapshot->>'reset')::boolean IS DISTINCT FROM true
  OR (reconnect->>'reset')::boolean IS DISTINCT FROM false
  OR jsonb_array_length(snapshot->'snapshot')<1
  OR jsonb_array_length(snapshot->'snapshot')>20
  OR (snapshot->'snapshot'->0) ?| ARRAY['turnoId','pacienteId','actorId','organizationId','nombre','token']
  OR snapshot::text LIKE '%'||pg_temp.m139_id(40)::text||'%' THEN
  RAISE EXCEPTION 'M139 screen snapshot/cursor leaked or changed';
 END IF;
 PERFORM pg_temp.m139_expect('SELECT public.caller_screen_read(pg_temp.m139_id(20),current_setting(''test.m139_screen_token''),NULL)','42501');
END $$;
RESET ROLE;
SELECT pg_temp.m139_login(6);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m139_expect('SELECT public.caller_revoke_screen(pg_temp.m139_id(10),current_setting(''test.m139_screen_id'')::uuid)','42501');
RESET ROLE;
SELECT pg_temp.m139_login(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m139_expect('SELECT public.caller_screen_read(pg_temp.m139_id(10),current_setting(''test.m139_screen_token''),NULL)','42501');
RESET ROLE;
SELECT pg_temp.m139_login(1);
SET LOCAL ROLE authenticated;
SELECT public.caller_revoke_screen(pg_temp.m139_id(10),current_setting('test.m139_screen_id')::uuid);
RESET ROLE;
SELECT pg_temp.m139_anon();
SET LOCAL ROLE anon;
SELECT pg_temp.m139_expect('SELECT public.caller_screen_read(pg_temp.m139_id(10),current_setting(''test.m139_screen_token''),NULL)','42501');
RESET ROLE;

-- Pair and screen expiry reject otherwise valid credentials.
SELECT pg_temp.m139_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE issued jsonb;
BEGIN
 issued:=public.caller_create_pair(pg_temp.m139_id(10),pg_temp.m139_id(602));
 PERFORM set_config('test.m139_pair_expired',issued->>'pairCode',true);
 PERFORM set_config('test.m139_screen_expired_id',issued->>'screenId',true);
END $$;
RESET ROLE;
UPDATE folio_caller_private.screen SET pair_expires_at=clock_timestamp()-interval '1 second'
 WHERE id=current_setting('test.m139_screen_expired_id')::uuid;
SELECT pg_temp.m139_anon();
SET LOCAL ROLE anon;
SELECT pg_temp.m139_expect('SELECT public.caller_pair(current_setting(''test.m139_pair_expired''))','42501');
RESET ROLE;

-- Current patient/identity and cancellation gates also remove display rows.
SELECT pg_temp.m139_login(1);
SAVEPOINT vault;
UPDATE public.paciente SET caja_fuerte_profesional=pg_temp.m139_id(13) WHERE id=pg_temp.m139_id(32);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m139_expect('SELECT public.caller_issue_code(pg_temp.m139_id(10),pg_temp.m139_id(40))','42501');
RESET ROLE;
ROLLBACK TO vault;
SAVEPOINT identity_deleted;
UPDATE public.paciente_identidad SET deleted_at=now() WHERE id=pg_temp.m139_id(31);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m139_expect('SELECT public.caller_issue_code(pg_temp.m139_id(10),pg_temp.m139_id(40))','42501');
RESET ROLE;
ROLLBACK TO identity_deleted;
SAVEPOINT canceled;
UPDATE public.turno SET estado='CANCELADO' WHERE id=pg_temp.m139_id(40);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m139_expect('SELECT public.caller_call(pg_temp.m139_id(10),pg_temp.m139_id(507),pg_temp.m139_id(40),''RECEPCION'',NULL)','55000');
RESET ROLE;
ROLLBACK TO canceled;

-- A credential also dies when its issuing owner/director loses current authority.
SELECT pg_temp.m139_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE issued jsonb;
BEGIN
 issued:=public.caller_create_pair(pg_temp.m139_id(10),pg_temp.m139_id(601));
 PERFORM set_config('test.m139_pair_code2',issued->>'pairCode',true);
END $$;
RESET ROLE;
SELECT pg_temp.m139_anon();
SET LOCAL ROLE anon;
DO $$ DECLARE paired jsonb;
BEGIN
 paired:=public.caller_pair(current_setting('test.m139_pair_code2'));
 PERFORM set_config('test.m139_token2',paired->>'token',true);
 PERFORM set_config('test.m139_screen_id2',paired->>'screenId',true);
END $$;
RESET ROLE;
SAVEPOINT token_expired;
UPDATE folio_caller_private.screen SET token_expires_at=clock_timestamp()-interval '1 second'
 WHERE id=current_setting('test.m139_screen_id2')::uuid;
SET LOCAL ROLE anon;
SELECT pg_temp.m139_expect('SELECT public.caller_screen_read(pg_temp.m139_id(10),current_setting(''test.m139_token2''),NULL)','42501');
RESET ROLE;
ROLLBACK TO token_expired;
SELECT pg_temp.m139_login(1);
SAVEPOINT canceled_screen;
UPDATE public.turno SET estado='CANCELADO' WHERE id=pg_temp.m139_id(40);
SELECT pg_temp.m139_anon();
SET LOCAL ROLE anon;
DO $$ DECLARE snapshot jsonb;
BEGIN
 snapshot:=public.caller_screen_read(pg_temp.m139_id(10),current_setting('test.m139_token2'),NULL);
 IF jsonb_array_length(snapshot->'snapshot')<>0 THEN
  RAISE EXCEPTION 'M139 canceled turn remained on screen';
 END IF;
END $$;
RESET ROLE;
ROLLBACK TO canceled_screen;
SAVEPOINT issuer_removed;
UPDATE public.member SET deleted_at=now() WHERE id=pg_temp.m139_id(11);
SELECT pg_temp.m139_anon();
SET LOCAL ROLE anon;
SELECT pg_temp.m139_expect('SELECT public.caller_screen_read(pg_temp.m139_id(10),current_setting(''test.m139_token2''),NULL)','42501');
RESET ROLE;
ROLLBACK TO issuer_removed;
UPDATE public.member SET role='PROFESIONAL' WHERE id=pg_temp.m139_id(11);
SELECT pg_temp.m139_anon();
SET LOCAL ROLE anon;
SELECT pg_temp.m139_expect('SELECT public.caller_screen_read(pg_temp.m139_id(10),current_setting(''test.m139_token2''),NULL)','42501');
RESET ROLE;
ROLLBACK;
