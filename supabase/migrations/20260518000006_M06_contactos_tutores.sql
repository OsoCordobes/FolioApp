-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M06 · Contactos de emergencia y tutores legales
-- ════════════════════════════════════════════════════════════════════════════
-- Dos tablas relacionadas:
--
--   - ContactoEmergencia · personas a contactar si hay emergencia clínica
--     (cónyuge, padre/madre, hijo). NO firma consentimientos.
--   - TutorLegal         · representante legal del paciente (Ley 26.061 para
--                          menores, código civil para incapacidades).
--                          SÍ firma consentimientos en lugar del paciente.
--
-- Por qué separadas:
--   - Validación: TutorLegal requiere DOCUMENTACIÓN (mostrar DNI, tutela).
--   - Compliance: TutorLegal aparece en `consentimiento.firmado_por_tutor_id`.
--   - RLS: ambos accesibles a roles administrativos + clínicos (necesario
--     para llamar en emergencia, no es PHI strict).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Enums ─────────────────────────────────────────────────────────────────

CREATE TYPE vinculo_familiar AS ENUM (
  'MADRE',
  'PADRE',
  'CONYUGE',
  'HIJO',
  'HERMANO',
  'ABUELO',
  'OTRO'
);

CREATE TYPE vinculo_tutor AS ENUM (
  'MADRE',
  'PADRE',
  'TUTOR_DESIGNADO',
  'ABUELO',
  'OTRO'
);

-- ─── ContactoEmergencia ───────────────────────────────────────────────────

CREATE TABLE contacto_emergencia (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  paciente_id         uuid NOT NULL REFERENCES paciente(id) ON DELETE CASCADE,
  nombre_cifrado      bytea NOT NULL,                          -- AES-256-GCM app-side
  telefono_cifrado    bytea NOT NULL,                          -- AES-256-GCM app-side
  vinculo             vinculo_familiar NOT NULL,
  es_principal        boolean NOT NULL DEFAULT false,
  notas               text,                                    -- libre, no cifrado (raramente PII)

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Solo un contacto principal por paciente (partial unique index)
CREATE UNIQUE INDEX contacto_emergencia_principal_unique
  ON contacto_emergencia (paciente_id)
  WHERE es_principal = true;

CREATE INDEX contacto_emergencia_paciente_idx
  ON contacto_emergencia (paciente_id, es_principal DESC);

CREATE TRIGGER contacto_emergencia_set_updated_at
  BEFORE UPDATE ON contacto_emergencia
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE contacto_emergencia IS
  'Folio · contactos para llamar en emergencia. NO son representantes legales (esos van en tutor_legal). es_principal=true: el primero en llamar.';

-- ─── TutorLegal ───────────────────────────────────────────────────────────

CREATE TABLE tutor_legal (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  paciente_id              uuid NOT NULL REFERENCES paciente(id) ON DELETE CASCADE,
  nombre_cifrado           bytea NOT NULL,                     -- AES-256-GCM app-side
  numero_doc_cifrado       bytea NOT NULL,                     -- DNI / pasaporte cifrado
  vinculo                  vinculo_tutor NOT NULL,
  telefono_cifrado         bytea NOT NULL,                     -- AES-256-GCM app-side
  email_cifrado            bytea,                              -- AES-256-GCM app-side
  es_principal             boolean NOT NULL DEFAULT true,

  -- Documentación de la designación (para tutores no-padres)
  documento_designacion_path text,                             -- Supabase Storage path
  vigencia_desde           date,
  vigencia_hasta           date,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tutor_vigencia CHECK (vigencia_hasta IS NULL OR vigencia_hasta >= vigencia_desde),
  CONSTRAINT tutor_designado_requires_doc
    CHECK (vinculo <> 'TUTOR_DESIGNADO' OR documento_designacion_path IS NOT NULL)
);

CREATE UNIQUE INDEX tutor_legal_principal_unique
  ON tutor_legal (paciente_id)
  WHERE es_principal = true;

CREATE INDEX tutor_legal_paciente_idx
  ON tutor_legal (paciente_id, es_principal DESC);

CREATE TRIGGER tutor_legal_set_updated_at
  BEFORE UPDATE ON tutor_legal
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE tutor_legal IS
  'Folio · representante legal (Ley 26.061 para menores). Firma consentimientos en lugar del paciente. TUTOR_DESIGNADO requiere documento de designación judicial.';

-- ════════════════════════════════════════════════════════════════════════════
-- RLS · contactos / tutores
-- ════════════════════════════════════════════════════════════════════════════
-- Lectura: todos los roles administrativos (incluye ASISTENTE) — necesario
-- para llamar en emergencia. La PII (nombre, teléfono) sigue cifrada a nivel
-- columna; RLS controla quién ve la fila.
-- Escritura: OWNER + PROFESIONAL + DIRECTOR. ASISTENTE puede insertar
-- (paciente nuevo en recepción) pero no editar después.

ALTER TABLE contacto_emergencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacto_emergencia FORCE  ROW LEVEL SECURITY;
ALTER TABLE tutor_legal         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_legal         FORCE  ROW LEVEL SECURITY;

CREATE POLICY contacto_select_org
  ON contacto_emergencia FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_admin(organization_id)
  );

CREATE POLICY contacto_insert_admin
  ON contacto_emergencia FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL', 'ASISTENTE')
    AND EXISTS (
      SELECT 1 FROM paciente p
      WHERE p.id = contacto_emergencia.paciente_id
        AND p.organization_id = contacto_emergencia.organization_id
    )
  );

CREATE POLICY contacto_update_admin
  ON contacto_emergencia FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL')
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL')
  );

CREATE POLICY contacto_delete_owner
  ON contacto_emergencia FOR DELETE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
  );

-- TutorLegal: misma estructura pero más estricto (la designación legal es seria).

CREATE POLICY tutor_legal_select_org
  ON tutor_legal FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_admin(organization_id)
  );

CREATE POLICY tutor_legal_insert_admin
  ON tutor_legal FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL')
    AND EXISTS (
      SELECT 1 FROM paciente p
      WHERE p.id = tutor_legal.paciente_id
        AND p.organization_id = tutor_legal.organization_id
    )
  );

CREATE POLICY tutor_legal_update_admin
  ON tutor_legal FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL')
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL')
  );

CREATE POLICY tutor_legal_delete_owner
  ON tutor_legal FOR DELETE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) = 'OWNER'
  );
