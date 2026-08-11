-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M94 spec · el bucket clínico deja de ser la puerta de atrás a la HC 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- Regresión de la fuga que M27 dejó abierta desde el día uno: las policies de
-- `storage.objects` de `documentos-clinicos` y `consentimientos-firmados` sólo
-- miraban el segmento [1] del path ({org}/{paciente}/{archivo}) más el rol
-- clínico del member. El segmento [2] — el PACIENTE — no lo miraba nadie.
--
-- Consecuencia real: un PROFESIONAL de la org hacía
--   storage.from('documentos-clinicos').list('<org>')
-- y se bajaba estudios, DICOM y consentimientos firmados de pacientes que en la
-- DB NO PUEDE VER: los que no son suyos (M32) y, peor, los que están en la CAJA
-- FUERTE de otro profesional (M03/M31/M32). La ficha le decía "no existe" y el
-- bucket se los entregaba. PHI directa · Ley 26.529.
--
-- M94 le suma a cada policy un EXISTS sobre `public.paciente` del segmento [2],
-- evaluado bajo la RLS de `paciente` (NO es SECURITY DEFINER) ⇒ hereda gratis
-- asignación (M32), branch "atendió un turno" y caja fuerte (M03/M31). Regla
-- única: **si no podés ver la ficha, no podés ver sus archivos**. Y de paso
-- cierra el hermano del bug en M85 (la escritura del portal no validaba el
-- segmento de org ⇒ contaminación cross-tenant del bucket).
--
--   NEGATIVAS (la frontera que M94 cierra):
--     N1. Dr. B (PROFESIONAL de la org, sin relación con el paciente) NO ve el
--         objeto de un paciente en CAJA FUERTE del Dr. A — ni en
--         documentos-clinicos ni en consentimientos-firmados.
--     N2. El OWNER tampoco ve la caja fuerte ajena (consecuencia deliberada:
--         tampoco puede leer esa ficha en la DB).
--     N3. Un objeto cuyo paciente pertenece a OTRA org que la del segmento [1]
--         no se ve — aunque el lector pueda leer esa ficha en su org real.
--     N5. El paciente de portal NO puede INSERT bajo {org_ajena}/{su_paciente}/.
--
--   FAIL-CLOSED SIN ERROR (la razón de existir de public.storage_path_uuid):
--     N4. Paths fuera de convención (sin segmento [2], segmento vacío, o
--         segmento que no parsea como uuid) DENIEGAN EN SILENCIO: el SELECT
--         devuelve 0 filas en vez de abortar la query entera con SQLSTATE
--         22P02. Un solo objeto legacy con path raro rompería el `list()` de
--         TODO el bucket para todos si el cast se hiciera crudo en el USING.
--         Incluye la trampa exacta del guard frágil de M85
--         (`~ '^[0-9a-f-]{36}$'`): 36 guiones pasan el regex y explotan al
--         castear.
--
--   POSITIVAS (lo que NO se puede romper al angostar):
--     P1. Dr. A (el profesional de la caja fuerte) SÍ ve sus dos objetos.
--     P2. Dr. B sigue viendo el objeto del paciente que SÍ es suyo (prueba que
--         las negativas de arriba no son un falso verde por falta de grants).
--     P3. El OWNER de la org B ve el objeto bajo el prefijo de org B del mismo
--         paciente que N3 le niega bajo el prefijo de org A.
--     P5. El paciente de portal SÍ puede INSERT bajo el prefijo de SU org.
--     P6. `documentos-clinicos admin delete` sigue habilitado para el OWNER
--         sobre un paciente que puede ver.
--
-- ─── Mecánica CI (pgtap.yml) ────────────────────────────────────────────────
-- Los specs corren como `postgres` sobre postgres:16 vanilla con stubs mínimos
-- de auth/storage; auth.uid() está stubeado a NULL. Patrón M84/M85/M92:
-- fixtures como superuser → override de auth.uid() → GRANTs mínimos a
-- `authenticated` → SET ROLE authenticated → RESET ROLE. Los helpers
-- (user_org_ids, can_read_clinical, user_role_in, user_member_id_in,
-- profesional_attended_paciente, paciente_owns) son SECURITY DEFINER ⇒ andan
-- bajo el rol bajado. can_read_clinical() sólo mira el rol del member (M01:107)
-- — no hay gate de suscripción — así que alcanza con crear los members.
--
-- ⚠️ OJO (sin esto el spec pasaría en verde sin probar NADA): M27 NO hace
-- `ENABLE ROW LEVEL SECURITY` sobre storage.objects — en Supabase real la RLS de
-- esa tabla la habilita la plataforma, y el stub del CI la crea sin RLS. Este
-- spec la habilita él mismo y otorga los GRANT mínimos a `authenticated`; si no,
-- las policies no se ejercitan. Al final restaura el flag como lo encontró,
-- revoca los grants y devuelve auth.uid() a NULL.
--
-- UUIDs fijos (prefijo 94…, propios ⇒ no chocan con los fixtures de otros specs;
-- todo con ON CONFLICT DO NOTHING porque los specs comparten la misma base):
--   Org A = …0a1 · Org B = …0b1
--   Dr. A  (PROFESIONAL en A) auth/profile …0a2 · member …0a3
--   Dr. B  (PROFESIONAL en A) auth/profile …0b2 · member …0b3
--   Dr. O  (OWNER en A y en B) auth/profile …0c2 · member A …0c3 · member B …0c4
--   Portal PP  auth …0d2 · paciente_cuenta …0d3
--   Pacientes: P1 …0f1 (org A · CAJA FUERTE de Dr. A) · P2 …0f2 (org A · de Dr. B)
--              P3 …0f3 (org B) · P4 …0f4 (org A · cuenta de PP)
--   Identidades …0e1/…0e2/…0e3/…0e4 · objetos …0901…0910
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Precondición: M94 aplicó de verdad ─────────────────────────────────────
-- Las policies de storage.objects de M94 van en DO blocks con EXCEPTION
-- insufficient_privilege (patrón M27): si el runner no fuera dueño de la tabla
-- se saltearían en silencio y este spec estaría midiendo las policies VIEJAS de
-- M27. Cortamos acá con un mensaje claro en vez de dar un rojo confuso abajo.
DO $$
DECLARE v int;
BEGIN
  IF to_regprocedure('public.storage_path_uuid(text, int)') IS NULL THEN
    RAISE EXCEPTION 'M94 SETUP FAIL: no existe public.storage_path_uuid(text,int) — ¿se aplicó la migración M94?';
  END IF;

  SELECT count(*) INTO v FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN (
       'documentos-clinicos clinical read',
       'documentos-clinicos clinical write',
       'documentos-clinicos admin delete',
       'consentimientos-firmados clinical read',
       'consentimientos-firmados clinical write',
       'consentimientos-firmados portal write',
       'consentimientos-firmados portal read'
     );
  IF v <> 7 THEN
    RAISE EXCEPTION 'M94 SETUP FAIL: esperaba 7 policies en storage.objects, hay %', v;
  END IF;

  -- El predicado nuevo tiene que estar EN la policy, no sólo la función suelta.
  SELECT count(*) INTO v FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'documentos-clinicos clinical read'
     AND qual LIKE '%storage_path_uuid%';
  IF v <> 1 THEN
    RAISE EXCEPTION 'M94 SETUP FAIL: "documentos-clinicos clinical read" no valida el segmento paciente (el DO block de M94 se salteó por insufficient_privilege?)';
  END IF;

  SELECT count(*) INTO v FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'consentimientos-firmados portal write'
     AND with_check LIKE '%organization_id%';
  IF v <> 1 THEN
    RAISE EXCEPTION 'M94 SETUP FAIL: "consentimientos-firmados portal write" no valida el segmento de org (fix hermano de M85 ausente)';
  END IF;
