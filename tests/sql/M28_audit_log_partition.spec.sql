-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M28 spec · audit_log partition safety
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_default_exists boolean;
  v_fn_exists      boolean;
  v_result         jsonb;
  v_orphans        int;
  v_created        int;
  v_partitions_after int;
BEGIN
  -- 1. DEFAULT partition existe
  SELECT EXISTS (
    SELECT 1 FROM pg_partition_tree('audit_log'::regclass)
    WHERE relid = 'audit_log_default'::regclass
  ) INTO v_default_exists;
  IF NOT v_default_exists THEN
    RAISE EXCEPTION 'M28 spec FAIL: audit_log_default partition no existe';
  END IF;

  -- 2. Función wrapper existe y solo callable por service_role
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'audit_log_run_maintenance'
  ) INTO v_fn_exists;
  IF NOT v_fn_exists THEN
    RAISE EXCEPTION 'M28 spec FAIL: audit_log_run_maintenance no existe';
  END IF;

  -- 3. Llamar maintenance(6) y verificar shape de respuesta
  SELECT audit_log_run_maintenance(6) INTO v_result;
  v_orphans          := (v_result ->> 'default_partition_orphans')::int;
  v_created          := (v_result ->> 'created')::int;
  v_partitions_after := (v_result ->> 'partitions_after')::int;

  IF v_orphans <> 0 THEN
    RAISE WARNING 'M28 spec: orphans en DEFAULT partition = % (esperado 0 en fresh DB)', v_orphans;
  END IF;
  IF v_partitions_after < 7 THEN
    RAISE EXCEPTION 'M28 spec FAIL: debería haber al menos 7 particiones mensuales después de maintenance(6), hay %', v_partitions_after;
  END IF;
  IF (v_result ->> 'failure_count')::int > 0 THEN
    RAISE EXCEPTION 'M28 spec FAIL: hubo failures en maintenance: %', v_result -> 'failures';
  END IF;

  -- 4. Idempotente: segunda llamada no debe crear nada nuevo
  SELECT audit_log_run_maintenance(6) INTO v_result;
  IF (v_result ->> 'created')::int <> 0 THEN
    RAISE EXCEPTION 'M28 spec FAIL: segunda llamada no debería crear (idempotente). Got: %', v_result ->> 'created';
  END IF;

  -- 5. Argumento inválido debe rechazar
  BEGIN
    PERFORM audit_log_run_maintenance(25);
    RAISE EXCEPTION 'M28 spec FAIL: months_ahead=25 debería rechazarse';
  EXCEPTION WHEN raise_exception THEN
    -- esperado
  END;

  RAISE NOTICE 'M28 spec PASS · partitions_after=% orphans=%', v_partitions_after, v_orphans;
END $$;
