-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M05 · Entidades clínicas (Diagnóstico, Alergia, Medicación, Cobertura)
-- ════════════════════════════════════════════════════════════════════════════
-- Adjuntos del paciente que materializan el historial clínico estructurado:
--
--   - Diagnostico   · FK opcional a CIE-10 + descripción libre cifrada
--   - Alergia       · sustancia cifrada + severidad + reacción cifrada
--   - Medicacion    · principio activo cifrado + dosis/frecuencia/vía
--   - Cobertura     · FK ObraSocial + número afiliado cifrado + plan
--
-- RLS:
--   - Diagnóstico / Alergia / Medicación → CLÍNICA (OWNER + PROFESIONAL +
--     DIRECTOR colegiado). ASISTENTE NO ve estos datos.
--   - CoberturaPaciente → ADMINISTRATIVA (también ASISTENTE para coordinar
--     autorización con obra social). El numero_afiliado SÍ está cifrado.
--
-- Compliance:
--   - `creado_por_id` registra quién agregó el diagnóstico/alergia (Ley 26.529
--     art. 15 inviolabilidad — quién tocó qué).
--   - `verificada_por` en Alergia marca verificación clínica explícita
--     (importante para AINEs, anestesias, etc.).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Enums ─────────────────────────────────────────────────────────────────

CREATE TYPE tipo_diagnostico AS ENUM ('PRINCIPAL', 'SECUNDARIO');
CREATE TYPE estado_diagnostico AS ENUM ('ACTIVO', 'RESUELTO', 'CRONICO');
CREATE TYPE severidad_alergia AS ENUM ('LEVE', 'MODERADA', 'SEVERA', 'ANAFILAXIA');

-- ─── Diagnóstico ──────────────────────────────────────────────────────────

CREATE TABLE diagnostico (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  paciente_id           uuid NOT NULL REFERENCES paciente(id) ON DELETE CASCADE,
  codigo_cie10          text REFERENCES codigo_cie10(codigo) ON DELETE SET NULL,
  descripcion_cifrado   bytea NOT NULL,                        -- AES-256-GCM app-side
  tipo                  tipo_diagnostico NOT NULL DEFAULT 'PRINCIPAL',
  estado                estado_diagnostico NOT NULL DEFAULT 'ACTIVO',
  fecha_inicio          date NOT NULL,
  fecha_resolucion      date,
  creado_por_id         uuid NOT NULL REFERENCES member(id) ON DELETE SET NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT diagnostico_fechas_orden CHECK (fecha_resolucion IS NULL OR fecha_resolucion >= fecha_inicio),
  CONSTRAINT diagnostico_resuelto_consistency
    CHECK ((estado = 'RESUELTO') = (fecha_resolucion IS NOT NULL))
);

CREATE INDEX diagnostico_paciente_idx ON diagnostico (paciente_id, fecha_inicio DESC);
CREATE INDEX diagnostico_org_estado_idx ON diagnostico (organization_id, estado);
CREATE INDEX diagnostico_cie10_idx ON diagnostico (codigo_cie10) WHERE codigo_cie10 IS NOT NULL;

CREATE TRIGGER diagnostico_set_updated_at
  BEFORE UPDATE ON diagnostico
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE diagnostico IS
  'Folio · diagnóstico estructurado por paciente. codigo_cie10 opcional (texto libre cifrado siempre disponible). creado_por_id es FK fuerte para audit (Ley 26.529 art. 15).';

-- ─── Alergia ──────────────────────────────────────────────────────────────

CREATE TABLE alergia (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  paciente_id           uuid NOT NULL REFERENCES paciente(id) ON DELETE CASCADE,
  sustancia_cifrado     bytea NOT NULL,                        -- AES-256-GCM app-side
  severidad             severidad_alergia NOT NULL,
  reaccion_cifrado      bytea,                                 -- AES-256-GCM app-side
  verificada_por        uuid REFERENCES member(id) ON DELETE SET NULL,
  verificada_en         timestamptz,
  activa                boolean NOT NULL DEFAULT true,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT alergia_verificacion_consistency
    CHECK ((verificada_por IS NULL) = (verificada_en IS NULL))
);

CREATE INDEX alergia_paciente_activa_idx
  ON alergia (paciente_id, activa) WHERE activa = true;
