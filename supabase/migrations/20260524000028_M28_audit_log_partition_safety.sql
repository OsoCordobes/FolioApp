-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M28 · Audit log partition safety (DEFAULT partition + maintenance wrapper)
-- ════════════════════════════════════════════════════════════════════════════
-- M12 definió audit_log_ensure_future_partitions(int) y pre-creó 12 particiones
-- mensuales, pero NUNCA cableó la función a un cron. Cuando se agoten las 12
-- particiones (~12 meses post-deploy), cada INSERT a audit_log (disparado por
-- triggers en paciente, sesion, turno, diagnostico, alergia, medicacion,
-- consentimiento, documento_clinico, paciente_identidad, sesion_enmienda, pago)
-- fallaría con "no partition of relation 'audit_log' found for row". Como los
-- triggers son SECURITY DEFINER y participan en la transacción del caller, eso
-- abortaría la operación entera — la app se brickea sola a los 12 meses.
--
-- Esta migración cierra esa bomba de tiempo con dos defensas:
--
--   1. DEFAULT partition como safety net. Postgres permite una tabla
--      `audit_log_default` que recibe filas que no calcen en ninguna partición
--      mensual. Debería quedarse vacía en estado estable; rows aquí significan
--      que el cron de mantenimiento lageó.
--
--   2. audit_log_run_maintenance(int) — wrapper RPC-callable (SECURITY DEFINER)
--      que el cron /api/cron/maintenance invoca mensualmente. Itera mes a mes
--      creando IF NOT EXISTS y capturando errores individuales en un jsonb
--      (no aborta el lote si una partición falla). Reporta orphans para que
--      Sentry alerte si el cron lageó.
--
-- Compatibilidad con M12: la función `audit_log_ensure_future_partitions(int)`
-- de M12 sigue existiendo y NO se toca; es invocable manualmente para
-- backfill. La nueva wrapper es la API estable de cara al cron.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. DEFAULT partition como safety net ───────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log_default
  PARTITION OF audit_log DEFAULT;

COMMENT ON TABLE audit_log_default IS
  'M28 · safety-net partition. Debe permanecer vacío en estado estable; rows aquí indican que el cron mensual de mantenimiento lageó y necesita backfill al partition mensual correcto. El cron /api/cron/maintenance reporta este conteo en cada corrida.';

-- ─── 2. Maintenance wrapper (idempotente, defensivo) ────────────────────

CREATE OR REPLACE FUNCTION audit_log_run_maintenance(p_months_ahead int DEFAULT 6)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before     int;
  v_after      int;
  v_orphans    bigint;
  v_failures   jsonb := '[]'::jsonb;
  v_start_date date;
  v_end_date   date;
  v_part_name  text;
  v_i          int;
BEGIN
  IF p_months_ahead < 1 OR p_months_ahead > 24 THEN
    RAISE EXCEPTION 'audit_log_run_maintenance: months_ahead must be 1..24, got %', p_months_ahead;
  END IF;

  -- Contar particiones mensuales antes (sólo las que matchean YYYY_MM)
  SELECT count(*) INTO v_before
    FROM pg_tables
    WHERE tablename ~ '^audit_log_[0-9]{4}_[0-9]{2}$';

  -- Crear (o validar existencia de) cada mes en el rango. Cada CREATE se
  -- envuelve en sub-block con EXCEPTION amplia para que un fallo aislado
  -- (ej. constraint violation por filas en DEFAULT que solapan) no aborte
  -- la corrida completa — el error se reporta en `failures` para que el
  -- caller alerte a Sentry y haga backfill manual.
  FOR v_i IN 0..p_months_ahead LOOP
    v_start_date := (date_trunc('month', CURRENT_DATE)::date + (v_i || ' months')::interval)::date;
    v_end_date   := (v_start_date + interval '1 month')::date;
    v_part_name  := format('audit_log_%s', to_char(v_start_date, 'YYYY_MM'));
    BEGIN
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
        v_part_name, v_start_date, v_end_date
      );
    EXCEPTION WHEN OTHERS THEN
      v_failures := v_failures || jsonb_build_array(
        jsonb_build_object(
          'partition', v_part_name,
          'sqlstate',  SQLSTATE,
          'message',   SQLERRM
        )
      );
    END;
  END LOOP;

  SELECT count(*) INTO v_after
    FROM pg_tables
    WHERE tablename ~ '^audit_log_[0-9]{4}_[0-9]{2}$';

  -- Orphans = filas que cayeron en DEFAULT. > 0 indica que el cron lageó
  -- en algún momento previo y debemos hacer backfill (mover esas filas al
  -- partition mensual correcto).
  SELECT count(*) INTO v_orphans FROM ONLY audit_log_default;

  RETURN jsonb_build_object(
    'months_ahead',             p_months_ahead,
    'partitions_before',        v_before,
    'partitions_after',         v_after,
    'created',                  v_after - v_before,
    'failures',                 v_failures,
    'failure_count',            jsonb_array_length(v_failures),
    'default_partition_orphans', v_orphans,
    'ts',                       now()
  );
END
$$;

REVOKE ALL ON FUNCTION audit_log_run_maintenance(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_log_run_maintenance(int) TO service_role;

COMMENT ON FUNCTION audit_log_run_maintenance(int) IS
  'M28 · invocado por /api/cron/maintenance mensualmente. Crea las próximas months_ahead+1 particiones mensuales con IF NOT EXISTS, captura errores individuales en jsonb, reporta orphans de la partición DEFAULT (indicador de cron lageado). Solo callable por service_role.';
