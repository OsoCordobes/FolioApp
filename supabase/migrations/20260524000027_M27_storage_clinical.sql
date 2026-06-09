-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M27 · Storage buckets para archivos clínicos
-- ════════════════════════════════════════════════════════════════════════════
-- M07 (consentimientos) y M08 (documentos_clinicos) referencian los buckets
-- `consentimientos-firmados` y `documentos-clinicos` en sus CHECK constraints
-- de path, PERO ninguna migración los creó. M21 solo creó `org-logos`.
--
-- Riesgo cerrado:
--   - Si los buckets fueron creados manualmente en Supabase Dashboard sin RLS,
--     cualquiera con la URL podría bajarse PDFs de consentimientos y estudios
--     clínicos (PHI directa). Fuga de Ley 26.529.
--   - Si no fueron creados, todo upload falla con "Bucket not found" a runtime
--     — feature gap silencioso.
--
-- Esta migración:
--   1. Crea ambos buckets como PRIVADOS (public=false) con upsert idempotente.
--   2. Instala storage.objects policies que replican el modelo de M07/M08:
--        - documentos-clinicos: solo can_read_clinical(org) del path
--        - consentimientos-firmados: solo can_read_clinical(org) para SELECT
--          y para INSERT (sin DELETE — los consentimientos firmados son
--          inmutables por Ley 26.529 art. 9).
--   3. Sigue el patrón idempotente de M21 (DO block con IF NOT EXISTS) para
--     soportar re-aplicación sin error.
--
-- Convención de path (mirrors M07 / M08 CHECK constraints):
--   documentos-clinicos/{org_uuid}/{paciente_uuid}/{file}.{ext}
--   consentimientos-firmados/{org_uuid}/{paciente_uuid}/{file}.pdf
--
-- En storage.objects.name el bucket prefix NO está incluido — solo
-- `{org_uuid}/{paciente_uuid}/{file}`. Por eso el path-extractor usa
-- (string_to_array(name, '/'))[1] (mismo patrón que M21 line 95).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Buckets (idempotent UPSERT) ──────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'documentos-clinicos',
    'documentos-clinicos',
    false,                                            -- privado obligatorio
    52428800,                                         -- 50 MB (alineado con M08 CHECK documento_tamanio_limite)
    ARRAY[
      'application/pdf',
      'image/jpeg', 'image/png', 'image/webp', 'image/heic',
      'image/tiff',                                   -- común para DICOM exportado
      'application/dicom'                             -- DICOM nativo
    ]
  ),
  (
    'consentimientos-firmados',
    'consentimientos-firmados',
    false,                                            -- privado obligatorio
    10485760,                                         -- 10 MB
    ARRAY['application/pdf']
  )
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── 2. RLS policies storage.objects · documentos-clinicos ───────────────

