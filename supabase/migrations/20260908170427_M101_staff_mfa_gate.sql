-- B2: additive MFA preparation. NULL activation preserves existing first-factor
-- access until the UI is deployed, enrollment completed and activation reviewed.
BEGIN;
CREATE SCHEMA folio_mfa_private;
REVOKE ALL ON SCHEMA folio_mfa_private FROM PUBLIC, anon, authenticated;

CREATE TABLE folio_mfa_private.policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  application_ready boolean NOT NULL DEFAULT false,
  staff_enforce_after timestamptz,
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text
);
INSERT INTO folio_mfa_private.policy(singleton) VALUES(true);
CREATE TABLE folio_mfa_private.protected_account (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  protected_since timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE folio_mfa_private.policy_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  enforce_after timestamptz,
  reason text NOT NULL
);
REVOKE ALL ON ALL TABLES IN SCHEMA folio_mfa_private FROM PUBLIC, anon, authenticated;

-- Once a verified factor exists, deleting it never becomes an MFA opt-out.
INSERT INTO folio_mfa_private.protected_account(user_id)
SELECT DISTINCT user_id FROM auth.mfa_factors WHERE status::text='verified';
CREATE FUNCTION folio_mfa_private.remember_enrollment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.status::text='verified' THEN
    INSERT INTO folio_mfa_private.protected_account(user_id) VALUES(NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION folio_mfa_private.remember_enrollment() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER folio_remember_verified_mfa
AFTER INSERT OR UPDATE OF status ON auth.mfa_factors
FOR EACH ROW EXECUTE FUNCTION folio_mfa_private.remember_enrollment();

CREATE FUNCTION public.mfa_access_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  uid uuid := auth.uid(); claims jsonb := auth.jwt();
  staff boolean; verified boolean; required boolean; session_alive boolean;
  activation timestamptz; ready boolean;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('required',true,'allowed',false,'isStaff',false,
      'hasVerifiedFactor',false,'sessionValid',false);
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.member m JOIN public.organization o ON o.id=m.organization_id
    WHERE m.profile_id=uid AND m.deleted_at IS NULL AND o.deleted_at IS NULL
      -- Historical directly-created members have no invitation or accepted_at.
      AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
  ) INTO staff;
  SELECT EXISTS(SELECT 1 FROM auth.mfa_factors f
    WHERE f.user_id=uid AND f.status::text='verified') INTO verified;
  SELECT staff_enforce_after,application_ready INTO activation,ready FROM folio_mfa_private.policy WHERE singleton;
  required := ready AND (verified OR EXISTS(SELECT 1 FROM folio_mfa_private.protected_account a WHERE a.user_id=uid)
    OR (staff AND activation IS NOT NULL AND activation<=now()));
  -- Compare text instead of casting caller claims: malformed session IDs fail closed.
  SELECT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.user_id=uid
    AND s.id::text=claims->>'session_id' AND (s.not_after IS NULL OR s.not_after>now())
    AND s.aal::text='aal2' AND EXISTS(SELECT 1 FROM auth.mfa_factors f
      WHERE f.id=s.factor_id AND f.user_id=uid AND f.status::text='verified'))
    INTO session_alive;
  RETURN jsonb_build_object('required',required,'isStaff',staff,
    'hasVerifiedFactor',verified,'sessionValid',session_alive,
    'allowed',NOT required OR (coalesce(claims->>'aal','')='aal2' AND session_alive AND verified));
END $$;
REVOKE ALL ON FUNCTION public.mfa_access_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mfa_access_status() TO authenticated, service_role;

CREATE FUNCTION public.mfa_access_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN auth.role() IS DISTINCT FROM 'authenticated'
    ELSE coalesce((public.mfa_access_status()->>'allowed')::boolean,false) END
$$;
REVOKE ALL ON FUNCTION public.mfa_access_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mfa_access_allowed() TO anon, authenticated, service_role;

CREATE FUNCTION folio_mfa_private.assert_access() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT public.mfa_access_allowed() THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='mfa_required';
  END IF;
END $$;
REVOKE ALL ON FUNCTION folio_mfa_private.assert_access() FROM PUBLIC, anon, authenticated;