CREATE INDEX alergia_org_severidad_idx
  ON alergia (organization_id, severidad) WHERE activa = true;

CREATE TRIGGER alergia_set_updated_at
  BEFORE UPDATE ON alergia
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE alergia IS
  'Folio · alergias del paciente. severidad enum (ANAFILAXIA = riesgo vital). verificada_por marca cuando un profesional confirmó la alergia (importante antes de AINEs, anestésicos).';

-- ─── Medicación ───────────────────────────────────────────────────────────

CREATE TABLE medicacion (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  paciente_id                 uuid NOT NULL REFERENCES paciente(id) ON DELETE CASCADE,
  principio_activo_cifrado    bytea NOT NULL,                  -- AES-256-GCM app-side
  dosis                       text,                            -- "500mg", "20mg/ml"
  frecuencia                  text,                            -- "cada 8h", "1 vez/día"
  via                         text,                            -- "oral", "tópica"
  desde                       date,
  hasta                       date,                            -- NULL = vigente
  prescripto_por_externo      text,                            -- nombre del médico externo
  notas_cifrado               bytea,                           -- AES-256-GCM app-side

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT medicacion_vigencia CHECK (hasta IS NULL OR hasta >= desde)
);

-- Partial index sobre medicación vigente. NO usamos CURRENT_DATE en el
-- predicado porque no es IMMUTABLE (Postgres rechaza). Indexamos por
-- (paciente_id, hasta) y la query filtra `hasta IS NULL OR hasta >= CURRENT_DATE`
-- usando el composite — el planner usa el índice eficientemente igual.
CREATE INDEX medicacion_paciente_vigente_idx
  ON medicacion (paciente_id, hasta);
CREATE INDEX medicacion_org_idx ON medicacion (organization_id);

CREATE TRIGGER medicacion_set_updated_at
  BEFORE UPDATE ON medicacion
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE medicacion IS
  'Folio · medicación vigente o histórica del paciente. principio_activo + dosis + frecuencia + vía es la unidad clínica. prescripto_por_externo cuando el indicador viene de otro médico.';

-- ─── CoberturaPaciente ────────────────────────────────────────────────────

CREATE TYPE vinculo_titular AS ENUM (
  'CONYUGE',
  'HIJO',
  'PADRE_MADRE',
  'OTRO_FAMILIAR',
  'TITULAR_DIRECTO'
);

CREATE TABLE cobertura_paciente (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  paciente_id                 uuid NOT NULL REFERENCES paciente(id) ON DELETE CASCADE,
  obra_social_id              uuid NOT NULL REFERENCES obra_social(id) ON DELETE RESTRICT,
  numero_afiliado_cifrado     bytea NOT NULL,                  -- AES-256-GCM app-side
  plan                        text,                            -- "Plan 410", "B2"
  vigencia_desde              date,
  vigencia_hasta              date,
  es_titular                  boolean NOT NULL DEFAULT true,
  vinculo_titular             vinculo_titular,
  activa                      boolean NOT NULL DEFAULT true,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cobertura_titular_consistency
    CHECK (es_titular = true OR vinculo_titular IS NOT NULL),
  CONSTRAINT cobertura_vigencia CHECK (vigencia_hasta IS NULL OR vigencia_hasta >= vigencia_desde)
);

CREATE INDEX cobertura_paciente_activa_idx
  ON cobertura_paciente (paciente_id, activa) WHERE activa = true;
CREATE INDEX cobertura_obra_social_idx ON cobertura_paciente (obra_social_id);

CREATE TRIGGER cobertura_set_updated_at
  BEFORE UPDATE ON cobertura_paciente
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE cobertura_paciente IS
  'Folio · cobertura médica del paciente. numero_afiliado cifrado. es_titular=true → no necesita vinculo_titular. Si es_titular=false (familiar), debe especificar vinculo.';

-- ════════════════════════════════════════════════════════════════════════════
-- RLS · entidades clínicas
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE diagnostico         ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagnostico         FORCE  ROW LEVEL SECURITY;
ALTER TABLE alergia             ENABLE ROW LEVEL SECURITY;
ALTER TABLE alergia             FORCE  ROW LEVEL SECURITY;
ALTER TABLE medicacion          ENABLE ROW LEVEL SECURITY;
ALTER TABLE medicacion          FORCE  ROW LEVEL SECURITY;
ALTER TABLE cobertura_paciente  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cobertura_paciente  FORCE  ROW LEVEL SECURITY;

