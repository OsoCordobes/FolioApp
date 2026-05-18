-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M13 · Soft delete + Pseudonimización (Habeas Data art. 16)
-- ════════════════════════════════════════════════════════════════════════════
-- Implementa los 3 niveles de baja del paciente exigidos por Ley 25.326:
--
--   1. Soft delete (`paciente.deleted_at`):
--      - El paciente desaparece de las queries normales (filter por
--        deleted_at IS NULL en la app).
--      - Reversible: setear deleted_at = NULL restaura.
--      - NO se invoca para "derecho al olvido" — solo cuando es necesario
--        ocultar temporalmente (cliente que dejó de venir, etc.).
--
--   2. Pseudonimización (stored proc `pseudonimizar_paciente`):
--      - Borra FÍSICAMENTE el paciente_identidad (PII).
--      - Setea `paciente.identidad_id = NULL` y `pseudonimizado_en = now()`.
--      - La PHI clínica (sesiones, diagnósticos, etc.) PERMANECE pero queda
--        "huérfana" — solo accesible vía paciente.id, no por nombre/DNI.
--      - IRREVERSIBLE.
--      - Cumple Habeas Data + retención obligatoria de Ley 26.529 (10 años).
--
--   3. Borrado físico completo:
--      - Solo en casos extremos (error grave de carga, fraude).
--      - Requiere DELETE manual con service_role + log a audit_log.
--      - NO disponible vía RLS (paciente_no_delete policy en M03).
--
-- La proc `pseudonimizar_paciente` es la única forma de eliminar PII vía la
-- aplicación. Se invoca desde la UI de Configuración → "Eliminar paciente".
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Stored procedure: pseudonimizar_paciente ─────────────────────────────

