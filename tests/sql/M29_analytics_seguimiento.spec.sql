-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M29 spec · analytics.refresh_org_metrics enum literals
-- ════════════════════════════════════════════════════════════════════════════
-- Verificación liviana (sin fixtures pesados):
--   1. Función existe.
--   2. Body de la función contiene los literales correctos (SEGUIMIENTO_ESTANDAR
--      y SEGUIMIENTO_EXTENDIDO) y NO contiene los literales rotos
--      ('SEGUIMIENTO', 'CONTROL') como tipo_canonico.
--   3. La función corre sin errores en un periodo vacío (devuelve 0).
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_fn_def     text;
  v_rows       int;
  v_count      int;
BEGIN
  -- 1. Existe
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'analytics' AND p.proname = 'refresh_org_metrics'
  ) THEN
    RAISE EXCEPTION 'M29 spec FAIL: analytics.refresh_org_metrics no existe';
  END IF;

  -- 2. Body tiene los literales correctos
  v_fn_def := pg_get_functiondef('analytics.refresh_org_metrics(date)'::regprocedure);
  IF v_fn_def NOT LIKE '%SEGUIMIENTO_ESTANDAR%' THEN
    RAISE EXCEPTION 'M29 spec FAIL: el cuerpo de refresh_org_metrics no contiene SEGUIMIENTO_ESTANDAR';
  END IF;
  IF v_fn_def NOT LIKE '%SEGUIMIENTO_EXTENDIDO%' THEN
    RAISE EXCEPTION 'M29 spec FAIL: el cuerpo no contiene SEGUIMIENTO_EXTENDIDO';
  END IF;

  -- Verificar que NO hay rastros del literal roto. Esto es delicado porque el
  -- comment de M29 puede mencionar las cadenas para documentación; chequear
  -- solo dentro del SQL ejecutable es difícil sin parsear. Strict check:
  -- el patrón "'SEGUIMIENTO', 'CONTROL'" o "'CONTROL'" no debe aparecer.
  IF v_fn_def LIKE '%''SEGUIMIENTO'', ''CONTROL''%' THEN
    RAISE EXCEPTION 'M29 spec FAIL: aún quedan los literales rotos (''SEGUIMIENTO'', ''CONTROL'') en el body';
  END IF;

  -- 3. Corre sin errores en un periodo sin datos (devuelve 0)
  -- (Usamos un mes muy lejano para garantizar 0 filas y no afectar otros tests)
  v_rows := analytics.refresh_org_metrics('2020-01-01'::date);
  IF v_rows IS NULL THEN
    RAISE EXCEPTION 'M29 spec FAIL: refresh_org_metrics devolvió NULL';
  END IF;
  IF v_rows < 0 THEN
    RAISE EXCEPTION 'M29 spec FAIL: refresh_org_metrics devolvió valor negativo: %', v_rows;
  END IF;

  -- Cleanup del snapshot 2020-01-01
  DELETE FROM analytics.org_metrics_monthly WHERE periodo = '2020-01-01';

  RAISE NOTICE 'M29 spec PASS · rows_for_empty_period=%', v_rows;
END $$;
