-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M94 · las policies de Storage clínico validan TAMBIÉN el paciente 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- Hallazgo (audit 2026-08-09 · CRITICAL). M27 instaló las policies de los
-- buckets `documentos-clinicos` y `consentimientos-firmados` sobre la convención
-- de path `{org_uuid}/{paciente_uuid}/{archivo}` (el bucket-prefix NO va en
-- storage.objects.name) — pero SÓLO validan el segmento [1] (= la organización)
-- más el rol clínico del member. El segmento [2] (= el PACIENTE) nunca se mira.
--
-- Consecuencia: un PROFESIONAL de la org puede
--   storage.from('documentos-clinicos').list('<org>')
-- y bajarse estudios, DICOM y consentimientos firmados de pacientes que en la DB
-- NO PUEDE VER: los que no son suyos (M32: profesional_principal_id o turno
-- atendido) y, peor, los que están en la CAJA FUERTE de otro profesional (M03/
-- M31/M32). La ficha del paciente le dice "no existe" y el bucket se lo entrega.
-- PHI directa · Ley 26.529.
--
-- Hermano del mismo bug, en M85: la policy de ESCRITURA del portal
-- ("consentimientos-firmados portal write") valida el segmento paciente
-- (paciente_owns) pero NO el de org ⇒ un paciente de portal puede depositar PDFs
-- bajo el prefijo de OTRO tenant (contaminación cross-org del bucket).
--
-- ─── Qué hace esta migración ────────────────────────────────────────────────
-- Recrea (DROP + CREATE, idempotente) las 5 policies de M27 CONSERVANDO su
-- lógica completa (bucket, auth.uid(), segmento org, roles, quién borra) y les
-- agrega un predicado nuevo:
--
--     EXISTS (SELECT 1 FROM public.paciente p
--              WHERE p.id = <segmento [2] del path como uuid>
--                AND p.organization_id::text = <segmento [1] del path>)
--
-- Ese EXISTS se evalúa bajo la RLS de `paciente` (NO es SECURITY DEFINER), así
-- que hereda GRATIS toda la política de acceso a la ficha: asignación del
-- profesional, branch "atendió un turno" (M32) y caja fuerte (M03/M31/M32). La
-- regla queda una sola y en un solo lugar: **si no podés ver la ficha, no podés
-- ver sus archivos**. También corrige el hermano de M85 (org del path en el
-- write del portal).
--
-- ─── Decisión: path mal formado ⇒ DENIEGA, nunca ERROR ──────────────────────
-- `(string_to_array(name,'/'))[2]::uuid` LANZA (invalid_text_representation,
-- SQLSTATE 22P02) si el segmento no es un uuid — y un error dentro de un USING
-- no deniega una fila: aborta la QUERY ENTERA. Un solo objeto legacy con path
-- raro (o un `list()` sobre una carpeta vieja) rompería la lectura de TODO el
-- bucket para todos. Por eso el cast va encapsulado en
-- `public.storage_path_uuid(name, idx)`, IMMUTABLE, que devuelve NULL cuando el
-- segmento falta o no parsea. Con NULL, `p.id = NULL` es NULL ⇒ el EXISTS es
-- falso ⇒ **la fila se deniega en silencio** (fail-closed), que es exactamente lo
-- que queremos para un objeto que no respeta la convención de path.
-- De paso, el mismo helper reemplaza el guard frágil de M85
-- (`~ '^[0-9a-f-]{36}$'` seguido del cast: '------------------------------------'
-- pasa el regex y explota en el cast) sin cambiar quién queda habilitado — la
-- pertenencia la sigue decidiendo paciente_owns().
--
-- ─── Consecuencia operativa (deliberada) ────────────────────────────────────
-- Un OWNER/DIRECTOR ya NO puede bajar los archivos de un paciente en caja fuerte
-- ajena: tampoco puede leer esa ficha en la DB (M32 aplica la caja fuerte a todos
-- los roles). El bucket deja de ser la puerta de atrás. Lo que un rol clínico
-- podía ver de pacientes que sí puede leer no cambia.
--
-- Segunda consecuencia, más angosta: el DELETE de documentos-clinicos conserva
-- la cláusula de M27 (`role IN ('OWNER','DIRECTOR')`, SIN es_colegiado), pero el
-- EXISTS nuevo se evalúa bajo paciente_select_clinical, que sí exige
-- can_read_clinical → un DIRECTOR **no colegiado** pasa de poder borrar
-- cualquier archivo de la org a no poder borrar ninguno. Es coherente con el
-- resto del esquema (no puede leer ninguna ficha, así que tampoco debería poder
-- borrar sus archivos), pero es un cambio real de permisos. Pre-check en
-- producción antes de aplicar: 42 members activos, todos OWNER colegiados, cero
-- DIRECTOR — no afecta a nadie hoy.
--
-- ─── Portabilidad / replay ──────────────────────────────────────────────────
-- Idempotente (CREATE OR REPLACE FUNCTION + DROP POLICY IF EXISTS). Las policies
-- de storage.objects van en DO blocks con EXCEPTION insufficient_privilege
-- (patrón M27/M85): el runner de la Supabase preview branch / `supabase db reset`
-- NO es dueño de storage.objects (lo es supabase_storage_admin) y ahí se saltean
-- sin abortar la migración; en prod (superuser) y en el CI de pgtap (postgres es
-- dueño del stub) aplican. El DROP y el CREATE viven en el MISMO bloque: si el
-- CREATE falla, el subtransaction rollback repone la policy vieja (nunca queda el
-- bucket sin policy).
--
-- Orden de replay: depende de M03/M31/M32 (paciente + caja fuerte), M27 (buckets
-- y policies) y M85 (portal). Prefijo …096, número canónico M94.
-- ════════════════════════════════════════════════════════════════════════════

