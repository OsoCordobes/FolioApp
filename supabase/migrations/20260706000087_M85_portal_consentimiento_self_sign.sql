-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M85 · Portal · firma de consentimiento por el paciente (Fase 3 · P6) 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- M71 (P2) dejó al paciente SÓLO LEER sus consentimientos (consentimiento_select_
-- portal). P6 le suma UNA acción acotada: FIRMAR un consentimiento sobre una ficha
-- `paciente` SUYA (canvas → PNG → Storage + fila `consentimiento`). Ambas escrituras
-- (la fila y el binario en Storage) son self-scoped por `paciente_owns()` (anti-IDOR)
-- y heredan las invariantes ya vigentes:
--   · La INMUTABILIDAD post-firma la garantiza el trigger consentimiento_immutable_
--     guard (M07): una vez firmado NO se puede mutar (salvo revocar). El paciente
--     tampoco recibe policy de UPDATE/DELETE acá ⇒ sólo puede INSERTAR (append-only).
--   · La coherencia firmante-tutor la garantiza consentimiento_tutor_guard (M07):
--     firmado_por_tutor_id debe ser tutor del mismo paciente/org.
--   · El formato del path lo garantiza el CHECK consentimiento_path_format (M07).
--   · La evidencia legal (ip / user_agent) la escribe el data layer (P6), igual que
--     el path del profesional (M07/F8).
--
-- Principio (plan Fase 3 · seguridad): toda decisión scopea desde la sesión del
-- paciente (paciente_owns → paciente_cuenta_actual() → auth.uid()), NUNCA desde
-- input del cliente. El paciente NO recibe acceso a `sesion` (M71 lo deja
-- estructuralmente fuera); esto sólo agrega INSERT sobre `consentimiento` (que él ya
-- podía leer) y sobre el objeto de Storage de su propia firma.
--
-- Dos policies nuevas, ambas INSERT-only y self-scoped:
--   1. consentimiento_insert_portal   — sobre public.consentimiento
--   2. "consentimientos-firmados portal write" — sobre storage.objects
--
-- El paciente NO es member ⇒ la policy de escritura de M27 ("consentimientos-
-- firmados clinical write", que exige member clínico) NUNCA lo habilita: por eso hace
-- falta una policy de Storage propia, scopeada por paciente_owns() del segmento
-- `paciente` del path ({org}/{paciente}/{file} — el bucket-prefix NO está en
-- storage.objects.name; mismo extractor que M27: (string_to_array(name,'/'))[2]).
--
-- ─── check_function_bodies = off (house style) ────────────────────────────────
-- Convención de la casa (M01/M60/M70/M71/M84). No definimos funciones nuevas acá
-- (reusamos public.paciente_owns de M71), pero dejamos el flag por consistencia y
-- para blindar el replay bajo la preview branch de Supabase.
--
-- ─── Orden de replay (append-only) ────────────────────────────────────────────
-- Depende de M71 (paciente_owns, consentimiento_select_portal) y de M27 (bucket +
-- policies de storage) → prefijo …087 (después de M84 …086). Número canónico M85
-- (siguiente libre ≥ M84 pedido por el plan; M84 lo tomó P4).
--
-- Portabilidad: replay-safe en postgres:16 vanilla y bajo pgTAP. Idempotente
-- (DROP POLICY IF EXISTS antes de cada CREATE; la de storage.objects va con guard de
-- catálogo + best-effort, patrón M27 — el runner de la preview branch / db reset no
-- es dueño de storage.objects y podría no poder crear/commentar policies ahí).
-- ════════════════════════════════════════════════════════════════════════════

set check_function_bodies = off;

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · consentimiento · self-INSERT del paciente (firma desde el portal)
-- ════════════════════════════════════════════════════════════════════════════
-- ADITIVA sobre las policies clínicas de M07 (PERMISSIVE ⇒ OR). El paciente sólo
-- puede insertar un consentimiento:
--   · atado a una fila `paciente` SUYA (paciente_owns(paciente_id)) — anti-IDOR: no
--     puede firmar "a nombre de" otro paciente ni en otra org,
--   · en la MISMA org de esa ficha (organization_id = org del paciente) — coherencia
--     a nivel fila (evita cruzar el path de Storage con un org ajeno),
--   · NO revocado (revocado_en / revocado_motivo NULL al insertar — la firma nace
--     vigente; la revocación es un UPDATE, que el paciente NO puede hacer acá).
-- El resto de las invariantes (inmutabilidad, tutor coherente, formato de path) las
-- fijan los triggers y CHECKs de M07 — no se relajan.
--
-- Sin policy de UPDATE/DELETE para el paciente sobre `consentimiento`: es append-only
-- para él. Revocar (Ley 26.529 art. 11) queda del lado clínico (consentimiento_
-- update_clinical, M07) o se sumará en un PR posterior con su propio path acotado.
DROP POLICY IF EXISTS consentimiento_insert_portal ON public.consentimiento;
CREATE POLICY consentimiento_insert_portal
  ON public.consentimiento FOR INSERT
  WITH CHECK (
    revocado_en IS NULL
    AND revocado_motivo IS NULL
    AND public.paciente_owns(paciente_id)
    AND EXISTS (
      SELECT 1 FROM public.paciente p
      WHERE p.id = consentimiento.paciente_id
        AND p.organization_id = consentimiento.organization_id
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · storage.objects · self-write del paciente en `consentimientos-firmados`
-- ════════════════════════════════════════════════════════════════════════════
-- El paciente NO es member ⇒ la policy "consentimientos-firmados clinical write"
-- (M27) NO lo habilita. Necesita una policy propia, scopeada por paciente_owns() del
-- segmento `paciente` del path. Convención de path (mirror M07/M27, sin el
-- bucket-prefix en storage.objects.name): {org_uuid}/{paciente_uuid}/{file}.
--   → org      = (string_to_array(name, '/'))[1]
--   → paciente = (string_to_array(name, '/'))[2]
-- paciente_owns() (M71, SECURITY DEFINER) valida que ese `paciente` cuelga de la
-- cuenta del usuario logueado (auth.uid()); si el segmento no es un uuid o no es
-- suyo, el cast/EXISTS falla y el INSERT se rechaza (anti-IDOR: no puede escribir
-- bajo el path de otro paciente/org). SIN DELETE (inmutabilidad, Ley 26.529 art. 9;
-- consistente con M27, que tampoco da DELETE en este bucket a usuarios).
--
-- Idempotente + best-effort (patrón M27): el runner de la preview branch / db reset
-- NO es dueño de storage.objects (lo es supabase_storage_admin) y podría abortar el
-- CREATE POLICY con insufficient_privilege — se saltea sin romper la migración. En
-- prod (superuser) y en Supabase real, aplica.
--
-- SELECT (leer/firmar-URL de la propia firma) + INSERT (subir el PNG), ambas
-- scopeadas por paciente_owns() del segmento `paciente` del path. El SELECT deja que
-- el paciente genere un signed URL de SU firma con el cliente anon (RLS-enforced) sin
-- pasar por service_role. Sin UPDATE/DELETE (inmutable, Ley 26.529 art. 9).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'consentimientos-firmados portal read'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "consentimientos-firmados portal read"
        ON storage.objects FOR SELECT
        USING (
          bucket_id = 'consentimientos-firmados'
          AND auth.uid() IS NOT NULL
          AND (string_to_array(name, '/'))[2] IS NOT NULL
          AND (string_to_array(name, '/'))[2] ~ '^[0-9a-f-]{36}$'
          AND public.paciente_owns((string_to_array(name, '/'))[2]::uuid)
        )
    $POL$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'consentimientos-firmados portal write'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "consentimientos-firmados portal write"
        ON storage.objects FOR INSERT
        WITH CHECK (
          bucket_id = 'consentimientos-firmados'
          AND auth.uid() IS NOT NULL
          AND (string_to_array(name, '/'))[2] IS NOT NULL
          AND (string_to_array(name, '/'))[2] ~ '^[0-9a-f-]{36}$'
          AND public.paciente_owns((string_to_array(name, '/'))[2]::uuid)
        )
    $POL$;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'M85: skip CREATE POLICY storage.objects (runner no es owner — esperado en preview branch / db reset)';
END$$;

-- COMMENT best-effort (requiere OWNER de storage.objects; cosmético, patrón M27).
DO $$
BEGIN
  EXECUTE $C$COMMENT ON POLICY "consentimientos-firmados portal write" ON storage.objects IS 'M85 · el PACIENTE de portal (paciente_owns del segmento paciente del path) puede subir el PNG de la firma de su propio consentimiento. Path: {org_uuid}/{paciente_uuid}/{file.png}. Sin DELETE (inmutable, Ley 26.529 art. 9).'$C$;
  EXECUTE $C$COMMENT ON POLICY "consentimientos-firmados portal read" ON storage.objects IS 'M85 · el PACIENTE de portal puede leer/firmar-URL el PNG de SU propia firma (paciente_owns del segmento paciente del path). Habilita el signed URL desde el cliente anon sin service_role.'$C$;
EXCEPTION
  WHEN insufficient_privilege OR undefined_object THEN
    RAISE NOTICE 'M85: skip COMMENT ON POLICY storage.objects (runner no es owner — esperado en preview branch / db reset)';
END$$;
