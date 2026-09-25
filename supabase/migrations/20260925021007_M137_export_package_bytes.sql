-- M137 / B06b2: private, lease-fenced fragment ledger and exact finalization.
-- Storage bytes are uploaded/read back by the server; these RPCs never trust a
-- client path and do not expose private tables to anon/authenticated/service.
ALTER TABLE folio_export_private.entry ADD COLUMN registered_at timestamptz NOT NULL DEFAULT now();

CREATE FUNCTION folio_export_private.assert_lease(
  p_id uuid, p_actor uuid, p_token uuid, p_revision bigint
) RETURNS folio_export_private.job
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job folio_export_private.job;
BEGIN
  PERFORM folio_export_private.assert_server();
  SELECT * INTO v_job FROM folio_export_private.job WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR v_job.actor_user_id IS DISTINCT FROM p_actor
    OR v_job.state<>'leased' OR v_job.lease_token IS DISTINCT FROM p_token
    OR v_job.revision IS DISTINCT FROM p_revision OR v_job.lease_until<=now()
    OR v_job.expires_at<=now() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='export_job_lease_invalid';
  END IF;
  PERFORM folio_export_private.assert_authority(v_job);
  RETURN v_job;
END $$;
REVOKE ALL ON FUNCTION folio_export_private.assert_lease(uuid,uuid,uuid,bigint)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.export_package_renew(
  p_id uuid, p_actor uuid, p_token uuid, p_revision bigint
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM folio_export_private.assert_lease(p_id,p_actor,p_token,p_revision);
  UPDATE folio_export_private.job SET lease_until=least(now()+interval '2 minutes',expires_at)
    WHERE id=p_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.export_package_renew(uuid,uuid,uuid,bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_renew(uuid,uuid,uuid,bigint) TO service_role;

CREATE FUNCTION public.export_package_entry_register(
  p_id uuid, p_actor uuid, p_token uuid, p_revision bigint,
  p_kind text, p_source uuid, p_index smallint, p_fragments integer,
  p_hash_kind text, p_source_sha text
) RETURNS TABLE(entry_id uuid,registered_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_entry folio_export_private.entry;
BEGIN
  PERFORM folio_export_private.assert_lease(p_id,p_actor,p_token,p_revision);
  IF p_kind IS NULL OR p_kind NOT IN ('json','document','signature','withdrawn_document')
    OR p_source IS NULL OR p_index IS NULL OR p_fragments IS NULL
    OR p_hash_kind IS NULL OR p_hash_kind NOT IN ('recorded','not_recorded','not_applicable')
    OR p_fragments NOT BETWEEN 0 AND 17
    OR (p_kind='withdrawn_document') IS DISTINCT FROM (p_fragments=0)
    OR (p_kind='json' AND (p_index<>0 OR p_hash_kind<>'not_applicable'))
    OR (p_kind='document' AND p_index<>0)
    OR (p_kind='signature' AND p_index NOT BETWEEN 0 AND 1)
    OR (p_hash_kind='recorded') IS DISTINCT FROM (p_source_sha IS NOT NULL)
    OR (p_source_sha IS NOT NULL AND p_source_sha !~ '^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_export_entry';
  END IF;
  INSERT INTO folio_export_private.entry(
    job_id,kind,source_id,source_index,expected_fragments,source_hash_kind,source_sha256)
  VALUES(p_id,p_kind,p_source,p_index,p_fragments,p_hash_kind,p_source_sha)
  ON CONFLICT (job_id,kind,source_id,source_index) DO NOTHING;
  SELECT * INTO STRICT v_entry FROM folio_export_private.entry
    WHERE job_id=p_id AND kind=p_kind AND source_id=p_source AND source_index=p_index;
  IF v_entry.expected_fragments IS DISTINCT FROM p_fragments OR
    v_entry.source_hash_kind IS DISTINCT FROM p_hash_kind OR
    v_entry.source_sha256 IS DISTINCT FROM p_source_sha THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='export_entry_replay_conflict';
  END IF;
  entry_id:=v_entry.id;
  registered_at:=v_entry.registered_at;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.export_package_entry_register(uuid,uuid,uuid,bigint,text,uuid,smallint,integer,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_entry_register(uuid,uuid,uuid,bigint,text,uuid,smallint,integer,text,text)
  TO service_role;

CREATE FUNCTION public.export_package_fragment_register(
  p_id uuid, p_actor uuid, p_token uuid, p_revision bigint,
  p_entry uuid, p_ordinal integer, p_bytes integer, p_sha text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_entry folio_export_private.entry; v_fragment folio_export_private.fragment;
BEGIN
  PERFORM folio_export_private.assert_lease(p_id,p_actor,p_token,p_revision);
  SELECT * INTO v_entry FROM folio_export_private.entry
    WHERE job_id=p_id AND id=p_entry FOR UPDATE;
  IF NOT FOUND OR v_entry.kind='withdrawn_document' OR p_ordinal IS NULL
    OR p_ordinal<0 OR p_ordinal>=v_entry.expected_fragments OR p_bytes IS NULL
    OR p_bytes NOT BETWEEN 1 AND 3145728 OR p_sha IS NULL
    OR p_sha !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_export_fragment';
  END IF;
  IF v_entry.verified_at IS NULL THEN
    INSERT INTO folio_export_private.fragment(job_id,entry_id,ordinal,bytes,sha256,verified_at)
    VALUES(p_id,p_entry,p_ordinal,p_bytes,p_sha,now())
    ON CONFLICT (entry_id,ordinal) DO NOTHING;
  END IF;
  SELECT * INTO v_fragment FROM folio_export_private.fragment
    WHERE entry_id=p_entry AND ordinal=p_ordinal;
  IF NOT FOUND OR v_fragment.job_id<>p_id OR v_fragment.bytes<>p_bytes
    OR v_fragment.sha256<>p_sha THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='export_fragment_replay_conflict';
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.export_package_fragment_register(uuid,uuid,uuid,bigint,uuid,integer,integer,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_fragment_register(uuid,uuid,uuid,bigint,uuid,integer,integer,text)
  TO service_role;

CREATE FUNCTION public.export_package_fragment_read(
  p_id uuid,p_actor uuid,p_token uuid,p_revision bigint,p_entry uuid
) RETURNS TABLE(ordinal integer,bytes integer,sha256 text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_entry folio_export_private.entry;
BEGIN
  PERFORM folio_export_private.assert_lease(p_id,p_actor,p_token,p_revision);
  SELECT * INTO v_entry FROM folio_export_private.entry WHERE job_id=p_id AND id=p_entry;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='export_entry_missing';
  END IF;
  RETURN QUERY SELECT f.ordinal,f.bytes,f.sha256 FROM folio_export_private.fragment f
    WHERE f.job_id=p_id AND f.entry_id=p_entry ORDER BY f.ordinal;
END $$;
REVOKE ALL ON FUNCTION public.export_package_fragment_read(uuid,uuid,uuid,bigint,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_fragment_read(uuid,uuid,uuid,bigint,uuid)
  TO service_role;

CREATE FUNCTION public.export_package_entry_verify(
  p_id uuid, p_actor uuid, p_token uuid, p_revision bigint,
  p_entry uuid, p_computed_sha text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_entry folio_export_private.entry; v_count bigint; v_min integer; v_max integer;
BEGIN
  PERFORM folio_export_private.assert_lease(p_id,p_actor,p_token,p_revision);
  SELECT * INTO v_entry FROM folio_export_private.entry
    WHERE job_id=p_id AND id=p_entry FOR UPDATE;
  IF NOT FOUND OR v_entry.kind='withdrawn_document' OR p_computed_sha IS NULL
    OR p_computed_sha !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_export_entry_verification';
  END IF;
  SELECT count(*),min(ordinal),max(ordinal) INTO v_count,v_min,v_max
    FROM folio_export_private.fragment WHERE job_id=p_id AND entry_id=p_entry;
  IF v_count<>v_entry.expected_fragments OR v_min<>0
    OR v_max<>v_entry.expected_fragments-1
    OR (v_entry.source_hash_kind='recorded' AND v_entry.source_sha256<>p_computed_sha)
    OR (v_entry.verified_at IS NOT NULL AND v_entry.computed_sha256<>p_computed_sha) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='export_entry_incomplete_or_changed';
  END IF;
  UPDATE folio_export_private.entry SET computed_sha256=p_computed_sha,
    verified_at=coalesce(verified_at,now()) WHERE id=p_entry;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.export_package_entry_verify(uuid,uuid,uuid,bigint,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_entry_verify(uuid,uuid,uuid,bigint,uuid,text)
  TO service_role;

CREATE FUNCTION public.export_package_inventory_read(
  p_id uuid,p_actor uuid,p_offset integer,p_limit integer)
RETURNS TABLE(entry_id uuid,kind text,source_id uuid,source_index smallint,
  expected_fragments integer,source_hash_kind text,source_sha256 text,
  computed_sha256 text,verified_at timestamptz,registered_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job folio_export_private.job;
BEGIN
  PERFORM folio_export_private.assert_server();
  IF p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 10000
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_export_inventory_page';
  END IF;
  SELECT * INTO v_job FROM folio_export_private.job WHERE id=p_id AND actor_user_id=p_actor;
  IF NOT FOUND OR v_job.expires_at<=now() OR v_job.state NOT IN ('leased','ready') THEN RETURN; END IF;
  PERFORM folio_export_private.assert_authority(v_job);
  RETURN QUERY SELECT e.id,e.kind,e.source_id,e.source_index,e.expected_fragments,
    e.source_hash_kind,e.source_sha256,e.computed_sha256,e.verified_at,e.registered_at
  FROM folio_export_private.entry e WHERE e.job_id=p_id
  ORDER BY e.kind,e.source_id,e.source_index LIMIT p_limit OFFSET p_offset;
END $$;
REVOKE ALL ON FUNCTION public.export_package_inventory_read(uuid,uuid,integer,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_inventory_read(uuid,uuid,integer,integer) TO service_role;

CREATE FUNCTION public.export_package_finish(
  p_id uuid,p_actor uuid,p_token uuid,p_revision bigint,p_fingerprint text,p_expected jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job folio_export_private.job; v_actual jsonb; v_count bigint;
BEGIN
  v_job:=folio_export_private.assert_lease(p_id,p_actor,p_token,p_revision);
  IF p_fingerprint IS DISTINCT FROM v_job.source_fingerprint
    OR p_expected IS NULL OR jsonb_typeof(p_expected)<>'array'
    OR jsonb_array_length(p_expected)<>v_job.expected_entries THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='export_inventory_contract_changed';
  END IF;
  SELECT count(*),coalesce(jsonb_agg(jsonb_build_object(
    'kind',e.kind,'source_id',e.source_id,'source_index',e.source_index,
    'expected_fragments',e.expected_fragments,'source_hash_kind',e.source_hash_kind,
    'source_sha256',e.source_sha256) ORDER BY e.kind,e.source_id,e.source_index),'[]'::jsonb)
  INTO v_count,v_actual FROM folio_export_private.entry e WHERE e.job_id=p_id;
  IF v_count<>v_job.expected_entries OR p_expected<>v_actual OR EXISTS (
    SELECT 1 FROM folio_export_private.entry e
    LEFT JOIN LATERAL (
      SELECT count(*) AS n,min(f.ordinal) AS first_ordinal,max(f.ordinal) AS last_ordinal
      FROM folio_export_private.fragment f WHERE f.job_id=e.job_id AND f.entry_id=e.id
    ) f ON true
    WHERE e.job_id=p_id AND (
      (e.kind='withdrawn_document' AND (e.expected_fragments<>0 OR f.n<>0)) OR
      (e.kind<>'withdrawn_document' AND (e.verified_at IS NULL
        OR e.computed_sha256 IS NULL OR f.n<>e.expected_fragments
        OR f.first_ordinal<>0 OR f.last_ordinal<>e.expected_fragments-1
        OR (e.source_hash_kind='recorded' AND e.source_sha256<>e.computed_sha256)))
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='export_inventory_incomplete';
  END IF;
  UPDATE folio_export_private.job SET state='ready',ready_at=now(),
    lease_token=NULL,lease_until=NULL,revision=revision+1 WHERE id=p_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.export_package_finish(uuid,uuid,uuid,bigint,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_finish(uuid,uuid,uuid,bigint,text,jsonb)
  TO service_role;

-- Cleanup is separately leased after expiry plus a bounded in-flight grace.
-- The b1 confirmation remains compatible only for jobs with no entries.
-- Jobs with entries require per-entry confirmation under this CAS.
ALTER TABLE folio_export_private.job
  ADD COLUMN cleanup_token uuid,
  ADD COLUMN cleanup_until timestamptz,
  ADD CONSTRAINT export_job_cleanup_pair CHECK
    ((cleanup_token IS NULL AND cleanup_until IS NULL) OR
     (cleanup_token IS NOT NULL AND cleanup_until IS NOT NULL AND state='expired'));
ALTER TABLE folio_export_private.entry
  ADD COLUMN cleanup_empty_at timestamptz,
  ADD COLUMN cleaned_at timestamptz;
CREATE OR REPLACE FUNCTION public.export_package_cleanup_confirm(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM folio_export_private.assert_server();
  UPDATE folio_export_private.job j SET cleaned_at=now(),revision=j.revision+1
  WHERE j.id=p_id AND j.state='expired' AND j.cleaned_at IS NULL
    AND j.cleanup_token IS NULL
    AND NOT EXISTS (SELECT 1 FROM folio_export_private.entry e WHERE e.job_id=j.id);
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.export_package_expire_due(p_limit integer)
RETURNS TABLE(job_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM folio_export_private.assert_server();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_export_expiry_limit';
  END IF;
  RETURN QUERY WITH due AS (
    SELECT j.id FROM folio_export_private.job j
    WHERE j.expires_at<=now() AND j.state<>'expired' AND j.cleaned_at IS NULL
    ORDER BY j.expires_at,j.id FOR UPDATE SKIP LOCKED LIMIT p_limit
  ) UPDATE folio_export_private.job j
    SET state='expired',lease_token=NULL,lease_until=NULL,revision=j.revision+1
    FROM due WHERE j.id=due.id RETURNING j.id;
END $$;

CREATE FUNCTION public.export_package_cleanup_due(p_limit integer)
RETURNS TABLE(job_id uuid,revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM folio_export_private.assert_server();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_export_cleanup_limit';
  END IF;
  RETURN QUERY SELECT j.id,j.revision FROM folio_export_private.job j
    WHERE j.state='expired' AND j.cleaned_at IS NULL
      AND j.expires_at<=now()-interval '5 minutes'
      AND (j.cleanup_until IS NULL OR j.cleanup_until<=now())
    ORDER BY j.expires_at,j.id LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.export_package_cleanup_due(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_cleanup_due(integer) TO service_role;

CREATE FUNCTION public.export_package_cleanup_claim(p_id uuid,p_revision bigint)
RETURNS TABLE(cleanup_token uuid,revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job folio_export_private.job;
BEGIN
  PERFORM folio_export_private.assert_server();
  SELECT * INTO v_job FROM folio_export_private.job WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR v_job.state<>'expired' OR v_job.cleaned_at IS NOT NULL
    OR v_job.expires_at>now()-interval '5 minutes'
    OR v_job.revision IS DISTINCT FROM p_revision
    OR (v_job.cleanup_until IS NOT NULL AND v_job.cleanup_until>now()) THEN RETURN; END IF;
  UPDATE folio_export_private.job j SET cleanup_token=gen_random_uuid(),
    cleanup_until=now()+interval '2 minutes',revision=j.revision+1
    WHERE j.id=p_id RETURNING j.cleanup_token,j.revision INTO cleanup_token,revision;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.export_package_cleanup_claim(uuid,bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_cleanup_claim(uuid,bigint) TO service_role;

CREATE FUNCTION folio_export_private.assert_cleanup(
  p_id uuid,p_token uuid,p_revision bigint
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job folio_export_private.job;
BEGIN
  PERFORM folio_export_private.assert_server();
  SELECT * INTO v_job FROM folio_export_private.job WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR v_job.state<>'expired' OR v_job.cleaned_at IS NOT NULL
    OR v_job.cleanup_token IS DISTINCT FROM p_token
    OR v_job.revision IS DISTINCT FROM p_revision OR v_job.cleanup_until<=now() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='export_cleanup_lease_invalid';
  END IF;
END $$;
REVOKE ALL ON FUNCTION folio_export_private.assert_cleanup(uuid,uuid,bigint)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.export_package_cleanup_renew(
  p_id uuid,p_token uuid,p_revision bigint
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM folio_export_private.assert_cleanup(p_id,p_token,p_revision);
  UPDATE folio_export_private.job SET cleanup_until=now()+interval '2 minutes'
    WHERE id=p_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.export_package_cleanup_renew(uuid,uuid,bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_cleanup_renew(uuid,uuid,bigint) TO service_role;

CREATE FUNCTION public.export_package_cleanup_entry_read(
  p_id uuid,p_token uuid,p_revision bigint
) RETURNS TABLE(entry_id uuid,expected_fragments integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM folio_export_private.assert_cleanup(p_id,p_token,p_revision);
  RETURN QUERY SELECT e.id,e.expected_fragments FROM folio_export_private.entry e
    WHERE e.job_id=p_id AND e.cleaned_at IS NULL ORDER BY e.id LIMIT 10;
END $$;
REVOKE ALL ON FUNCTION public.export_package_cleanup_entry_read(uuid,uuid,bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_cleanup_entry_read(uuid,uuid,bigint) TO service_role;

CREATE FUNCTION public.export_package_cleanup_entry_confirm(
  p_id uuid,p_token uuid,p_revision bigint,p_entry uuid,p_empty boolean
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_entry folio_export_private.entry;
BEGIN
  PERFORM folio_export_private.assert_cleanup(p_id,p_token,p_revision);
  IF p_empty IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_export_cleanup_scan';
  END IF;
  SELECT * INTO v_entry FROM folio_export_private.entry
    WHERE job_id=p_id AND id=p_entry FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_entry.cleaned_at IS NOT NULL THEN RETURN true; END IF;
  IF NOT p_empty THEN
    UPDATE folio_export_private.entry SET cleanup_empty_at=NULL WHERE id=p_entry;
    RETURN false;
  END IF;
  IF v_entry.cleanup_empty_at IS NULL THEN
    UPDATE folio_export_private.entry SET cleanup_empty_at=now() WHERE id=p_entry;
    RETURN false;
  END IF;
  IF v_entry.cleanup_empty_at>now()-interval '1 minute' THEN RETURN false; END IF;
  UPDATE folio_export_private.entry SET cleaned_at=now() WHERE id=p_entry;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.export_package_cleanup_entry_confirm(uuid,uuid,bigint,uuid,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_cleanup_entry_confirm(uuid,uuid,bigint,uuid,boolean)
  TO service_role;

CREATE FUNCTION public.export_package_cleanup_confirm(
  p_id uuid,p_token uuid,p_revision bigint
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM folio_export_private.assert_cleanup(p_id,p_token,p_revision);
  IF EXISTS (SELECT 1 FROM folio_export_private.entry
    WHERE job_id=p_id AND cleaned_at IS NULL) THEN RETURN false; END IF;
  UPDATE folio_export_private.job SET cleaned_at=now(),cleanup_token=NULL,
    cleanup_until=NULL,revision=revision+1 WHERE id=p_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.export_package_cleanup_confirm(uuid,uuid,bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_cleanup_confirm(uuid,uuid,bigint)
  TO service_role;
