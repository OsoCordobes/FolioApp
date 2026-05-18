-- ============================================================================
-- M15 · analytics schema
-- ============================================================================
-- Schema dedicado para benchmarking comparativo entre orgs. Diseño privacy-by-
-- design: las tablas guardan agregados sin PII/PHI. La ÚNICA tabla expuesta
-- al cliente vía RLS es `org_insights_cache` (cada org solo ve sus propios
-- insights renderizados).
--
-- Tablas:
--   - geo_regions               (mapa ciudad → gran_area → provincia → región)
--   - org_metrics_monthly       (snapshot mensual por org, fact table)
--   - cohort_benchmarks         (percentiles pre-calculados por cohort)
--   - org_insights_cache        (insights renderizados por org, expuesto al cliente)
--   - insight_templates         (plantillas de copy en español)
--
-- La pipeline que rellena estas tablas vive en M16. Se ejecuta vía cron (3 AM AR)
-- y opera sobre datos del periodo anterior. Suppression rules: k=5 hard floor,
-- k=10 para métricas monetarias, cascada geográfica (ciudad → gran_area →
-- provincia → región → nacional).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Schema
-- ─────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS analytics;

COMMENT ON SCHEMA analytics IS
  'Folio · agregados anonimizados con k-anonymity para benchmarking. Sin PII/PHI.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. geo_regions (mapa estático, ~50 ciudades AR)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE analytics.geo_regions (
  ciudad           text PRIMARY KEY,
  provincia        text NOT NULL,
  gran_area        text,                       -- 'AMBA' | 'Gran Cordoba' | 'Gran Rosario' | NULL
  region_nacional  text NOT NULL               -- 'AMBA' | 'Centro' | 'Cuyo' | 'NOA' | 'NEA' | 'Patagonia' | 'Pampeana'
);

CREATE INDEX geo_regions_provincia_idx ON analytics.geo_regions (provincia);
CREATE INDEX geo_regions_gran_area_idx ON analytics.geo_regions (gran_area) WHERE gran_area IS NOT NULL;

COMMENT ON TABLE analytics.geo_regions IS
  'Mapeo estático ciudad → niveles geográficos para cascada de cohort en benchmarking. ~50 filas.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. org_metrics_monthly (snapshot mensual por org)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE analytics.org_metrics_monthly (
  org_id                       uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
  periodo                      date NOT NULL,                  -- siempre primer día del mes
  especialidad                 text NOT NULL,                  -- rubro denormalizado (snapshot point-in-time)
  ciudad                       text NOT NULL,
  provincia                    text NOT NULL,

  precio_avg_inicial           numeric,
  precio_avg_seguimiento       numeric,
  duracion_avg_min             numeric,
  tasa_no_show                 numeric,                        -- 0.0..1.0
  tasa_cancelacion             numeric,                        -- 0.0..1.0
  ocupacion_pct                numeric,                        -- 0.0..1.0
  pacientes_nuevos             int,
  pacientes_activos            int,
  tasa_retencion_60d           numeric,                        -- 0.0..1.0
  tiempo_entre_sesiones_dias   numeric,
  total_turnos                 int,

  computed_at                  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (org_id, periodo),
  CONSTRAINT metrics_periodo_first_of_month CHECK (EXTRACT(DAY FROM periodo) = 1)
);

CREATE INDEX org_metrics_monthly_periodo_idx ON analytics.org_metrics_monthly (periodo);
CREATE INDEX org_metrics_monthly_geo_idx ON analytics.org_metrics_monthly (especialidad, ciudad, provincia, periodo);

COMMENT ON TABLE analytics.org_metrics_monthly IS
  'Fact table: snapshot mensual de cada org. Sin PII/PHI. Granularidad mensual para cohort >= k.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. cohort_benchmarks (percentiles pre-calculados)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE analytics.cohort_benchmarks (
  especialidad      text NOT NULL,
  nivel_geografico  text NOT NULL,                             -- 'ciudad' | 'gran_area' | 'provincia' | 'region' | 'nacional'
  ambito            text NOT NULL,                             -- nombre del ámbito ('Córdoba', 'AMBA', 'Centro', 'AR')
  periodo           date NOT NULL,
  metrica           text NOT NULL,

  n_orgs            int NOT NULL,                              -- siempre >= 5 (k-anonymity floor)
  p10               numeric,
  p25               numeric,
  p50               numeric,
  p75               numeric,
  p90               numeric,
  mean              numeric,
  stddev            numeric,

  computed_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (especialidad, nivel_geografico, ambito, periodo, metrica),
  CONSTRAINT cohort_k_min CHECK (n_orgs >= 5),
  CONSTRAINT cohort_nivel_valid CHECK (
    nivel_geografico IN ('ciudad', 'gran_area', 'provincia', 'region', 'nacional')
  )
);

