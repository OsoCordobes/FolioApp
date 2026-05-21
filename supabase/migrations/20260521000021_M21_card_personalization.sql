-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M21 · Card personalization (logo_url + card_mood + org-logos bucket)
-- ════════════════════════════════════════════════════════════════════════════
-- Soporta Layer D (logo upload) y Layer B (mood preset) del redesign de la
-- card pública del profesional. Cero PII; cero data clínica. Datos del
-- negocio mostrados en /book/<slug>.
--
-- Mood: text + CHECK (4 valores). NO PG ENUM type — text + CHECK es más
-- fácil de evolucionar (agregar un quinto mood = un solo ALTER en una
-- migration futura).
--
-- Storage bucket: org-logos. Public read (la card se ve sin auth en /book).
-- Write restringido a OWNER/DIRECTOR de la org cuyo UUID es el primer
-- segmento del path (<org_id>/logo.png). MIME allowlist: image/png.
-- Size cap: 512 KB (el cliente caps a 500 KB, dejando 12 KB de headroom).
--
-- Backfill:
--   - Orgs existentes reciben card_mood='editorial' via DEFAULT.
--   - logo_url permanece NULL por definición (no había logos antes).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Columnas en organization ───────────────────────────────────────────

ALTER TABLE organization
  ADD COLUMN IF NOT EXISTS logo_url  text NULL,
  ADD COLUMN IF NOT EXISTS card_mood text NOT NULL DEFAULT 'editorial';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organization_card_mood_enum'
  ) THEN
    ALTER TABLE organization
      ADD CONSTRAINT organization_card_mood_enum
      CHECK (card_mood IN ('calido','clinico','editorial','boutique'));
  END IF;
END$$;

COMMENT ON COLUMN organization.logo_url IS
  'URL pública del logo PNG del consultorio (Supabase Storage bucket org-logos). NULL → renderea avatar iniciales en card pública.';
COMMENT ON COLUMN organization.card_mood IS
  'Estilo visual elegido por el pro para su card pública. Valores: calido | clinico | editorial | boutique. Aplicado vía data-card-mood en <PublicCard>.';

-- ─── 2. Storage bucket org-logos ──────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-logos',
  'org-logos',
  true,
  524288,                            -- 512 KB
  ARRAY['image/png']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── 3. RLS policies en storage.objects ──────────────────────────────────
-- Public read: anyone (incluyendo anonymous) puede SELECT objects del bucket.
-- Write: requiere session válida + member OWNER/DIRECTOR de la org cuyo UUID
-- es el primer segmento del path. Esto previene que un pro suba un logo a
-- la carpeta de otra org.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'org-logos public read'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "org-logos public read"
        ON storage.objects FOR SELECT
        USING (bucket_id = 'org-logos')
    $POL$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'org-logos owner-or-director write'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "org-logos owner-or-director write"
        ON storage.objects FOR ALL
        USING (
          bucket_id = 'org-logos'
          AND auth.uid() IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.member m
            WHERE m.profile_id = auth.uid()
              AND m.organization_id::text = (string_to_array(name, '/'))[1]
              AND m.role IN ('OWNER', 'DIRECTOR')
              AND m.deleted_at IS NULL
          )
        )
        WITH CHECK (
          bucket_id = 'org-logos'
          AND auth.uid() IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.member m
            WHERE m.profile_id = auth.uid()
              AND m.organization_id::text = (string_to_array(name, '/'))[1]
              AND m.role IN ('OWNER', 'DIRECTOR')
              AND m.deleted_at IS NULL
          )
        )
    $POL$;
  END IF;
END$$;
