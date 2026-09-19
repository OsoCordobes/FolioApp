-- SQL-only synthetic authorization fixture; does not claim live Auth coverage.
BEGIN;
\ir ../fixtures/M121_payment_settlement.sql
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.m123_jwt',true),''),'{}')::jsonb $$;
INSERT INTO auth.mfa_factors(id,user_id,status)
 SELECT pg_temp.m121_id(800+n),pg_temp.m121_id(n),'verified' FROM generate_series(1,7) n;
INSERT INTO auth.sessions(id,user_id,aal,factor_id)
 SELECT pg_temp.m121_id(900+n),pg_temp.m121_id(n),'aal2',pg_temp.m121_id(800+n) FROM generate_series(1,7) n;
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
CREATE FUNCTION pg_temp.m123_login(n integer,aal text DEFAULT 'aal2') RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('test.m121_uid',pg_temp.m121_id(n)::text,true);
 PERFORM set_config('test.m123_jwt',jsonb_build_object('aal',aal,'session_id',pg_temp.m121_id(900+n))::text,true);
END $$;
SELECT pg_temp.m123_login(1);
UPDATE turno SET profesional_id=pg_temp.m121_id(31) WHERE id=pg_temp.m121_id(101);
SELECT pg_temp.m123_login(5);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM turno WHERE id=pg_temp.m121_id(100)) THEN RAISE EXCEPTION 'M123 fixture coordinator lost operational scope';END IF;
 IF EXISTS(SELECT 1 FROM pago WHERE turno_id=pg_temp.m121_id(100)) THEN RAISE EXCEPTION 'M123 FAIL: coordinator can read payment';END IF;
END $$;
RESET ROLE;
-- SELECT is restricted even when another permissive FOR ALL policy applies.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.pago'::regclass AND polname='pago_select_financial_role'
  AND NOT polpermissive AND polcmd='r' AND polroles=ARRAY['authenticated'::regrole::oid])
 THEN RAISE EXCEPTION 'M123 restrictive SELECT role boundary missing';END IF;
END $$;
-- Preserve the authorized financial readers and the existing visible-turno scope.
SELECT pg_temp.m123_login(4);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF (SELECT count(*) FROM pago)<>21 THEN RAISE EXCEPTION 'M123 assistant lost authorized payments';END IF;END $$;
RESET ROLE;
SELECT pg_temp.m123_login(1);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF (SELECT count(*) FROM pago)<>21 THEN RAISE EXCEPTION 'M123 owner lost authorized payments';END IF;END $$;
RESET ROLE;
SELECT pg_temp.m123_login(6);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF (SELECT count(*) FROM pago)<>21 THEN RAISE EXCEPTION 'M123 director lost authorized payments';END IF;END $$;
RESET ROLE;
SELECT pg_temp.m123_login(3);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM pago)<>1 OR NOT EXISTS(SELECT 1 FROM pago WHERE id=pg_temp.m121_id(201))
 THEN RAISE EXCEPTION 'M123 scoped professional payment boundary changed';END IF;
END $$;
RESET ROLE;
SELECT pg_temp.m123_login(1);
UPDATE member SET alcance='LISTA_PROFESIONALES',profesionales_gestionados=ARRAY[pg_temp.m121_id(31)::text] WHERE id=pg_temp.m121_id(41);
SELECT pg_temp.m123_login(4);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM pago)<>1 OR NOT EXISTS(SELECT 1 FROM pago WHERE id=pg_temp.m121_id(201))
 THEN RAISE EXCEPTION 'M123 payment professional scope changed';END IF;
END $$;
RESET ROLE;
SELECT pg_temp.m123_login(2);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pago) THEN RAISE EXCEPTION 'M123 foreign organization payment exposed';END IF;END $$;
RESET ROLE;
SELECT pg_temp.m123_login(4,'aal1');
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pago) THEN RAISE EXCEPTION 'M123 AAL1 payment exposed';END IF;END $$;
RESET ROLE;
SELECT pg_temp.m123_login(4);
DELETE FROM auth.sessions WHERE id=pg_temp.m121_id(904);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pago) THEN RAISE EXCEPTION 'M123 revoked session payment exposed';END IF;END $$;
RESET ROLE;
SELECT 'M123 PASS: coordinator denied; financial readers/scope/foreign/MFA preserved';
ROLLBACK;
