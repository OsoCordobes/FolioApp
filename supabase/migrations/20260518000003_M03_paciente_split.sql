-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M03 · Split PII / PHI del paciente
-- ════════════════════════════════════════════════════════════════════════════
-- Implementa la regla de oro de privacy de Folio: la PII (nombre, DNI, contacto,
-- domicilio) vive en `paciente_identidad`, y la PHI (motivo, notas clínicas,
-- profesional asignado, caja fuerte) vive en `paciente`. Relación 1:1 via
-- `paciente.identidad_id` con `ON DELETE SET NULL`.
--
-- Por qué split:
--   1. RLS diferenciada — ASISTENTE puede leer PII (necesario para agenda)
--      pero NO la PHI. PROFESIONAL/OWNER pueden leer ambas.
--   2. Pseudonimización (Ley 25.326 art. 16) — borrar `paciente_identidad`
--      deja `paciente` huérfano (identidad_id=NULL) sin tocar el historial
--      clínico. Cumple Ley 26.529 art. 18 (retención 10 años) + Habeas Data.
--   3. Analytics — F8 puede agregar sobre `paciente` sin tocar PII.
--
-- Encriptación columnar (AES-256-GCM app-side, key en FOLIO_ENC_KEY):
--   - Todo lo que identifica personalmente está bytea con ciphertext.
--   - fecha_nacimiento NO cifrada (necesaria para agrupar por edad en analytics).
--   - domicilio_ciudad / domicilio_provincia / domicilio_cp NO cifrados
--     (geo cohort para k-anonymity).
--
-- Blind indexes:
--   - `nombre_hash` (HMAC del nombre normalizado) para búsqueda prefix.
--   - `dni_hash` (HMAC del documento) para lookup exacto.
--   - Unique(organization_id, dni_hash) garantiza no duplicar pacientes por DNI.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Enums ─────────────────────────────────────────────────────────────────

CREATE TYPE tipo_doc AS ENUM ('DNI', 'LE', 'LC', 'CI', 'PASAPORTE');
CREATE TYPE tipo_paciente AS ENUM ('NUEVO', 'RECURRENTE');

-- ─── PacienteIdentidad (PII) ──────────────────────────────────────────────

