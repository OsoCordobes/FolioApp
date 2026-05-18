-- ============================================================================
-- M16 · analytics pipeline (refresh functions + k-anonymity suppression)
-- ============================================================================
-- Funciones SECURITY DEFINER que rellenan las tablas de analytics. Se ejecutan
-- vía cron (Vercel Cron en F9 o pg_cron en Pro). Lógica:
--
--   1. analytics.refresh_org_metrics(p_periodo date) → llena org_metrics_monthly
--      con los datos del mes p_periodo (primer día del mes). Ignora orgs con
--      opt_out_benchmarks=true. Calcula métricas usando agregados sobre turno,
--      sesion, paciente (sin tocar PII).
--
--   2. analytics.refresh_cohort_benchmarks(p_periodo date) → calcula
--      percentiles por (especialidad × nivel_geografico × ambito × metrica)
--      con cascada y k-anonymity hard floor. Winsorizing 5/95 antes de
--      percentile_cont. Solo inserta cohorts con n_orgs >= 5 (10 para
--      monetarias).
--
--   3. analytics.render_insights(p_periodo date) → por cada org, elige el
--      cohort más específico que cumpla k, compara cada métrica vs sus
--      percentiles, elige plantilla, escribe en org_insights_cache.
--
--   4. analytics.refresh_all(p_periodo date) → orquesta los 3 anteriores.
--
-- En MVP Free de Supabase no usamos pg_cron (limitado en Free); el endpoint
-- /api/analytics/refresh con secreto cron-token + Vercel Cron @ 03:00 AR
-- dispara la pipeline. F9 implementa ese endpoint.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Helper: métricas monetarias requieren k=10 (no k=5)
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION analytics.metrica_k_min(p_metrica text) RETURNS int
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_metrica IN ('precio_avg_inicial', 'precio_avg_seguimiento') THEN 10
    ELSE 5
  END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. refresh_org_metrics: snapshot mensual por org
