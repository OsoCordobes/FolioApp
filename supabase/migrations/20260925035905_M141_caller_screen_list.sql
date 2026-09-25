-- M141: bounded screen inventory for durable revocation after reloading settings.
-- No token, hash, pairing code, patient, appointment or call is returned.
CREATE FUNCTION folio_caller_private.list_screens(p_org uuid,p_before_created timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; items jsonb; has_more boolean; cursor_value jsonb;
BEGIN
 IF (p_before_created IS NULL) IS DISTINCT FROM (p_before_id IS NULL)
  OR p_limit IS NULL OR p_limit<1 OR p_limit>50 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid screen page';
 END IF;
 actor:=folio_caller_private.staff(p_org,true);
 WITH page AS (
  SELECT s.id,s.created_at,s.pair_expires_at,s.token_expires_at,s.revoked_at,s.pair_used_at,
   m.id IS NOT NULL AND m.organization_id=p_org AND m.deleted_at IS NULL
    AND m.role IN ('OWNER','DIRECTOR')
    AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL) AS issuer_valid
  FROM folio_caller_private.screen s
  LEFT JOIN public.member m ON m.id=s.issuer_id
  WHERE s.organization_id=p_org AND (p_before_created IS NULL OR (s.created_at,s.id)<(p_before_created,p_before_id))
  ORDER BY s.created_at DESC,s.id DESC
  LIMIT p_limit+1
 ), visible AS (SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT p_limit)
 SELECT
  (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'screenId',id,'createdAt',created_at,'pairExpiresAt',pair_expires_at,
    'tokenExpiresAt',token_expires_at,
    'status',CASE
      WHEN revoked_at IS NOT NULL OR NOT issuer_valid THEN 'revocada'
      WHEN token_expires_at IS NOT NULL AND token_expires_at>clock_timestamp() THEN 'activa'
      WHEN pair_used_at IS NULL AND pair_expires_at>clock_timestamp() THEN 'pendiente'
      ELSE 'vencida' END
   ) ORDER BY created_at DESC,id DESC),'[]'::jsonb) FROM visible),
  (SELECT count(*)>p_limit FROM page),
  (SELECT jsonb_build_object('createdAt',created_at,'screenId',id) FROM visible
   ORDER BY created_at ASC,id ASC LIMIT 1)
 INTO items,has_more,cursor_value;
 RETURN jsonb_build_object('screens',items,'nextCursor',CASE WHEN has_more THEN cursor_value ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION folio_caller_private.list_screens(uuid,timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION folio_caller_private.list_screens(uuid,timestamptz,uuid,integer) TO authenticated;

CREATE FUNCTION public.caller_list_screens(p_org uuid,p_before_created timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT folio_caller_private.list_screens(p_org,p_before_created,p_before_id,p_limit)
$$;
REVOKE ALL ON FUNCTION public.caller_list_screens(uuid,timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.caller_list_screens(uuid,timestamptz,uuid,integer) TO authenticated;
