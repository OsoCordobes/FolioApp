-- Synthetic screen inventory and revocation, rolled back after each CI run.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.caller_list_screens(uuid,timestamptz,uuid,integer)') IS NULL
  OR has_function_privilege('anon','public.caller_list_screens(uuid,timestamptz,uuid,integer)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.caller_list_screens(uuid,timestamptz,uuid,integer)','EXECUTE')
  OR has_table_privilege('authenticated','folio_caller_private.screen','SELECT') THEN
  RAISE EXCEPTION 'M141 screen inventory grant boundary changed';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m141_uid',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.m141_jwt',true),''),'{}')::jsonb $$;
CREATE FUNCTION pg_temp.m141_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('14100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.m141_login(n integer,aal text DEFAULT 'aal2') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('test.m141_uid',pg_temp.m141_id(n)::text,true);
 PERFORM set_config('test.m141_jwt',jsonb_build_object('aal',aal,'session_id',pg_temp.m141_id(900+n))::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
END $$;
CREATE FUNCTION pg_temp.m141_expect(query text,code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE query;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE=code THEN RETURN;END IF;
  RAISE EXCEPTION 'M141 expected %, got %',code,SQLSTATE;
 END;
 RAISE EXCEPTION 'M141 expected failure %, statement succeeded',code;
END $$;
INSERT INTO auth.users(id,email) SELECT pg_temp.m141_id(n),'m141-'||n||'@synthetic.invalid' FROM generate_series(1,4) n;
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version)
 SELECT pg_temp.m141_id(n),'m141-'||n||'@synthetic.invalid',now(),'v1' FROM generate_series(1,4) n;
INSERT INTO public.organization(id,slug,nombre,timezone) VALUES
 (pg_temp.m141_id(10),'m141-one','Synthetic One','America/Argentina/Cordoba'),
 (pg_temp.m141_id(20),'m141-two','Synthetic Two','America/Argentina/Cordoba');
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at,alcance,profesionales_gestionados) VALUES
 (pg_temp.m141_id(11),pg_temp.m141_id(10),pg_temp.m141_id(1),'OWNER',true,now(),'TODOS','{}'),
 (pg_temp.m141_id(12),pg_temp.m141_id(10),pg_temp.m141_id(2),'DIRECTOR',false,now(),'TODOS','{}'),
 (pg_temp.m141_id(13),pg_temp.m141_id(10),pg_temp.m141_id(3),'PROFESIONAL',true,now(),'TODOS','{}'),
 (pg_temp.m141_id(21),pg_temp.m141_id(20),pg_temp.m141_id(4),'OWNER',true,now(),'TODOS','{}');
INSERT INTO auth.mfa_factors(id,user_id,status)
 SELECT pg_temp.m141_id(800+n),pg_temp.m141_id(n),'verified' FROM generate_series(1,4) n;
INSERT INTO auth.sessions(id,user_id,aal,factor_id)
 SELECT pg_temp.m141_id(900+n),pg_temp.m141_id(n),'aal2',pg_temp.m141_id(800+n) FROM generate_series(1,4) n;
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
INSERT INTO folio_caller_private.screen(id,organization_id,issuer_id,operation_id,pair_hash,pair_expires_at,pair_used_at,token_hash,token_expires_at,created_at) VALUES
 (pg_temp.m141_id(100),pg_temp.m141_id(10),pg_temp.m141_id(11),pg_temp.m141_id(200),sha256(convert_to('m141-one','UTF8')),now()+interval '5 min',now(),sha256(convert_to('m141-token','UTF8')),now()+interval '12 hours',now()-interval '3 min'),
 (pg_temp.m141_id(101),pg_temp.m141_id(10),pg_temp.m141_id(12),pg_temp.m141_id(201),sha256(convert_to('m141-two','UTF8')),now()+interval '5 min',NULL,NULL,NULL,now()-interval '2 min'),
 (pg_temp.m141_id(102),pg_temp.m141_id(10),pg_temp.m141_id(12),pg_temp.m141_id(202),sha256(convert_to('m141-three','UTF8')),now()-interval '5 min',NULL,NULL,NULL,now()-interval '1 min'),
 (pg_temp.m141_id(103),pg_temp.m141_id(20),pg_temp.m141_id(21),pg_temp.m141_id(203),sha256(convert_to('m141-other','UTF8')),now()+interval '5 min',NULL,NULL,NULL,now());

SELECT pg_temp.m141_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE first jsonb; second jsonb; all_items jsonb;
BEGIN
 first:=public.caller_list_screens(pg_temp.m141_id(10),NULL,NULL,2);
 second:=public.caller_list_screens(pg_temp.m141_id(10),(first->'nextCursor'->>'createdAt')::timestamptz,(first->'nextCursor'->>'screenId')::uuid,2);
 all_items:=public.caller_list_screens(pg_temp.m141_id(10),NULL,NULL,20);
 IF jsonb_array_length(first->'screens')<>2 OR first->'nextCursor' IS NULL
  OR jsonb_array_length(second->'screens')<>1 OR second->'nextCursor'<>'null'::jsonb
  OR jsonb_array_length(all_items->'screens')<>3
  OR (all_items->'screens'->0->>'status') IS DISTINCT FROM 'vencida'
  OR (all_items->'screens'->1->>'status') IS DISTINCT FROM 'pendiente'
  OR (all_items->'screens'->2->>'status') IS DISTINCT FROM 'activa'
  OR all_items::text LIKE '%m141-token%' OR all_items::text LIKE '%pair_hash%'
  OR all_items::text LIKE '%'||pg_temp.m141_id(103)::text||'%' THEN
  RAISE EXCEPTION 'M141 bounded inventory or redaction changed';
 END IF;
 PERFORM pg_temp.m141_expect('SELECT public.caller_list_screens(pg_temp.m141_id(20),NULL,NULL,20)','42501');
 PERFORM pg_temp.m141_expect('SELECT public.caller_list_screens(pg_temp.m141_id(10),NULL,NULL,51)','22023');
 PERFORM pg_temp.m141_expect('SELECT public.caller_list_screens(pg_temp.m141_id(10),now(),NULL,20)','22023');
END $$;
RESET ROLE;

-- A fresh read after reloading settings must still find and revoke the active screen.
SELECT pg_temp.m141_login(2);
SET LOCAL ROLE authenticated;
DO $$ DECLARE listed jsonb; after_revoke jsonb;
BEGIN
 listed:=public.caller_list_screens(pg_temp.m141_id(10),NULL,NULL,20);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(listed->'screens') e
  WHERE e->>'screenId'=pg_temp.m141_id(100)::text AND e->>'status'='activa') THEN
  RAISE EXCEPTION 'M141 reload lost active screen';
 END IF;
 PERFORM public.caller_revoke_screen(pg_temp.m141_id(10),pg_temp.m141_id(100));
 after_revoke:=public.caller_list_screens(pg_temp.m141_id(10),NULL,NULL,20);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(after_revoke->'screens') e
  WHERE e->>'screenId'=pg_temp.m141_id(100)::text AND e->>'status'='revocada') THEN
  RAISE EXCEPTION 'M141 revoked screen remained active';
 END IF;
END $$;
RESET ROLE;

SELECT pg_temp.m141_login(3);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m141_expect('SELECT public.caller_list_screens(pg_temp.m141_id(10),NULL,NULL,20)','42501');
RESET ROLE;
SELECT pg_temp.m141_login(1,'aal1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.m141_expect('SELECT public.caller_list_screens(pg_temp.m141_id(10),NULL,NULL,20)','42501');
RESET ROLE;
SELECT pg_temp.m141_login(1);
SAVEPOINT issuer_revoked;
UPDATE public.member SET deleted_at=now() WHERE id=pg_temp.m141_id(12);
SET LOCAL ROLE authenticated;
DO $$ DECLARE listed jsonb;
BEGIN
 listed:=public.caller_list_screens(pg_temp.m141_id(10),NULL,NULL,20);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(listed->'screens') e
  WHERE e->>'screenId'=pg_temp.m141_id(101)::text AND e->>'status'='revocada') THEN
  RAISE EXCEPTION 'M141 revoked issuer screen remains pending';
 END IF;
END $$;
RESET ROLE;
ROLLBACK TO issuer_revoked;
ROLLBACK;
