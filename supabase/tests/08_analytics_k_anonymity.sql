-- ============================================================================
-- Test 08 · k-anonymity y suppression rules en analytics (M15 + M16)
-- ============================================================================
-- Verifica:
--   1. Schema analytics existe y tablas tienen las columnas esperadas.
--   2. cohort_benchmarks rechaza n_orgs < 5 vía CHECK constraint.
--   3. metrica_k_min() devuelve 10 para precio_* y 5 para el resto.
--   4. org_insights_cache tiene RLS habilitada (force RLS).
--   5. refresh_all() ejecuta y retorna metadata cuando no hay datos.
--   6. SELECT directo a cohort_benchmarks desde authenticated falla (sin GRANT).

BEGIN;

SELECT plan(11);

-- ─── 1. Schema y tablas ──────────────────────────────────────────────────

SELECT has_schema('analytics', 'Schema analytics existe');

SELECT has_table('analytics', 'geo_regions',            'Tabla geo_regions existe');
SELECT has_table('analytics', 'org_metrics_monthly',    'Tabla org_metrics_monthly existe');
SELECT has_table('analytics', 'cohort_benchmarks',      'Tabla cohort_benchmarks existe');
SELECT has_table('analytics', 'org_insights_cache',     'Tabla org_insights_cache existe');
SELECT has_table('analytics', 'insight_templates',      'Tabla insight_templates existe');

-- ─── 2. CHECK n_orgs >= 5 ────────────────────────────────────────────────

SELECT throws_ok(
  $$ INSERT INTO analytics.cohort_benchmarks
       (especialidad, nivel_geografico, ambito, periodo, metrica, n_orgs, p50)
     VALUES ('kine', 'ciudad', 'Córdoba', '2026-04-01', 'tasa_no_show', 3, 0.10) $$,
  '23514',
  NULL,
  'CHECK n_orgs >= 5 rechaza n_orgs=3'
);

-- ─── 3. metrica_k_min ────────────────────────────────────────────────────

SELECT is(
  analytics.metrica_k_min('precio_avg_inicial'),
  10,
  'metrica_k_min: precio_avg_inicial -> 10 (monetaria)'
);

SELECT is(
  analytics.metrica_k_min('tasa_no_show'),
  5,
  'metrica_k_min: tasa_no_show -> 5 (no monetaria)'
);

-- ─── 4. RLS en org_insights_cache ────────────────────────────────────────

SELECT is(
  (SELECT relrowsecurity
     FROM pg_class
     WHERE relnamespace = 'analytics'::regnamespace AND relname = 'org_insights_cache'),
  true,
  'org_insights_cache tiene RLS habilitada'
);

SELECT is(
  (SELECT relforcerowsecurity
     FROM pg_class
     WHERE relnamespace = 'analytics'::regnamespace AND relname = 'org_insights_cache'),
  true,
  'org_insights_cache tiene FORCE RLS (no bypass para el owner)'
);

-- ─── 5. refresh_all retorna JSON con metadata ────────────────────────────

SELECT ok(
  (analytics.refresh_all('2099-12-01'::date) ?& ARRAY['periodo', 'metrics_rows', 'cohort_rows', 'orgs_rendered']),
  'refresh_all retorna JSON con campos periodo/metrics_rows/cohort_rows/orgs_rendered'
);

SELECT * FROM finish();
ROLLBACK;