-- ─────────────────────────────────────────────────────────────────────────

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
  -- Normalizar a primer día del mes
  p_periodo := date_trunc('month', p_periodo)::date;
  v_periodo_start := p_periodo::timestamptz;
  v_periodo_end   := (p_periodo + INTERVAL '1 month')::timestamptz;

  -- Borrar snapshot previo del periodo (idempotencia)
  DELETE FROM analytics.org_metrics_monthly WHERE periodo = p_periodo;

  -- Insertar agregado por org (skip opt-outs y orgs sin actividad)
  WITH
    -- Base: turnos del periodo, excluyendo NO_ASISTIO/CERRADO ya filtrados aparte
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
    -- Pagos por turno (precio efectivo) para diferenciar inicial vs seguimiento
    -- usamos el tipo_canonico del servicio asociado.
    pagos_inicial AS (
      SELECT t.organization_id, p.monto_cents / 100.0 AS monto
      FROM public.pago p
      JOIN public.turno t ON t.id = p.turno_id
      JOIN public.servicio s ON s.id = t.servicio_id
      WHERE t.inicio >= v_periodo_start AND t.inicio < v_periodo_end
        AND s.tipo_canonico = 'CONSULTA_INICIAL'
        AND p.estado = 'PAGADO'
    ),
    pagos_seguimiento AS (
      SELECT t.organization_id, p.monto_cents / 100.0 AS monto
      FROM public.pago p
      JOIN public.turno t ON t.id = p.turno_id
      JOIN public.servicio s ON s.id = t.servicio_id
      WHERE t.inicio >= v_periodo_start AND t.inicio < v_periodo_end
        AND s.tipo_canonico IN ('SEGUIMIENTO', 'CONTROL')
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
    -- Pacientes nuevos = primer turno del paciente cayó en el periodo
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
    NULL::numeric AS ocupacion_pct,                  -- requiere disponibilidad_horas total → V2
    COALESCE(pn.nuevos, 0) AS pacientes_nuevos,
    COALESCE(pa.activos, 0) AS pacientes_activos,
    NULL::numeric AS tasa_retencion_60d,              -- V2
    NULL::numeric AS tiempo_entre_sesiones_dias,      -- V2
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
  'Snapshot mensual de cada org. Idempotente: borra/reinserta para el periodo. Excluye opt-outs.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. refresh_cohort_benchmarks: percentiles por cohort
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION analytics.refresh_cohort_benchmarks(p_periodo date)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, analytics
AS $$
DECLARE
  v_rows_inserted int := 0;
  v_metricas      text[] := ARRAY[
    'precio_avg_inicial',
    'precio_avg_seguimiento',
    'duracion_avg_min',
    'tasa_no_show',
    'tasa_cancelacion',
    'pacientes_nuevos',
    'pacientes_activos',
    'total_turnos'
  ];
  v_metrica text;
BEGIN
  p_periodo := date_trunc('month', p_periodo)::date;

  -- Idempotencia
  DELETE FROM analytics.cohort_benchmarks WHERE periodo = p_periodo;

  -- Iterar por métrica (más simple debuggear vs query gigante con UNION ALL)
  FOREACH v_metrica IN ARRAY v_metricas LOOP
    EXECUTE format($f$
      WITH base AS (
        SELECT
          m.especialidad,
          m.ciudad,
          m.provincia,
          g.gran_area,
          g.region_nacional,
          (m.%1$I)::numeric AS valor
        FROM analytics.org_metrics_monthly m
        LEFT JOIN analytics.geo_regions g ON g.ciudad = m.ciudad
        WHERE m.periodo = %2$L
          AND m.%1$I IS NOT NULL
      ),
      -- Winsorizing 5/95 por (especialidad × periodo). Recorta outliers globales
      -- para que la percentil del cohort no esté contaminada por ceros o picos.
      bounds AS (
        SELECT
          especialidad,
          percentile_cont(0.05) WITHIN GROUP (ORDER BY valor) AS p05,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY valor) AS p95
        FROM base
        GROUP BY especialidad
      ),
      winsor AS (
        SELECT
          b.especialidad,
          b.ciudad,
          b.provincia,
          b.gran_area,
          b.region_nacional,
          GREATEST(LEAST(b.valor, bd.p95), bd.p05) AS valor
        FROM base b
        JOIN bounds bd ON bd.especialidad = b.especialidad
      ),
      -- Niveles geo agrupados manualmente con UNION ALL
      por_ciudad AS (
        SELECT especialidad, 'ciudad' AS nivel_geografico, ciudad AS ambito, valor FROM winsor
      ),
      por_gran_area AS (
        SELECT especialidad, 'gran_area' AS nivel_geografico, gran_area AS ambito, valor
        FROM winsor WHERE gran_area IS NOT NULL
      ),
      por_provincia AS (
        SELECT especialidad, 'provincia' AS nivel_geografico, provincia AS ambito, valor FROM winsor
      ),
      por_region AS (
        SELECT especialidad, 'region' AS nivel_geografico, region_nacional AS ambito, valor
        FROM winsor WHERE region_nacional IS NOT NULL
      ),
      por_nacional AS (
        SELECT especialidad, 'nacional' AS nivel_geografico, 'AR' AS ambito, valor FROM winsor
      ),
      todos AS (
        SELECT * FROM por_ciudad
        UNION ALL SELECT * FROM por_gran_area
        UNION ALL SELECT * FROM por_provincia
        UNION ALL SELECT * FROM por_region
        UNION ALL SELECT * FROM por_nacional
      )
      INSERT INTO analytics.cohort_benchmarks (
        especialidad, nivel_geografico, ambito, periodo, metrica,
        n_orgs, p10, p25, p50, p75, p90, mean, stddev
      )
      SELECT
        especialidad,
        nivel_geografico,
        ambito,
        %2$L::date AS periodo,
        %3$L AS metrica,
        COUNT(*) AS n_orgs,
        percentile_cont(0.10) WITHIN GROUP (ORDER BY valor) AS p10,
        percentile_cont(0.25) WITHIN GROUP (ORDER BY valor) AS p25,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY valor) AS p50,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY valor) AS p75,
        percentile_cont(0.90) WITHIN GROUP (ORDER BY valor) AS p90,
        AVG(valor) AS mean,
        STDDEV_POP(valor) AS stddev
      FROM todos
      GROUP BY especialidad, nivel_geografico, ambito
      HAVING COUNT(*) >= analytics.metrica_k_min(%3$L);
    $f$, v_metrica, p_periodo, v_metrica);

    GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;
  END LOOP;

  RETURN (SELECT COUNT(*) FROM analytics.cohort_benchmarks WHERE periodo = p_periodo);
