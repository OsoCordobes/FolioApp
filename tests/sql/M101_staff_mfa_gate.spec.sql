-- Synthetic Auth/JWT rows verify database authorization, not real GoTrue tokens.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m101_uid',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.m101_jwt',true),''),'{}')::jsonb $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('10100000-0000-4000-8000-000000000001','m101-staff@spec.invalid',now()),
 ('10100000-0000-4000-8000-000000000002','m101-patient@spec.invalid',now());
INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version)
VALUES('10100000-0000-4000-8000-000000000001','m101-staff@spec.invalid',now(),'v1');
INSERT INTO organization(id,slug,nombre) VALUES
 ('10100000-0000-4000-8000-000000000010','m101-test','M101 synthetic');
INSERT INTO member(id,organization_id,profile_id,role,accepted_at) VALUES
 ('10100000-0000-4000-8000-000000000011','10100000-0000-4000-8000-000000000010','10100000-0000-4000-8000-000000000001','OWNER',now());
INSERT INTO paciente_cuenta(id,auth_user_id,email) VALUES
 ('10100000-0000-4000-8000-000000000020','10100000-0000-4000-8000-000000000001','m101-staff@spec.invalid'),
 ('10100000-0000-4000-8000-000000000021','10100000-0000-4000-8000-000000000002','m101-patient@spec.invalid');
INSERT INTO auth.sessions(id,user_id) VALUES
 ('10100000-0000-4000-8000-000000000030','10100000-0000-4000-8000-000000000001');
SELECT set_config('test.m101_uid','10100000-0000-4000-8000-000000000001',true);
SELECT set_config('test.m101_jwt','{"aal":"aal1","session_id":"10100000-0000-4000-8000-000000000030","user_metadata":{"aal":"aal2","isStaff":false}}',true);
DO $$ BEGIN
 IF (public.mfa_access_status()->>'required')::boolean THEN RAISE EXCEPTION 'M101: migration unexpectedly activates global policy'; END IF;
 BEGIN
  PERFORM public.mfa_set_staff_enforcement(now(),'Synthetic rollout verification reason');
  RAISE EXCEPTION 'M101: activation permitted before enrolling all staff';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- Force an activated policy only inside this rollback-only fixture.
INSERT INTO auth.mfa_factors(id,user_id,status) VALUES
 ('10100000-0000-4000-8000-000000000040','10100000-0000-4000-8000-000000000001','verified');
DO $$ BEGIN
 IF (public.mfa_access_status()->>'required')::boolean THEN RAISE EXCEPTION 'M101: existing factor blocks migration-before-code rollout'; END IF;
 PERFORM public.mfa_enable_preparation('Synthetic deployed UI readiness verification');
 IF NOT (public.mfa_access_status()->>'required')::boolean OR (public.mfa_access_status()->>'allowed')::boolean THEN
  RAISE EXCEPTION 'M101: preparation does not protect enrolled accounts';
 END IF;
END $$;
DELETE FROM auth.mfa_factors WHERE id='10100000-0000-4000-8000-000000000040';
DO $$ BEGIN
 BEGIN
  PERFORM public.mfa_set_staff_enforcement(now(),'Synthetic staff enrollment prerequisite verification');
  RAISE EXCEPTION 'M101: prepared policy activation allows staff without factors';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
GRANT SELECT ON public.organization,public.paciente_cuenta TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (public.mfa_access_status()->>'allowed')::boolean THEN RAISE EXCEPTION 'M101: AAL1 staff/dual account allowed'; END IF;
 BEGIN
  PERFORM public.paciente_cuenta_actual();
  RAISE EXCEPTION 'M101: dual account bypasses MFA via portal SECURITY DEFINER';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.pseudonimizar_member(p_motivo=>'Synthetic reason with required length');
  RAISE EXCEPTION 'M101: privileged mutation with default argument bypasses MFA';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.mfa_set_staff_enforcement(null,'Attempt to remove security by account owner');
  RAISE EXCEPTION 'M101: user can disable the policy';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM 1 FROM organization WHERE id='10100000-0000-4000-8000-000000000010';
  IF FOUND THEN RAISE EXCEPTION 'M101: RLS exposes rows at AAL1'; END IF;
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- Even a permissive Storage policy cannot override the restrictive MFA gate.
INSERT INTO storage.buckets(id,name) VALUES('m101-private','m101-private');
INSERT INTO storage.objects(bucket_id,name) VALUES('m101-private','synthetic.txt');
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT,INSERT ON storage.objects TO authenticated;
CREATE POLICY m101_test_allow ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='m101-private') THEN RAISE EXCEPTION 'M101: AAL1 Storage read allowed'; END IF;
 BEGIN
  INSERT INTO storage.objects(bucket_id,name) VALUES('m101-private','blocked.txt');
  RAISE EXCEPTION 'M101: AAL1 Storage write allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- Patient-only accounts have a different policy; selected route/org has no effect.
