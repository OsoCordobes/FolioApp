-- M104 draft (never applied in production): install with enforcement OFF.
-- Deploy and smoke-test the authenticated paths, then activate explicitly with
-- the release build SHA and review reference. Installation alone is NOT closure.
BEGIN;
CREATE SCHEMA folio_attachments_private;
REVOKE ALL ON SCHEMA folio_attachments_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE folio_attachments_private.policy (
 singleton boolean PRIMARY KEY CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false,
 enabled_at timestamptz,
 enabled_by text,
 reason text,
 build_sha text,
 reference text,
 CHECK ((NOT enabled AND enabled_at IS NULL AND enabled_by IS NULL AND reason IS NULL AND build_sha IS NULL AND reference IS NULL)
     OR (enabled AND enabled_at IS NOT NULL AND enabled_by IS NOT NULL AND reason IS NOT NULL AND build_sha IS NOT NULL AND reference IS NOT NULL))
);
CREATE TABLE folio_attachments_private.policy_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 enabled_at timestamptz NOT NULL,
 enabled_by text NOT NULL,
 reason text NOT NULL,
 build_sha text NOT NULL,
 reference text NOT NULL
);
INSERT INTO folio_attachments_private.policy(singleton) VALUES(true);
ALTER TABLE folio_attachments_private.policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_attachments_private.policy_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA folio_attachments_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA folio_attachments_private FROM PUBLIC,anon,authenticated,service_role;

-- Read-only policy predicate. Missing policy fails closed; private schema has
-- no client USAGE, and only this fixed boolean can be evaluated by stored RLS.
CREATE FUNCTION folio_attachments_private.client_access_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT NOT enabled FROM folio_attachments_private.policy WHERE singleton),false)
$$;
REVOKE ALL ON FUNCTION folio_attachments_private.client_access_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION folio_attachments_private.client_access_allowed() TO anon,authenticated,service_role;

CREATE FUNCTION public.enable_clinical_attachments(p_reason text,p_build_sha text,p_reference text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_policy folio_attachments_private.policy; v_role text := coalesce(current_setting('role',true),'none');
BEGIN
 IF v_role <> 'service_role' AND NOT (v_role IN ('none','') AND session_user IN ('postgres','supabase_admin')) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Attachment rollout requires platform administration';
 END IF;
 IF length(trim(coalesce(p_reason,''))) NOT BETWEEN 20 AND 240
    OR coalesce(p_build_sha,'') !~ '^[a-f0-9]{40}$'
    OR coalesce(p_reference,'') !~ '^[A-Z0-9][A-Z0-9_.:-]{7,119}$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Reviewed reason, full build SHA and reference required';
 END IF;
 SELECT * INTO STRICT v_policy FROM folio_attachments_private.policy WHERE singleton FOR UPDATE;
 IF v_policy.enabled THEN RETURN; END IF;
 UPDATE storage.buckets SET public=false WHERE id='documentos-clinicos';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Clinical bucket missing'; END IF;
 UPDATE folio_attachments_private.policy
 SET enabled=true,enabled_at=clock_timestamp(),enabled_by=session_user||':'||v_role,
     reason=trim(p_reason),build_sha=p_build_sha,reference=p_reference
 WHERE singleton RETURNING * INTO v_policy;
 INSERT INTO folio_attachments_private.policy_history(enabled_at,enabled_by,reason,build_sha,reference)
 VALUES(v_policy.enabled_at,v_policy.enabled_by,v_policy.reason,v_policy.build_sha,v_policy.reference);
END $$;
REVOKE ALL ON FUNCTION public.enable_clinical_attachments(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enable_clinical_attachments(text,text,text) TO service_role;

-- Restrictive policies never grant new access. Before activation they preserve
-- existing patient/vault policies; afterwards they close browser writes/Storage.
CREATE POLICY documento_server_insert ON public.documento_clinico AS RESTRICTIVE
 FOR INSERT TO authenticated WITH CHECK ((SELECT folio_attachments_private.client_access_allowed()));
CREATE POLICY documento_server_update ON public.documento_clinico AS RESTRICTIVE
 FOR UPDATE TO authenticated USING ((SELECT folio_attachments_private.client_access_allowed()))
 WITH CHECK ((SELECT folio_attachments_private.client_access_allowed()));

-- Unlike old migrations, permission errors are fatal: installation must never
-- report success while the public SDK still bypasses the validation boundary.
CREATE POLICY clinical_attachments_server_only ON storage.objects AS RESTRICTIVE
 FOR ALL TO anon, authenticated
 USING (bucket_id <> 'documentos-clinicos' OR (SELECT folio_attachments_private.client_access_allowed()))
 WITH CHECK (bucket_id <> 'documentos-clinicos' OR (SELECT folio_attachments_private.client_access_allowed()));
COMMIT;