END;
$$;

COMMENT ON FUNCTION analytics.refresh_cohort_benchmarks(date) IS
  'Calcula percentiles por (especialidad × nivel_geo × ámbito × métrica). Winsoriza 5/95, suprime cohorts con n<k.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. render_insights: elige cohort + plantilla, escribe cache
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION analytics.render_insights(p_periodo date)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, analytics
AS $$
DECLARE
  v_orgs_processed int := 0;
  r RECORD;
  v_insights jsonb;
BEGIN
  p_periodo := date_trunc('month', p_periodo)::date;
  DELETE FROM analytics.org_insights_cache WHERE periodo = p_periodo;

  FOR r IN
    SELECT
      m.org_id,
      m.especialidad,
      m.ciudad,
      m.provincia,
      g.gran_area,
      g.region_nacional,
      m.precio_avg_inicial,
      m.precio_avg_seguimiento,
      m.duracion_avg_min,
      m.tasa_no_show,
      m.tasa_cancelacion,
      m.pacientes_nuevos,
      m.pacientes_activos,
      m.total_turnos
    FROM analytics.org_metrics_monthly m
    LEFT JOIN analytics.geo_regions g ON g.ciudad = m.ciudad
    WHERE m.periodo = p_periodo
  LOOP
    v_insights := analytics.compute_org_insights(p_periodo, r);
    IF jsonb_array_length(v_insights) > 0 THEN
      INSERT INTO analytics.org_insights_cache (org_id, periodo, insights)
      VALUES (r.org_id, p_periodo, v_insights);
      v_orgs_processed := v_orgs_processed + 1;
    END IF;
  END LOOP;

  RETURN v_orgs_processed;
END;
$$;

