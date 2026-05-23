-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M29 · Fix analytics enum literals (SEGUIMIENTO_ESTANDAR/EXTENDIDO)
-- ════════════════════════════════════════════════════════════════════════════
-- BUG (M16:96): `tipo_canonico IN ('SEGUIMIENTO', 'CONTROL')` filtraba pagos
-- de seguimiento usando literales que NO EXISTEN en el enum
-- tipo_servicio_canonico (M09:30). El enum válido es:
--     CONSULTA_INICIAL, SEGUIMIENTO_ESTANDAR, SEGUIMIENTO_EXTENDIDO,
--     PACK_SESIONES, SERVICIO_ESPECIALIZADO
--
-- Postgres comparó como texto (no como enum) y devolvió 0 filas siempre, así
-- que `precio_avg_seguimiento` venía NULL para todas las orgs forever —
-- una de las 5 métricas core de F8 silenciosamente rota.
--
-- Fix: recrear analytics.refresh_org_metrics con el CTE `pagos_seguimiento`
-- corregido. Resto idéntico (verbatim de M16) — sin cambios de semántica.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION analytics.refresh_org_metrics(p_periodo date)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, analytics
AS $$
DECLARE
  v_rows_inserted int := 0;
  v_periodo_start timestamptz;
  v_periodo_end   timestamptz;
BEGIN
  p_periodo := date_trunc('month', p_periodo)::date;
  v_periodo_start := p_periodo::timestamptz;
  v_periodo_end   := (p_periodo + INTERVAL '1 month')::timestamptz;

  DELETE FROM analytics.org_metrics_monthly WHERE periodo = p_periodo;

  WITH
    turnos_periodo AS (
      SELECT
        t.organization_id,
        t.estado,
        t.duracion_min,
        t.inicio,
        t.servicio_id,
        t.paciente_id
      FROM public.turno t
      WHERE t.inicio >= v_periodo_start
        AND t.inicio <  v_periodo_end
    ),
    pagos_inicial AS (
      SELECT t.organization_id, p.monto_cents / 100.0 AS monto
      FROM public.pago p
      JOIN public.turno t    ON t.id = p.turno_id
      JOIN public.servicio s ON s.id = t.servicio_id
      WHERE t.inicio >= v_periodo_start AND t.inicio < v_periodo_end
        AND s.tipo_canonico = 'CONSULTA_INICIAL'
        AND p.estado = 'PAGADO'
    ),
    -- ⬇ FIX M29: literales corregidos al enum real
    pagos_seguimiento AS (
      SELECT t.organization_id, p.monto_cents / 100.0 AS monto
      FROM public.pago p
      JOIN public.turno t    ON t.id = p.turno_id
      JOIN public.servicio s ON s.id = t.servicio_id
      WHERE t.inicio >= v_periodo_start AND t.inicio < v_periodo_end
        AND s.tipo_canonico IN ('SEGUIMIENTO_ESTANDAR', 'SEGUIMIENTO_EXTENDIDO')
        AND p.estado = 'PAGADO'
    ),
    no_show_stats AS (
      SELECT
        organization_id,
        COUNT(*) FILTER (WHERE estado = 'NO_ASISTIO')::numeric AS no_show,
        COUNT(*) FILTER (WHERE estado IN ('NO_ASISTIO', 'CERRADO', 'ATENDIENDO', 'EN_SALA', 'CONFIRMADO', 'AGENDADO'))::numeric AS total
      FROM turnos_periodo
      GROUP BY organization_id
    ),
    cancel_stats AS (
      SELECT
        organization_id,
        COUNT(*) FILTER (WHERE estado = 'CANCELADO')::numeric AS cancel,
        COUNT(*)::numeric AS total
      FROM turnos_periodo
      GROUP BY organization_id
    ),
    duracion_stats AS (
      SELECT
        organization_id,
        AVG(duracion_min)::numeric AS avg_dur,
        COUNT(*)::int AS total_turnos
      FROM turnos_periodo
      WHERE estado IN ('CERRADO', 'ATENDIENDO')
      GROUP BY organization_id
    ),
    primer_turno AS (
      SELECT
        paciente_id,
        organization_id,
        MIN(inicio) AS primer
      FROM public.turno
      GROUP BY paciente_id, organization_id
    ),
    pacientes_nuevos_stats AS (
      SELECT
        organization_id,
        COUNT(DISTINCT paciente_id)::int AS nuevos
      FROM primer_turno
      WHERE primer >= v_periodo_start AND primer < v_periodo_end
      GROUP BY organization_id
    ),
    pacientes_activos_stats AS (
      SELECT
        organization_id,
        COUNT(DISTINCT paciente_id)::int AS activos
      FROM turnos_periodo
      WHERE paciente_id IS NOT NULL
      GROUP BY organization_id
    )
  INSERT INTO analytics.org_metrics_monthly (
    org_id, periodo, especialidad, ciudad, provincia,
    precio_avg_inicial, precio_avg_seguimiento, duracion_avg_min,
    tasa_no_show, tasa_cancelacion, ocupacion_pct,
    pacientes_nuevos, pacientes_activos, tasa_retencion_60d,
    tiempo_entre_sesiones_dias, total_turnos
  )
  SELECT
    o.id AS org_id,
    p_periodo AS periodo,
    COALESCE(o.rubro, 'otros') AS especialidad,
    COALESCE(o.ciudad, 'desconocida') AS ciudad,
    COALESCE(o.provincia, 'desconocida') AS provincia,
    (SELECT AVG(monto) FROM pagos_inicial pi WHERE pi.organization_id = o.id) AS precio_avg_inicial,
    (SELECT AVG(monto) FROM pagos_seguimiento ps WHERE ps.organization_id = o.id) AS precio_avg_seguimiento,
    d.avg_dur AS duracion_avg_min,
    CASE WHEN ns.total > 0 THEN ns.no_show / ns.total ELSE NULL END AS tasa_no_show,
    CASE WHEN cs.total > 0 THEN cs.cancel / cs.total ELSE NULL END AS tasa_cancelacion,
    NULL::numeric AS ocupacion_pct,
    COALESCE(pn.nuevos, 0) AS pacientes_nuevos,
    COALESCE(pa.activos, 0) AS pacientes_activos,
    NULL::numeric AS tasa_retencion_60d,
    NULL::numeric AS tiempo_entre_sesiones_dias,
    COALESCE(d.total_turnos, 0) AS total_turnos
  FROM public.organization o
  LEFT JOIN duracion_stats          d  ON d.organization_id  = o.id
  LEFT JOIN no_show_stats           ns ON ns.organization_id = o.id
  LEFT JOIN cancel_stats            cs ON cs.organization_id = o.id
  LEFT JOIN pacientes_nuevos_stats  pn ON pn.organization_id = o.id
  LEFT JOIN pacientes_activos_stats pa ON pa.organization_id = o.id
  WHERE o.deleted_at IS NULL
    AND o.opt_out_benchmarks = false
    AND (d.total_turnos > 0 OR ns.total > 0);

  GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;
  RETURN v_rows_inserted;
END;
$$;

COMMENT ON FUNCTION analytics.refresh_org_metrics(date) IS
  'M29 · snapshot mensual por org. Idempotente. Excluye opt_out_benchmarks. Fix sobre M16: literales SEGUIMIENTO_ESTANDAR/EXTENDIDO en pagos_seguimiento CTE.';