SELECT set_config('test.m101_uid','10100000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT (public.mfa_access_status()->>'allowed')::boolean THEN RAISE EXCEPTION 'M101: patient-only login unexpectedly blocked'; END IF;
 IF public.paciente_cuenta_actual() IS DISTINCT FROM '10100000-0000-4000-8000-000000000021'::uuid THEN RAISE EXCEPTION 'M101: legitimate patient account lookup lost'; END IF;
END $$;
RESET ROLE;
SELECT set_config('test.m101_uid','10100000-0000-4000-8000-000000000001',true);
INSERT INTO auth.mfa_factors(id,user_id,status) VALUES
 ('10100000-0000-4000-8000-000000000040','10100000-0000-4000-8000-000000000001','verified');
SELECT set_config('test.m101_jwt','{"aal":"aal2","session_id":"10100000-0000-4000-8000-000000000030"}',true);
UPDATE auth.sessions SET aal='aal2',factor_id='10100000-0000-4000-8000-000000000040'
WHERE id='10100000-0000-4000-8000-000000000030';
SELECT public.mfa_set_staff_enforcement(now(),'Synthetic completed enrollment rollout verification');
DO $$ BEGIN
 IF (SELECT count(*) FROM folio_mfa_private.policy_history)<>2 THEN RAISE EXCEPTION 'M101: preparation and activation not audited'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT (public.mfa_access_status()->>'allowed')::boolean THEN RAISE EXCEPTION 'M101: valid AAL2 session denied'; END IF;
 IF public.can_read_clinical(org=>'10100000-0000-4000-8000-000000000010') IS NOT TRUE THEN RAISE EXCEPTION 'M101: valid clinical access lost'; END IF;
 IF public.paciente_cuenta_actual() IS DISTINCT FROM '10100000-0000-4000-8000-000000000020'::uuid THEN RAISE EXCEPTION 'M101: valid dual portal access lost'; END IF;
 PERFORM public.pseudonimizar_member(p_motivo=>'Synthetic dry run authorization',p_dry_run=>true);
END $$;
RESET ROLE;

-- Independent review: an AAL2 claim is not enough with another user's live
-- session/factor, or a factor that has not completed enrollment.
UPDATE auth.sessions SET user_id='10100000-0000-4000-8000-000000000002'
WHERE id='10100000-0000-4000-8000-000000000030';
DO $$ BEGIN
 IF (public.mfa_access_status()->>'allowed')::boolean THEN RAISE EXCEPTION 'M101: foreign session accepted'; END IF;
END $$;
UPDATE auth.sessions SET user_id='10100000-0000-4000-8000-000000000001'
WHERE id='10100000-0000-4000-8000-000000000030';
INSERT INTO auth.mfa_factors(id,user_id,status) VALUES
 ('10100000-0000-4000-8000-000000000041','10100000-0000-4000-8000-000000000002','verified');
UPDATE auth.sessions SET factor_id='10100000-0000-4000-8000-000000000041'
WHERE id='10100000-0000-4000-8000-000000000030';
DO $$ BEGIN
 IF (public.mfa_access_status()->>'allowed')::boolean THEN RAISE EXCEPTION 'M101: foreign verified factor accepted'; END IF;
END $$;
UPDATE auth.sessions SET factor_id='10100000-0000-4000-8000-000000000040'
WHERE id='10100000-0000-4000-8000-000000000030';
UPDATE auth.mfa_factors SET status='unverified' WHERE id='10100000-0000-4000-8000-000000000040';
DO $$ BEGIN
 IF (public.mfa_access_status()->>'allowed')::boolean THEN RAISE EXCEPTION 'M101: unverified factor accepted with AAL2 claim'; END IF;
END $$;
UPDATE auth.mfa_factors SET status='verified' WHERE id='10100000-0000-4000-8000-000000000040';

UPDATE auth.sessions SET aal='aal1' WHERE id='10100000-0000-4000-8000-000000000030';
DO $$ BEGIN
 IF (public.mfa_access_status()->>'allowed')::boolean THEN RAISE EXCEPTION 'M101: downgraded session accepts stale AAL2 JWT'; END IF;
END $$;
UPDATE auth.sessions SET aal='aal2',factor_id=null WHERE id='10100000-0000-4000-8000-000000000030';
DO $$ BEGIN
 IF (public.mfa_access_status()->>'allowed')::boolean THEN RAISE EXCEPTION 'M101: unbound factor accepts stale AAL2 JWT'; END IF;
END $$;
UPDATE auth.sessions SET factor_id='10100000-0000-4000-8000-000000000040',not_after=now()-interval '1 second' WHERE id='10100000-0000-4000-8000-000000000030';
DO $$ BEGIN
 IF (public.mfa_access_status()->>'allowed')::boolean THEN RAISE EXCEPTION 'M101: expired session accepted'; END IF;
END $$;
UPDATE auth.sessions SET not_after=null WHERE id='10100000-0000-4000-8000-000000000030';
DELETE FROM auth.sessions WHERE id='10100000-0000-4000-8000-000000000030';
DO $$ BEGIN
 IF (public.mfa_access_status()->>'allowed')::boolean THEN RAISE EXCEPTION 'M101: revoked session token accepted'; END IF;
END $$;
INSERT INTO auth.sessions(id,user_id) VALUES
 ('10100000-0000-4000-8000-000000000030','10100000-0000-4000-8000-000000000001');
DELETE FROM auth.mfa_factors WHERE id='10100000-0000-4000-8000-000000000040';
UPDATE folio_mfa_private.policy SET staff_enforce_after=null;
DO $$ BEGIN
 IF NOT (public.mfa_access_status()->>'required')::boolean OR (public.mfa_access_status()->>'allowed')::boolean THEN
  RAISE EXCEPTION 'M101: factor removal disables protection or permits stale AAL2';
 END IF;
END $$;
UPDATE member SET deleted_at=now() WHERE id='10100000-0000-4000-8000-000000000011';
DO $$ BEGIN
 IF (public.mfa_access_status()->>'isStaff')::boolean THEN RAISE EXCEPTION 'M101: stale membership/metadata used for staff decision'; END IF;
END $$;

-- Catch newly exposed definer bypasses: new RPCs must explicitly adopt the guard.
DO $$ DECLARE missing text; BEGIN
 SELECT string_agg(p.proname,', ') INTO missing
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef
 AND p.prorettype NOT IN ('trigger'::regtype,'event_trigger'::regtype)
 AND has_function_privilege('authenticated',p.oid,'EXECUTE')
 AND p.proname NOT IN ('mfa_access_status','mfa_access_allowed')
 AND position('folio_mfa_private.assert_access()' IN p.prosrc)=0;
 IF missing IS NOT NULL THEN RAISE EXCEPTION 'M101: unguarded exposed SECURITY DEFINER: %',missing; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE c.relrowsecurity AND c.relkind IN ('r','p') AND
   (n.nspname='public' OR (n.nspname='storage' AND c.relname IN ('objects','buckets')))
   AND NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='folio_mfa_gate' AND NOT p.polpermissive))
 THEN RAISE EXCEPTION 'M101: missing restrictive policy'; END IF;
 IF (SELECT provolatile FROM pg_proc WHERE oid='public.user_org_ids()'::regprocedure)<>'s' THEN
  RAISE EXCEPTION 'M101: stable helper changed volatility';
 END IF;
END $$;
ROLLBACK;
