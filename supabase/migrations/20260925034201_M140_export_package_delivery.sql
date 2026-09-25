-- M140 / B06b3a: bounded server-only reads for an authenticated HTTP adapter.
-- This does not grant direct table or Storage access to a client role.
CREATE FUNCTION folio_export_private.assert_ready(p_id uuid, p_actor uuid)
RETURNS folio_export_private.job
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job folio_export_private.job;
BEGIN
  PERFORM folio_export_private.assert_server();
  SELECT * INTO v_job FROM folio_export_private.job j
    WHERE j.id=p_id AND j.actor_user_id=p_actor;
  IF NOT FOUND OR v_job.state<>'ready' OR v_job.expires_at<=now() THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='export_package_not_deliverable';
  END IF;
  PERFORM folio_export_private.assert_authority(v_job);
  RETURN v_job;
END $$;
REVOKE ALL ON FUNCTION folio_export_private.assert_ready(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Recover an uncertain begin using the original operation ID. The caller must
-- also match its current organization and patient; no lease token is returned.
CREATE FUNCTION public.export_package_operation_read(
  p_actor uuid,p_org uuid,p_patient uuid,p_operation uuid
) RETURNS TABLE(job_id uuid,organization_id uuid,paciente_id uuid,
  actor_user_id uuid,actor_member_id uuid,source_fingerprint text,state text,
  revision bigint,expected_entries integer,expires_at timestamptz,lease_until timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job folio_export_private.job;
BEGIN
  PERFORM folio_export_private.assert_server();
  IF p_actor IS NULL OR p_org IS NULL OR p_patient IS NULL OR p_operation IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_export_operation';
  END IF;
  SELECT * INTO v_job FROM folio_export_private.job j
    WHERE j.actor_user_id=p_actor AND j.organization_id=p_org
      AND j.paciente_id=p_patient AND j.idempotency_key=p_operation;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM folio_export_private.assert_authority(v_job);
  RETURN QUERY SELECT v_job.id,v_job.organization_id,v_job.paciente_id,
    v_job.actor_user_id,v_job.actor_member_id,v_job.source_fingerprint,
    v_job.state,v_job.revision,v_job.expected_entries,v_job.expires_at,v_job.lease_until;
END $$;
REVOKE ALL ON FUNCTION public.export_package_operation_read(uuid,uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_operation_read(uuid,uuid,uuid,uuid)
  TO service_role;

-- A page is at most 50 entries; the total is checked against the immutable
-- READY contract on every page. No private path, bucket or URL is returned.
CREATE FUNCTION public.export_package_delivery_page(
  p_id uuid,p_actor uuid,p_offset integer,p_limit integer
) RETURNS TABLE(expected_entries integer,expires_at timestamptz,prepared_at timestamptz,
  entry_id uuid,kind text,source_id uuid,source_index smallint,
  expected_fragments integer,actual_fragments bigint,total_bytes bigint,
  source_hash_kind text,source_sha256 text,computed_sha256 text,
  registered_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job folio_export_private.job; v_count bigint;
BEGIN
  IF p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 10000
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_export_delivery_page';
  END IF;
  v_job:=folio_export_private.assert_ready(p_id,p_actor);
  SELECT count(*) INTO v_count FROM folio_export_private.entry e WHERE e.job_id=p_id;
  IF v_count<>v_job.expected_entries THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='export_delivery_inventory_changed';
  END IF;
  RETURN QUERY SELECT v_job.expected_entries,v_job.expires_at,
    (SELECT j.registered_at FROM folio_export_private.entry j
      WHERE j.job_id=p_id AND j.kind='json'),e.id,e.kind,
    e.source_id,e.source_index,e.expected_fragments,
    f.actual_fragments,f.total_bytes,e.source_hash_kind,e.source_sha256,
    e.computed_sha256,e.registered_at
  FROM folio_export_private.entry e
  CROSS JOIN LATERAL (
    SELECT count(*) AS actual_fragments,coalesce(sum(x.bytes),0)::bigint AS total_bytes
    FROM folio_export_private.fragment x WHERE x.job_id=p_id AND x.entry_id=e.id
  ) f
  WHERE e.job_id=p_id
  ORDER BY e.kind,e.source_id,e.source_index
  LIMIT p_limit OFFSET p_offset;
END $$;
REVOKE ALL ON FUNCTION public.export_package_delivery_page(uuid,uuid,integer,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_delivery_page(uuid,uuid,integer,integer)
  TO service_role;

-- Single verified ledger fragment. Storage path remains server-derived from
-- (job, entry, ordinal), and the HTTP adapter rechecks live source authority.
CREATE FUNCTION public.export_package_delivery_fragment(
  p_id uuid,p_actor uuid,p_entry uuid,p_ordinal integer
) RETURNS TABLE(entry_id uuid,kind text,source_id uuid,source_index smallint,
  expected_fragments integer,source_hash_kind text,source_sha256 text,
  computed_sha256 text,fragment_bytes integer,fragment_sha256 text,
  expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_job folio_export_private.job;
BEGIN
  IF p_entry IS NULL OR p_ordinal IS NULL OR p_ordinal NOT BETWEEN 0 AND 9999 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid_export_delivery_fragment';
  END IF;
  v_job:=folio_export_private.assert_ready(p_id,p_actor);
  RETURN QUERY SELECT e.id,e.kind,e.source_id,e.source_index,e.expected_fragments,
    e.source_hash_kind,e.source_sha256,e.computed_sha256,f.bytes,f.sha256,
    v_job.expires_at
  FROM folio_export_private.entry e
  JOIN folio_export_private.fragment f ON f.job_id=e.job_id AND f.entry_id=e.id
  WHERE e.job_id=p_id AND e.id=p_entry AND e.kind<>'withdrawn_document'
    AND e.verified_at IS NOT NULL AND e.computed_sha256 IS NOT NULL
    AND f.ordinal=p_ordinal AND p_ordinal<e.expected_fragments;
END $$;
REVOKE ALL ON FUNCTION public.export_package_delivery_fragment(uuid,uuid,uuid,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_package_delivery_fragment(uuid,uuid,uuid,integer)
  TO service_role;
