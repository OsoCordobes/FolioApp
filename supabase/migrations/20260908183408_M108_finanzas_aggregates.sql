-- Additive read API. Deploy before code. Existing write policies are unchanged.
-- INVOKER deliberately retains turno, identity/caja fuerte and MFA RLS.
CREATE INDEX IF NOT EXISTS pago_created_cursor_idx ON public.pago(created_at DESC,id DESC);

CREATE FUNCTION public.finanzas_read_scope(p_organization uuid, p_start timestamptz, p_end timestamptz)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_role text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.mfa_access_allowed() THEN
    RAISE EXCEPTION 'finance_access_denied' USING ERRCODE='42501';
  END IF;
  v_role := public.user_role_in(p_organization);
  IF v_role IS NULL OR v_role NOT IN ('OWNER','DIRECTOR','PROFESIONAL') THEN
    RAISE EXCEPTION 'finance_access_denied' USING ERRCODE='42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR NOT isfinite(p_start) OR NOT isfinite(p_end)
     OR p_end <= p_start OR p_end-p_start > interval '367 days' THEN
    RAISE EXCEPTION 'finance_range_invalid' USING ERRCODE='22023';
  END IF;
  IF v_role='PROFESIONAL' THEN RETURN public.user_member_id_in(p_organization); END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION public.finanzas_summary(p_organization uuid, p_start timestamptz, p_end timestamptz,
  p_previous_start timestamptz, p_previous_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_member uuid; v_timezone text; v_result jsonb;
BEGIN
  v_member := public.finanzas_read_scope(p_organization,p_start,p_end);
  PERFORM public.finanzas_read_scope(p_organization,p_previous_start,p_previous_end);
  SELECT coalesce(timezone,'America/Argentina/Cordoba') INTO v_timezone FROM public.organization WHERE id=p_organization;
  WITH payments AS MATERIALIZED (
    SELECT p.monto_cents,p.estado,t.profesional_id,
      coalesce(s.tipo_canonico::text,s.nombre,'unknown') service_key,coalesce(s.nombre,'Sin servicio') service_name,
      ((CASE WHEN p.pagado_ts >= p_start AND p.pagado_ts < p_end THEN p.pagado_ts ELSE p.created_at END)
        AT TIME ZONE v_timezone)::date bucket
    FROM public.pago p JOIN public.turno t ON t.id=p.turno_id
    LEFT JOIN public.servicio s ON s.id=t.servicio_id
    WHERE t.organization_id=p_organization AND (v_member IS NULL OR t.profesional_id=v_member)
      AND p.created_at>=p_start AND p.created_at<p_end
  ), days AS (
    SELECT bucket,sum(monto_cents)::text cents FROM payments WHERE estado='PAGADO' GROUP BY bucket
  ), services AS (
    SELECT service_key id,min(service_name) nombre,count(*) count,sum(monto_cents)::text cents
    FROM payments WHERE estado='PAGADO' GROUP BY service_key
  ), professionals AS (
    SELECT profesional_id id,count(*) count,sum(monto_cents)::text cents
    FROM payments WHERE estado='PAGADO' GROUP BY profesional_id
  )
  SELECT jsonb_build_object(
    'paid_cents',coalesce(sum(monto_cents) FILTER(WHERE estado='PAGADO'),0)::text,
    'pending_cents',coalesce(sum(monto_cents) FILTER(WHERE estado<>'PAGADO'),0)::text,
    'pending_count',count(*) FILTER(WHERE estado<>'PAGADO'),
    'sessions',(SELECT count(*) FROM public.turno t WHERE t.organization_id=p_organization
      AND (v_member IS NULL OR t.profesional_id=v_member) AND t.estado='CERRADO' AND t.inicio>=p_start AND t.inicio<p_end),
    'previous_cents',(SELECT coalesce(sum(p.monto_cents),0)::text FROM public.pago p JOIN public.turno t ON t.id=p.turno_id
      WHERE t.organization_id=p_organization AND (v_member IS NULL OR t.profesional_id=v_member)
      AND p.estado='PAGADO' AND p.created_at>=p_previous_start AND p.created_at<p_previous_end),
    'days',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY bucket) FROM days d),'[]'::jsonb),
    'services',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY cents::numeric DESC,id) FROM services s),'[]'::jsonb),
    'professionals',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY cents::numeric DESC,id) FROM professionals r),'[]'::jsonb)
  ) INTO v_result FROM payments;
  RETURN v_result;
END $$;