CREATE TABLE paciente_identidad (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,

  -- Todos cifrados AES-256-GCM app-side antes de INSERT
  nombre_cifrado              bytea NOT NULL,
  apellido_cifrado            bytea NOT NULL,
  tipo_doc                    tipo_doc NOT NULL DEFAULT 'DNI',
  numero_doc_cifrado          bytea,
  email_cifrado               bytea,
  telefono_cifrado            bytea NOT NULL,
  domicilio_calle_cifrado     bytea,
  domicilio_numero_cifrado    bytea,

  -- NO cifrados (uso en analytics + geo cohort)
  fecha_nacimiento            date,
  sexo_biologico              text,            -- 'M', 'F', 'I' (Ley 26.743: util clínicamente)
  genero_autopercibido        text,            -- libre, default = sexo_biologico
  domicilio_ciudad            text,
  domicilio_provincia         text,
  domicilio_cp                text,

  -- Blind indexes (HMAC determinístico, calculados en app o trigger)
  nombre_hash                 text,            -- hmac sobre lower(trim(nombre || ' ' || apellido))
  dni_hash                    text,            -- hmac sobre lower(trim(numero_doc))

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  deleted_at                  timestamptz,     -- borrado físico al pseudonimizar

  CONSTRAINT paciente_identidad_unique_dni
    UNIQUE (organization_id, dni_hash) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX paciente_identidad_org_nombre_idx
  ON paciente_identidad (organization_id, nombre_hash) WHERE deleted_at IS NULL;
CREATE INDEX paciente_identidad_org_dni_idx
  ON paciente_identidad (organization_id, dni_hash) WHERE deleted_at IS NULL;
CREATE INDEX paciente_identidad_ciudad_idx
  ON paciente_identidad (domicilio_ciudad, domicilio_provincia) WHERE deleted_at IS NULL;

COMMENT ON TABLE paciente_identidad IS
  'Folio · PII del paciente (nombre, doc, contacto, domicilio). Columnas *_cifrado guardan ciphertext AES-256-GCM (encrypt en Server Action con FOLIO_ENC_KEY). Se borra físicamente en la pseudonimización (Ley 25.326 art. 16).';
COMMENT ON COLUMN paciente_identidad.nombre_cifrado IS 'AES-256-GCM app-side';
COMMENT ON COLUMN paciente_identidad.apellido_cifrado IS 'AES-256-GCM app-side';
COMMENT ON COLUMN paciente_identidad.numero_doc_cifrado IS 'AES-256-GCM app-side';
COMMENT ON COLUMN paciente_identidad.email_cifrado IS 'AES-256-GCM app-side';
COMMENT ON COLUMN paciente_identidad.telefono_cifrado IS 'AES-256-GCM app-side';
COMMENT ON COLUMN paciente_identidad.domicilio_calle_cifrado IS 'AES-256-GCM app-side';
COMMENT ON COLUMN paciente_identidad.domicilio_numero_cifrado IS 'AES-256-GCM app-side';
COMMENT ON COLUMN paciente_identidad.nombre_hash IS 'HMAC-SHA256 de lower(trim(nombre + " " + apellido)) con FOLIO_ENC_HMAC_KEY · blind index para búsqueda';
COMMENT ON COLUMN paciente_identidad.dni_hash IS 'HMAC-SHA256 de lower(trim(numero_doc)) con FOLIO_ENC_HMAC_KEY · blind index para lookup exacto';

-- ─── Paciente (PHI) ───────────────────────────────────────────────────────

CREATE TABLE paciente (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  identidad_id                uuid UNIQUE REFERENCES paciente_identidad(id) ON DELETE SET NULL,

  motivo_consulta_cifrado     bytea,
  notas_importantes_cifrado   bytea,
  tipo                        tipo_paciente NOT NULL DEFAULT 'NUEVO',
  tags                        text[] NOT NULL DEFAULT '{}',

  -- Clinic-ready: profesional dueño de la HC + caja fuerte opcional
  profesional_principal_id    uuid REFERENCES member(id) ON DELETE SET NULL,
  caja_fuerte_profesional     uuid REFERENCES member(id) ON DELETE SET NULL,

  -- Soft delete + pseudonimización
  deleted_at                  timestamptz,
  deleted_by_id               uuid REFERENCES profile(id) ON DELETE SET NULL,
  deleted_reason              text,
  pseudonimizado_en           timestamptz,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT paciente_pseudo_consistency
    CHECK (pseudonimizado_en IS NULL OR identidad_id IS NULL),
  CONSTRAINT paciente_profesional_principal_in_same_org
    CHECK (profesional_principal_id IS NULL),   -- trigger valida cross-table abajo
  CONSTRAINT paciente_caja_fuerte_in_same_org
    CHECK (caja_fuerte_profesional IS NULL)
);

CREATE INDEX paciente_org_deleted_idx ON paciente (organization_id, deleted_at);
CREATE INDEX paciente_profesional_idx
  ON paciente (profesional_principal_id) WHERE profesional_principal_id IS NOT NULL;
CREATE INDEX paciente_caja_fuerte_idx
  ON paciente (caja_fuerte_profesional) WHERE caja_fuerte_profesional IS NOT NULL;
CREATE INDEX paciente_org_tipo_idx ON paciente (organization_id, tipo) WHERE deleted_at IS NULL;

COMMENT ON TABLE paciente IS
  'Folio · PHI del paciente (motivo, notas, profesional asignado, caja fuerte). Columnas *_cifrado son AES-256-GCM app-side. identidad_id NULL = pseudonimizado.';
COMMENT ON COLUMN paciente.motivo_consulta_cifrado IS 'AES-256-GCM app-side';
COMMENT ON COLUMN paciente.notas_importantes_cifrado IS 'AES-256-GCM app-side';
COMMENT ON COLUMN paciente.caja_fuerte_profesional IS
  'Si seteado, SOLO ese member puede leer la PHI (override de paciente.profesional_principal_id). Para casos VIP / restricción explícita del paciente.';

-- Trigger que valida que profesional_principal_id y caja_fuerte_profesional
-- pertenezcan a la misma org que el paciente.
CREATE OR REPLACE FUNCTION paciente_validate_member_same_org()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.profesional_principal_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM member
      WHERE id = NEW.profesional_principal_id AND organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'paciente.profesional_principal_id must reference a member in the same organization';
    END IF;
  END IF;
  IF NEW.caja_fuerte_profesional IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM member
      WHERE id = NEW.caja_fuerte_profesional AND organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'paciente.caja_fuerte_profesional must reference a member in the same organization';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER paciente_member_same_org_guard
  BEFORE INSERT OR UPDATE OF profesional_principal_id, caja_fuerte_profesional, organization_id
  ON paciente
  FOR EACH ROW EXECUTE FUNCTION paciente_validate_member_same_org();

CREATE TRIGGER paciente_set_updated_at
  BEFORE UPDATE ON paciente
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER paciente_identidad_set_updated_at
  BEFORE UPDATE ON paciente_identidad
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- RLS · paciente_identidad y paciente
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE paciente_identidad ENABLE ROW LEVEL SECURITY;
ALTER TABLE paciente_identidad FORCE  ROW LEVEL SECURITY;
ALTER TABLE paciente           ENABLE ROW LEVEL SECURITY;
ALTER TABLE paciente           FORCE  ROW LEVEL SECURITY;

-- ─── PacienteIdentidad: lectura amplia dentro de la org ──────────────────
-- Todos los roles ven la PII (necesario para agenda, recordatorios, búsqueda).
-- Lo que cambia es si pueden leer también la PHI (Paciente) — la policy
-- de Paciente abajo es estricta.

CREATE POLICY paciente_identidad_select_org
  ON paciente_identidad FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND deleted_at IS NULL
  );

