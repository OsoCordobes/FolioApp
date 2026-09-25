-- M138: metadata of withdrawn clinical documents for authorized export only.
-- M08's regular SELECT and M104's Storage denial remain unchanged. The RPC
-- never returns an object path, bucket, URL or file bytes.
CREATE FUNCTION public.export_retired_document_metadata(
  p_org uuid,p_patient uuid,p_offset integer,p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  v_uid uuid:=auth.uid();
  v_status jsonb;
  v_member public.member%ROWTYPE;
  v_total integer;
  v_all_total integer;
  v_rows jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_uid IS NULL
    OR p_org IS NULL OR p_patient IS NULL OR p_offset IS NULL
    OR p_offset NOT BETWEEN 0 AND 10000 OR p_limit IS NULL
    OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='retired_export_access_denied';
  END IF;
  PERFORM folio_mfa_private.assert_access();
  v_status:=public.mfa_access_status();
  IF (v_status->>'isStaff')::boolean IS DISTINCT FROM true
    OR (v_status->>'allowed')::boolean IS DISTINCT FROM true
    OR ((v_status->>'required')::boolean IS TRUE AND (
      (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2'
      OR (v_status->>'hasVerifiedFactor')::boolean IS DISTINCT FROM true
      OR (v_status->>'sessionValid')::boolean IS DISTINCT FROM true)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='retired_export_access_denied';
  END IF;
  SELECT m.* INTO v_member FROM public.member m
  JOIN public.organization o ON o.id=m.organization_id
  WHERE m.profile_id=v_uid AND m.organization_id=p_org
    AND m.deleted_at IS NULL AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
    AND o.deleted_at IS NULL;
  IF NOT FOUND OR NOT public.can_read_clinical(p_org) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='retired_export_access_denied';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.paciente p
    JOIN public.paciente_identidad pi ON pi.id=p.identidad_id AND pi.organization_id=p.organization_id
    WHERE p.id=p_patient AND p.organization_id=p_org AND p.deleted_at IS NULL
      AND p.pseudonimizado_en IS NULL AND pi.deleted_at IS NULL
      AND (p.caja_fuerte_profesional IS NULL OR p.caja_fuerte_profesional=v_member.id)
      AND (
        v_member.role='OWNER'
        OR (v_member.role='DIRECTOR' AND v_member.es_colegiado)
        OR (v_member.role='PROFESIONAL' AND (
          p.profesional_principal_id=v_member.id
          OR public.profesional_attended_paciente(p.id,p_org)
        ))
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='retired_export_access_denied';
  END IF;
  SELECT count(*)::integer,count(*) FILTER (WHERE d.deleted_at IS NOT NULL)::integer
    INTO v_all_total,v_total FROM public.documento_clinico d
    WHERE d.organization_id=p_org AND d.paciente_id=p_patient;
  IF v_all_total>10000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='retired_export_limit';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'organization_id',d.organization_id,'paciente_id',d.paciente_id,
    'sesion_id',d.sesion_id,'tipo',d.tipo::text,'mime_type',d.mime_type,
    'tamanio_bytes',d.tamanio_bytes,'content_sha256',d.content_sha256,
    'fecha_estudio',d.fecha_estudio,'descripcion_cifrado',
      CASE WHEN d.descripcion_cifrado IS NULL THEN NULL ELSE '\x'||encode(d.descripcion_cifrado,'hex') END,
    'subido_por_id',d.subido_por_id,'consentimiento_id',d.consentimiento_id,
    'created_at',d.created_at,'deleted_at',d.deleted_at
  ) ORDER BY d.id),'[]'::jsonb) INTO v_rows
  FROM (
    SELECT id,organization_id,paciente_id,sesion_id,tipo,mime_type,tamanio_bytes,
      content_sha256,fecha_estudio,descripcion_cifrado,subido_por_id,
      consentimiento_id,created_at,deleted_at
    FROM public.documento_clinico
    WHERE organization_id=p_org AND paciente_id=p_patient AND deleted_at IS NOT NULL
    ORDER BY id LIMIT p_limit OFFSET p_offset
  ) d;
  RETURN jsonb_build_object('total',v_total,'all_total',v_all_total,'rows',v_rows);
END $$;
REVOKE ALL ON FUNCTION public.export_retired_document_metadata(uuid,uuid,integer,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.export_retired_document_metadata(uuid,uuid,integer,integer)
  TO authenticated;