COMMENT ON FUNCTION analytics.render_insights(date) IS
  'Para cada org del periodo, escribe insights renderizados a org_insights_cache.';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. compute_org_insights: helper que arma el JSONB para una org
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION analytics.compute_org_insights(
  p_periodo date,
  r record
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, analytics
AS $$
DECLARE
  v_insights jsonb := '[]'::jsonb;
  v_metricas text[] := ARRAY[
    'precio_avg_inicial',
    'precio_avg_seguimiento',
    'duracion_avg_min',
    'tasa_no_show',
    'tasa_cancelacion'
  ];
  v_metrica text;
  v_valor numeric;
  v_cohort record;
  v_condicion text;
  v_template record;
BEGIN
  FOREACH v_metrica IN ARRAY v_metricas LOOP
    -- Obtener valor de la org para esta métrica
    EXECUTE format('SELECT ($1).%I::numeric', v_metrica) INTO v_valor USING r;
    IF v_valor IS NULL THEN CONTINUE; END IF;

    -- Cascada geográfica: ciudad → gran_area → provincia → region → nacional
    v_cohort := NULL;
    SELECT * INTO v_cohort FROM analytics.cohort_benchmarks
      WHERE especialidad = r.especialidad
        AND nivel_geografico = 'ciudad'
        AND ambito = r.ciudad
        AND periodo = p_periodo
        AND metrica = v_metrica
      LIMIT 1;

    IF v_cohort IS NULL AND r.gran_area IS NOT NULL THEN
      SELECT * INTO v_cohort FROM analytics.cohort_benchmarks
        WHERE especialidad = r.especialidad
          AND nivel_geografico = 'gran_area'
          AND ambito = r.gran_area
          AND periodo = p_periodo
          AND metrica = v_metrica
        LIMIT 1;
    END IF;

    IF v_cohort IS NULL THEN
      SELECT * INTO v_cohort FROM analytics.cohort_benchmarks
        WHERE especialidad = r.especialidad
          AND nivel_geografico = 'provincia'
          AND ambito = r.provincia
          AND periodo = p_periodo
          AND metrica = v_metrica
        LIMIT 1;
    END IF;

    IF v_cohort IS NULL AND r.region_nacional IS NOT NULL THEN
      SELECT * INTO v_cohort FROM analytics.cohort_benchmarks
        WHERE especialidad = r.especialidad
          AND nivel_geografico = 'region'
          AND ambito = r.region_nacional
          AND periodo = p_periodo
          AND metrica = v_metrica
        LIMIT 1;
    END IF;

    IF v_cohort IS NULL THEN
      SELECT * INTO v_cohort FROM analytics.cohort_benchmarks
        WHERE especialidad = r.especialidad
          AND nivel_geografico = 'nacional'
          AND ambito = 'AR'
          AND periodo = p_periodo
          AND metrica = v_metrica
        LIMIT 1;
    END IF;

    IF v_cohort IS NULL THEN CONTINUE; END IF;

    -- Determinar condición (severity)
    v_condicion := NULL;
    IF v_valor <= v_cohort.p10 THEN v_condicion := 'p10_low';
    ELSIF v_valor <= v_cohort.p25 THEN v_condicion := 'p25_low';
    ELSIF v_valor >= v_cohort.p90 THEN v_condicion := 'p90_high';
    ELSIF v_valor >= v_cohort.p75 THEN v_condicion := 'p75_high';
    END IF;
    IF v_condicion IS NULL THEN CONTINUE; END IF;

    -- Plantilla
    SELECT * INTO v_template FROM analytics.insight_templates
      WHERE metrica = v_metrica AND condicion = v_condicion
      LIMIT 1;
    IF v_template IS NULL THEN CONTINUE; END IF;

    v_insights := v_insights || jsonb_build_object(
      'metrica',        v_metrica,
      'severity',       v_template.severity,
      'copy',           format(v_template.template_es, v_cohort.ambito),
      'ambito',         v_cohort.ambito,
      'nivel',          v_cohort.nivel_geografico,
      'condicion',      v_condicion,
      'n_orgs_cohort',  v_cohort.n_orgs
    );
  END LOOP;

  RETURN v_insights;
END;
$$;

COMMENT ON FUNCTION analytics.compute_org_insights(date, record) IS
  'Helper: dado una fila de org_metrics_monthly, devuelve el array JSON de insights aplicables (cascada geo + plantilla).';

-- ─────────────────────────────────────────────────────────────────────────
-- 6. refresh_all: orquesta los 3 pasos
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION analytics.refresh_all(p_periodo date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, analytics
AS $$
DECLARE
  v_metrics_rows  int;
  v_cohort_rows   int;
  v_orgs_rendered int;
  v_started_at    timestamptz := clock_timestamp();
BEGIN
  -- Default: mes anterior al actual (los datos del mes en curso son incompletos)
  IF p_periodo IS NULL THEN
    p_periodo := date_trunc('month', (now() AT TIME ZONE 'America/Argentina/Cordoba') - INTERVAL '1 month')::date;
  ELSE
    p_periodo := date_trunc('month', p_periodo)::date;
  END IF;

  v_metrics_rows  := analytics.refresh_org_metrics(p_periodo);
  v_cohort_rows   := analytics.refresh_cohort_benchmarks(p_periodo);
  v_orgs_rendered := analytics.render_insights(p_periodo);

  RETURN jsonb_build_object(
    'periodo',         p_periodo,
    'metrics_rows',    v_metrics_rows,
    'cohort_rows',     v_cohort_rows,
    'orgs_rendered',   v_orgs_rendered,
    'elapsed_ms',      extract(epoch FROM (clock_timestamp() - v_started_at)) * 1000
  );
END;
$$;

COMMENT ON FUNCTION analytics.refresh_all(date) IS
  'Pipeline completa: refresh_org_metrics + refresh_cohort_benchmarks + render_insights. Si p_periodo es NULL, usa el mes anterior (zona AR).';

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Permisos
-- ─────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION analytics.refresh_org_metrics(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.refresh_cohort_benchmarks(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.render_insights(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.compute_org_insights(date, record) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics.refresh_all(date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION analytics.refresh_all(date) TO service_role;
-- las internas solo las llama refresh_all; no necesitan GRANT a service_role
-- porque SECURITY DEFINER ejecuta como el owner del schema.