CREATE POLICY paciente_identidad_insert_admin
  ON paciente_identidad FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    -- Cualquier rol con rol activo puede crear (ASISTENTE para walk-in,
    -- PROFESIONAL para primera consulta, etc.)
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL', 'COORDINADOR', 'ASISTENTE')
  );

CREATE POLICY paciente_identidad_update_admin
  ON paciente_identidad FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL', 'ASISTENTE')
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL', 'ASISTENTE')
  );

-- DELETE solo por proc pseudonimización (M13). Por ahora cerramos.
CREATE POLICY paciente_identidad_no_delete
  ON paciente_identidad FOR DELETE
  USING (false);

-- ─── Paciente (PHI): policies estrictas por rol + caja fuerte ────────────
-- Lectura:
--   - OWNER siempre.
--   - DIRECTOR si es_colegiado.
--   - PROFESIONAL si profesional_principal_id = mi member_id O si tengo
--     turnos atendidos con el paciente (lo último se materializa en M09 vía
--     EXISTS en turno).
--   - ASISTENTE / COORDINADOR no clínico: NUNCA (solo ven PacienteIdentidad).
--   - Caja fuerte: si seteada, solo ese member específico (override).

CREATE POLICY paciente_select_clinical
  ON paciente FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND (
      -- OWNER y DIRECTOR colegiado: ven todo (sujeto a caja fuerte abajo)
      public.user_role_in(organization_id) = 'OWNER'
      OR (
        public.user_role_in(organization_id) = 'DIRECTOR'
        AND EXISTS (
          SELECT 1 FROM member
          WHERE profile_id = auth.uid()
            AND organization_id = paciente.organization_id
            AND es_colegiado = true
        )
      )
      -- PROFESIONAL: dueño del paciente (otros pacientes vienen via Turno en M09)
      OR (
        public.user_role_in(organization_id) = 'PROFESIONAL'
        AND profesional_principal_id = public.user_member_id_in(organization_id)
      )
    )
    -- Caja fuerte: si seteada, solo el member específico
    AND (
      caja_fuerte_profesional IS NULL
      OR caja_fuerte_profesional = public.user_member_id_in(organization_id)
    )
  );

CREATE POLICY paciente_insert_clinical
  ON paciente FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    -- Solo roles clínicos pueden crear pacientes (la PHI nace de aquí)
    AND public.user_role_in(organization_id) IN ('OWNER', 'PROFESIONAL', 'DIRECTOR')
  );

CREATE POLICY paciente_update_clinical
  ON paciente FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND (
      caja_fuerte_profesional IS NULL
      OR caja_fuerte_profesional = public.user_member_id_in(organization_id)
    )
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
  );

CREATE POLICY paciente_no_delete
  ON paciente FOR DELETE
  USING (false);

-- ─── Blind indexes ────────────────────────────────────────────────────────
-- nombre_hash y dni_hash se computan SIEMPRE en el cliente (Server Action en F4
-- con `lib/crypto.ts`). La DB no los puede recalcular porque los datos en
-- columnas `*_cifrado` ya están cifrados con AES-256-GCM y la key vive en el
-- servidor. Las queries de búsqueda por nombre o DNI envían el HMAC pre-
-- computado: `SELECT ... WHERE nombre_hash = $1` con `$1` igual a
-- `hmac_sha256(lower(trim(name)), FOLIO_ENC_HMAC_KEY)`.
