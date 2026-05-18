-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M04 · Catálogos read-only (CIE-10, ObraSocial, PlantillaConsentimiento)
-- ════════════════════════════════════════════════════════════════════════════
-- Tablas de referencia compartidas. NO son tenant-scoped (RLS abierta para
-- lectura) pero la escritura está limitada a service_role (admin Supabase).
--
-- Las tres tablas se completan vía scripts de seed:
--   - `supabase/seed/cie10.sql`        — ~14.000 filas (Capítulos I-XXII)
--   - `supabase/seed/obras_sociales_ar.sql` — ~300 obras sociales argentinas
--   - `supabase/seed/consentimientos_default.sql` — 5 plantillas globales
--
-- Para PlantillaConsentimiento, `organization_id` es NULLABLE:
--   - NULL = plantilla global del sistema (templates legales base)
--   - != NULL = plantilla custom del consultorio (variación local)
--
-- Versionado: una plantilla publicada es INMUTABLE. Para cambios, se crea
-- una nueva versión con `reemplazado_por` apuntando a la nueva.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Enums ─────────────────────────────────────────────────────────────────

CREATE TYPE tipo_obra_social AS ENUM (
  'OBRA_SOCIAL',
  'PREPAGA',
  'PAMI',
  'SINDICAL',
  'PARTICULAR'
);

CREATE TYPE tipo_consentimiento AS ENUM (
  'GENERAL',
  'FOTOS',
  'DIVULGACION_CIENTIFICA',
  'TELEMEDICINA',
  'TRATAMIENTO_MENOR'
);

-- ─── CodigoCie10 ──────────────────────────────────────────────────────────

CREATE TABLE codigo_cie10 (
  codigo          text PRIMARY KEY,                            -- "M54.5"
  descripcion     text NOT NULL,                               -- "Lumbago no especificado"
  capitulo        text NOT NULL,                               -- "XIII · Enfermedades del sistema osteomuscular"
  capitulo_num    smallint NOT NULL,                           -- 13 para ordenar
  bloque          text,                                        -- "M50-M54"
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT codigo_cie10_format CHECK (codigo ~ '^[A-Z][0-9]{2}(\.[0-9]{1,2})?$'),
  CONSTRAINT codigo_cie10_capitulo_num CHECK (capitulo_num BETWEEN 1 AND 22)
);

-- pg_trgm para búsqueda fuzzy ("lumbalgia" → encuentra "lumbago"). Está
-- disponible en Supabase Free. Debe crearse ANTES del índice que usa
-- gin_trgm_ops (M01 ya la habilita, repetimos por seguridad si M04 corre suelto).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_trgm';
  END IF;
END
$$;

CREATE INDEX codigo_cie10_capitulo_idx ON codigo_cie10 (capitulo_num, codigo);
CREATE INDEX codigo_cie10_descripcion_trgm_idx
  ON codigo_cie10 USING gin (descripcion gin_trgm_ops);

COMMENT ON TABLE codigo_cie10 IS
  'Folio · catálogo CIE-10 (OMS Spanish edition) · ~14.000 códigos diagnósticos. Seed en supabase/seed/cie10.sql.';

-- ─── ObraSocial ───────────────────────────────────────────────────────────

CREATE TABLE obra_social (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_rnos     text UNIQUE,                                 -- Registro Nacional de Obras Sociales
  nombre          text NOT NULL,
  nombre_corto    text,                                        -- "OSDE", "Swiss Medical", etc.
  tipo            tipo_obra_social NOT NULL,
  activa          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT obra_social_nombre_len CHECK (length(nombre) BETWEEN 2 AND 200)
);

CREATE INDEX obra_social_nombre_idx ON obra_social (lower(nombre)) WHERE activa = true;
CREATE INDEX obra_social_tipo_idx ON obra_social (tipo, activa);

COMMENT ON TABLE obra_social IS
  'Folio · catálogo de Obras Sociales y prepagas argentinas (Superintendencia de Servicios de Salud). ~300 filas. Seed en supabase/seed/obras_sociales_ar.sql.';

-- ─── PlantillaConsentimiento ──────────────────────────────────────────────

