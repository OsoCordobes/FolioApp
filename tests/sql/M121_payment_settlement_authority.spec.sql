BEGIN;
\ir ../fixtures/M121_payment_settlement.sql
CREATE TEMP TABLE payments_before AS SELECT * FROM pago WHERE turno_id IN(SELECT id FROM turno WHERE organization_id=pg_temp.m121_id(10));
CREATE TEMP TABLE context_before AS SELECT t.id,to_jsonb(t) AS t,to_jsonb(s) AS s,to_jsonb(j) AS j,to_jsonb(c) AS c
 FROM turno t JOIN sesion s ON s.turno_id=t.id LEFT JOIN recordatorio_job j ON j.turno_id=t.id
 LEFT JOIN folio_close_private.close_record c ON c.turno_id=t.id WHERE t.organization_id=pg_temp.m121_id(10);
-- Disabled policy preserves the existing finance writer until cutover.
SET LOCAL ROLE authenticated;
UPDATE pago SET estado='PAGADO',pagado_ts='2026-01-01T10:00:00Z' WHERE id=pg_temp.m121_id(202);
SELECT pg_temp.m121_expect($q$SELECT public.enable_payment_settlement_authority('Unauthorized owner cannot activate this policy')$q$,'42501');
SELECT pg_temp.m121_expect($q$SELECT folio_settlement_private.enable('Unauthorized helper cannot activate this policy')$q$,'42501');
RESET ROLE;
SAVEPOINT missing_prerequisite;
UPDATE folio_close_private.policy SET enabled_at=NULL;
SELECT pg_temp.m121_expect($q$SELECT public.enable_payment_settlement_authority('Compatible callers require close prerequisite')$q$,'55000');
ROLLBACK TO missing_prerequisite;
SELECT pg_temp.m121_expect($q$SELECT public.enable_payment_settlement_authority('short')$q$,'22023');
SET LOCAL ROLE service_role;
SELECT public.enable_payment_settlement_authority('Compatible finance and closed agenda settlement callers verified');
SELECT public.enable_payment_settlement_authority('Idempotent repeated activation keeps original audit');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM folio_settlement_private.activation_history)<>1
 OR has_function_privilege('anon','public.settle_pago_atomic(uuid,uuid,uuid)','EXECUTE')
 OR has_function_privilege('service_role','public.settle_pago_atomic(uuid,uuid,uuid)','EXECUTE')
 OR has_table_privilege('authenticated','folio_settlement_private.authority','INSERT')
 OR has_table_privilege('authenticated','folio_settlement_private.policy','SELECT')
 OR (SELECT prosecdef FROM pg_proc WHERE oid='public.settle_pago_atomic(uuid,uuid,uuid)'::regprocedure) THEN RAISE EXCEPTION 'M121 exposed unsafe privileges'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; retry jsonb; BEGIN
 r:=pg_temp.m121_settle(100);
 IF r#>>'{pago,estado}' IS DISTINCT FROM 'PAGADO' OR r->>'alreadyPaid' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'M121 settlement did not confirm existing payment'; END IF;
 IF NOT(r ?& ARRAY['turnoId','alreadyPaid','pago']) OR NOT((r->'pago') ?& ARRAY['id','montoCents','metodo','estado','pagadoTs','updatedAt'])
 OR r#>>'{pago,id}' IS DISTINCT FROM pg_temp.m121_id(200)::text OR r#>>'{pago,montoCents}' IS DISTINCT FROM '1200'
 OR r#>>'{pago,metodo}' IS DISTINCT FROM 'EFECTIVO'
 OR (r#>>'{pago,pagadoTs}')::timestamptz IS DISTINCT FROM (SELECT pagado_ts FROM pago WHERE id=pg_temp.m121_id(200))
 OR (r#>>'{pago,updatedAt}')::timestamptz IS DISTINCT FROM (SELECT updated_at FROM pago WHERE id=pg_temp.m121_id(200)) THEN RAISE EXCEPTION 'M121 response is not real stored payment'; END IF;
 retry:=pg_temp.m121_settle(100);
 IF retry->>'alreadyPaid' IS DISTINCT FROM 'true' OR retry->'pago' IS DISTINCT FROM r->'pago' THEN RAISE EXCEPTION 'M121 idempotent retry changed paid timestamp'; END IF;
 IF pg_temp.m121_settle(101)#>>'{pago,estado}' IS DISTINCT FROM 'PAGADO' THEN RAISE EXCEPTION 'M121 existing PARCIAL was not settled'; END IF;
 r:=pg_temp.m121_settle(102);
 IF r->>'alreadyPaid' IS DISTINCT FROM 'true' OR (r#>>'{pago,pagadoTs}')::timestamptz IS DISTINCT FROM '2026-01-01T10:00:00Z'::timestamptz THEN RAISE EXCEPTION 'M121 old paid timestamp overwritten'; END IF;
 PERFORM pg_temp.m121_expect('SELECT public.settle_pago_atomic(NULL,pg_temp.m121_id(103),pg_temp.m121_id(203))','22023');
 PERFORM pg_temp.m121_expect('SELECT public.settle_pago_atomic(pg_temp.m121_id(10),NULL,pg_temp.m121_id(203))','22023');
 PERFORM pg_temp.m121_expect('SELECT public.settle_pago_atomic(pg_temp.m121_id(10),pg_temp.m121_id(103),NULL)','22023');
 PERFORM pg_temp.m121_expect('SELECT public.settle_pago_atomic(pg_temp.m121_id(20),pg_temp.m121_id(103),pg_temp.m121_id(203))','42501');
 PERFORM pg_temp.m121_expect('SELECT public.settle_pago_atomic(pg_temp.m121_id(10),pg_temp.m121_id(103),pg_temp.m121_id(204))','42501');
 PERFORM pg_temp.m121_expect('SELECT public.settle_pago_atomic(pg_temp.m121_id(10),pg_temp.m121_id(103),gen_random_uuid())','42501');
 -- These calls would alter or falsely acknowledge settlement outside the RPC.
 PERFORM pg_temp.m121_expect($q$UPDATE pago SET estado='PAGADO',pagado_ts=clock_timestamp() WHERE id=pg_temp.m121_id(203)$q$,'42501');
 PERFORM pg_temp.m121_expect($q$UPDATE pago SET estado=estado WHERE id=pg_temp.m121_id(203)$q$,'42501');
 PERFORM pg_temp.m121_expect($q$UPDATE pago SET notas='mixed forbidden',estado='PAGADO',pagado_ts=clock_timestamp() WHERE id=pg_temp.m121_id(203)$q$,'42501');
 PERFORM pg_temp.m121_expect($q$UPDATE pago SET pagado_ts=clock_timestamp() WHERE id=pg_temp.m121_id(200)$q$,'42501');
 PERFORM pg_temp.m121_expect($q$UPDATE pago SET estado='PENDIENTE',pagado_ts=NULL WHERE id=pg_temp.m121_id(200)$q$,'42501');
 PERFORM pg_temp.m121_expect('SELECT folio_settlement_private.assert_update_authority(pg_temp.m121_id(203))','42501');
 PERFORM set_config('folio.settlement_authorized','true',true);
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM pg_temp.m121_expect($q$UPDATE pago SET estado='PAGADO',pagado_ts=clock_timestamp() WHERE id=pg_temp.m121_id(203)$q$,'42501');
 -- Metadata changes and pre-existing finance prepayment semantics remain valid.
 UPDATE pago SET notas='metadata only allowed' WHERE id=pg_temp.m121_id(203);
 IF pg_temp.m121_settle(119)#>>'{pago,estado}' IS DISTINCT FROM 'PAGADO' THEN RAISE EXCEPTION 'M121 owner cannot settle existing open-visit payment'; END IF;
END $$;
RESET ROLE;
CREATE FUNCTION pg_temp.m121_unsafe_definer() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ UPDATE public.pago SET estado='PAGADO',pagado_ts=clock_timestamp() WHERE id=pg_temp.m121_id(203) $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT pg_temp.m121_unsafe_definer()','42501');
RESET ROLE;
-- A trigger from an unrelated metadata UPDATE cannot secretly settle either.
CREATE FUNCTION pg_temp.m121_changed_by_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.notas='synthetic indirect settlement' THEN NEW.estado:='PAGADO';NEW.pagado_ts:=clock_timestamp();END IF;RETURN NEW;
END $$;
CREATE TRIGGER m121_indirect BEFORE UPDATE ON pago FOR EACH ROW EXECUTE FUNCTION pg_temp.m121_changed_by_trigger();
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect($q$UPDATE pago SET notas='synthetic indirect settlement' WHERE id=pg_temp.m121_id(203)$q$,'42501');
RESET ROLE;
DROP TRIGGER m121_indirect ON pago;
CREATE FUNCTION pg_temp.m121_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Synthetic settlement storage failure';END $$;
CREATE TRIGGER m121_fail BEFORE UPDATE ON pago FOR EACH ROW EXECUTE FUNCTION pg_temp.m121_fail();
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT pg_temp.m121_settle(104)','23514');
RESET ROLE;
DROP TRIGGER m121_fail ON pago;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pago WHERE id=pg_temp.m121_id(204) AND estado='PENDIENTE' AND pagado_ts IS NULL)
 OR EXISTS(SELECT 1 FROM folio_settlement_private.authority) THEN RAISE EXCEPTION 'M121 failed UPDATE leaked payment or authority'; END IF;
END $$;
SELECT set_config('test.m121_uid',pg_temp.m121_id(5)::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT pg_temp.m121_settle(104)','42501');
SELECT pg_temp.m121_expect('SELECT pg_temp.m121_settle(100)','42501');
RESET ROLE;
SELECT set_config('test.m121_uid',pg_temp.m121_id(4)::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM sesion WHERE turno_id=pg_temp.m121_id(104)) THEN RAISE EXCEPTION 'M121 assistant reads clinical original'; END IF;
 IF pg_temp.m121_settle(104)#>>'{pago,estado}' IS DISTINCT FROM 'PAGADO' THEN RAISE EXCEPTION 'M121 scoped assistant denied'; END IF;
END $$;
SELECT pg_temp.m121_expect('SELECT pg_temp.m121_settle(120)','55000');
RESET ROLE;
UPDATE member SET alcance='LISTA_PROFESIONALES',profesionales_gestionados=ARRAY[pg_temp.m121_id(31)::text] WHERE id=pg_temp.m121_id(41);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT pg_temp.m121_settle(104)','42501');
RESET ROLE;
SELECT set_config('test.m121_uid',pg_temp.m121_id(3)::text,true);
UPDATE turno SET profesional_id=pg_temp.m121_id(31) WHERE id=pg_temp.m121_id(105);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_settle(105);
SELECT pg_temp.m121_expect('SELECT pg_temp.m121_settle(106)','42501');
RESET ROLE;
UPDATE turno SET profesional_id=pg_temp.m121_id(11) WHERE id=pg_temp.m121_id(105);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT pg_temp.m121_settle(105)','42501');
RESET ROLE;
SELECT set_config('test.m121_uid',pg_temp.m121_id(6)::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_settle(106);
RESET ROLE;
UPDATE member SET deleted_at=clock_timestamp() WHERE id=pg_temp.m121_id(61);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT pg_temp.m121_settle(106)','42501');
RESET ROLE;
SELECT set_config('test.m121_uid',pg_temp.m121_id(2)::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT pg_temp.m121_settle(107)','42501');
RESET ROLE;
SELECT set_config('test.m121_uid',pg_temp.m121_id(7)::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT pg_temp.m121_settle(107)','42501');
RESET ROLE;
SELECT set_config('test.m121_uid','',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT pg_temp.m121_settle(107)','42501');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.m121_expect('SELECT pg_temp.m121_settle(107)','42501');
RESET ROLE;
-- Explicitly trusted platform SQL maintenance retains its existing privileges.
GRANT SELECT,UPDATE ON pago TO service_role;
SET LOCAL ROLE service_role;
UPDATE pago SET estado='PAGADO',pagado_ts='2026-02-01T10:00:00Z' WHERE id=pg_temp.m121_id(207);
RESET ROLE;
SELECT set_config('test.m121_uid',pg_temp.m121_id(1)::text,true);
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"aal":"aal1"}'::jsonb $$;
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT pg_temp.m121_settle(100)','42501');
SELECT pg_temp.m121_expect('SELECT pg_temp.m121_settle(108)','42501');
RESET ROLE;
INSERT INTO auth.mfa_factors(id,user_id,status) VALUES(pg_temp.m121_id(800),pg_temp.m121_id(1),'verified');
INSERT INTO auth.sessions(id,user_id,aal,factor_id,not_after) VALUES(pg_temp.m121_id(801),pg_temp.m121_id(1),'aal2',pg_temp.m121_id(800),now()+interval '1 hour');
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"aal":"aal2","session_id":"12100000-0000-4000-8000-000000000801"}'::jsonb $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_settle(108);
RESET ROLE;
UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=pg_temp.m121_id(801);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT pg_temp.m121_settle(108)','42501');
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM folio_settlement_private.authority)
 OR (SELECT count(*) FROM pago WHERE turno_id IN(SELECT id FROM turno WHERE organization_id=pg_temp.m121_id(10)))<>21
 OR EXISTS(SELECT 1 FROM pago p JOIN payments_before b USING(id) WHERE (to_jsonb(p)-ARRAY['estado','pagado_ts','updated_at','notas']) IS DISTINCT FROM (to_jsonb(b)-ARRAY['estado','pagado_ts','updated_at','notas']))
 OR EXISTS(SELECT 1 FROM context_before b JOIN turno t ON t.id=b.id JOIN sesion s ON s.turno_id=t.id
  LEFT JOIN recordatorio_job j ON j.turno_id=t.id LEFT JOIN folio_close_private.close_record c ON c.turno_id=t.id
  WHERE (to_jsonb(t)-'updated_at') IS DISTINCT FROM (b.t-'updated_at') OR to_jsonb(s) IS DISTINCT FROM b.s OR to_jsonb(j) IS DISTINCT FROM b.j OR to_jsonb(c) IS DISTINCT FROM b.c)
 THEN RAISE EXCEPTION 'M121 changed unrelated payment/clinical/visit/queue data'; END IF;
END $$;
ROLLBACK;