CREATE OR REPLACE FUNCTION public.pseudonimizar_paciente(
  p_paciente_id   uuid,
  p_motivo        text,
  p_dry_run       boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id            uuid;
  v_actor_id          uuid;
  v_actor_member_id   uuid;
  v_identidad_id      uuid;
  v_actor_role        text;
  v_resumen           jsonb;
BEGIN
  -- ─── Validaciones ────────────────────────────────────────────────────
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'pseudonimizar_paciente: requiere auth.uid() — no se puede invocar sin sesión';
  END IF;

  -- Verificar paciente y obtener org
  SELECT organization_id, identidad_id
    INTO v_org_id, v_identidad_id
  FROM paciente
  WHERE id = p_paciente_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'pseudonimizar_paciente: paciente % no existe', p_paciente_id;
  END IF;

  IF v_identidad_id IS NULL THEN
    RAISE EXCEPTION 'pseudonimizar_paciente: paciente % ya está pseudonimizado', p_paciente_id;
  END IF;

  -- Solo OWNER o DIRECTOR pueden pseudonimizar (decisión legal seria)
  SELECT role::text INTO v_actor_role
  FROM member
  WHERE profile_id = v_actor_id
    AND organization_id = v_org_id
    AND deleted_at IS NULL;

  IF v_actor_role IS NULL THEN
    RAISE EXCEPTION 'pseudonimizar_paciente: actor no es member de la organización del paciente';
  END IF;

  IF v_actor_role NOT IN ('OWNER', 'DIRECTOR') THEN
    RAISE EXCEPTION 'pseudonimizar_paciente: requiere OWNER o DIRECTOR (actor es %)', v_actor_role;
  END IF;

  IF p_motivo IS NULL OR length(trim(p_motivo)) < 20 THEN
    RAISE EXCEPTION 'pseudonimizar_paciente: motivo requerido (>=20 chars). Describí la base legal (consentimiento del paciente, fallo judicial, etc.)';
  END IF;

  -- Obtener member_id del actor para audit
  SELECT id INTO v_actor_member_id
  FROM member
  WHERE profile_id = v_actor_id AND organization_id = v_org_id;

  -- ─── Resumen de lo que se va a hacer ─────────────────────────────────
  v_resumen := jsonb_build_object(
    'paciente_id', p_paciente_id,
    'organization_id', v_org_id,
    'identidad_id_a_borrar', v_identidad_id,
    'sesiones_huerfanas', (SELECT count(*) FROM sesion WHERE paciente_id = p_paciente_id),
    'turnos_huerfanos', (SELECT count(*) FROM turno WHERE paciente_id = p_paciente_id),
    'diagnosticos_huerfanos', (SELECT count(*) FROM diagnostico WHERE paciente_id = p_paciente_id),
    'documentos_huerfanos', (SELECT count(*) FROM documento_clinico WHERE paciente_id = p_paciente_id),
    'consentimientos_huerfanos', (SELECT count(*) FROM consentimiento WHERE paciente_id = p_paciente_id),
    'motivo', p_motivo,
    'actor_role', v_actor_role,
    'dry_run', p_dry_run
  );

  IF p_dry_run THEN
    RETURN v_resumen || jsonb_build_object('status', 'dry_run_ok_no_changes');
  END IF;

  -- ─── Ejecución (transacción atómica) ─────────────────────────────────
  -- 1. Audit log explícito ANTES de la operación destructiva
  INSERT INTO audit_log (
    organization_id, actor_id, actor_role,
    action, resource_type, resource_id, payload
  ) VALUES (
    v_org_id, v_actor_id, v_actor_role,
    'paciente.pseudonimizar', 'paciente', p_paciente_id::text,
    v_resumen
  );

  -- 2. Marcar paciente como pseudonimizado y desvincular identidad
  UPDATE paciente
  SET identidad_id = NULL,
      pseudonimizado_en = now(),
      updated_at = now()
  WHERE id = p_paciente_id;

  -- 3. Borrar físicamente paciente_identidad (PII desaparece)
  DELETE FROM paciente_identidad WHERE id = v_identidad_id;

  -- 4. Borrar contactos de emergencia + tutores (también PII de terceros)
  DELETE FROM contacto_emergencia WHERE paciente_id = p_paciente_id;
  DELETE FROM tutor_legal WHERE paciente_id = p_paciente_id;

  -- 5. Auditar el éxito
  INSERT INTO audit_log (
    organization_id, actor_id, actor_role,
    action, resource_type, resource_id, payload
  ) VALUES (
    v_org_id, v_actor_id, v_actor_role,
    'paciente.pseudonimizar.success', 'paciente', p_paciente_id::text,
    v_resumen
  );

  RETURN v_resumen || jsonb_build_object('status', 'pseudonimizado_ok', 'ejecutado_en', now());
END
$$;

REVOKE ALL ON FUNCTION public.pseudonimizar_paciente FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pseudonimizar_paciente TO authenticated;

COMMENT ON FUNCTION public.pseudonimizar_paciente IS
  'Folio · pseudonimización irreversible (Ley 25.326 art. 16). Borra PII físicamente, mantiene PHI huérfana. Solo OWNER/DIRECTOR pueden invocar. Motivo obligatorio (>=20 chars). Modo dry_run muestra el impacto sin ejecutar.';

-- ─── Soft delete helper para pacientes ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.soft_delete_paciente(
  p_paciente_id   uuid,
  p_motivo        text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id     uuid;
  v_actor_id   uuid;
  v_actor_member_id uuid;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'soft_delete_paciente: requiere auth.uid()';
  END IF;

  SELECT organization_id INTO v_org_id FROM paciente WHERE id = p_paciente_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'soft_delete_paciente: paciente % no existe', p_paciente_id;
  END IF;

  IF NOT public.can_read_clinical(v_org_id) THEN
    RAISE EXCEPTION 'soft_delete_paciente: actor no tiene permisos clínicos en la org';
  END IF;

  SELECT id INTO v_actor_member_id FROM member
  WHERE profile_id = v_actor_id AND organization_id = v_org_id;

  UPDATE paciente
  SET deleted_at = now(),
      deleted_by_id = v_actor_id,
      deleted_reason = p_motivo,
      updated_at = now()
  WHERE id = p_paciente_id;
END
$$;

REVOKE ALL ON FUNCTION public.soft_delete_paciente FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_paciente TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_paciente(p_paciente_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_org_id uuid;
BEGIN
  SELECT organization_id INTO v_org_id FROM paciente WHERE id = p_paciente_id;
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'paciente no existe'; END IF;
  IF NOT public.can_read_clinical(v_org_id) THEN
    RAISE EXCEPTION 'sin permisos clínicos en la org';
  END IF;
  UPDATE paciente
  SET deleted_at = NULL, deleted_by_id = NULL, deleted_reason = NULL, updated_at = now()
  WHERE id = p_paciente_id;
END
$$;
REVOKE ALL ON FUNCTION public.restore_paciente FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_paciente TO authenticated;

-- ─── Helper: ¿el paciente está pseudonimizado? ───────────────────────────

CREATE OR REPLACE FUNCTION public.paciente_es_pseudonimizado(p_paciente_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT pseudonimizado_en IS NOT NULL
  FROM paciente WHERE id = p_paciente_id
$$;
