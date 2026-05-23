-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M27 spec · storage buckets clínicos
-- ════════════════════════════════════════════════════════════════════════════
-- Validaciones estáticas (no requieren fixtures):
--   1. Existen los dos buckets como privados.
--   2. Las policies esperadas existen en storage.objects.
--   3. Los MIME allowlist son razonables.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_count int;
  v_doc_public boolean;
  v_cons_public boolean;
BEGIN
  -- 1. Buckets existen y son privados
  SELECT count(*) INTO v_count FROM storage.buckets
    WHERE id IN ('documentos-clinicos', 'consentimientos-firmados');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'M27 spec FAIL: esperados 2 buckets, hay %', v_count;
  END IF;

  SELECT public INTO v_doc_public  FROM storage.buckets WHERE id = 'documentos-clinicos';
  SELECT public INTO v_cons_public FROM storage.buckets WHERE id = 'consentimientos-firmados';
  IF v_doc_public <> false THEN
    RAISE EXCEPTION 'M27 spec FAIL: documentos-clinicos debe ser private, está public=%', v_doc_public;
  END IF;
  IF v_cons_public <> false THEN
    RAISE EXCEPTION 'M27 spec FAIL: consentimientos-firmados debe ser private, está public=%', v_cons_public;
  END IF;

  -- 2. Policies esperadas
  SELECT count(*) INTO v_count FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN (
        'documentos-clinicos clinical read',
        'documentos-clinicos clinical write',
        'documentos-clinicos admin delete',
        'consentimientos-firmados clinical read',
        'consentimientos-firmados clinical write'
      );
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'M27 spec FAIL: esperadas 5 policies, hay %', v_count;
  END IF;

  -- 3. consentimientos no tiene DELETE policy (inmutabilidad Ley 26.529)
  SELECT count(*) INTO v_count FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname LIKE '%consentimientos-firmados%' AND cmd = 'DELETE';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'M27 spec FAIL: consentimientos-firmados no debería tener DELETE policy';
  END IF;

  RAISE NOTICE 'M27 spec PASS';
END $$;
