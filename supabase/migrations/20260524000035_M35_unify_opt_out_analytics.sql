-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M35 · Unificar opt_out_analytics, dropear opt_out_benchmarks
-- ════════════════════════════════════════════════════════════════════════════
-- Hallazgo auditoría HIGH-6: M02 creó organization.opt_out_analytics. M15 más
-- tarde agregó opt_out_benchmarks. La UI/app actualiza opt_out_analytics
-- (active-context.ts:112, :183). La pipeline de analytics lee opt_out_benchmarks
-- (M16:180). Son DOS columnas distintas con semántica solapada → user toggea
-- opt-out en /configuracion, pero la pipeline sigue incluyéndolo en benchmarks.
-- Potencial incumplimiento Ley 25.326 si se audita.
--
-- Fix: consolidar en opt_out_analytics (la semánticamente correcta + la que la
-- UI ya usa). Dropear opt_out_benchmarks. Recrear analytics.refresh_org_metrics
-- para leer la columna unificada.
--
-- Análisis de seguridad y compatibilidad:
--   - Backfill conservativo: cualquier org con opt_out_benchmarks=true pasa
--     a opt_out_analytics=true (preservamos la intención previa).
--   - DROP COLUMN no rompe app — verificado vía grep que NINGÚN code path
--     en lib/ ni app/ referencia opt_out_benchmarks.
--   - CREATE OR REPLACE FUNCTION es atómico (toma row lock); ningún query
--     in-flight de la pipeline ve un estado inconsistente.
--   - Idempotente: si M35 se aplica dos veces, el segundo run es no-op
--     (opt_out_benchmarks ya no existe → DROP IF EXISTS, función ya tiene
--     opt_out_analytics).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Backfill ─────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization'
      AND column_name = 'opt_out_benchmarks'
  ) THEN
    UPDATE public.organization
      SET opt_out_analytics = true
      WHERE opt_out_benchmarks = true AND opt_out_analytics = false;
    RAISE NOTICE 'M35 backfill aplicado · % orgs migradas a opt_out_analytics',
      (SELECT count(*) FROM public.organization WHERE opt_out_benchmarks = true);
  ELSE
    RAISE NOTICE 'M35 backfill skipped · opt_out_benchmarks ya no existe (idempotent rerun)';
  END IF;
END $$;

-- ─── 2. DROP COLUMN ──────────────────────────────────────────────────────

ALTER TABLE public.organization
  DROP COLUMN IF EXISTS opt_out_benchmarks;

-- ─── 3. Recrear analytics.refresh_org_metrics con opt_out_analytics ──────

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
        t.organization_id, t.estado, t.duracion_min, t.inicio, t.servicio_id, t.paciente_id
      FROM public.turno t
      WHERE t.inicio >= v_periodo_start AND t.inicio < v_periodo_end
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
        COUNT(*) FILTER (WHERE estado IN ('NO_ASISTIO','CERRADO','ATENDIENDO','EN_SALA','CONFIRMADO','AGENDADO'))::numeric AS total
      FROM turnos_periodo
      GROUP BY organization_id
    ),
    cancel_stats AS (
      SELECT organization_id,
        COUNT(*) FILTER (WHERE estado = 'CANCELADO')::numeric AS cancel,
        COUNT(*)::numeric AS total
      FROM turnos_periodo
      GROUP BY organization_id
    ),
    duracion_stats AS (
      SELECT organization_id,
        AVG(duracion_min)::numeric AS avg_dur,
        COUNT(*)::int AS total_turnos
      FROM turnos_periodo
      WHERE estado IN ('CERRADO', 'ATENDIENDO')
      GROUP BY organization_id
    ),
    primer_turno AS (
      SELECT paciente_id, organization_id, MIN(inicio) AS primer
      FROM public.turno
      GROUP BY paciente_id, organization_id
    ),
    pacientes_nuevos_stats AS (
      SELECT organization_id, COUNT(DISTINCT paciente_id)::int AS nuevos
      FROM primer_turno
      WHERE primer >= v_periodo_start AND primer < v_periodo_end
      GROUP BY organization_id
    ),
    pacientes_activos_stats AS (
      SELECT organization_id, COUNT(DISTINCT paciente_id)::int AS activos
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
    o.id, p_periodo,
    COALESCE(o.rubro, 'otros'),
    COALESCE(o.ciudad, 'desconocida'),
    COALESCE(o.provincia, 'desconocida'),
    (SELECT AVG(monto) FROM pagos_inicial pi WHERE pi.organization_id = o.id),
    (SELECT AVG(monto) FROM pagos_seguimiento ps WHERE ps.organization_id = o.id),
    d.avg_dur,
    CASE WHEN ns.total > 0 THEN ns.no_show / ns.total ELSE NULL END,
    CASE WHEN cs.total > 0 THEN cs.cancel / cs.total ELSE NULL END,
    NULL::numeric,
    COALESCE(pn.nuevos, 0),
    COALESCE(pa.activos, 0),
    NULL::numeric,
    NULL::numeric,
    COALESCE(d.total_turnos, 0)
  FROM public.organization o
  LEFT JOIN duracion_stats          d  ON d.organization_id  = o.id
  LEFT JOIN no_show_stats           ns ON ns.organization_id = o.id
  LEFT JOIN cancel_stats            cs ON cs.organization_id = o.id
  LEFT JOIN pacientes_nuevos_stats  pn ON pn.organization_id = o.id
  LEFT JOIN pacientes_activos_stats pa ON pa.organization_id = o.id
  WHERE o.deleted_at IS NULL
    AND o.opt_out_analytics = false                      -- M35 fix: era opt_out_benchmarks
    AND (d.total_turnos > 0 OR ns.total > 0);

  GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;
  RETURN v_rows_inserted;
END;
$$;

COMMENT ON FUNCTION analytics.refresh_org_metrics(date) IS
  'M35 · snapshot mensual por org. Idempotente. Excluye orgs con opt_out_analytics=true (columna unificada · era opt_out_benchmarks pre-M35). Fix de literales SEGUIMIENTO_ESTANDAR/EXTENDIDO heredado de M29.';
