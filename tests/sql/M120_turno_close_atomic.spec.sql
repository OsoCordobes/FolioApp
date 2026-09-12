-- PostgreSQL boundary; Auth stubs, no hosted Auth/Storage claim.
BEGIN;
\ir ../fixtures/M120_turno_close.sql
-- Both payment states already exist before activation; closing cannot overwrite
-- audit fields, settle a debt, or infer that a pre-existing payment is new.
INSERT INTO pago(turno_id,monto_cents,metodo,estado,pagado_ts,notas,factura_afip_numero)
 VALUES(pg_temp.m120_id(104),400,'EFECTIVO','PENDIENTE',NULL,'preserve pending','synthetic-104'),
 (pg_temp.m120_id(105),500,'EFECTIVO','PAGADO',now(),'preserve paid','synthetic-105');
CREATE TEMP TABLE payment_before AS SELECT * FROM pago;
SELECT public.enable_turno_atomic_close('Synthetic callers and recovery reviewed before activation');
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; decision jsonb:='{"montoCents":1200,"metodo":"EFECTIVO","pagado":true}'; bad jsonb; BEGIN
 result:=public.close_turno_atomic(pg_temp.m120_id(10),pg_temp.m120_id(200),pg_temp.m120_id(100),15,'{"montoCents":1200,"metodo":"EFECTIVO","pagado":true}');
 IF NOT(result ?& ARRAY['turnoId','estado','closedAt','origen','clasificacion','pago','puedeRegistrar','operationId','pagoOrigen'])
 OR NOT((result->'pago') ?& ARRAY['id','montoCents','metodo','estado','pagadoTs','updatedAt'])
 OR result->>'clasificacion' IS DISTINCT FROM 'REGISTRADO' OR result#>>'{pago,estado}' IS DISTINCT FROM 'PAGADO'
 OR result->>'pagoOrigen' IS DISTINCT FROM 'CREADO' OR result#>>'{pago,montoCents}' IS DISTINCT FROM '1200' THEN RAISE EXCEPTION 'M120 explicit payment not confirmed'; END IF;
 IF (result#>>'{pago,updatedAt}')::timestamptz IS DISTINCT FROM (SELECT updated_at FROM pago WHERE turno_id=pg_temp.m120_id(100)) THEN RAISE EXCEPTION 'M120 payment freshness timestamp absent or fabricated'; END IF;
 IF pg_temp.m120_close(200,100,decision,15) IS DISTINCT FROM result OR pg_temp.m120_probe(200,100,'CLOSE',decision,15) IS DISTINCT FROM result THEN RAISE EXCEPTION 'M120 retry changed receipt'; END IF;
 PERFORM pg_temp.m120_expect($q$SELECT pg_temp.m120_close(200,100,'{"montoCents":1,"metodo":"EFECTIVO","pagado":true}',15)$q$,'40001');
 PERFORM pg_temp.m120_expect('SELECT pg_temp.m120_close(201,100)','55000');
 IF pg_temp.m120_probe(299,101,'CLOSE') IS NOT NULL THEN RAISE EXCEPTION 'M120 probe wrote an operation'; END IF;
 result:=pg_temp.m120_close(201,101,'{"montoCents":200,"metodo":"EFECTIVO","pagado":false}');
 IF result#>>'{pago,estado}' IS DISTINCT FROM 'PENDIENTE' OR result#>>'{pago,pagadoTs}' IS NOT NULL THEN RAISE EXCEPTION 'M120 explicit pending was treated as received'; END IF;
 result:=pg_temp.m120_close(202,102,'{"montoCents":0}');
 IF result->>'clasificacion' IS DISTINCT FROM 'SIN_CARGO' OR result->'pago' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'M120 explicit zero created payment'; END IF;
 result:=pg_temp.m120_close(203,103);
 IF result->>'clasificacion' IS DISTINCT FROM 'REQUIERE_REGISTRO' OR result->'pago' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'M120 absence invented financial decision'; END IF;
 PERFORM pg_temp.m120_expect($q$SELECT pg_temp.m120_close(204,104,'{"montoCents":400,"metodo":"EFECTIVO","pagado":true}')$q$,'40001');
 PERFORM pg_temp.m120_expect($q$SELECT pg_temp.m120_close(204,104,'{"montoCents":0}')$q$,'40001');
 result:=pg_temp.m120_close(204,104,'{"montoCents":400,"metodo":"EFECTIVO","pagado":false}');
 IF result->>'pagoOrigen'<>'EXISTENTE' OR result#>>'{pago,estado}'<>'PENDIENTE' THEN RAISE EXCEPTION 'M120 changed existing debt'; END IF;
 result:=pg_temp.m120_close(205,105);
 IF result->>'pagoOrigen'<>'EXISTENTE' OR result#>>'{pago,montoCents}'<>'500' THEN RAISE EXCEPTION 'M120 failed to report real prepayment'; END IF;
 FOR bad IN SELECT value FROM jsonb_array_elements('[null,[],{}, {"montoCents":"1"},{"montoCents":-1},{"montoCents":1.5},{"montoCents":2147483648},{"montoCents":0,"pagado":true},{"montoCents":10,"metodo":"BAD","pagado":true},{"montoCents":10,"metodo":"EFECTIVO","pagado":"true"},{"montoCents":10,"metodo":"EFECTIVO","pagado":true,"extra":1}]') LOOP
  PERFORM pg_temp.m120_expect(format('SELECT pg_temp.m120_close(206,106,%L::jsonb)',bad),'22023');
 END LOOP;
 PERFORM pg_temp.m120_expect('SELECT pg_temp.m120_close(206,106,NULL,-1)','22023');
 PERFORM pg_temp.m120_expect('SELECT pg_temp.m120_close(206,106,NULL,481)','22023');
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pago p JOIN payment_before b USING(id) WHERE to_jsonb(p) IS DISTINCT FROM to_jsonb(b)) THEN RAISE EXCEPTION 'M120 altered pre-existing payment fields'; END IF;
 IF (SELECT count(*) FROM pago WHERE turno_id IN(SELECT id FROM turno WHERE organization_id=pg_temp.m120_id(10)))<>4 OR (SELECT count(*) FROM folio_close_private.receipt)<>6
 OR (SELECT count(*) FROM transicion WHERE to_estado='CERRADO')<>6 OR (SELECT count(*) FROM recordatorio_job WHERE tipo='POST_VISITA')<>6
 OR EXISTS(SELECT 1 FROM recordatorio_job j JOIN folio_close_private.close_record c ON c.turno_id=j.turno_id WHERE j.scheduled_ts<>c.closed_at+interval '2 hours')
 OR NOT EXISTS(SELECT 1 FROM sesion WHERE turno_id=pg_temp.m120_id(100) AND revision=2 AND locked_at IS NOT NULL AND soap_s_cifrado='\x01')
 OR EXISTS(SELECT 1 FROM folio_close_private.authority) THEN RAISE EXCEPTION 'M120 stored effects/counts inconsistent'; END IF;
