-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M62 · Perfil público por profesional (foto + bio + matrícula visible)
-- ════════════════════════════════════════════════════════════════════════════
-- Da a cada profesional un perfil PÚBLICO por consultorio (en `member`, no en
-- `profile` — igual que M55 con `especialidad`): la landing /book/[slug] muestra
-- "conocé a tu profesional" con foto, bio y (opt-in) matrícula.
--
-- foto_publica_url y bio_publica son datos PÚBLICOS, consentidos, NO médicos,
-- NO PII sensible — viven en plaintext y en un bucket público, igual que
-- organization.bio / organization.logo_url (M20/M21). NO se cifran: la landing
-- anónima debe poder servirlos sin sesión. (Las tablas con PII real —
-- profile.nombre_cifrado, etc. — siguen cifradas.)
--
-- La matrícula NO se duplica: el VALOR sigue en profile.matricula (M02, ya
-- editable en Configuración → Cuenta). Acá solo agregamos mostrar_matricula
-- (opt-in por member, default false → privacy-safe: nadie expone su matrícula
-- sin activarlo).
--
-- 100% aditiva: columnas nullable / con default seguro + bucket público +
-- policies storage idempotentes (patrón M21). No define funciones SQL ni usa
-- funciones en índices/EXCLUDE → NO necesita `set check_function_bodies = off`
-- ni IMMUTABLE. Replay-safe en postgres:16 vanilla y bajo pgTAP.
--
-- Backfill: members existentes → foto_publica_url=NULL, bio_publica=NULL,
-- mostrar_matricula=false. Sin exposición; la landing cae a iniciales.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Columnas en member ──────────────────────────────────────────────────

ALTER TABLE member
  ADD COLUMN IF NOT EXISTS foto_publica_url  text NULL,
  ADD COLUMN IF NOT EXISTS bio_publica       text NULL,
  ADD COLUMN IF NOT EXISTS mostrar_matricula boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'member_bio_publica_len'
  ) THEN
    ALTER TABLE member
      ADD CONSTRAINT member_bio_publica_len
      CHECK (bio_publica IS NULL OR length(bio_publica) BETWEEN 1 AND 400);
  END IF;
END$$;

COMMENT ON COLUMN member.foto_publica_url IS
  'M62 · URL pública de la foto del profesional (bucket professional-photos). NULL → la landing /book renderea avatar de iniciales. Dato consentido, NO médico, plaintext.';
COMMENT ON COLUMN member.bio_publica IS
  'M62 · bio pública del profesional para /book (1-400 chars). Dato consentido, NO médico, plaintext. Distinta de organization.bio (que describe el consultorio).';
COMMENT ON COLUMN member.mostrar_matricula IS
  'M62 · opt-in del profesional a publicar profile.matricula en /book. Default false (privacy-safe). El VALOR vive en profile.matricula (M02), no se duplica acá.';

-- ─── 2. Storage bucket professional-photos (público, modelo M21 org-logos) ───
-- Las fotos son headshots → JPEG/WebP además de PNG (los logos eran solo PNG).
-- Cap 512 KB (el cliente caps a 500 KB, 12 KB de headroom).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'professional-photos',
  'professional-photos',
  true,
  524288,                                  -- 512 KB
  ARRAY['image/png','image/jpeg','image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── 3. RLS policies en storage.objects ──────────────────────────────────────
-- Path convention: professional-photos/<org_id>/<member_id>.<ext>
--   org_id    = substring(name FROM '^([0-9a-f-]{36})/')  ← ancla UUID estricta
--               (patrón M22: más fuerte que string_to_array, evita edge cases
--                de cast con paths malformados). Tenant scoping.
--   member_id = split_part((string_to_array(name,'/'))[2],'.',1)  (segmento 2 sin ext)
-- Write: el PROPIO profesional (su member en esa org) O un OWNER/DIRECTOR de la
--        org. Más permisivo que org-logos (solo OWNER/DIRECTOR) porque cada pro
--        gestiona su propia foto; la dirección puede gestionar la del equipo.

-- NOTA (M45): NO se crea una policy "public read". El bucket es public=true →
-- los objetos se sirven por /storage/v1/object/public/... SIN consultar policy
-- SELECT. Una policy SELECT amplia solo habilitaría ENUMERAR todas las fotos
-- vía la Storage API a anónimos — el antipatrón que M45 borró de org-logos.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'professional-photos self-or-director write'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "professional-photos self-or-director write"
        ON storage.objects FOR ALL
        USING (
          bucket_id = 'professional-photos'
          AND auth.uid() IS NOT NULL
          AND substring(name FROM '^([0-9a-f-]{36})/') IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.member m
            WHERE m.profile_id = auth.uid()
              AND m.organization_id::text = substring(name FROM '^([0-9a-f-]{36})/')
              AND m.deleted_at IS NULL
              AND (
                m.role IN ('OWNER', 'DIRECTOR')
                OR m.id::text = split_part((string_to_array(name, '/'))[2], '.', 1)
              )
          )
        )
        WITH CHECK (
          bucket_id = 'professional-photos'
          AND auth.uid() IS NOT NULL
          AND substring(name FROM '^([0-9a-f-]{36})/') IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.member m
            WHERE m.profile_id = auth.uid()
              AND m.organization_id::text = substring(name FROM '^([0-9a-f-]{36})/')
              AND m.deleted_at IS NULL
              AND (
                m.role IN ('OWNER', 'DIRECTOR')
                OR m.id::text = split_part((string_to_array(name, '/'))[2], '.', 1)
              )
          )
        )
    $POL$;
  END IF;
END$$;
