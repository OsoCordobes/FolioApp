-- M114: bounded directory; no new privilege over paciente/identity/turno RLS.
CREATE INDEX IF NOT EXISTS paciente_directory_cursor_idx
  ON public.paciente (organization_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.pacientes_directory_page(
  p_org uuid, p_hashes text[] DEFAULT '{}', p_phone_hashes text[] DEFAULT '{}',
  p_search boolean DEFAULT false, p_status text DEFAULT 'todos',
  p_coverage text DEFAULT 'todas', p_before_created timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL, p_limit integer DEFAULT 50,
  p_cutoff timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public AS $$
DECLARE v_result jsonb; v_cutoff timestamptz := coalesce(p_cutoff, statement_timestamp());
BEGIN
  IF auth.uid() IS NULL OR NOT public.mfa_access_allowed()
     OR public.user_role_in(p_org) IS NULL THEN
    RAISE EXCEPTION 'directory_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR p_status IS NULL OR p_status NOT IN ('todos','activos','nuevos','reactivar','inactivos','alta')
    OR p_coverage IS NULL OR length(p_coverage) > 200
    OR p_search IS NULL OR p_hashes IS NULL OR p_phone_hashes IS NULL
    OR cardinality(p_hashes) > 8 OR cardinality(p_phone_hashes) > 8
    OR EXISTS (SELECT 1 FROM unnest(p_hashes || p_phone_hashes) h WHERE h IS NULL OR h !~ '^[a-f0-9]{64}$')
    OR (p_before_created IS NULL) <> (p_before_id IS NULL)
    OR (p_before_id IS NOT NULL AND p_cutoff IS NULL)
    OR NOT isfinite(v_cutoff) OR v_cutoff > statement_timestamp()
    OR (p_before_created IS NOT NULL AND (NOT isfinite(p_before_created) OR p_before_created > v_cutoff)) THEN
    RAISE EXCEPTION 'directory_invalid_query' USING ERRCODE = '22023';
  END IF;

  WITH base AS MATERIALIZED (
    SELECT d.*, pi.telefono_hash, pi.cobertura_nombre, pi.cobertura_plan,
      pi.updated_at AS identidad_updated_at,
      CASE WHEN EXISTS (SELECT 1 FROM unnest(d.tags) t WHERE upper(t) = 'ALTA') THEN 'alta'
           WHEN EXISTS (SELECT 1 FROM unnest(d.tags) t WHERE upper(t) = 'PAUSA') THEN 'pausa'
           WHEN d.proximo_turno IS NULL AND d.ultima_visita <= v_cutoff - interval '61 days' THEN 'inactivo'
           ELSE 'activo' END AS estado
    FROM public.paciente_directorio_lite d
    JOIN public.paciente_identidad pi ON pi.id = d.identidad_id
    WHERE d.organization_id = p_org AND d.deleted_at IS NULL AND d.created_at <= v_cutoff
  ), filtered AS MATERIALIZED (
    SELECT * FROM base b WHERE
      (NOT p_search OR b.nombre_hash = ANY(p_hashes) OR b.dni_hash = ANY(p_hashes) OR b.telefono_hash = ANY(p_phone_hashes))
      AND (p_coverage = 'todas' OR (p_coverage = '__particular' AND b.cobertura_nombre IS NULL) OR b.cobertura_nombre = p_coverage)
      AND (p_status = 'todos' OR (p_status = 'nuevos' AND b.tipo_paciente::text = 'NUEVO')
        OR (p_status = 'activos' AND b.estado = 'activo')
        OR (p_status IN ('reactivar','inactivos') AND b.estado = 'inactivo')
        OR (p_status = 'alta' AND b.estado = 'alta'))
  ), limited AS MATERIALIZED (
    SELECT * FROM filtered WHERE p_before_id IS NULL OR (created_at,paciente_id) < (p_before_created,p_before_id)
    ORDER BY created_at DESC,paciente_id DESC LIMIT p_limit + 1
  ), page AS MATERIALIZED (
    SELECT * FROM limited ORDER BY created_at DESC,paciente_id DESC LIMIT p_limit
  ) SELECT jsonb_build_object(
    'rows',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY created_at DESC,paciente_id DESC) FROM page p),'[]'::jsonb),
    'total',(SELECT count(*) FROM filtered),
    'counts',(SELECT jsonb_build_object('todos',count(*),'activos',count(*) FILTER (WHERE estado='activo'),
      'nuevos',count(*) FILTER (WHERE tipo_paciente::text='NUEVO'),'reactivar',count(*) FILTER (WHERE estado='inactivo'),
      'inactivos',count(*) FILTER (WHERE estado='inactivo'),'alta',count(*) FILTER (WHERE estado='alta')) FROM base),
    'coberturas',coalesce((SELECT jsonb_agg(c ORDER BY c) FROM (SELECT DISTINCT cobertura_nombre c FROM base WHERE cobertura_nombre IS NOT NULL) x),'[]'::jsonb),
    'revision',(SELECT md5(coalesce(string_agg(md5(to_jsonb(f)::text),',' ORDER BY created_at,paciente_id),'')) FROM filtered f),
    'cutoff',v_cutoff,
    'next_cursor',CASE WHEN (SELECT count(*) FROM limited)>p_limit THEN
      (SELECT jsonb_build_object('createdAt',created_at,'id',paciente_id) FROM page ORDER BY created_at,paciente_id LIMIT 1)
      ELSE NULL END
  ) INTO v_result;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.pacientes_directory_page(uuid,text[],text[],boolean,text,text,timestamptz,uuid,integer,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pacientes_directory_page(uuid,text[],text[],boolean,text,text,timestamptz,uuid,integer,timestamptz) TO authenticated;
