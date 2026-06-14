-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M60 · Intake avanzado por especialidad + erasure
-- ════════════════════════════════════════════════════════════════════════════
-- La sección "Información avanzada" del alta de paciente es por especialidad
-- (anamnesis del quiropráctico; sets iniciales adaptables para cardio/psico).
-- Se guarda como JSON cifrado validado por el schema zod de cada especialidad
-- (mismo patrón que sesion.tool_data_cifrado). 1 fila por (paciente, especialidad).
--
-- Convenciones espejadas de M10/M58: validate_same_org dedicado, set_updated_at,
-- audit_log_trigger, RLS clinical-scoped, INSERT con el predicado de M03.
--
-- ERASURE: la tabla tiene PII directa/de terceros (recomendado_por no aplica acá
-- pero sí cirugías/medicamentos/observaciones = PHI, y datos identificatorios).
-- Por keyear por paciente_id (no por paciente_identidad) NO se borra al
-- pseudonimizar salvo que lo agreguemos: esta migración REDEFINE
-- pseudonimizar_paciente (cuerpo vigente = M25) sumando el DELETE de esta tabla.
-- Todos los objetos referenciados pre-existen → sin check_function_bodies off.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE paciente_intake_avanzado (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  paciente_id      uuid NOT NULL REFERENCES paciente(id) ON DELETE CASCADE,
  especialidad     text NOT NULL,
  datos_cifrado    bytea,                                 -- JSON cifrado AES-256-GCM app-side

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT paciente_intake_avanzado_unica UNIQUE (paciente_id, especialidad),
  CONSTRAINT paciente_intake_avanzado_especialidad_valida
    CHECK (especialidad IN ('quiropraxia', 'cardiologia', 'psicologia'))
);

CREATE INDEX paciente_intake_avanzado_org_idx ON paciente_intake_avanzado (organization_id);
CREATE INDEX paciente_intake_avanzado_paciente_idx ON paciente_intake_avanzado (paciente_id);

COMMENT ON TABLE paciente_intake_avanzado IS
  'Folio M60 · intake avanzado por especialidad (1 por paciente+especialidad). datos_cifrado = JSON AES-256-GCM validado por el schema zod del registry. Borrado en pseudonimizar_paciente (PHI/PII).';

-- ─── Triggers ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION paciente_intake_avanzado_validate_same_org()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM paciente p
    WHERE p.id = NEW.paciente_id
      AND p.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'paciente_intake_avanzado.paciente_id debe coincidir en org con el paciente';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER paciente_intake_avanzado_same_org_guard
  BEFORE INSERT OR UPDATE OF paciente_id, organization_id ON paciente_intake_avanzado
  FOR EACH ROW EXECUTE FUNCTION paciente_intake_avanzado_validate_same_org();

CREATE TRIGGER paciente_intake_avanzado_set_updated_at
  BEFORE UPDATE ON paciente_intake_avanzado
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER paciente_intake_avanzado_audit
  AFTER INSERT OR UPDATE OR DELETE ON paciente_intake_avanzado
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

-- ─── RLS (clinical-scoped, espejo de M10/M58) ────────────────────────────────

ALTER TABLE paciente_intake_avanzado ENABLE ROW LEVEL SECURITY;
ALTER TABLE paciente_intake_avanzado FORCE  ROW LEVEL SECURITY;

CREATE POLICY paciente_intake_avanzado_select_clinical
  ON paciente_intake_avanzado FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
  );

CREATE POLICY paciente_intake_avanzado_insert_clinical
  ON paciente_intake_avanzado FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'PROFESIONAL', 'DIRECTOR')
  );

CREATE POLICY paciente_intake_avanzado_update_clinical
  ON paciente_intake_avanzado FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'PROFESIONAL', 'DIRECTOR')
  );

CREATE POLICY paciente_intake_avanzado_no_delete
  ON paciente_intake_avanzado FOR DELETE
  USING (false);

