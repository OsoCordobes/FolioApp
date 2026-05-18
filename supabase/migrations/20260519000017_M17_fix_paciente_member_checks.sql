-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M17 · Fix bug en M03: CHECK constraints contradictorios
-- ════════════════════════════════════════════════════════════════════════════
--
-- M03 declaró:
--   CONSTRAINT paciente_profesional_principal_in_same_org
--     CHECK (profesional_principal_id IS NULL),   -- trigger valida cross-table
--   CONSTRAINT paciente_caja_fuerte_in_same_org
--     CHECK (caja_fuerte_profesional IS NULL)
--
-- El nombre dice "same_org" pero la CHECK fuerza NULL — bloqueando todo
-- INSERT que asigne profesional_principal_id o caja_fuerte_profesional.
-- El comentario hace explícito que la validación cross-table la hace el
-- trigger `paciente_validate_member_same_org()` (que ya existe y funciona).
-- Las CHECKs son anti-objetivo y se deben eliminar.
--
-- Detectado durante T-1.4 al intentar seedear data demo: el insert de
-- paciente con profesional_principal_id falló con
--   "new row violates check constraint paciente_profesional_principal_in_same_org"
--
-- El trigger ya creado en M03 (lines 138-153) hace la validación correcta:
--   - Verifica que el member exista.
--   - Verifica que pertenezca a la misma org.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE paciente
  DROP CONSTRAINT IF EXISTS paciente_profesional_principal_in_same_org;

ALTER TABLE paciente
  DROP CONSTRAINT IF EXISTS paciente_caja_fuerte_in_same_org;

-- Verificación: el trigger paciente_member_same_org_guard debe seguir activo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'paciente_member_same_org_guard'
  ) THEN
    RAISE EXCEPTION 'M17 abort: trigger paciente_member_same_org_guard no existe. La validación cross-table desaparece sin él.';
  END IF;
END$$;