END $$;
-- Payment failure is AFTER the turno UPDATE and queue insertion: every effect,
-- including the M106 original lock/revision and transition log, must roll back.
CREATE FUNCTION pg_temp.m120_fail_payment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Synthetic payment failure'; END $$;
CREATE TRIGGER m120_failure BEFORE INSERT ON pago FOR EACH ROW EXECUTE FUNCTION pg_temp.m120_fail_payment();
SET LOCAL ROLE authenticated;
SELECT pg_temp.m120_expect($q$SELECT pg_temp.m120_close(206,106,'{"montoCents":600,"metodo":"EFECTIVO","pagado":true}')$q$,'23514');
RESET ROLE;
DROP TRIGGER m120_failure ON pago;
DO $$ BEGIN
 IF (SELECT estado FROM turno WHERE id=pg_temp.m120_id(106))<>'ATENDIENDO'
 OR NOT EXISTS(SELECT 1 FROM sesion WHERE turno_id=pg_temp.m120_id(106) AND revision=1 AND locked_at IS NULL)
 OR EXISTS(SELECT 1 FROM transicion WHERE turno_id=pg_temp.m120_id(106) AND to_estado='CERRADO')
 OR EXISTS(SELECT 1 FROM recordatorio_job WHERE turno_id=pg_temp.m120_id(106))
 OR EXISTS(SELECT 1 FROM folio_close_private.close_record WHERE turno_id=pg_temp.m120_id(106))
 OR EXISTS(SELECT 1 FROM folio_close_private.receipt WHERE operation_id=pg_temp.m120_id(206)) THEN RAISE EXCEPTION 'M120 payment failure left partial close'; END IF;