CREATE TABLE plantilla_consentimiento (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid REFERENCES organization(id) ON DELETE CASCADE,  -- NULL = global
  tipo             tipo_consentimiento NOT NULL,
  version          smallint NOT NULL DEFAULT 1,
  texto_markdown   text NOT NULL,                              -- inmutable una vez publicado
  publicado_en     timestamptz NOT NULL DEFAULT now(),
  reemplazado_por  uuid REFERENCES plantilla_consentimiento(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT plantilla_version_positive CHECK (version > 0),
  CONSTRAINT plantilla_texto_min CHECK (length(texto_markdown) > 100),
  CONSTRAINT plantilla_no_self_replace CHECK (reemplazado_por IS NULL OR reemplazado_por <> id)
);

CREATE INDEX plantilla_consentimiento_org_tipo_idx
  ON plantilla_consentimiento (organization_id, tipo, version DESC)
  WHERE reemplazado_por IS NULL;
CREATE INDEX plantilla_consentimiento_global_tipo_idx
  ON plantilla_consentimiento (tipo, version DESC)
  WHERE organization_id IS NULL AND reemplazado_por IS NULL;

COMMENT ON TABLE plantilla_consentimiento IS
  'Folio · plantillas de consentimiento informado (Ley 26.529 art. 5-11). Versionado inmutable: una vez publicada, no se edita; cambios crean nueva versión con `reemplazado_por`.';
COMMENT ON COLUMN plantilla_consentimiento.organization_id IS
  'NULL = plantilla global del sistema (template legal base). != NULL = versión custom del consultorio.';

-- Trigger: prevenir UPDATE del texto una vez publicado. Permite UPDATE solo
-- de `reemplazado_por` (para marcar como obsoleta).
CREATE OR REPLACE FUNCTION plantilla_prevent_text_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.publicado_en IS NOT NULL
     AND (OLD.texto_markdown IS DISTINCT FROM NEW.texto_markdown
          OR OLD.version IS DISTINCT FROM NEW.version
          OR OLD.tipo IS DISTINCT FROM NEW.tipo) THEN
    RAISE EXCEPTION 'plantilla_consentimiento.texto_markdown / version / tipo son inmutables una vez publicado. Creá una nueva versión y apuntá `reemplazado_por` a ella.';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER plantilla_immutable_guard
  BEFORE UPDATE ON plantilla_consentimiento
  FOR EACH ROW EXECUTE FUNCTION plantilla_prevent_text_update();

-- ════════════════════════════════════════════════════════════════════════════
-- RLS · catálogos
-- ════════════════════════════════════════════════════════════════════════════
-- CodigoCie10 y ObraSocial son lectura PÚBLICA (cualquier usuario autenticado
-- ve el catálogo completo — no hay PII en ellos). Escritura limitada a
-- service_role (admin Supabase via supabase CLI o panel).
--
-- PlantillaConsentimiento: lectura combinada de globales (org_id NULL) +
-- propias de la org. Escritura solo OWNER + DIRECTOR.

ALTER TABLE codigo_cie10                ENABLE ROW LEVEL SECURITY;
ALTER TABLE codigo_cie10                FORCE  ROW LEVEL SECURITY;
ALTER TABLE obra_social                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE obra_social                 FORCE  ROW LEVEL SECURITY;
ALTER TABLE plantilla_consentimiento    ENABLE ROW LEVEL SECURITY;
ALTER TABLE plantilla_consentimiento    FORCE  ROW LEVEL SECURITY;

-- ─── CodigoCie10 ──────────────────────────────────────────────────────────

CREATE POLICY cie10_select_authenticated
  ON codigo_cie10 FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- No CREATE/UPDATE/DELETE policy → bloqueado para usuarios normales.
-- service_role bypassea RLS automáticamente para el seed.

-- ─── ObraSocial ───────────────────────────────────────────────────────────

CREATE POLICY obra_social_select_authenticated
  ON obra_social FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ─── PlantillaConsentimiento ──────────────────────────────────────────────

CREATE POLICY plantilla_select_global_or_own
  ON plantilla_consentimiento FOR SELECT
  USING (
    organization_id IS NULL                                    -- global
    OR organization_id IN (SELECT public.user_org_ids())       -- propia
  );

CREATE POLICY plantilla_insert_admin
  ON plantilla_consentimiento FOR INSERT
  WITH CHECK (
    organization_id IS NOT NULL                                -- no se insertan globales vía RLS
    AND organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
  );

-- Solo permite UPDATE de `reemplazado_por` (el trigger arriba bloquea texto).
CREATE POLICY plantilla_update_admin
  ON plantilla_consentimiento FOR UPDATE
  USING (
    organization_id IS NOT NULL
    AND organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
  );

CREATE POLICY plantilla_no_delete
  ON plantilla_consentimiento FOR DELETE
  USING (false);
