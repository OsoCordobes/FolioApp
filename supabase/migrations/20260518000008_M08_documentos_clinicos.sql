-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M08 · Documentos clínicos (estudios + informes externos)
-- ════════════════════════════════════════════════════════════════════════════
-- Adjuntos del paciente que viven en Supabase Storage:
--   - RMN, TAC, radiografías, ecografías
--   - Resultados de laboratorio
--   - Recetas e informes de otros médicos
--   - Fotos posturales (con consentimiento FOTOS firmado)
--
-- Esquema:
--   - DB guarda metadata (tipo, fecha estudio, mime, tamaño, descripción).
--   - Storage guarda el binario en bucket privado `documentos-clinicos`.
--   - Acceso: signed URLs generadas en Server Action (F4) con expiración.
--
-- RLS:
--   - Lectura: clínica estricta (OWNER + PROFESIONAL + DIRECTOR colegiado).
--   - Escritura: misma + paciente puede subir vía booking público (F7) con
--     pre-signed POST URLs.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TYPE tipo_documento AS ENUM (
  'RMN',
  'TAC',
  'RADIOGRAFIA',
  'ECOGRAFIA',
  'LABORATORIO',
  'RECETA_EXTERNA',
  'INFORME_EXTERNO',
  'FOTO_POSTURAL',
  'OTRO'
);

CREATE TABLE documento_clinico (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  paciente_id             uuid NOT NULL REFERENCES paciente(id) ON DELETE CASCADE,
  sesion_id               uuid,                                 -- FK a sesion (definida en M10)
  tipo                    tipo_documento NOT NULL,

  storage_path            text NOT NULL,                        -- "documentos-clinicos/{org}/{paciente}/{uuid}.{ext}"
  storage_bucket          text NOT NULL DEFAULT 'documentos-clinicos',
  mime_type               text NOT NULL,                        -- 'application/pdf', 'image/jpeg', etc.
  tamanio_bytes           bigint NOT NULL,
  fecha_estudio           date,
  descripcion_cifrado     bytea,                                -- AES-256-GCM app-side (puede tener detalles PHI)
  subido_por_id           uuid NOT NULL REFERENCES member(id) ON DELETE SET NULL,

  -- Para FOTO_POSTURAL: requerir consentimiento de fotos
  consentimiento_id       uuid REFERENCES consentimiento(id) ON DELETE RESTRICT,

  created_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,

  CONSTRAINT documento_path_format
    CHECK (storage_path ~ '^documentos-clinicos/[a-f0-9-]+/[a-f0-9-]+/[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+$'),
  CONSTRAINT documento_tamanio_positivo CHECK (tamanio_bytes > 0),
  CONSTRAINT documento_tamanio_limite CHECK (tamanio_bytes <= 50 * 1024 * 1024),  -- 50 MB max
  CONSTRAINT documento_foto_requiere_consentimiento
    CHECK (tipo <> 'FOTO_POSTURAL' OR consentimiento_id IS NOT NULL)
);

CREATE INDEX documento_paciente_idx ON documento_clinico (paciente_id, fecha_estudio DESC NULLS LAST)
  WHERE deleted_at IS NULL;
CREATE INDEX documento_org_tipo_idx ON documento_clinico (organization_id, tipo)
  WHERE deleted_at IS NULL;
CREATE INDEX documento_sesion_idx ON documento_clinico (sesion_id) WHERE sesion_id IS NOT NULL;

COMMENT ON TABLE documento_clinico IS
  'Folio · adjuntos clínicos en Supabase Storage. DB guarda metadata + storage_path; binarios en bucket privado documentos-clinicos. Foto postural requiere consentimiento FOTOS.';
COMMENT ON COLUMN documento_clinico.storage_path IS
  'Path completo dentro del bucket. Acceso vía signed URL (F4) con expiración 5min.';

-- Trigger: validar que el consentimiento sea del mismo paciente.
CREATE OR REPLACE FUNCTION documento_validate_consentimiento()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.consentimiento_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM consentimiento
      WHERE id = NEW.consentimiento_id
        AND paciente_id = NEW.paciente_id
        AND organization_id = NEW.organization_id
        AND tipo = 'FOTOS'
        AND revocado_en IS NULL
    ) THEN
      RAISE EXCEPTION 'documento_clinico.consentimiento_id debe ser un consentimiento FOTOS vigente del mismo paciente';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER documento_consentimiento_guard
  BEFORE INSERT OR UPDATE OF consentimiento_id ON documento_clinico
  FOR EACH ROW EXECUTE FUNCTION documento_validate_consentimiento();

-- ════════════════════════════════════════════════════════════════════════════
-- RLS · documentos
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE documento_clinico ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento_clinico FORCE  ROW LEVEL SECURITY;

CREATE POLICY documento_select_clinical
  ON documento_clinico FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM paciente p WHERE p.id = documento_clinico.paciente_id)
  );

CREATE POLICY documento_insert_clinical
  ON documento_clinico FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND subido_por_id = public.user_member_id_in(organization_id)
    AND EXISTS (
      SELECT 1 FROM paciente p
      WHERE p.id = documento_clinico.paciente_id
        AND p.organization_id = documento_clinico.organization_id
    )
  );

CREATE POLICY documento_update_clinical
  ON documento_clinico FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
  );

-- Soft delete: marcar deleted_at en lugar de DELETE físico (retención).
CREATE POLICY documento_no_delete
  ON documento_clinico FOR DELETE USING (false);