END $$;
CREATE FUNCTION pg_temp.m120_fail_queue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tipo='POST_VISITA' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Synthetic queue failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER m120_failure BEFORE INSERT ON recordatorio_job FOR EACH ROW EXECUTE FUNCTION pg_temp.m120_fail_queue();
SET LOCAL ROLE authenticated;
SELECT pg_temp.m120_expect('SELECT pg_temp.m120_close(206,106)','23514');
SELECT pg_temp.m120_expect($q$SELECT public.save_clinical_session(pg_temp.m120_id(10),pg_temp.m120_id(107),pg_temp.m120_id(14),pg_temp.m120_id(207),1,'CLOSE',repeat('a',64),'{"soap_s_cifrado":"\\x02"}',pg_temp.m120_context(107))$q$,'23514');
RESET ROLE;
DROP TRIGGER m120_failure ON recordatorio_job;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM turno WHERE id IN(pg_temp.m120_id(106),pg_temp.m120_id(107)) AND estado<>'ATENDIENDO')
 OR EXISTS(SELECT 1 FROM sesion WHERE turno_id IN(pg_temp.m120_id(106),pg_temp.m120_id(107)) AND (revision<>1 OR locked_at IS NOT NULL OR soap_s_cifrado<>'\x01'))
 OR EXISTS(SELECT 1 FROM folio_close_private.close_record WHERE turno_id IN(pg_temp.m120_id(106),pg_temp.m120_id(107)))
 OR EXISTS(SELECT 1 FROM recordatorio_job WHERE turno_id IN(pg_temp.m120_id(106),pg_temp.m120_id(107)))
 OR EXISTS(SELECT 1 FROM folio_close_private.receipt WHERE operation_id=pg_temp.m120_id(206))
 OR EXISTS(SELECT 1 FROM folio_session_private.receipt WHERE operation_id=pg_temp.m120_id(207)) THEN RAISE EXCEPTION 'M120 queue failure left clinical effects'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.save_clinical_session(pg_temp.m120_id(10),pg_temp.m120_id(107),pg_temp.m120_id(14),pg_temp.m120_id(207),1,'CLOSE',repeat('a',64),'{"soap_s_cifrado":"\\x02"}',pg_temp.m120_context(107));
 IF public.save_clinical_session(pg_temp.m120_id(10),pg_temp.m120_id(107),pg_temp.m120_id(14),pg_temp.m120_id(207),1,'CLOSE',repeat('a',64),NULL,pg_temp.m120_context(107)) IS DISTINCT FROM r THEN RAISE EXCEPTION 'M120 clinical retry changed original receipt'; END IF;
 IF public.get_turno_close_status(pg_temp.m120_id(10),pg_temp.m120_id(107))->>'clasificacion'<>'REQUIERE_REGISTRO' THEN RAISE EXCEPTION 'M120 clinical close invented payment'; END IF;
END $$;
RESET ROLE;
-- Freeze clinical/agenda/queue evidence before administrative recovery.
CREATE TEMP TABLE close_snapshot AS SELECT to_jsonb(t) AS t,to_jsonb(s) AS s,to_jsonb(j) AS j,c.closed_at
 FROM turno t JOIN sesion s ON s.turno_id=t.id JOIN recordatorio_job j ON j.turno_id=t.id JOIN folio_close_private.close_record c ON c.turno_id=t.id WHERE t.id=pg_temp.m120_id(107);
