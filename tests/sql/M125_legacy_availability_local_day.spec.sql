-- Rollback-only contract for the legacy availability bridge after M101/M113.
-- Deliberately choose a session day different from the Cordoba day: M97's
-- implicit CURRENT_DATE used to make a newly saved week look future-dated.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.reemplazar_disponibilidad(uuid,uuid,jsonb)') IS NULL
 OR to_regprocedure('public.read_availability_snapshot(uuid,uuid)') IS NULL
 OR to_regprocedure('public.save_availability_revision(uuid,uuid,bigint,uuid,text,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'M125 requires the legacy and versioned availability writers';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m125_uid',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.m125_jwt',true),''),'{}')::jsonb $$;
INSERT INTO auth.users(id,email,email_confirmed_at)
 VALUES('12500000-0000-4000-8000-000000000001','m125-owner@synthetic.invalid',now());
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version)
 VALUES('12500000-0000-4000-8000-000000000001','m125-owner@synthetic.invalid',now(),'synthetic');
INSERT INTO public.organization(id,slug,nombre,is_synthetic)
 VALUES('12500000-0000-4000-8000-000000000010','m125-synthetic','M125 synthetic',true);
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at)
 VALUES('12500000-0000-4000-8000-000000000011','12500000-0000-4000-8000-000000000010',
  '12500000-0000-4000-8000-000000000001','OWNER',true,now());
INSERT INTO auth.mfa_factors(id,user_id,status)
 VALUES('12500000-0000-4000-8000-000000000040','12500000-0000-4000-8000-000000000001','verified');
INSERT INTO auth.sessions(id,user_id,aal,factor_id)
 VALUES('12500000-0000-4000-8000-000000000030','12500000-0000-4000-8000-000000000001',
  'aal2','12500000-0000-4000-8000-000000000040');
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
SELECT set_config('test.m125_uid','12500000-0000-4000-8000-000000000001',true);
SELECT set_config('test.m125_jwt',
 '{"aal":"aal1","session_id":"12500000-0000-4000-8000-000000000030"}',true);

DO $$ BEGIN
 IF has_function_privilege('anon','public.reemplazar_disponibilidad(uuid,uuid,jsonb)','EXECUTE')
 OR has_function_privilege('service_role','public.reemplazar_disponibilidad(uuid,uuid,jsonb)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.reemplazar_disponibilidad(uuid,uuid,jsonb)','EXECUTE')
 OR NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.reemplazar_disponibilidad(uuid,uuid,jsonb)'::regprocedure)
 THEN RAISE EXCEPTION 'M125 legacy writer privileges changed';END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.reemplazar_disponibilidad(
   '12500000-0000-4000-8000-000000000010','12500000-0000-4000-8000-000000000011',
   '[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"12:00"}]');
  RAISE EXCEPTION 'M125 AAL1 legacy writer bypassed MFA';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM IS DISTINCT FROM 'mfa_required' THEN RAISE;END IF;
 END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.disponibilidad_profesional
  WHERE organization_id='12500000-0000-4000-8000-000000000010')
 THEN RAISE EXCEPTION 'M125 denied write changed availability';END IF;
END $$;

SELECT set_config('test.m125_jwt',
 '{"aal":"aal2","session_id":"12500000-0000-4000-8000-000000000030"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE
 original_tz text:=current_setting('TimeZone');
 cordoba_day date:=(now() AT TIME ZONE 'America/Argentina/Cordoba')::date;
 forced_tz text;
 snapshot jsonb;
BEGIN
 forced_tz:=CASE WHEN (now() AT TIME ZONE 'Pacific/Kiritimati')::date<>cordoba_day
  THEN 'Pacific/Kiritimati' ELSE 'Etc/GMT+12' END;
 PERFORM set_config('TimeZone',forced_tz,true);
 IF current_date=cordoba_day THEN RAISE EXCEPTION 'M125 failed to force a mismatched session day';END IF;
 PERFORM public.reemplazar_disponibilidad(
  '12500000-0000-4000-8000-000000000010','12500000-0000-4000-8000-000000000011',
  '[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"12:00"}]');
 PERFORM set_config('TimeZone',original_tz,true);
 snapshot:=public.read_availability_snapshot(
  '12500000-0000-4000-8000-000000000010','12500000-0000-4000-8000-000000000011');
 IF (snapshot->>'protectedDates')::boolean IS DISTINCT FROM false
  OR jsonb_array_length(snapshot->'franjas')<>1
  OR snapshot->'franjas'->0->>'hora_inicio' IS DISTINCT FROM '09:00' THEN
  RAISE EXCEPTION 'M125 legacy week is not visible to versioned editor: %',snapshot;
 END IF;
END $$;
RESET ROLE;

-- A failed legacy INSERT must roll back its preceding DELETE and revision bump.
CREATE FUNCTION pg_temp.m125_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.organization_id='12500000-0000-4000-8000-000000000010' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Synthetic failure after delete';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER m125_fail_insert BEFORE INSERT ON public.disponibilidad_profesional
 FOR EACH ROW EXECUTE FUNCTION pg_temp.m125_fail_insert();
SET LOCAL ROLE authenticated;
DO $$ DECLARE before_snapshot jsonb;BEGIN
 before_snapshot:=public.read_availability_snapshot(
  '12500000-0000-4000-8000-000000000010','12500000-0000-4000-8000-000000000011');
 BEGIN
  PERFORM public.reemplazar_disponibilidad(
   '12500000-0000-4000-8000-000000000010','12500000-0000-4000-8000-000000000011',
   '[{"dia_semana":2,"hora_inicio":"10:00","hora_fin":"13:00"}]');
  RAISE EXCEPTION 'M125 legacy writer committed a partial replacement';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 IF public.read_availability_snapshot(
  '12500000-0000-4000-8000-000000000010','12500000-0000-4000-8000-000000000011')
  IS DISTINCT FROM before_snapshot THEN
  RAISE EXCEPTION 'M125 failed legacy replacement lost schedule or revision';
 END IF;
END $$;
RESET ROLE;
DROP TRIGGER m125_fail_insert ON public.disponibilidad_profesional;

SET LOCAL ROLE authenticated;
DO $$ DECLARE snapshot jsonb;receipt jsonb;BEGIN
 snapshot:=public.read_availability_snapshot(
  '12500000-0000-4000-8000-000000000010','12500000-0000-4000-8000-000000000011');
 receipt:=public.save_availability_revision(
  '12500000-0000-4000-8000-000000000010','12500000-0000-4000-8000-000000000011',
  (snapshot->>'revision')::bigint,gen_random_uuid(),repeat('a',64),'[]'::jsonb);
 IF (receipt->>'count')::integer IS DISTINCT FROM 0 THEN
  RAISE EXCEPTION 'M125 versioned writer could not replace legacy week';END IF;
END $$;
RESET ROLE;
SELECT 'M125 PASS: legacy local day, MFA gate, and versioned handoff';
ROLLBACK;