-- Explicit privileged activation; no API for a user or OWNER to exempt themselves.
-- One-way preparation switch: deploy the enrollment UI before calling this.
CREATE FUNCTION public.mfa_enable_preparation(p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF length(trim(coalesce(p_reason,'')))<20 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Document the reviewed preparation reason';
  END IF;
  UPDATE folio_mfa_private.policy SET application_ready=true,changed_at=now(),reason=p_reason WHERE singleton;
  INSERT INTO folio_mfa_private.policy_history(action,reason)
  VALUES('enable_preparation',p_reason);
END $$;
REVOKE ALL ON FUNCTION public.mfa_enable_preparation(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mfa_enable_preparation(text) TO service_role;

CREATE FUNCTION public.mfa_set_staff_enforcement(p_after timestamptz,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF length(trim(coalesce(p_reason,'')))<20 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Document the reviewed rollout or rollback reason';
  END IF;
  IF p_after IS NOT NULL AND NOT (SELECT application_ready FROM folio_mfa_private.policy WHERE singleton) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Deploy and enable MFA preparation first';
  END IF;
  IF p_after IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.member m JOIN public.organization o ON o.id=m.organization_id
    WHERE m.deleted_at IS NULL AND o.deleted_at IS NULL
      AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
      AND NOT EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=m.profile_id AND f.status::text='verified')
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enroll all active staff before activating the policy';
  END IF;
  UPDATE folio_mfa_private.policy SET staff_enforce_after=p_after,changed_at=now(),reason=p_reason WHERE singleton;
  INSERT INTO folio_mfa_private.policy_history(action,enforce_after,reason)
  VALUES('staff_enforcement',p_after,p_reason);
END $$;
REVOKE ALL ON FUNCTION public.mfa_set_staff_enforcement(timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mfa_set_staff_enforcement(timestamptz,text) TO service_role;

-- Resolve membership from current rows, including organization revocation.
CREATE OR REPLACE FUNCTION public.user_org_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT m.organization_id FROM member m JOIN organization o ON o.id=m.organization_id
 WHERE m.profile_id=auth.uid() AND m.deleted_at IS NULL AND o.deleted_at IS NULL
 AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
$$;
CREATE OR REPLACE FUNCTION public.user_role_in(org uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT m.role::text FROM member m JOIN organization o ON o.id=m.organization_id
 WHERE m.profile_id=auth.uid() AND m.organization_id=org AND m.deleted_at IS NULL AND o.deleted_at IS NULL
 AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
$$;
CREATE OR REPLACE FUNCTION public.user_member_id_in(org uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT m.id FROM member m JOIN organization o ON o.id=m.organization_id
 WHERE m.profile_id=auth.uid() AND m.organization_id=org AND m.deleted_at IS NULL AND o.deleted_at IS NULL
 AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
$$;
CREATE OR REPLACE FUNCTION public.can_read_clinical(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM member m JOIN organization o ON o.id=m.organization_id
 WHERE m.profile_id=auth.uid() AND m.organization_id=org AND m.deleted_at IS NULL AND o.deleted_at IS NULL
 AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
 AND (m.role IN ('OWNER','PROFESIONAL') OR (m.role='DIRECTOR' AND m.es_colegiado)))
$$;

-- Guard the 22 explicitly inventoried caller-accessible SECURITY DEFINER RPCs.
-- CREATE OR REPLACE preserves OIDs, dependencies, named args/defaults, grants
-- and properties. No rename or schema relocation of existing functions.
DO $migration$
DECLARE signature text; proc record; definition text; body text; needle text; replacement text;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
 'public.accept_member_invitation(text,text,text,text)', 'public.can_read_admin(uuid)',
 'public.can_read_clinical(uuid)', 'public.get_invitation_preview(text)',
 'public.has_caja_fuerte_blocking_access(uuid,uuid)', 'public.listar_paciente_claims_pendientes(uuid)',
 'public.paciente_cuenta_actual()', 'public.paciente_cuenta_ensure()',
 'public.paciente_owns(uuid)', 'public.paciente_owns_identidad(uuid)',
 'public.portal_cancel_cutoff(uuid)', 'public.profesional_attended_paciente(uuid,uuid)',
 'public.pseudonimizar_member(text,boolean)', 'public.pseudonimizar_paciente(uuid,text,boolean)',
 'public.reemplazar_disponibilidad(uuid,uuid,jsonb)', 'public.resolver_paciente_claim(uuid,boolean)',
 'public.restore_paciente(uuid)', 'public.soft_delete_paciente(uuid,text)',
 'public.user_has_scope_over(uuid,uuid)', 'public.user_member_id_in(uuid)',
 'public.user_org_ids()', 'public.user_role_in(uuid)'
 ] LOOP
   SELECT p.*,l.lanname INTO STRICT proc FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
     WHERE p.oid=signature::regprocedure;
   IF NOT proc.prosecdef OR proc.lanname NOT IN ('sql','plpgsql') THEN
     RAISE EXCEPTION 'Unexpected MFA RPC shape: %',signature;
   END IF;
   definition := pg_get_functiondef(proc.oid);
   IF proc.lanname='plpgsql' THEN
     body := E'BEGIN\n PERFORM folio_mfa_private.assert_access();\n' || rtrim(btrim(proc.prosrc),E'; \t\r\n') || E';\nEND;\n';
   ELSE
     body := E'BEGIN\n PERFORM folio_mfa_private.assert_access();\n' ||
       CASE WHEN proc.proretset THEN 'RETURN QUERY ' ELSE 'RETURN (' END ||
       rtrim(btrim(proc.prosrc),E'; \t\r\n') ||
       CASE WHEN proc.proretset THEN E';\nEND;\n' ELSE E');\nEND;\n' END;
     definition := replace(definition,'LANGUAGE sql','LANGUAGE plpgsql');
   END IF;
   needle := 'AS $function$'||proc.prosrc||'$function$';
   replacement := 'AS $function$'||body||'$function$';
   IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected function delimiter: %',signature; END IF;
   EXECUTE replace(definition,needle,replacement);
 END LOOP;
END $migration$;

-- Restrictive policy is ANDed with every existing permissive policy, including
-- the patient portal's self-access. It grants no access by itself.
DO $$ DECLARE tbl record; BEGIN
 FOR tbl IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE c.relrowsecurity AND c.relkind IN ('r','p')
   AND (n.nspname='public' OR (n.nspname='storage' AND c.relname IN ('objects','buckets')))
 LOOP
   EXECUTE format('CREATE POLICY folio_mfa_gate ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.mfa_access_allowed())) WITH CHECK ((SELECT public.mfa_access_allowed()))',tbl.nspname,tbl.relname);
 END LOOP;
END $$;

COMMENT ON FUNCTION public.mfa_access_status() IS
 'M101 self-only current DB MFA policy. PostgREST supplies verified JWT AAL/session. Never infer staff from metadata or selected organization.';
COMMIT;