SELECT set_config('test.m120_uid',pg_temp.m120_id(4)::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 IF EXISTS(SELECT 1 FROM sesion WHERE turno_id=pg_temp.m120_id(107)) THEN RAISE EXCEPTION 'M120 assistant can read clinical original'; END IF;
 r:=pg_temp.m120_resolve(208,107,'{"montoCents":700,"metodo":"EFECTIVO","pagado":true}');
 IF pg_temp.m120_probe(208,107,'RESOLVE','{"montoCents":700,"metodo":"EFECTIVO","pagado":true}') IS DISTINCT FROM r THEN RAISE EXCEPTION 'M120 administrative receipt changed'; END IF;
 PERFORM pg_temp.m120_expect($q$SELECT pg_temp.m120_resolve(209,107,'{"montoCents":701,"metodo":"EFECTIVO","pagado":true}')$q$,'40001');
 PERFORM pg_temp.m120_resolve(209,103,'{"montoCents":0}');
 PERFORM pg_temp.m120_expect($q$SELECT pg_temp.m120_resolve(210,103,'{"montoCents":1,"metodo":"EFECTIVO","pagado":true}')$q$,'40001');
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM close_snapshot b,turno t JOIN sesion s ON s.turno_id=t.id JOIN recordatorio_job j ON j.turno_id=t.id JOIN folio_close_private.close_record c ON c.turno_id=t.id
 WHERE t.id=pg_temp.m120_id(107) AND (to_jsonb(t)<>b.t OR to_jsonb(s)<>b.s OR to_jsonb(j)<>b.j OR c.closed_at<>b.closed_at))
 OR (SELECT count(*) FROM folio_session_private.receipt WHERE operation_id=pg_temp.m120_id(207))<>1
 OR (SELECT count(*) FROM transicion WHERE turno_id=pg_temp.m120_id(107) AND to_estado='CERRADO')<>1 THEN RAISE EXCEPTION 'M120 administrative recovery mutated clinical/agenda/job history'; END IF;