CREATE FUNCTION public.finanzas_movements(p_organization uuid,p_start timestamptz,p_end timestamptz,
  p_status text DEFAULT 'todos',p_query text DEFAULT '',p_hashes text[] DEFAULT '{}',p_amount_cents text DEFAULT NULL,
  p_before_created timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_limit integer DEFAULT 50,
  p_check_revision boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE v_member uuid; v_result jsonb;
BEGIN
  v_member := public.finanzas_read_scope(p_organization,p_start,p_end);
  IF p_status IS NULL OR p_status NOT IN ('todos','cobrados','pendientes') OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR p_query IS NULL OR length(p_query)>120 OR coalesce(cardinality(p_hashes),0)>8
     OR (p_before_created IS NULL)<>(p_before_id IS NULL)
     OR (p_amount_cents IS NOT NULL AND p_amount_cents !~ '^[0-9]{1,25}$') THEN
    RAISE EXCEPTION 'finance_filter_invalid' USING ERRCODE='22023';
  END IF;
  WITH searched_patients AS MATERIALIZED (
    SELECT a.id FROM public.paciente_identidad i JOIN public.paciente a ON a.identidad_id=i.id
    WHERE cardinality(p_hashes)>0 AND i.organization_id=p_organization
      AND (i.nombre_hash=ANY(p_hashes) OR i.dni_hash=ANY(p_hashes))
  ), matching AS MATERIALIZED (
    SELECT p.id,p.created_at,coalesce(p.pagado_ts,p.created_at) fecha,p.monto_cents::text cents,
      p.metodo,p.estado,coalesce(s.nombre,'—') servicio,t.paciente_id
    FROM public.pago p JOIN public.turno t ON t.id=p.turno_id
    LEFT JOIN public.servicio s ON s.id=t.servicio_id
    WHERE t.organization_id=p_organization AND (v_member IS NULL OR t.profesional_id=v_member)
      AND p.created_at>=p_start AND p.created_at<p_end
      AND (p_status='todos' OR (p_status='cobrados' AND p.estado='PAGADO') OR (p_status='pendientes' AND p.estado<>'PAGADO'))
      AND (p_query='' OR strpos(lower(s.nombre),lower(p_query))>0 OR p.monto_cents::numeric=p_amount_cents::numeric
        OR t.paciente_id IN (SELECT id FROM searched_patients))
  ), candidates AS (
    SELECT * FROM matching WHERE p_before_created IS NULL OR (created_at,id)<(p_before_created,p_before_id)
    ORDER BY created_at DESC,id DESC LIMIT p_limit+1
  ), page AS (
    SELECT * FROM candidates ORDER BY created_at DESC,id DESC LIMIT p_limit
  ), hydrated AS (
    -- No identity lookup for every payment just to display fifty rows.
    SELECT p.*,i.nombre_cifrado,i.apellido_cifrado FROM page p
    LEFT JOIN public.paciente a ON a.id=p.paciente_id
    LEFT JOIN public.paciente_identidad i ON i.id=a.identidad_id
  ), revision_patients AS MATERIALIZED (
    -- Export detects ciphertext/visibility changes once per distinct patient.
    SELECT keys.paciente_id,i.nombre_cifrado,i.apellido_cifrado
    FROM (SELECT DISTINCT paciente_id FROM matching WHERE p_check_revision) keys
    LEFT JOIN public.paciente a ON a.id=keys.paciente_id
    LEFT JOIN public.paciente_identidad i ON i.id=a.identidad_id
  )
  SELECT jsonb_build_object(
    'rows',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY created_at DESC,id DESC) FROM hydrated r),'[]'::jsonb),
    'total_count',(SELECT count(*) FROM matching),
    'has_more',(SELECT count(*)>p_limit FROM candidates),
    -- Only exports request this digest. Any row/value/name visibility change aborts the export.
    -- One statement snapshot covers revision, counts and page. No PHI is returned in the digest.
    'revision',CASE WHEN p_check_revision THEN
      md5((SELECT coalesce(string_agg(to_jsonb(m)::text,',' ORDER BY id),'') FROM matching m)
        || ':' || (SELECT coalesce(string_agg(to_jsonb(i)::text,',' ORDER BY paciente_id),'') FROM revision_patients i))
      ELSE NULL END
  ) INTO v_result;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.finanzas_read_scope(uuid,timestamptz,timestamptz) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.finanzas_summary(uuid,timestamptz,timestamptz,timestamptz,timestamptz) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.finanzas_movements(uuid,timestamptz,timestamptz,text,text,text[],text,timestamptz,uuid,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finanzas_read_scope(uuid,timestamptz,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finanzas_summary(uuid,timestamptz,timestamptz,timestamptz,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finanzas_movements(uuid,timestamptz,timestamptz,text,text,text[],text,timestamptz,uuid,integer,boolean) TO authenticated;

-- Raw REST must respect the same professional scope, including INSERT/UPDATE.
-- Existing permissive policies still decide whether each other role may act;
-- this restriction does not grant coordinators/assistants any new capability.
CREATE POLICY pago_professional_scope ON public.pago AS RESTRICTIVE FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.turno t WHERE t.id=pago.turno_id
    AND public.user_role_in(t.organization_id) IS NOT NULL
    AND (public.user_role_in(t.organization_id)<>'PROFESIONAL'
      OR t.profesional_id=public.user_member_id_in(t.organization_id))
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.turno t WHERE t.id=pago.turno_id
    AND public.user_role_in(t.organization_id) IS NOT NULL
    AND (public.user_role_in(t.organization_id)<>'PROFESIONAL'
      OR t.profesional_id=public.user_member_id_in(t.organization_id))
));

-- M22's permissive false policy was OR-ed with pago_write_admin FOR ALL.
-- Financial audit rows cannot be deleted by an authenticated application user.
CREATE POLICY pago_append_only_delete ON public.pago AS RESTRICTIVE FOR DELETE TO authenticated USING(false);