CREATE INDEX cohort_periodo_idx ON analytics.cohort_benchmarks (periodo);
CREATE INDEX cohort_lookup_idx ON analytics.cohort_benchmarks (especialidad, nivel_geografico, ambito, periodo);

COMMENT ON TABLE analytics.cohort_benchmarks IS
  'Percentiles pre-calculados por cohort. Solo se inserta si n_orgs >= 5 (>= 10 para monetarias). NO se expone al cliente; solo se usa server-side para resolver insights.';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. org_insights_cache (única tabla expuesta al cliente, con RLS)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE analytics.org_insights_cache (
  org_id        uuid PRIMARY KEY REFERENCES public.organization(id) ON DELETE CASCADE,
  periodo       date NOT NULL,
  insights      jsonb NOT NULL,
  computed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX org_insights_periodo_idx ON analytics.org_insights_cache (periodo);

COMMENT ON TABLE analytics.org_insights_cache IS
  'Insights renderizados por org. Estructura insights[]: { metrica, severity, copy, ambito, nivel, posicion_pct }. Esta es la ÚNICA tabla de analytics accesible vía RLS al cliente.';

-- RLS estricta: cada org solo ve sus propios insights
ALTER TABLE analytics.org_insights_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics.org_insights_cache FORCE ROW LEVEL SECURITY;

CREATE POLICY own_insights_select ON analytics.org_insights_cache
  FOR SELECT
  USING (org_id IN (SELECT public.user_org_ids()));

-- No INSERT/UPDATE/DELETE desde RLS — solo refresh con SECURITY DEFINER funcs
-- ejecutadas por la cron de Supabase.

-- ─────────────────────────────────────────────────────────────────────────
-- 6. insight_templates (plantillas de copy en español)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE analytics.insight_templates (
  metrica       text NOT NULL,
  condicion     text NOT NULL,                                 -- 'p10_low' | 'p25_low' | 'p75_high' | 'p90_high' | 'median'
  severity      text NOT NULL,                                 -- 'positive' | 'neutral' | 'attention'
  template_es   text NOT NULL,                                 -- usa %s para sustituir el ámbito ("Córdoba", "Centro", etc.)

  PRIMARY KEY (metrica, condicion),
  CONSTRAINT template_severity_valid CHECK (severity IN ('positive', 'neutral', 'attention')),
  CONSTRAINT template_condicion_valid CHECK (
    condicion IN ('p10_low', 'p25_low', 'p75_high', 'p90_high', 'median', 'outlier_extreme')
  )
);

COMMENT ON TABLE analytics.insight_templates IS
  'Plantillas de copy en español para insights. V1 usa reglas SQL sin LLM. Sustitución de %s = ámbito (Córdoba / Centro / AR).';

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Helper: opt-out de benchmarks (toggle por org)
-- ─────────────────────────────────────────────────────────────────────────

-- Bandera ya existe en `organization` si M02 incluyó `opt_out_benchmarks`.
-- Si no, este migration es seguro porque no la referencia hasta el pipeline (M16).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization'
      AND column_name = 'opt_out_benchmarks'
  ) THEN
    ALTER TABLE public.organization
      ADD COLUMN opt_out_benchmarks boolean NOT NULL DEFAULT false;
    COMMENT ON COLUMN public.organization.opt_out_benchmarks IS
      'Si true, esta org no contribuye al cohort ni recibe insights (toggle en /configuracion).';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8. GRANTs
-- ─────────────────────────────────────────────────────────────────────────

-- authenticated rol puede leer org_insights_cache (RLS filtra)
GRANT USAGE ON SCHEMA analytics TO authenticated;
GRANT SELECT ON analytics.org_insights_cache TO authenticated;
GRANT SELECT ON analytics.geo_regions TO authenticated;

-- service_role tiene full access (lo usa el cron y server actions con SECURITY DEFINER)
GRANT ALL ON SCHEMA analytics TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA analytics TO service_role;
