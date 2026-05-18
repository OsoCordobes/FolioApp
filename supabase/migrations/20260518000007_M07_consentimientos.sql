-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M07 · Consentimientos firmados
-- ════════════════════════════════════════════════════════════════════════════
-- Instancias firmadas de plantillas de consentimiento (Ley 26.529 art. 5-11).
-- Cada fila representa la firma del paciente (o su tutor legal) sobre una
-- versión específica de una plantilla.
--
-- Inmutabilidad:
--   - Una vez firmado, NO se puede modificar el contenido. Solo se puede
--     marcar `revocado_en` para indicar revocación posterior.
--   - El `firma_storage_path` apunta a un archivo en Supabase Storage
--     (PNG/PDF de la firma manuscrita o el PDF firmado electrónicamente).
--
-- Trazabilidad:
--   - `ip` y `user_agent` del request donde se firmó (audit AAIP).
--   - `firmado_en` con timestamp exacto.
--   - `firmado_por_tutor_id` cuando el firmante NO es el paciente (menores
--     de edad, Ley 26.061).
--
-- Bucket Storage `consentimientos-firmados` se crea en F8 (Storage setup).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE consentimiento (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  paciente_id              uuid NOT NULL REFERENCES paciente(id) ON DELETE CASCADE,
  plantilla_id             uuid NOT NULL REFERENCES plantilla_consentimiento(id) ON DELETE RESTRICT,
  tipo                     tipo_consentimiento NOT NULL,        -- redundante con plantilla.tipo, pero util para indexes

  firma_storage_path       text NOT NULL,                       -- "consentimientos-firmados/{org}/{paciente}/{uuid}.pdf"
  firmado_en               timestamptz NOT NULL DEFAULT now(),
  firmado_por_tutor_id     uuid REFERENCES tutor_legal(id) ON DELETE RESTRICT,
  -- Si firmado_por_tutor_id IS NULL, el paciente firmó por sí mismo (mayor edad).

  ip                       inet,                                -- audit
  user_agent               text,                                -- audit

  revocado_en              timestamptz,
  revocado_motivo          text,

  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT consentimiento_no_self_revoke_before_signed
    CHECK (revocado_en IS NULL OR revocado_en >= firmado_en),
  CONSTRAINT consentimiento_path_format
    CHECK (firma_storage_path ~ '^consentimientos-firmados/[a-f0-9-]+/[a-f0-9-]+/[a-zA-Z0-9_.-]+$'),
  CONSTRAINT consentimiento_revocacion_completa
    CHECK ((revocado_en IS NULL AND revocado_motivo IS NULL)
           OR (revocado_en IS NOT NULL AND revocado_motivo IS NOT NULL))
);

CREATE INDEX consentimiento_paciente_tipo_idx
  ON consentimiento (paciente_id, tipo)
  WHERE revocado_en IS NULL;
CREATE INDEX consentimiento_org_firmado_idx
  ON consentimiento (organization_id, firmado_en DESC);
CREATE INDEX consentimiento_plantilla_idx ON consentimiento (plantilla_id);

COMMENT ON TABLE consentimiento IS
  'Folio · consentimiento informado firmado (Ley 26.529 art. 5-11). Una vez firmado es inmutable; solo se puede marcar revocado_en. firma_storage_path apunta al archivo en bucket privado de Supabase Storage.';

-- Trigger: prevenir UPDATE de campos críticos una vez firmado.
CREATE OR REPLACE FUNCTION consentimiento_prevent_critical_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.firmado_en IS NOT NULL THEN
    -- Solo se permite cambiar revocado_en / revocado_motivo (revocación).
    IF OLD.paciente_id IS DISTINCT FROM NEW.paciente_id
       OR OLD.plantilla_id IS DISTINCT FROM NEW.plantilla_id
       OR OLD.tipo IS DISTINCT FROM NEW.tipo
       OR OLD.firma_storage_path IS DISTINCT FROM NEW.firma_storage_path
       OR OLD.firmado_en IS DISTINCT FROM NEW.firmado_en
       OR OLD.firmado_por_tutor_id IS DISTINCT FROM NEW.firmado_por_tutor_id THEN
      RAISE EXCEPTION 'consentimiento es inmutable una vez firmado. Solo se permite UPDATE de revocado_en/revocado_motivo.';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER consentimiento_immutable_guard
  BEFORE UPDATE ON consentimiento
  FOR EACH ROW EXECUTE FUNCTION consentimiento_prevent_critical_update();

-- Validar que firmado_por_tutor_id pertenezca al mismo paciente.
CREATE OR REPLACE FUNCTION consentimiento_validate_tutor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.firmado_por_tutor_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM tutor_legal
      WHERE id = NEW.firmado_por_tutor_id
        AND paciente_id = NEW.paciente_id
        AND organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'consentimiento.firmado_por_tutor_id debe ser un tutor del mismo paciente y org';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER consentimiento_tutor_guard
  BEFORE INSERT OR UPDATE OF firmado_por_tutor_id ON consentimiento
  FOR EACH ROW EXECUTE FUNCTION consentimiento_validate_tutor();

-- ════════════════════════════════════════════════════════════════════════════
-- RLS · consentimientos
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE consentimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE consentimiento FORCE  ROW LEVEL SECURITY;

-- Lectura: clínica (igual que sesion/diagnóstico — protege el contenido).
-- ASISTENTE no ve consentimientos (privacidad del paciente).
CREATE POLICY consentimiento_select_clinical
  ON consentimiento FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND EXISTS (SELECT 1 FROM paciente p WHERE p.id = consentimiento.paciente_id)
  );

CREATE POLICY consentimiento_insert_clinical
  ON consentimiento FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND EXISTS (
      SELECT 1 FROM paciente p
      WHERE p.id = consentimiento.paciente_id
        AND p.organization_id = consentimiento.organization_id
    )
  );

-- UPDATE solo permite revocación (controlado por trigger arriba).
CREATE POLICY consentimiento_update_clinical
  ON consentimiento FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
  );

CREATE POLICY consentimiento_no_delete
  ON consentimiento FOR DELETE USING (false);