END $$;
SELECT set_config('test.m120_uid',pg_temp.m120_id(5)::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=pg_temp.m120_close(211,108);
 IF r->>'clasificacion'<>'REQUIERE_REGISTRO' OR (r->>'puedeRegistrar')::boolean THEN RAISE EXCEPTION 'M120 coordinator close gained financial right'; END IF;
 IF public.get_turno_close_status(pg_temp.m120_id(10),pg_temp.m120_id(100))->'pago'<>'null'::jsonb THEN RAISE EXCEPTION 'M120 coordinator received payment details'; END IF;
 PERFORM pg_temp.m120_expect($q$SELECT pg_temp.m120_close(212,109,'{"montoCents":0}')$q$,'42501');
 PERFORM pg_temp.m120_expect($q$SELECT pg_temp.m120_resolve(212,108,'{"montoCents":0}')$q$,'42501');
 PERFORM pg_temp.m120_expect($q$SELECT folio_close_private.execute(pg_temp.m120_id(10),pg_temp.m120_id(212),pg_temp.m120_id(108),'RESOLVE',NULL,'{"montoCents":0}',false)$q$,'42501');
END $$;
RESET ROLE;
-- Professional scope stays own-only even when alcance is TODOS.
SELECT set_config('test.m120_uid',pg_temp.m120_id(3)::text,true);
UPDATE turno SET profesional_id=pg_temp.m120_id(31) WHERE id=pg_temp.m120_id(109);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m120_close(212,109,'{"montoCents":0}');
SELECT pg_temp.m120_expect('SELECT pg_temp.m120_close(213,110)','42501');
RESET ROLE;
UPDATE turno SET profesional_id=pg_temp.m120_id(11) WHERE id=pg_temp.m120_id(109);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m120_expect($q$SELECT pg_temp.m120_probe(212,109,'CLOSE','{"montoCents":0}')$q$,'42501');
RESET ROLE;
SELECT set_config('test.m120_uid',pg_temp.m120_id(6)::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m120_close(213,110,'{"montoCents":0}');
RESET ROLE;
SELECT set_config('test.m120_uid',pg_temp.m120_id(1)::text,true);
SAVEPOINT valid_actor;
UPDATE member SET deleted_at=now() WHERE id=pg_temp.m120_id(11);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m120_expect('SELECT pg_temp.m120_probe(203,103,''CLOSE'')','42501');
SELECT pg_temp.m120_expect('SELECT public.get_turno_close_status(pg_temp.m120_id(10),pg_temp.m120_id(103))','42501');
RESET ROLE;
ROLLBACK TO valid_actor;
UPDATE organization SET deleted_at=now() WHERE id=pg_temp.m120_id(10);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m120_expect('SELECT pg_temp.m120_probe(203,103,''CLOSE'')','42501');
RESET ROLE;
ROLLBACK TO valid_actor;
UPDATE member SET role='COORDINADOR' WHERE id=pg_temp.m120_id(11);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m120_expect('SELECT pg_temp.m120_probe(205,105,''CLOSE'')','42501');
RESET ROLE;
ROLLBACK TO valid_actor;
UPDATE member SET alcance='LISTA_PROFESIONALES',profesionales_gestionados=ARRAY[pg_temp.m120_id(31)::text] WHERE id=pg_temp.m120_id(41);
SELECT set_config('test.m120_uid',pg_temp.m120_id(4)::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m120_expect($q$SELECT pg_temp.m120_probe(208,107,'RESOLVE','{"montoCents":700,"metodo":"EFECTIVO","pagado":true}')$q$,'42501');
RESET ROLE;
ROLLBACK TO valid_actor;
SELECT set_config('test.m120_uid',pg_temp.m120_id(2)::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m120_expect('SELECT pg_temp.m120_close(214,111)','42501');
RESET ROLE;
SELECT set_config('test.m120_uid',pg_temp.m120_id(7)::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m120_expect('SELECT pg_temp.m120_close(214,111)','42501');
RESET ROLE;
-- AAL1 rejected on every public entry, even when an operation already committed.
SELECT set_config('test.m120_uid','',true);
DELETE FROM sesion WHERE turno_id=pg_temp.m120_id(115);
UPDATE turno SET precio_cents=0 WHERE id=pg_temp.m120_id(115);
INSERT INTO recordatorio_job(organization_id,turno_id,tipo,scheduled_ts,delivery_state,lease_token,lease_until)
 VALUES(pg_temp.m120_id(10),pg_temp.m120_id(115),'POST_VISITA','2026-01-01T10:00:00Z','leased',pg_temp.m120_id(900),now()+interval '1 hour');
CREATE TEMP TABLE preexisting_job AS SELECT to_jsonb(j) AS j FROM recordatorio_job j WHERE turno_id=pg_temp.m120_id(115);
SELECT set_config('test.m120_uid',pg_temp.m120_id(1)::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF pg_temp.m120_close(215,115)->>'clasificacion'<>'REQUIERE_REGISTRO' THEN RAISE EXCEPTION 'M120 zero list price inferred a no-charge decision'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM sesion WHERE turno_id=pg_temp.m120_id(115))
 OR EXISTS(SELECT 1 FROM preexisting_job b,recordatorio_job j WHERE j.turno_id=pg_temp.m120_id(115) AND to_jsonb(j)<>b.j) THEN RAISE EXCEPTION 'M120 close created clinical content or restarted leased job'; END IF;
END $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"aal":"aal1"}'::jsonb $$;
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
SET LOCAL ROLE authenticated;
SELECT pg_temp.m120_expect('SELECT pg_temp.m120_close(214,111)','42501');
SELECT pg_temp.m120_expect('SELECT pg_temp.m120_probe(203,103,''CLOSE'')','42501');
SELECT pg_temp.m120_expect('SELECT public.get_turno_close_status(pg_temp.m120_id(10),pg_temp.m120_id(103))','42501');
SELECT pg_temp.m120_expect($q$SELECT pg_temp.m120_resolve(214,108,'{"montoCents":0}')$q$,'42501');
RESET ROLE;
INSERT INTO auth.mfa_factors(id,user_id,status) VALUES(pg_temp.m120_id(800),pg_temp.m120_id(1),'verified');
INSERT INTO auth.sessions(id,user_id,aal,factor_id,not_after) VALUES(pg_temp.m120_id(801),pg_temp.m120_id(1),'aal2',pg_temp.m120_id(800),now()+interval '1 hour');
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"aal":"aal2","session_id":"12000000-0000-4000-8000-000000000801"}'::jsonb $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF pg_temp.m120_probe(203,103,'CLOSE') IS NULL THEN RAISE EXCEPTION 'M120 valid AAL2 receipt denied'; END IF;
END $$;
RESET ROLE;
UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=pg_temp.m120_id(801);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m120_expect('SELECT pg_temp.m120_probe(203,103,''CLOSE'')','42501');
RESET ROLE;
ROLLBACK;