set check_function_bodies = off;

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · public.storage_path_uuid(text, int) — cast que NO explota
-- ════════════════════════════════════════════════════════════════════════════
-- Devuelve el segmento `p_idx` (1-based) del path de storage.objects.name como
-- uuid, o NULL si el path es corto, el segmento está vacío o no parsea como uuid.
-- IMMUTABLE + PARALLEL SAFE: es cómputo puro sobre el argumento (string_to_array
-- y el cast a uuid lo son); no toca ninguna tabla, así que es apto para usarse en
-- USING/WITH CHECK sin volatilidad ni fugas.
CREATE OR REPLACE FUNCTION public.storage_path_uuid(p_name text, p_idx int)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $fn$
DECLARE
  v_seg text;
BEGIN
  IF p_name IS NULL OR p_idx IS NULL THEN
    RETURN NULL;
  END IF;
  v_seg := (string_to_array(p_name, '/'))[p_idx];
  IF v_seg IS NULL OR v_seg = '' THEN
    RETURN NULL;
  END IF;
  RETURN v_seg::uuid;
EXCEPTION
  -- Objeto legacy / path fuera de convención: NULL ⇒ el predicado que lo usa da
  -- falso ⇒ se deniega la fila. NUNCA se propaga el error (abortaría la query).
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.storage_path_uuid(text, int) IS
  'Folio M94 · segmento p_idx (1-based) de un storage.objects.name como uuid; NULL si falta o no parsea (fail-closed en las policies de Storage, en vez de abortar la query con 22P02).';

