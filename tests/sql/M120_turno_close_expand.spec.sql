BEGIN;
\ir ../fixtures/M120_turno_close.sql
SAVEPOINT clinical_not_activated;
UPDATE folio_session_private.policy SET enabled_at=NULL;
SET LOCAL ROLE authenticated;
SELECT pg_temp.m120_expect('SELECT pg_temp.m120_close(199,125)','55000');
RESET ROLE;
ROLLBACK TO clinical_not_activated;
-- Additive rollout keeps the direct writer before enablement.
SET LOCAL ROLE authenticated;
UPDATE turno SET estado='CERRADO',atendiendo_desde=NULL WHERE id=pg_temp.m120_id(100);
INSERT INTO pago(turno_id,monto_cents,metodo,estado,pagado_ts) VALUES(pg_temp.m120_id(100),100,'EFECTIVO','PAGADO',now());
UPDATE turno SET estado='CERRADO' WHERE id=pg_temp.m120_id(100);
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM transicion WHERE turno_id=pg_temp.m120_id(100) AND to_estado='CERRADO')<>1
 OR (SELECT count(*) FROM recordatorio_job WHERE turno_id=pg_temp.m120_id(100) AND tipo='POST_VISITA')<>1
 OR (SELECT clasificacion FROM folio_close_private.close_record WHERE turno_id=pg_temp.m120_id(100))<>'REGISTRADO'
 OR public.get_turno_close_status(pg_temp.m120_id(10),pg_temp.m120_id(100))->>'clasificacion'<>'REGISTRADO' THEN RAISE EXCEPTION 'M120 additive writer or status broken'; END IF;
 IF has_function_privilege('anon','public.close_turno_atomic(uuid,uuid,uuid,integer,jsonb)','EXECUTE')
 OR has_function_privilege('service_role','public.close_turno_atomic(uuid,uuid,uuid,integer,jsonb)','EXECUTE')
 OR has_function_privilege('authenticated','public.enable_turno_atomic_close(text)','EXECUTE')
 OR has_function_privilege('authenticated','folio_close_private.enable(text)','EXECUTE')
 OR has_function_privilege('authenticated','folio_close_private.authorize(uuid,public.turno,boolean)','EXECUTE')
 OR has_table_privilege('authenticated','folio_close_private.authority','INSERT')
 OR has_table_privilege('authenticated','folio_close_private.receipt','SELECT')
 OR (SELECT prosecdef FROM pg_proc WHERE oid='public.close_turno_atomic(uuid,uuid,uuid,integer,jsonb)'::regprocedure)
 THEN RAISE EXCEPTION 'M120 exposed privilege or private data'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.m120_expect($q$SELECT public.enable_turno_atomic_close('Unauthorized owner activation attempt')$q$,'42501');
SELECT pg_temp.m120_expect($q$SELECT folio_close_private.enable('Unauthorized private helper attempt')$q$,'42501');
RESET ROLE;
-- Historical recovery: no exact first-close time available, and no old job sent.
DELETE FROM folio_close_private.close_record WHERE turno_id=pg_temp.m120_id(100);
DELETE FROM recordatorio_job WHERE turno_id=pg_temp.m120_id(100);
SET LOCAL ROLE service_role;
SELECT public.enable_turno_atomic_close('Compatible agenda, clinical and recovery callers verified');
SELECT public.enable_turno_atomic_close('Repeated activation does not replace the first audit');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.m120_expect($q$UPDATE turno SET estado='CERRADO' WHERE id=pg_temp.m120_id(101)$q$,'42501');
-- Legacy clinical follow-up fails before it can reach its automatic pago upsert.
SELECT pg_temp.m120_expect($q$UPDATE turno SET estado='CERRADO' WHERE id=pg_temp.m120_id(100)$q$,'42501');
SELECT set_config('folio.close_authorized','true',true);
SELECT set_config('folio.session_mode','WRITE',true);
SELECT pg_temp.m120_expect($q$UPDATE turno SET estado='CERRADO' WHERE id=pg_temp.m120_id(101)$q$,'42501');
SELECT pg_temp.m120_expect($q$INSERT INTO pago(turno_id,monto_cents,metodo,estado,pagado_ts) VALUES(pg_temp.m120_id(101),100,'EFECTIVO','PAGADO',now()) ON CONFLICT(turno_id) DO NOTHING$q$,'42501');
SELECT pg_temp.m120_expect($q$INSERT INTO pago(turno_id,monto_cents,metodo,estado,pagado_ts) VALUES(pg_temp.m120_id(100),100,'EFECTIVO','PAGADO',now()) ON CONFLICT(turno_id) DO NOTHING$q$,'42501');
SELECT pg_temp.m120_expect($q$UPDATE pago SET turno_id=pg_temp.m120_id(101) WHERE turno_id=pg_temp.m120_id(100)$q$,'42501');
DO $$ DECLARE r jsonb; BEGIN
 r:=pg_temp.m120_resolve(200,100,'{"montoCents":100,"metodo":"EFECTIVO","pagado":true}');
 IF r->>'closedAt' IS NOT NULL OR r->>'origen'<>'HISTORICO' OR r->>'pagoOrigen'<>'EXISTENTE' THEN RAISE EXCEPTION 'M120 historical recovery invented closure time'; END IF;
 PERFORM pg_temp.m120_close(201,101,'{"montoCents":100,"metodo":"EFECTIVO","pagado":false}');
 -- Existing settlement UPDATE remains usable after activation.
 UPDATE pago SET estado='PAGADO',pagado_ts=clock_timestamp() WHERE turno_id=pg_temp.m120_id(101);
END $$;
RESET ROLE;
-- Existing terminal/enviado/lease metadata must survive a repeated operation.
UPDATE recordatorio_job SET delivery_state='terminal',enviado_ts=clock_timestamp(),intentos=2,error_msg='synthetic completed'
 WHERE turno_id=pg_temp.m120_id(101);
CREATE TEMP TABLE job_before AS SELECT to_jsonb(j) AS j FROM recordatorio_job j WHERE turno_id=pg_temp.m120_id(101);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m120_close(201,101,'{"montoCents":100,"metodo":"EFECTIVO","pagado":false}');
DO $$ BEGIN
 IF public.get_turno_close_status(pg_temp.m120_id(10),pg_temp.m120_id(101))#>>'{pago,estado}'<>'PAGADO' THEN RAISE EXCEPTION 'M120 current status freezes historical receipt'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM folio_close_private.activation_history)<>1
 OR EXISTS(SELECT 1 FROM recordatorio_job WHERE turno_id=pg_temp.m120_id(100))
 OR EXISTS(SELECT 1 FROM job_before b,recordatorio_job j WHERE j.turno_id=pg_temp.m120_id(101) AND to_jsonb(j)<>b.j)
 OR EXISTS(SELECT 1 FROM folio_close_private.authority) THEN RAISE EXCEPTION 'M120 activation/recovery/retry changed durable job'; END IF;
END $$;
ROLLBACK;
