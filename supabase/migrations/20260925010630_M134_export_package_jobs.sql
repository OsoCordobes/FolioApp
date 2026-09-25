-- M134 / B06b1: private, bounded lifecycle for a future clinical export package.
-- No bytes are produced here and no function can transition a job to READY.
CREATE SCHEMA folio_export_private;
REVOKE ALL ON SCHEMA folio_export_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE folio_export_private.job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organization(id),
  paciente_id uuid NOT NULL REFERENCES public.paciente(id),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  actor_member_id uuid NOT NULL REFERENCES public.member(id),
  idempotency_key uuid NOT NULL,
  source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[a-f0-9]{64}$'),
  expected_entries integer NOT NULL CHECK (expected_entries BETWEEN 1 AND 10000),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','leased','ready','failed','expired')),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  lease_token uuid,
  lease_until timestamptz,
  failure_code text CHECK (failure_code IN
    ('source_changed','source_unavailable','verification_failed','storage_failed','authorization_changed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  ready_at timestamptz,
  cleaned_at timestamptz,
  UNIQUE (organization_id, actor_user_id, idempotency_key),
  CHECK ((state = 'leased' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (state <> 'leased' AND lease_token IS NULL AND lease_until IS NULL)),
  CHECK (state <> 'ready' OR ready_at IS NOT NULL),
  CHECK (ready_at IS NULL OR state IN ('ready','expired')),
  CHECK (expires_at > created_at)
);
CREATE INDEX export_job_expiry_idx ON folio_export_private.job(expires_at, id)
  WHERE cleaned_at IS NULL;

-- B06b2 will populate this inventory with the verified JSON, document and
-- signature sources. A withdrawn document is inventory-only (zero fragments).
CREATE TABLE folio_export_private.entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES folio_export_private.job(id),
  kind text NOT NULL CHECK (kind IN ('json','document','signature','withdrawn_document')),
  source_id uuid NOT NULL,
  source_index smallint NOT NULL DEFAULT 0 CHECK (source_index BETWEEN 0 AND 1),
  expected_fragments integer NOT NULL CHECK (expected_fragments BETWEEN 0 AND 10000),
  source_hash_kind text NOT NULL CHECK (source_hash_kind IN ('recorded','not_recorded','not_applicable')),
  source_sha256 text CHECK (source_sha256 IS NULL OR source_sha256 ~ '^[a-f0-9]{64}$'),
  computed_sha256 text CHECK (computed_sha256 IS NULL OR computed_sha256 ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz,
  UNIQUE (job_id, kind, source_id, source_index),
  UNIQUE (job_id, id),
  CHECK ((kind = 'withdrawn_document') = (expected_fragments = 0)),
  CHECK ((source_hash_kind = 'recorded') = (source_sha256 IS NOT NULL)),
  CHECK (verified_at IS NULL OR computed_sha256 IS NOT NULL)
);
CREATE INDEX export_entry_job_idx ON folio_export_private.entry(job_id);

CREATE TABLE folio_export_private.fragment (
  job_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 9999),
  bytes integer NOT NULL CHECK (bytes BETWEEN 1 AND 3145728),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL,
  PRIMARY KEY (entry_id, ordinal),
  FOREIGN KEY (job_id, entry_id) REFERENCES folio_export_private.entry(job_id, id)
);

ALTER TABLE folio_export_private.job ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_export_private.entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_export_private.fragment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA folio_export_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA folio_export_private FROM PUBLIC, anon, authenticated, service_role;

-- The bucket is private even if an older broad permissive Storage policy
-- exists. No reusable client URL or direct object operation is authorized.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('folio-export-packages','folio-export-packages',false,3145728,
  ARRAY['application/octet-stream']);
CREATE POLICY folio_export_package_no_client ON storage.objects AS RESTRICTIVE
  FOR ALL TO anon, authenticated
  USING (bucket_id <> 'folio-export-packages')
  WITH CHECK (bucket_id <> 'folio-export-packages');

-- SECURITY DEFINER helpers use fixed search_path and explicit role checks;
-- private tables remain unreachable even to service_role via direct SQL.
CREATE FUNCTION folio_export_private.assert_server() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='export_job_server_required';
  END IF;
END $$;
REVOKE ALL ON FUNCTION folio_export_private.assert_server() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION folio_export_private.assert_authority(p_job folio_export_private.job)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.member m JOIN public.organization o ON o.id=m.organization_id
    JOIN public.paciente p ON p.id=p_job.paciente_id AND p.organization_id=o.id
    JOIN public.paciente_identidad pi ON pi.id=p.identidad_id AND pi.organization_id=o.id
    WHERE m.id=p_job.actor_member_id AND m.profile_id=p_job.actor_user_id
      AND m.organization_id=p_job.organization_id AND m.deleted_at IS NULL
      AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
      AND (m.role='OWNER' OR (m.role='DIRECTOR' AND m.es_colegiado))
      AND o.deleted_at IS NULL AND p.deleted_at IS NULL AND pi.deleted_at IS NULL
      AND p.pseudonimizado_en IS NULL
      AND (p.caja_fuerte_profesional IS NULL OR p.caja_fuerte_profesional=m.id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='export_job_authority_changed';
  END IF;
END $$;
REVOKE ALL ON FUNCTION folio_export_private.assert_authority(folio_export_private.job)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.export_package_begin(
  p_actor uuid, p_member uuid, p_org uuid, p_patient uuid,
  p_idempotency uuid, p_fingerprint text, p_expected_entries integer
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job folio_export_private.job; v_id uuid;
BEGIN
  PERFORM folio_export_private.assert_server();
  IF p_actor IS NULL OR p_member IS NULL OR p_org IS NULL OR p_patient IS NULL
    OR p_idempotency IS NULL OR coalesce(p_fingerprint,'') !~ '^[a-f0-9]{64}$'
    OR p_expected_entries IS NULL OR p_expected_entries NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_export_job_contract';
  END IF;
  v_job.actor_user_id:=p_actor; v_job.actor_member_id:=p_member;
  v_job.organization_id:=p_org; v_job.paciente_id:=p_patient;
  PERFORM folio_export_private.assert_authority(v_job);
  INSERT INTO folio_export_private.job(
    organization_id,paciente_id,actor_user_id,actor_member_id,
    idempotency_key,source_fingerprint,expected_entries)
  VALUES(p_org,p_patient,p_actor,p_member,p_idempotency,p_fingerprint,p_expected_entries)
  ON CONFLICT (organization_id,actor_user_id,idempotency_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT * INTO STRICT v_job FROM folio_export_private.job
    WHERE organization_id=p_org AND actor_user_id=p_actor AND idempotency_key=p_idempotency;
  IF v_job.actor_member_id<>p_member OR v_job.paciente_id<>p_patient
    OR v_job.source_fingerprint<>p_fingerprint OR v_job.expected_entries<>p_expected_entries THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='export_job_idempotency_conflict';
  END IF;
  RETURN v_job.id;
END $$;
REVOKE ALL ON FUNCTION public.export_package_begin(uuid,uuid,uuid,uuid,uuid,text,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_begin(uuid,uuid,uuid,uuid,uuid,text,integer)
  TO service_role;

CREATE FUNCTION public.export_package_read(p_id uuid, p_actor uuid)
RETURNS TABLE(
  job_id uuid, organization_id uuid, paciente_id uuid, actor_user_id uuid,
  actor_member_id uuid, source_fingerprint text, state text, revision bigint,
  expires_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job folio_export_private.job;
BEGIN
  PERFORM folio_export_private.assert_server();
  SELECT * INTO v_job FROM folio_export_private.job j
    WHERE j.id=p_id AND j.actor_user_id=p_actor;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM folio_export_private.assert_authority(v_job);
  RETURN QUERY SELECT v_job.id,v_job.organization_id,v_job.paciente_id,
    v_job.actor_user_id,v_job.actor_member_id,v_job.source_fingerprint,
    v_job.state,v_job.revision,v_job.expires_at;
END $$;
REVOKE ALL ON FUNCTION public.export_package_read(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_read(uuid,uuid) TO service_role;

CREATE FUNCTION public.export_package_claim(p_id uuid, p_actor uuid, p_revision bigint)
RETURNS TABLE(lease_token uuid, revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job folio_export_private.job;
BEGIN
  PERFORM folio_export_private.assert_server();
  SELECT * INTO v_job FROM folio_export_private.job WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR v_job.actor_user_id IS DISTINCT FROM p_actor THEN RETURN; END IF;
  PERFORM folio_export_private.assert_authority(v_job);
  IF v_job.revision IS DISTINCT FROM p_revision OR v_job.expires_at<=now()
    OR NOT (v_job.state='pending' OR
      (v_job.state='leased' AND v_job.lease_until<=now())) THEN RETURN; END IF;
  UPDATE folio_export_private.job j
  SET state='leased',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',
    revision=j.revision+1
  WHERE j.id=p_id RETURNING j.lease_token,j.revision INTO lease_token,revision;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.export_package_claim(uuid,uuid,bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_claim(uuid,uuid,bigint) TO service_role;

CREATE FUNCTION public.export_package_fail(
  p_id uuid,p_actor uuid,p_token uuid,p_revision bigint,p_code text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job folio_export_private.job;
BEGIN
  PERFORM folio_export_private.assert_server();
  IF p_code IS NULL OR p_code NOT IN ('source_changed','source_unavailable','verification_failed',
    'storage_failed','authorization_changed') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_export_failure_code';
  END IF;
  SELECT * INTO v_job FROM folio_export_private.job WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR v_job.actor_user_id IS DISTINCT FROM p_actor OR v_job.state<>'leased'
    OR v_job.lease_token IS DISTINCT FROM p_token OR v_job.revision IS DISTINCT FROM p_revision
    OR v_job.lease_until<=now() OR v_job.expires_at<=now() THEN RETURN false; END IF;
  UPDATE folio_export_private.job SET state='failed',failure_code=p_code,
    lease_token=NULL,lease_until=NULL,revision=revision+1 WHERE id=p_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.export_package_fail(uuid,uuid,uuid,bigint,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_fail(uuid,uuid,uuid,bigint,text)
  TO service_role;

-- A caller must later remove only this bucket's deterministic job-id prefix,
-- then confirm cleanup. No cron and no deletion of original clinical objects.
CREATE FUNCTION public.export_package_expire_due(p_limit integer)
RETURNS TABLE(job_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM folio_export_private.assert_server();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_export_expiry_limit';
  END IF;
  RETURN QUERY WITH due AS (
    SELECT j.id FROM folio_export_private.job j
    WHERE j.expires_at<=now() AND j.cleaned_at IS NULL
    ORDER BY j.expires_at,j.id FOR UPDATE SKIP LOCKED LIMIT p_limit
  ) UPDATE folio_export_private.job j
    SET state='expired',lease_token=NULL,lease_until=NULL,revision=j.revision+1
    FROM due WHERE j.id=due.id RETURNING j.id;
END $$;
REVOKE ALL ON FUNCTION public.export_package_expire_due(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_expire_due(integer) TO service_role;

CREATE FUNCTION public.export_package_cleanup_confirm(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM folio_export_private.assert_server();
  UPDATE folio_export_private.job SET cleaned_at=now(),revision=revision+1
  WHERE id=p_id AND state='expired' AND cleaned_at IS NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.export_package_cleanup_confirm(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_cleanup_confirm(uuid) TO service_role;