-- Lo evalúan las policies de storage.objects bajo el rol del request
-- (authenticated / anon) y el service_role. Es cómputo puro: sin datos que fugar.
GRANT EXECUTE ON FUNCTION public.storage_path_uuid(text, int) TO anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · storage.objects · documentos-clinicos (SELECT / INSERT / DELETE)
-- ════════════════════════════════════════════════════════════════════════════
-- Se conserva TODO lo de M27 (bucket, auth.uid(), segmento org no nulo, el
-- EXISTS sobre member con los mismos roles por comando) y se suma el EXISTS
-- sobre `paciente` del segmento [2].
DO $$
BEGIN
  -- SELECT: rol clínico de la org del path (M27) + la ficha del paciente del
  -- path visible para ese usuario (M94).
  DROP POLICY IF EXISTS "documentos-clinicos clinical read" ON storage.objects;
  EXECUTE $POL$
    CREATE POLICY "documentos-clinicos clinical read"
      ON storage.objects FOR SELECT
      USING (
        bucket_id = 'documentos-clinicos'
        AND auth.uid() IS NOT NULL
        AND (string_to_array(objects.name, '/'))[1] IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.member m
          WHERE m.profile_id = auth.uid()
            AND m.organization_id::text = (string_to_array(objects.name, '/'))[1]
            AND m.deleted_at IS NULL
            AND (
              m.role IN ('OWNER', 'PROFESIONAL')
              OR (m.role = 'DIRECTOR' AND m.es_colegiado = true)
            )
        )
        AND EXISTS (
          SELECT 1 FROM public.paciente p
          WHERE p.id = public.storage_path_uuid(objects.name, 2)
            AND p.organization_id::text = (string_to_array(objects.name, '/'))[1]
        )
      )
  $POL$;

  -- INSERT: mismas reglas (no se sube a la carpeta de un paciente que no podés ver).
  DROP POLICY IF EXISTS "documentos-clinicos clinical write" ON storage.objects;
  EXECUTE $POL$
    CREATE POLICY "documentos-clinicos clinical write"
      ON storage.objects FOR INSERT
      WITH CHECK (
        bucket_id = 'documentos-clinicos'
        AND auth.uid() IS NOT NULL
        AND (string_to_array(objects.name, '/'))[1] IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.member m
          WHERE m.profile_id = auth.uid()
            AND m.organization_id::text = (string_to_array(objects.name, '/'))[1]
            AND m.deleted_at IS NULL
            AND (
              m.role IN ('OWNER', 'PROFESIONAL')
              OR (m.role = 'DIRECTOR' AND m.es_colegiado = true)
            )
        )
        AND EXISTS (
          SELECT 1 FROM public.paciente p
          WHERE p.id = public.storage_path_uuid(objects.name, 2)
            AND p.organization_id::text = (string_to_array(objects.name, '/'))[1]
        )
      )
  $POL$;

  -- DELETE: sigue siendo sólo OWNER/DIRECTOR (M27) y ahora, además, sobre un
  -- paciente que ese usuario puede leer.
  DROP POLICY IF EXISTS "documentos-clinicos admin delete" ON storage.objects;
  EXECUTE $POL$
    CREATE POLICY "documentos-clinicos admin delete"
      ON storage.objects FOR DELETE
      USING (
        bucket_id = 'documentos-clinicos'
        AND auth.uid() IS NOT NULL
        AND (string_to_array(objects.name, '/'))[1] IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.member m
          WHERE m.profile_id = auth.uid()
            AND m.organization_id::text = (string_to_array(objects.name, '/'))[1]
            AND m.role IN ('OWNER', 'DIRECTOR')
            AND m.deleted_at IS NULL
        )
        AND EXISTS (
          SELECT 1 FROM public.paciente p
          WHERE p.id = public.storage_path_uuid(objects.name, 2)
            AND p.organization_id::text = (string_to_array(objects.name, '/'))[1]
        )
      )
  $POL$;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'M94: skip policies de documentos-clinicos (el runner no es dueño de storage.objects — esperado en preview branch / db reset)';
END$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · storage.objects · consentimientos-firmados (SELECT / INSERT clínicos)
-- ════════════════════════════════════════════════════════════════════════════
-- Sin DELETE, igual que M27: el ejemplar firmado es inmutable (Ley 26.529 art. 9).
DO $$
BEGIN
  DROP POLICY IF EXISTS "consentimientos-firmados clinical read" ON storage.objects;
  EXECUTE $POL$
    CREATE POLICY "consentimientos-firmados clinical read"
      ON storage.objects FOR SELECT
      USING (
        bucket_id = 'consentimientos-firmados'
        AND auth.uid() IS NOT NULL
        AND (string_to_array(objects.name, '/'))[1] IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.member m
          WHERE m.profile_id = auth.uid()
            AND m.organization_id::text = (string_to_array(objects.name, '/'))[1]
            AND m.deleted_at IS NULL
            AND (
              m.role IN ('OWNER', 'PROFESIONAL')
              OR (m.role = 'DIRECTOR' AND m.es_colegiado = true)
            )
        )
        AND EXISTS (
          SELECT 1 FROM public.paciente p
          WHERE p.id = public.storage_path_uuid(objects.name, 2)
            AND p.organization_id::text = (string_to_array(objects.name, '/'))[1]
        )
      )
  $POL$;

  DROP POLICY IF EXISTS "consentimientos-firmados clinical write" ON storage.objects;
  EXECUTE $POL$
    CREATE POLICY "consentimientos-firmados clinical write"
      ON storage.objects FOR INSERT
      WITH CHECK (
        bucket_id = 'consentimientos-firmados'
        AND auth.uid() IS NOT NULL
        AND (string_to_array(objects.name, '/'))[1] IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.member m
          WHERE m.profile_id = auth.uid()
            AND m.organization_id::text = (string_to_array(objects.name, '/'))[1]
            AND m.deleted_at IS NULL
            AND (
              m.role IN ('OWNER', 'PROFESIONAL')
              OR (m.role = 'DIRECTOR' AND m.es_colegiado = true)
            )
        )
        AND EXISTS (
          SELECT 1 FROM public.paciente p
          WHERE p.id = public.storage_path_uuid(objects.name, 2)
            AND p.organization_id::text = (string_to_array(objects.name, '/'))[1]
        )
      )
  $POL$;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'M94: skip policies de consentimientos-firmados (el runner no es dueño de storage.objects)';