DO $$
BEGIN
  -- SELECT: solo clínicos (OWNER/PROFESIONAL/DIRECTOR colegiado) de la org dueña del path.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'documentos-clinicos clinical read'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "documentos-clinicos clinical read"
        ON storage.objects FOR SELECT
        USING (
          bucket_id = 'documentos-clinicos'
          AND auth.uid() IS NOT NULL
          AND (string_to_array(name, '/'))[1] IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.member m
            WHERE m.profile_id = auth.uid()
              AND m.organization_id::text = (string_to_array(name, '/'))[1]
              AND m.deleted_at IS NULL
              AND (
                m.role IN ('OWNER', 'PROFESIONAL')
                OR (m.role = 'DIRECTOR' AND m.es_colegiado = true)
              )
          )
        )
    $POL$;
  END IF;

  -- INSERT: mismas reglas (solo clínicos pueden subir adjuntos).
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'documentos-clinicos clinical write'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "documentos-clinicos clinical write"
        ON storage.objects FOR INSERT
        WITH CHECK (
          bucket_id = 'documentos-clinicos'
          AND auth.uid() IS NOT NULL
          AND (string_to_array(name, '/'))[1] IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.member m
            WHERE m.profile_id = auth.uid()
              AND m.organization_id::text = (string_to_array(name, '/'))[1]
              AND m.deleted_at IS NULL
              AND (
                m.role IN ('OWNER', 'PROFESIONAL')
                OR (m.role = 'DIRECTOR' AND m.es_colegiado = true)
              )
          )
        )
    $POL$;
  END IF;

  -- DELETE: solo OWNER/DIRECTOR (alineado con la regla operacional de que
  -- el borrado físico requiere autorización administrativa).
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'documentos-clinicos admin delete'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "documentos-clinicos admin delete"
        ON storage.objects FOR DELETE
        USING (
          bucket_id = 'documentos-clinicos'
          AND auth.uid() IS NOT NULL
          AND (string_to_array(name, '/'))[1] IS NOT NULL
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

-- ─── 3. RLS policies storage.objects · consentimientos-firmados ──────────

DO $$
BEGIN
  -- SELECT: solo clínicos de la org. Idéntico a M07 consentimiento RLS
  -- (ASISTENTE/COORDINADOR no leen consentimientos).
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'consentimientos-firmados clinical read'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "consentimientos-firmados clinical read"
        ON storage.objects FOR SELECT
        USING (
          bucket_id = 'consentimientos-firmados'
          AND auth.uid() IS NOT NULL
          AND (string_to_array(name, '/'))[1] IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.member m
            WHERE m.profile_id = auth.uid()
              AND m.organization_id::text = (string_to_array(name, '/'))[1]
              AND m.deleted_at IS NULL
              AND (
                m.role IN ('OWNER', 'PROFESIONAL')
                OR (m.role = 'DIRECTOR' AND m.es_colegiado = true)
              )
          )
        )
    $POL$;
  END IF;

  -- INSERT: mismas reglas. (Booking público con upload de PDF firmado por
  -- el paciente lo hace el server con service_role — bypass RLS — no este
  -- path. Este policy cubre uploads desde la app autenticada.)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'consentimientos-firmados clinical write'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "consentimientos-firmados clinical write"
        ON storage.objects FOR INSERT
        WITH CHECK (
          bucket_id = 'consentimientos-firmados'
          AND auth.uid() IS NOT NULL
          AND (string_to_array(name, '/'))[1] IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.member m
            WHERE m.profile_id = auth.uid()
              AND m.organization_id::text = (string_to_array(name, '/'))[1]
              AND m.deleted_at IS NULL
              AND (
                m.role IN ('OWNER', 'PROFESIONAL')
                OR (m.role = 'DIRECTOR' AND m.es_colegiado = true)
              )
          )
        )
    $POL$;
  END IF;

  -- NO DELETE policy: consentimientos firmados son inmutables (Ley 26.529
  -- art. 9 — el ejemplar firmado debe conservarse). Para pseudonimización
  -- post-grace-period la limpieza la hace el cron M25 con service_role
  -- (bypass RLS) — no este path.
END$$;

-- ════════════════════════════════════════════════════════════════════════════
-- COMMENTS
-- ════════════════════════════════════════════════════════════════════════════

-- COMMENT ON POLICY requiere ser OWNER de storage.objects (regla de Postgres,
-- no un privilegio granteable). En prod/superuser aplica; en la Supabase
-- preview branch y `supabase db reset` el runner no es dueño de
-- storage.objects (lo es supabase_storage_admin) y abortaría con SQLSTATE
-- 42501. Los comentarios son metadata cosmética: se aplican best-effort y se
-- saltean sin abortar la migration si falta privilegio o la policy no existe.
DO $$
BEGIN
  EXECUTE $C$COMMENT ON POLICY "documentos-clinicos clinical read" ON storage.objects IS 'M27 · clinical-role members de la org dueña del path pueden leer documentos. Path: {org_uuid}/{paciente_uuid}/{file.ext}'$C$;
  EXECUTE $C$COMMENT ON POLICY "consentimientos-firmados clinical read" ON storage.objects IS 'M27 · clinical-role members de la org dueña del path pueden leer PDFs de consentimientos. Path: {org_uuid}/{paciente_uuid}/{file.pdf}'$C$;
EXCEPTION
  WHEN insufficient_privilege OR undefined_object THEN
    RAISE NOTICE 'M27: skip COMMENT ON POLICY storage.objects (runner no es owner — esperado en preview branch / db reset)';
END$$;