-- ─── Diagnóstico / Alergia / Medicación: SOLO roles clínicos ──────────────
-- Misma policy estructural: la fila es visible si:
--   1. La org coincide con las del usuario
--   2. El usuario puede leer datos clínicos (can_read_clinical)
--   3. El paciente está dentro del scope del usuario (caja fuerte, profesional
--      principal, etc.) — esto se hereda de paciente.policy vía EXISTS join.

CREATE POLICY diagnostico_select_clinical
  ON diagnostico FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND EXISTS (
      SELECT 1 FROM paciente p
      WHERE p.id = diagnostico.paciente_id
      -- paciente.policy ya filtra por caja fuerte / profesional_principal
    )
  );

CREATE POLICY diagnostico_insert_clinical
  ON diagnostico FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND creado_por_id = public.user_member_id_in(organization_id)
    AND EXISTS (
      SELECT 1 FROM paciente p
      WHERE p.id = diagnostico.paciente_id
        AND p.organization_id = diagnostico.organization_id
    )
  );

CREATE POLICY diagnostico_update_clinical
  ON diagnostico FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
  );

CREATE POLICY diagnostico_no_delete
  ON diagnostico FOR DELETE USING (false);

-- Alergia y Medicación: idéntica estructura.

CREATE POLICY alergia_select_clinical
  ON alergia FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND EXISTS (SELECT 1 FROM paciente p WHERE p.id = alergia.paciente_id)
  );
CREATE POLICY alergia_insert_clinical
  ON alergia FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND EXISTS (
      SELECT 1 FROM paciente p
      WHERE p.id = alergia.paciente_id
        AND p.organization_id = alergia.organization_id
    )
  );
CREATE POLICY alergia_update_clinical
  ON alergia FOR UPDATE
  USING (organization_id IN (SELECT public.user_org_ids()) AND public.can_read_clinical(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_org_ids()) AND public.can_read_clinical(organization_id));
CREATE POLICY alergia_no_delete ON alergia FOR DELETE USING (false);

CREATE POLICY medicacion_select_clinical
  ON medicacion FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND EXISTS (SELECT 1 FROM paciente p WHERE p.id = medicacion.paciente_id)
  );
CREATE POLICY medicacion_insert_clinical
  ON medicacion FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND EXISTS (
      SELECT 1 FROM paciente p
      WHERE p.id = medicacion.paciente_id
        AND p.organization_id = medicacion.organization_id
    )
  );
CREATE POLICY medicacion_update_clinical
  ON medicacion FOR UPDATE
  USING (organization_id IN (SELECT public.user_org_ids()) AND public.can_read_clinical(organization_id))
  WITH CHECK (organization_id IN (SELECT public.user_org_ids()) AND public.can_read_clinical(organization_id));
CREATE POLICY medicacion_no_delete ON medicacion FOR DELETE USING (false);

-- ─── CoberturaPaciente: ADMIN (incluye ASISTENTE) ─────────────────────────
-- ASISTENTE coordina autorizaciones de obras sociales, necesita ver cobertura.
-- El numero_afiliado SÍ está cifrado para defensa en profundidad.

CREATE POLICY cobertura_select_admin
  ON cobertura_paciente FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL', 'COORDINADOR', 'ASISTENTE')
  );

CREATE POLICY cobertura_write_admin
  ON cobertura_paciente FOR ALL
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL', 'ASISTENTE')
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL', 'ASISTENTE')
  );

-- ─── Helper: ¿el paciente tiene alergias severas o anafilácticas? ─────────
-- Usado por la UI de Hoy para mostrar la bandera ⚠ junto al nombre.
-- SECURITY DEFINER para que la app pueda invocarlo sin permisos full sobre
-- la tabla alergia (solo necesita saber el bit).
CREATE OR REPLACE FUNCTION public.paciente_tiene_alergias_severas(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM alergia
    WHERE paciente_id = p_id
      AND activa = true
      AND severidad IN ('SEVERA', 'ANAFILAXIA')
  )
$$;