END$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · storage.objects · portal del paciente (fix hermano de M85)
-- ════════════════════════════════════════════════════════════════════════════
-- WRITE: M85 valida el segmento paciente (paciente_owns) pero NO el de org ⇒ el
-- paciente podía subir bajo `{org_ajena}/{su_paciente}/…`. Se agrega el EXISTS
-- que ata el segmento [1] a la org REAL de esa ficha (evaluado bajo
-- paciente_select_portal de M71 ⇒ el paciente sólo matchea sus propias fichas).
--
-- READ: NO se le agrega el predicado de org — se le cambia únicamente el guard
-- frágil (regex + cast) por el helper fail-closed. Razón: la lectura ya es
-- self-scoped por paciente_owns() y una fila `paciente` pertenece a UNA sola org,
-- así que un objeto `{org_ajena}/{mi_paciente}/…` sólo podía existir por el bug
-- de escritura que este mismo archivo cierra; angostar el read encima escondería
-- una firma legacy a su propio dueño sin cerrar nada nuevo.
DO $$
BEGIN
  DROP POLICY IF EXISTS "consentimientos-firmados portal write" ON storage.objects;
  EXECUTE $POL$
    CREATE POLICY "consentimientos-firmados portal write"
      ON storage.objects FOR INSERT
      WITH CHECK (
        bucket_id = 'consentimientos-firmados'
        AND auth.uid() IS NOT NULL
        AND public.storage_path_uuid(objects.name, 2) IS NOT NULL
        AND public.paciente_owns(public.storage_path_uuid(objects.name, 2))
        AND EXISTS (
          SELECT 1 FROM public.paciente p
          WHERE p.id = public.storage_path_uuid(objects.name, 2)
            AND p.organization_id::text = (string_to_array(objects.name, '/'))[1]
        )
      )
  $POL$;

  DROP POLICY IF EXISTS "consentimientos-firmados portal read" ON storage.objects;
  EXECUTE $POL$
    CREATE POLICY "consentimientos-firmados portal read"
      ON storage.objects FOR SELECT
      USING (
        bucket_id = 'consentimientos-firmados'
        AND auth.uid() IS NOT NULL
        AND public.storage_path_uuid(objects.name, 2) IS NOT NULL
        AND public.paciente_owns(public.storage_path_uuid(objects.name, 2))
      )
  $POL$;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'M94: skip policies del portal (el runner no es dueño de storage.objects)';
END$$;

-- ════════════════════════════════════════════════════════════════════════════
-- COMMENTS (best-effort · requiere ser dueño de storage.objects — patrón M27)
-- ════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  EXECUTE $C$COMMENT ON POLICY "documentos-clinicos clinical read" ON storage.objects IS 'M94 · rol clínico de la org del path (M27) Y ficha del paciente del path visible bajo la RLS de paciente (hereda asignación M32 + caja fuerte M03/M31). Path: {org_uuid}/{paciente_uuid}/{file.ext}; path fuera de convención ⇒ deniega.'$C$;
  EXECUTE $C$COMMENT ON POLICY "consentimientos-firmados clinical read" ON storage.objects IS 'M94 · idem documentos-clinicos: rol clínico de la org (M27) + paciente del path visible. Sin DELETE (inmutable, Ley 26.529 art. 9).'$C$;
  EXECUTE $C$COMMENT ON POLICY "consentimientos-firmados portal write" ON storage.objects IS 'M94 · el PACIENTE de portal sube el PNG de SU firma: paciente_owns del segmento paciente (M85) Y el segmento org del path debe ser la org REAL de esa ficha (fix cross-tenant).'$C$;
EXCEPTION
  WHEN insufficient_privilege OR undefined_object THEN
    RAISE NOTICE 'M94: skip COMMENT ON POLICY storage.objects (runner no es owner — esperado en preview branch / db reset)';
END$$;