END $$;

-- ─── Fixtures (superuser → bypass RLS) ──────────────────────────────────────
DO $$
BEGIN
  -- Re-run limpio (los specs comparten base; si el spec falló a mitad, arrancar
  -- de cero es más barato que adivinar el estado).
  DELETE FROM storage.objects WHERE id::text LIKE '94940000-0000-4000-8000-00000000090%'
                                 OR id::text LIKE '94940000-0000-4000-8000-00000000091%';

  INSERT INTO auth.users (id, email) VALUES
    ('94940000-0000-4000-8000-0000000000a2', 'm94-dr-a@spec.test'),
    ('94940000-0000-4000-8000-0000000000b2', 'm94-dr-b@spec.test'),
    ('94940000-0000-4000-8000-0000000000c2', 'm94-owner@spec.test'),
    ('94940000-0000-4000-8000-0000000000d2', 'm94-portal@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization (id, slug, nombre, tipo) VALUES
    ('94940000-0000-4000-8000-0000000000a1', 'm94-org-a', 'M94 Org A', 'INDEPENDIENTE'),
    ('94940000-0000-4000-8000-0000000000b1', 'm94-org-b', 'M94 Org B', 'INDEPENDIENTE')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version) VALUES
    ('94940000-0000-4000-8000-0000000000a2', 'm94-dr-a@spec.test',  now(), 'v1'),
    ('94940000-0000-4000-8000-0000000000b2', 'm94-dr-b@spec.test',  now(), 'v1'),
    ('94940000-0000-4000-8000-0000000000c2', 'm94-owner@spec.test', now(), 'v1')
  ON CONFLICT (id) DO NOTHING;

  -- Dr. A y Dr. B son AMBOS PROFESIONAL de la MISMA org: la policy de member de
  -- M27 los habilita a los dos por igual. Lo único que los separa es la ficha.
  -- Dr. O es OWNER en A y también en B (necesario para N3: que la negativa
  -- cross-org NO se explique por "no puede leer esa ficha").
  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at) VALUES
    ('94940000-0000-4000-8000-0000000000a3', '94940000-0000-4000-8000-0000000000a1',
     '94940000-0000-4000-8000-0000000000a2', 'PROFESIONAL', true, now()),
    ('94940000-0000-4000-8000-0000000000b3', '94940000-0000-4000-8000-0000000000a1',
     '94940000-0000-4000-8000-0000000000b2', 'PROFESIONAL', true, now()),
    ('94940000-0000-4000-8000-0000000000c3', '94940000-0000-4000-8000-0000000000a1',
     '94940000-0000-4000-8000-0000000000c2', 'OWNER', true, now()),
    ('94940000-0000-4000-8000-0000000000c4', '94940000-0000-4000-8000-0000000000b1',
     '94940000-0000-4000-8000-0000000000c2', 'OWNER', true, now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente_cuenta (id, auth_user_id, email) VALUES
    ('94940000-0000-4000-8000-0000000000d3', '94940000-0000-4000-8000-0000000000d2', 'm94-portal@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente_identidad
    (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash, nombre_hash) VALUES
    ('94940000-0000-4000-8000-0000000000e1', '94940000-0000-4000-8000-0000000000a1',
     '\x01'::bytea, '\x02'::bytea, '\x03'::bytea, repeat('1', 64), repeat('a', 64)),
    ('94940000-0000-4000-8000-0000000000e2', '94940000-0000-4000-8000-0000000000a1',
     '\x04'::bytea, '\x05'::bytea, '\x06'::bytea, repeat('2', 64), repeat('b', 64)),
    ('94940000-0000-4000-8000-0000000000e3', '94940000-0000-4000-8000-0000000000b1',
     '\x07'::bytea, '\x08'::bytea, '\x09'::bytea, repeat('3', 64), repeat('c', 64)),
    ('94940000-0000-4000-8000-0000000000e4', '94940000-0000-4000-8000-0000000000a1',
     '\x0a'::bytea, '\x0b'::bytea, '\x0c'::bytea, repeat('4', 64), repeat('d', 64))
  ON CONFLICT (id) DO NOTHING;

  -- P1: org A, CAJA FUERTE del Dr. A (y él es su principal) ⇒ sólo Dr. A la lee.
  -- P2: org A, principal = Dr. B, sin caja fuerte ⇒ la leen Dr. B y el OWNER.
  -- P3: org B, sin caja fuerte ⇒ la lee el OWNER (que es OWNER también en B).
  -- P4: org A, linkeada a la cuenta de portal PP.
  INSERT INTO paciente (id, organization_id, identidad_id, profesional_principal_id,
                        caja_fuerte_profesional, cuenta_id) VALUES
    ('94940000-0000-4000-8000-0000000000f1', '94940000-0000-4000-8000-0000000000a1',
     '94940000-0000-4000-8000-0000000000e1', '94940000-0000-4000-8000-0000000000a3',
     '94940000-0000-4000-8000-0000000000a3', NULL),
    ('94940000-0000-4000-8000-0000000000f2', '94940000-0000-4000-8000-0000000000a1',
     '94940000-0000-4000-8000-0000000000e2', '94940000-0000-4000-8000-0000000000b3',
     NULL, NULL),
    ('94940000-0000-4000-8000-0000000000f3', '94940000-0000-4000-8000-0000000000b1',
     '94940000-0000-4000-8000-0000000000e3', NULL, NULL, NULL),
    ('94940000-0000-4000-8000-0000000000f4', '94940000-0000-4000-8000-0000000000a1',
     '94940000-0000-4000-8000-0000000000e4', NULL, NULL,
     '94940000-0000-4000-8000-0000000000d3')
  ON CONFLICT (id) DO NOTHING;

  -- ─── Objetos de Storage ───────────────────────────────────────────────────
  -- En storage.objects.name el prefijo del bucket NO va: {org}/{paciente}/{file}.
  -- El stub del CI sólo tiene (id, bucket_id, name, owner, metadata) — no usar
  -- otras columnas.
  INSERT INTO storage.objects (id, bucket_id, name) VALUES
    -- Caja fuerte del Dr. A (los dos buckets).
    ('94940000-0000-4000-8000-000000000901', 'documentos-clinicos',
     '94940000-0000-4000-8000-0000000000a1/94940000-0000-4000-8000-0000000000f1/estudio.pdf'),
    ('94940000-0000-4000-8000-000000000902', 'consentimientos-firmados',
     '94940000-0000-4000-8000-0000000000a1/94940000-0000-4000-8000-0000000000f1/consent.pdf'),
    -- Paciente del Dr. B, sin caja fuerte (control positivo + DELETE del OWNER).
    ('94940000-0000-4000-8000-000000000903', 'documentos-clinicos',
     '94940000-0000-4000-8000-0000000000a1/94940000-0000-4000-8000-0000000000f2/informe.pdf'),
    -- Cross-org: paciente de la org B colgado del prefijo de la org A.
    ('94940000-0000-4000-8000-000000000904', 'documentos-clinicos',
     '94940000-0000-4000-8000-0000000000a1/94940000-0000-4000-8000-0000000000f3/estudio.pdf'),
    -- El MISMO paciente bajo su prefijo real (control positivo de N3).
    ('94940000-0000-4000-8000-000000000905', 'documentos-clinicos',
     '94940000-0000-4000-8000-0000000000b1/94940000-0000-4000-8000-0000000000f3/estudio.pdf'),
    -- Paths fuera de convención: sin el cast fail-closed, cada uno de estos
    -- aborta la query ENTERA con 22P02 (o deja pasar la fila).
    ('94940000-0000-4000-8000-000000000906', 'documentos-clinicos',
     '94940000-0000-4000-8000-0000000000a1/estudio-suelto.pdf'),          -- [2] no es uuid
    ('94940000-0000-4000-8000-000000000907', 'documentos-clinicos',
     '94940000-0000-4000-8000-0000000000a1/'),                            -- [2] vacío
    ('94940000-0000-4000-8000-000000000908', 'documentos-clinicos',
     '94940000-0000-4000-8000-0000000000a1'),                             -- sin [2]
    ('94940000-0000-4000-8000-000000000909', 'documentos-clinicos',
     '94940000-0000-4000-8000-0000000000a1/no-soy-un-uuid/estudio.pdf')   -- [2] basura
  ON CONFLICT (id) DO NOTHING;

  -- La trampa EXACTA del guard viejo de M85: 36 guiones pasan '^[0-9a-f-]{36}$'
  -- y revientan en el ::uuid. Va al bucket del portal, que es donde vivía.
  INSERT INTO storage.objects (id, bucket_id, name) VALUES
    ('94940000-0000-4000-8000-000000000910', 'consentimientos-firmados',
     '94940000-0000-4000-8000-0000000000a1/' || repeat('-', 36) || '/firma.png')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'M94 spec · fixtures listos';
END $$;

-- ─── Guardar el estado de RLS de storage.objects para restaurarlo al final ──
-- GUC de sesión y no tabla temporal a propósito: crear una temp table mete
-- pg_temp al frente de la resolución de nombres del resto del spec, justo
-- mientras se evalúan policies que hacen lookups sin esquema.
SELECT set_config('folio.m94_rls_prev', relrowsecurity::text, false)
  FROM pg_class WHERE oid = 'storage.objects'::regclass;

-- ─── Habilitar RLS + GRANTs mínimos (sin esto el spec no prueba NADA) ───────
-- El stub del CI crea storage.objects SIN RLS y sin grants para `authenticated`.
-- En Supabase real la plataforma hace las dos cosas; acá las hacemos nosotros.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'M94 SETUP FAIL: el runner no es dueño de storage.objects y no puede habilitar RLS — sin RLS este spec no ejercita ninguna policy y sería un falso verde';
END $$;

GRANT USAGE ON SCHEMA public  TO authenticated;
GRANT USAGE ON SCHEMA storage TO authenticated;
-- A diferencia de las policies de public.*, que delegan en helpers SECURITY
-- DEFINER, las de storage.objects llaman a auth.uid() DIRECTO — bajo SET ROLE
-- authenticated eso exige USAGE sobre el schema auth. En Supabase real lo tiene
-- (por eso las policies funcionan en prod); el stub del CI no lo concede, y sin
-- esto el spec muere con "permission denied for schema auth".
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON paciente, member TO authenticated;
GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated;

-- Cinturón: si por lo que sea la RLS quedó apagada, todo lo de abajo daría
-- verde sin evaluar una sola policy.
DO $$
DECLARE v boolean;
BEGIN
  SELECT relrowsecurity INTO v FROM pg_class WHERE oid = 'storage.objects'::regclass;
  IF v IS NOT TRUE THEN
    RAISE EXCEPTION 'M94 SETUP FAIL: storage.objects quedó SIN row level security — el spec no probaría nada';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- CASO 1 · Dr. B: PROFESIONAL de la org, sin relación con el paciente.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT '94940000-0000-4000-8000-0000000000b2'::uuid $$;

SET ROLE authenticated;

-- ── P2 (control primero): Dr. B SÍ ve el objeto de SU paciente ───────────────
-- Va antes que las negativas: si esto fallara, el caso 1 daría verde por el
-- motivo equivocado (falta de GRANT / bucket vacío) y no por M94.
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM storage.objects
   WHERE id = '94940000-0000-4000-8000-000000000903';
  IF v <> 1 THEN
    RAISE EXCEPTION 'M94 FAIL P2: Dr. B perdió el objeto de SU PROPIO paciente (filas=%) — M94 angostó de más o faltan GRANTs', v;
  END IF;
  RAISE NOTICE 'M94 spec · P2 OK: Dr. B sigue leyendo los archivos del paciente que sí es suyo';
END $$;

-- ── N1. Dr. B NO ve la caja fuerte del Dr. A (los DOS buckets) ──────────────
DO $$
DECLARE v_doc int; v_cons int;
BEGIN
  SELECT count(*) INTO v_doc  FROM storage.objects
   WHERE id = '94940000-0000-4000-8000-000000000901';
  SELECT count(*) INTO v_cons FROM storage.objects
   WHERE id = '94940000-0000-4000-8000-000000000902';
  IF v_doc <> 0 THEN
    RAISE EXCEPTION 'M94 FAIL N1: Dr. B leyó un DOCUMENTO CLÍNICO de un paciente en la caja fuerte del Dr. A (filas=%) — PHI, Ley 26.529', v_doc;
  END IF;
  IF v_cons <> 0 THEN
    RAISE EXCEPTION 'M94 FAIL N1: Dr. B leyó un CONSENTIMIENTO FIRMADO de un paciente en la caja fuerte del Dr. A (filas=%)', v_cons;
  END IF;
  RAISE NOTICE 'M94 spec · N1 OK: la caja fuerte del Dr. A es opaca para el Dr. B en ambos buckets';
END $$;

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- CASO 2 · Dr. A: el profesional de la caja fuerte. No le rompimos nada.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT '94940000-0000-4000-8000-0000000000a2'::uuid $$;

SET ROLE authenticated;

-- ── P1. Dr. A ve sus dos objetos, y sólo los suyos ──────────────────────────
DO $$
DECLARE v_doc int; v_cons int; v_ajeno int;
BEGIN
  SELECT count(*) INTO v_doc  FROM storage.objects
   WHERE id = '94940000-0000-4000-8000-000000000901';
  SELECT count(*) INTO v_cons FROM storage.objects
   WHERE id = '94940000-0000-4000-8000-000000000902';
  IF v_doc <> 1 THEN
    RAISE EXCEPTION 'M94 FAIL P1: el profesional de la caja fuerte perdió el documento de SU paciente (filas=%)', v_doc;
  END IF;
  IF v_cons <> 1 THEN
    RAISE EXCEPTION 'M94 FAIL P1: el profesional de la caja fuerte perdió el consentimiento de SU paciente (filas=%)', v_cons;
  END IF;
  -- Simetría: el paciente del Dr. B tampoco es suyo.
  SELECT count(*) INTO v_ajeno FROM storage.objects
   WHERE id = '94940000-0000-4000-8000-000000000903';
  IF v_ajeno <> 0 THEN
    RAISE EXCEPTION 'M94 FAIL P1: el Dr. A leyó el archivo del paciente del Dr. B (filas=%)', v_ajeno;
  END IF;
  RAISE NOTICE 'M94 spec · P1 OK: el acceso legítimo del Dr. A quedó intacto (y sigue siendo simétrico)';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- CASO 4a · Paths fuera de convención: DENIEGAN, no ABORTAN (documentos-clinicos)
-- ════════════════════════════════════════════════════════════════════════════
-- Ésta es la razón de existir de public.storage_path_uuid(). Con el cast crudo
-- `(string_to_array(name,'/'))[2]::uuid` dentro del USING, un error NO deniega la
-- fila: aborta la QUERY. Un solo objeto legacy con path raro dejaría a todo el
-- consultorio sin poder listar el bucket.
DO $$
DECLARE v int;
BEGIN
  BEGIN
    SELECT count(*) INTO v FROM storage.objects
     WHERE id IN ('94940000-0000-4000-8000-000000000906',   -- {org}/estudio-suelto.pdf
                  '94940000-0000-4000-8000-000000000907',   -- {org}/
                  '94940000-0000-4000-8000-000000000908',   -- {org}
                  '94940000-0000-4000-8000-000000000909');  -- {org}/no-soy-un-uuid/…
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'M94 FAIL N4: un path fuera de convención ABORTÓ la query con 22P02 en vez de denegar en silencio — el cast no está pasando por public.storage_path_uuid()';
  END;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M94 FAIL N4: se leyeron % objeto(s) con path fuera de convención (deben denegarse fail-closed)', v;
  END IF;
  RAISE NOTICE 'M94 spec · N4a OK: los paths rotos deniegan en silencio, sin 22P02';
END $$;

-- Y el escaneo del bucket entero (el equivalente al `list()`) tampoco explota:
-- la policy se evalúa contra TODAS las filas del bucket, rotas incluidas.
DO $$
DECLARE v int;
BEGIN
  BEGIN
    SELECT count(*) INTO v FROM storage.objects WHERE bucket_id = 'documentos-clinicos';
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'M94 FAIL N4: listar el bucket completo abortó con 22P02 — un objeto legacy rompe la lectura de TODO el bucket';
  END;
  IF v < 1 THEN
    RAISE EXCEPTION 'M94 FAIL N4: el Dr. A no ve NINGÚN objeto del bucket (esperaba al menos el suyo) — ¿falta el GRANT o angostamos de más?';
  END IF;
  RAISE NOTICE 'M94 spec · N4a OK: el list() del bucket sobrevive a los objetos legacy (% visibles para el Dr. A)', v;
END $$;

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- CASO 3 + 6 + 1b · OWNER de la org A (y también OWNER de la org B).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT '94940000-0000-4000-8000-0000000000c2'::uuid $$;

SET ROLE authenticated;

-- ── N2 (1b). Ni el OWNER entra a la caja fuerte ajena ───────────────────────
-- Consecuencia DELIBERADA de M94: tampoco puede leer esa ficha en la DB (M32
-- aplica la caja fuerte a todos los roles). El bucket deja de ser la puerta de
-- atrás. Si esto un día se decide revertir, hay que revertirlo en `paciente`,
-- no acá.
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM storage.objects
   WHERE id IN ('94940000-0000-4000-8000-000000000901',
                '94940000-0000-4000-8000-000000000902');
  IF v <> 0 THEN
    RAISE EXCEPTION 'M94 FAIL N2: el OWNER leyó % archivo(s) de un paciente en caja fuerte ajena — el bucket sigue siendo la puerta de atrás', v;
  END IF;
  RAISE NOTICE 'M94 spec · N2 OK: la caja fuerte le cierra el bucket también al OWNER (deliberado)';
END $$;

-- ── P3 (control de N3): el OWNER SÍ ve al paciente de la org B bajo el
--     prefijo de la org B ────────────────────────────────────────────────────
-- Va primero para que la negativa de abajo no se pueda explicar con "no puede
-- leer esa ficha": puede, es OWNER en las dos orgs.
DO $$
DECLARE v_ficha int; v_obj int;
BEGIN
  SELECT count(*) INTO v_ficha FROM paciente
   WHERE id = '94940000-0000-4000-8000-0000000000f3';
  IF v_ficha <> 1 THEN
    RAISE EXCEPTION 'M94 SETUP FAIL: el OWNER no lee la ficha del paciente de la org B (filas=%) — N3 probaría lo que no es', v_ficha;
  END IF;

  SELECT count(*) INTO v_obj FROM storage.objects
   WHERE id = '94940000-0000-4000-8000-000000000905';
  IF v_obj <> 1 THEN
    RAISE EXCEPTION 'M94 FAIL P3: el OWNER perdió el objeto de la org B bajo su prefijo correcto (filas=%)', v_obj;
  END IF;
  RAISE NOTICE 'M94 spec · P3 OK: bajo el prefijo de su org real el objeto se lee normal';
END $$;

-- ── N3. Mismo paciente, prefijo de OTRA org ⇒ invisible ─────────────────────
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM storage.objects
   WHERE id = '94940000-0000-4000-8000-000000000904';
  IF v <> 0 THEN
    RAISE EXCEPTION 'M94 FAIL N3: se leyó un objeto cuyo paciente es de OTRA org que la del segmento [1] (filas=%) — el path no está atado a la org real de la ficha', v;
  END IF;
  RAISE NOTICE 'M94 spec · N3 OK: el segmento [1] tiene que ser la org REAL de la ficha';
END $$;

-- ── P6. Regresión de DELETE: el OWNER sigue borrando lo que puede ver ───────
-- M27 le dio DELETE en documentos-clinicos a OWNER/DIRECTOR; M94 le suma el
-- EXISTS del paciente. Sobre un paciente visible (P2, sin caja fuerte) el
-- borrado tiene que seguir funcionando.
DO $$
DECLARE v_pre int; v_del int;
BEGIN
  SELECT count(*) INTO v_pre FROM storage.objects
   WHERE id = '94940000-0000-4000-8000-000000000903';
  IF v_pre <> 1 THEN
    RAISE EXCEPTION 'M94 SETUP FAIL: el OWNER no ve el objeto que va a borrar (filas=%)', v_pre;
  END IF;

  DELETE FROM storage.objects WHERE id = '94940000-0000-4000-8000-000000000903';
  GET DIAGNOSTICS v_del = ROW_COUNT;
  IF v_del <> 1 THEN
    RAISE EXCEPTION 'M94 FAIL P6: "documentos-clinicos admin delete" dejó de funcionar para el OWNER sobre un paciente que puede ver (borradas=%)', v_del;
  END IF;
  RAISE NOTICE 'M94 spec · P6 OK: el DELETE administrativo sigue habilitado (M27 intacto)';
END $$;

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- CASO 5 + 4b · PACIENTE DE PORTAL (auth.uid() = su cuenta).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT '94940000-0000-4000-8000-0000000000d2'::uuid $$;

SET ROLE authenticated;

-- ── N5. NO puede depositar su firma bajo el prefijo de OTRA org ─────────────
-- Éste es el hermano del bug en M85: paciente_owns() validaba el segmento
-- paciente pero nadie miraba el de org ⇒ contaminación cross-tenant del bucket.
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO storage.objects (id, bucket_id, name) VALUES
      ('94940000-0000-4000-8000-000000000911', 'consentimientos-firmados',
       '94940000-0000-4000-8000-0000000000b1/94940000-0000-4000-8000-0000000000f4/firma.png');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    v_blocked := true;   -- RLS rechaza el WITH CHECK
  END;
  IF NOT v_blocked THEN
    IF EXISTS (SELECT 1 FROM storage.objects WHERE id = '94940000-0000-4000-8000-000000000911') THEN
      RAISE EXCEPTION 'M94 FAIL N5: el paciente de portal depositó un archivo bajo el prefijo de OTRA organización (contaminación cross-tenant)';
    END IF;
  END IF;
  RAISE NOTICE 'M94 spec · N5 OK: el portal no puede escribir bajo el prefijo de una org ajena';
END $$;

-- ── P5. SÍ puede firmar bajo el prefijo de SU org ───────────────────────────
DO $$
DECLARE v int;
BEGIN
  INSERT INTO storage.objects (id, bucket_id, name) VALUES
    ('94940000-0000-4000-8000-000000000912', 'consentimientos-firmados',
     '94940000-0000-4000-8000-0000000000a1/94940000-0000-4000-8000-0000000000f4/firma.png');
  SELECT count(*) INTO v FROM storage.objects
   WHERE id = '94940000-0000-4000-8000-000000000912';
  IF v <> 1 THEN
    RAISE EXCEPTION 'M94 FAIL P5: el paciente de portal no pudo subir la firma de SU consentimiento en SU org (filas=%) — M85 roto', v;
  END IF;
  RAISE NOTICE 'M94 spec · P5 OK: el paciente sigue firmando lo suyo, en su org';
END $$;

-- ── N4b. La trampa del guard viejo de M85: 36 guiones ───────────────────────
-- '------------------------------------' pasa el regex '^[0-9a-f-]{36}$' y
-- explota en el ::uuid. Con el helper fail-closed la lectura del portal ni se
-- inmuta: el objeto simplemente no aparece.
DO $$
DECLARE v_trampa int; v_mias int;
BEGIN
  BEGIN
    SELECT count(*) INTO v_trampa FROM storage.objects
     WHERE bucket_id = 'consentimientos-firmados'
       AND id = '94940000-0000-4000-8000-000000000910';
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'M94 FAIL N4b: el path de 36 guiones abortó la lectura del portal con 22P02 — el guard regex de M85 sigue vivo';
  END;
  IF v_trampa <> 0 THEN
    RAISE EXCEPTION 'M94 FAIL N4b: el paciente leyó un objeto con segmento [2] no-uuid (filas=%)', v_trampa;
  END IF;

  -- Y el escaneo completo del bucket del portal tampoco explota: ve su firma y
  -- nada más (ni el consentimiento del paciente en caja fuerte, ni la trampa).
  BEGIN
    SELECT count(*) INTO v_mias FROM storage.objects WHERE bucket_id = 'consentimientos-firmados';
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'M94 FAIL N4b: listar consentimientos-firmados desde el portal abortó con 22P02';
  END;
  IF v_mias <> 1 THEN
    RAISE EXCEPTION 'M94 FAIL N4b: el paciente de portal ve % objeto(s) en consentimientos-firmados (esperaba exactamente el suyo)', v_mias;
  END IF;
  RAISE NOTICE 'M94 spec · N4b OK: el portal ve sólo su firma y sobrevive al path trampa de M85';
END $$;

RESET ROLE;

-- ─── Sanity como superuser (sin RLS de por medio) ───────────────────────────
-- N5 se verificó desde adentro de la RLS: si el INSERT hubiera entrado pero sin
-- ser legible por el propio paciente, la negativa habría dado un falso verde.
-- Acá lo miramos sin policies: la fila cross-tenant NO existe, y la legítima sí.
DO $$
DECLARE v_cross int; v_propia int;
BEGIN
  SELECT count(*) INTO v_cross  FROM storage.objects
   WHERE id = '94940000-0000-4000-8000-000000000911';
  SELECT count(*) INTO v_propia FROM storage.objects
   WHERE id = '94940000-0000-4000-8000-000000000912';
  IF v_cross <> 0 THEN
    RAISE EXCEPTION 'M94 FAIL N5: la fila cross-tenant SÍ entró al bucket (el paciente no la ve, pero está) — contaminación silenciosa';
  END IF;
  IF v_propia <> 1 THEN
    RAISE EXCEPTION 'M94 FAIL P5: la firma legítima del paciente no quedó persistida (filas=%)', v_propia;
  END IF;
  RAISE NOTICE 'M94 spec · N5/P5 OK confirmado sin RLS: sólo entró el objeto del prefijo correcto';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Restaurar el estado del CI (igual que M85/M92): RLS como estaba, sin GRANTs
-- extra sobre storage y auth.uid() de nuevo en NULL.
-- ════════════════════════════════════════════════════════════════════════════
REVOKE SELECT, INSERT, DELETE ON storage.objects FROM authenticated;
REVOKE USAGE ON SCHEMA storage FROM authenticated;
REVOKE USAGE ON SCHEMA auth    FROM authenticated;

DO $$
BEGIN
  -- Sólo la apagamos si la encontramos apagada (que es el caso del stub del CI).
  -- En un entorno donde la plataforma ya la tenía prendida, no la tocamos.
  IF coalesce(current_setting('folio.m94_rls_prev', true), 'false') <> 'true' THEN
    EXECUTE 'ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

DO $$ BEGIN RAISE NOTICE 'M94 spec PASS · el bucket clínico ahora respeta la ficha: caja fuerte cerrada, org atada al path, paths rotos fail-closed y el portal escribe sólo en su org'; END $$;