-- ════════════════════════════════════════════════════════════════════════════
-- Erasure: extender pseudonimizar_paciente (cuerpo vigente = M25) para borrar
-- físicamente el intake avanzado. Cuerpo copiado de M25 verbatim + el DELETE y
-- un flag en el resumen. (M25 ya había reemplazado el cuerpo de M13.)
-- ════════════════════════════════════════════════════════════════════════════

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
  v_nombre_hash       text;
  v_dni_hash          text;
  v_intake_borrados   int;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'pseudonimizar_paciente: requiere auth.uid()';
  END IF;
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN
    RAISE EXCEPTION 'pseudonimizar_paciente: motivo requerido (>= 3 caracteres)';
  END IF;

  SELECT p.organization_id, p.identidad_id
    INTO v_org_id, v_identidad_id
    FROM paciente p
   WHERE p.id = p_paciente_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'pseudonimizar_paciente: paciente % no existe', p_paciente_id;
  END IF;

  SELECT role, id INTO v_actor_role, v_actor_member_id
    FROM member
   WHERE profile_id = v_actor_id
     AND organization_id = v_org_id
     AND deleted_at IS NULL;
  IF v_actor_role NOT IN ('OWNER', 'DIRECTOR') THEN
    RAISE EXCEPTION 'pseudonimizar_paciente: rol % no autorizado. Solo OWNER/DIRECTOR.', v_actor_role;
  END IF;

  -- Capture the blind-index hashes BEFORE deletion (M25 audit trail).
  IF v_identidad_id IS NOT NULL THEN
    SELECT nombre_hash, dni_hash
      INTO v_nombre_hash, v_dni_hash
      FROM paciente_identidad
     WHERE id = v_identidad_id;
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'paciente_id', p_paciente_id,
      'organization_id', v_org_id,
      'actor_role', v_actor_role,
      'motivo', p_motivo,
      'dry_run', true,
      'identidad_id', v_identidad_id,
      'intake_avanzado_a_borrar', (SELECT count(*) FROM paciente_intake_avanzado WHERE paciente_id = p_paciente_id),
      'would_record_event', v_dni_hash IS NOT NULL AND v_nombre_hash IS NOT NULL
    );
  END IF;

  IF v_dni_hash IS NOT NULL AND v_nombre_hash IS NOT NULL THEN
    INSERT INTO pseudonimizacion_event
      (organization_id, paciente_id, dni_sha256, nombre_sha256, performed_by, motivo)
    VALUES
      (v_org_id, p_paciente_id, v_dni_hash, v_nombre_hash, v_actor_id, p_motivo);
  END IF;

  IF v_identidad_id IS NOT NULL THEN
    DELETE FROM paciente_identidad WHERE id = v_identidad_id;
  END IF;

  -- M60: borrar físicamente el intake avanzado (PHI/PII directa + de terceros).
  DELETE FROM paciente_intake_avanzado WHERE paciente_id = p_paciente_id;
  GET DIAGNOSTICS v_intake_borrados = ROW_COUNT;

  UPDATE paciente
     SET identidad_id    = NULL,
         pseudonimizado_en = now()
   WHERE id = p_paciente_id;

  RETURN jsonb_build_object(
    'paciente_id', p_paciente_id,
    'organization_id', v_org_id,
    'actor_role', v_actor_role,
    'motivo', p_motivo,
    'dry_run', false,
    'identidad_id_borrada', v_identidad_id,
    'intake_avanzado_borrados', v_intake_borrados,
    'pseudonimizacion_event_recorded', v_dni_hash IS NOT NULL
  );
END
$$;

COMMENT ON FUNCTION public.pseudonimizar_paciente(uuid, text, boolean) IS
  'Folio · M13 + M25 + M60 · pseudonimización de paciente. Borra paciente_identidad + paciente_intake_avanzado, marca paciente.pseudonimizado_en, y graba pseudonimizacion_event con SHA-256 del DNI + nombre. SECURITY DEFINER; solo OWNER/DIRECTOR.';
