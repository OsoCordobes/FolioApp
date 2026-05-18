-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M01 · Extensiones + helpers SQL globales
-- ════════════════════════════════════════════════════════════════════════════
-- Bootstrap minimal de la base. Habilita las 3 extensiones críticas y declara
-- las funciones helper que el resto de migrations referencian para RLS:
--
--   - pgcrypto:  hashing (HMAC para blind indexes en PII), gen_random_uuid()
--   - pgsodium:  Transparent Column Encryption (TCE) sobre PHI/PII.
--                Requiere plan Pro de Supabase en hosted. En local viene
--                incluido en la imagen Docker.
--   - pg_cron:   schedules de mantenimiento (refresh analytics, vacuum,
--                expiración de RecordatorioJob, etc.). Solo Supabase hosted.
--
-- Las funciones helper viven en el schema `public` para que Prisma las pueda
-- referenciar y se invocan SIEMPRE qualificadas (`public.user_org_ids()`)
-- desde policies — es la única forma de evitar surprises con `search_path`.
--
-- Todas las funciones son `SECURITY DEFINER` porque deben atravesar RLS para
-- leer la tabla `member` que decide los permisos (referencia circular si no).
-- El `SET search_path = public` previene el ataque clásico de funciones
-- SECURITY DEFINER (CWE-1284).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Extensiones ───────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- pgsodium en Supabase local viene precargado pero requiere CREATE EXTENSION
-- en cada nuevo schema. En hosted Pro idem.
CREATE EXTENSION IF NOT EXISTS pgsodium;

-- pg_cron solo en hosted (en local podemos simularlo con triggers o saltar).
-- En tests, esta línea no falla porque IF NOT EXISTS es no-op si ya está.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
  END IF;
END
$$;

-- ─── Helpers RLS · scope de organización ──────────────────────────────────

-- Devuelve las orgs del usuario actual. `auth.uid()` es nativo de Supabase
-- (devuelve el id de auth.users del JWT del request). En migrations corremos
-- como superuser y `auth.uid()` retorna NULL → no se ven filas (esperado).
CREATE OR REPLACE FUNCTION public.user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM member
  WHERE profile_id = auth.uid()
    AND deleted_at IS NULL
$$;

-- Rol del usuario en una org puntual. Devuelve text en lugar de enum para
-- que el caller pueda comparar fácil con `IN ('OWNER', 'DIRECTOR')` sin
-- castings explícitos.
CREATE OR REPLACE FUNCTION public.user_role_in(org uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text
  FROM member
  WHERE profile_id = auth.uid()
    AND organization_id = org
    AND deleted_at IS NULL
$$;

-- ¿El usuario puede leer datos clínicos (PHI) en la org?
-- - OWNER siempre.
-- - PROFESIONAL siempre (sobre los pacientes que le pertenecen — el filtro
--   más fino vive en las policies de Sesion/Paciente).
-- - DIRECTOR solo si `es_colegiado = true` (gerencial clínico vs admin puro).
-- - COORDINADOR / ASISTENTE: NUNCA.
CREATE OR REPLACE FUNCTION public.can_read_clinical(org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM member
    WHERE profile_id = auth.uid()
      AND organization_id = org
      AND deleted_at IS NULL
      AND (
        role IN ('OWNER', 'PROFESIONAL')
        OR (role = 'DIRECTOR' AND es_colegiado = true)
      )
  )
$$;

-- ¿El usuario puede leer datos administrativos/financieros (Turno, Pago,
-- KPIs)? Más permisivo que `can_read_clinical`: OWNER + DIRECTOR + PROFESIONAL.
-- ASISTENTE también ve agenda + cobros (necesario para recepción), pero las
-- policies específicas de Pago refinan si ve montos o no.
CREATE OR REPLACE FUNCTION public.can_read_admin(org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_role_in(org) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL', 'ASISTENTE')
$$;

-- Devuelve el id del Member del usuario en una org (sin pasar por JOIN cada
-- vez en las policies). Usado para self-scoping de PROFESIONAL.
CREATE OR REPLACE FUNCTION public.user_member_id_in(org uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM member
  WHERE profile_id = auth.uid()
    AND organization_id = org
    AND deleted_at IS NULL
$$;

-- ¿El usuario tiene alcance de visibilidad sobre `target_member` en la org?
-- Usado por COORDINADOR/ASISTENTE con alcance LISTA_PROFESIONALES o EQUIPO.
-- OWNER/DIRECTOR siempre tienen alcance total; un PROFESIONAL siempre se
-- ve a sí mismo.
CREATE OR REPLACE FUNCTION public.user_has_scope_over(org uuid, target_member uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH u AS (
    SELECT id, alcance, equipo_id, profesionales_gestionados, role
    FROM member
    WHERE profile_id = auth.uid()
      AND organization_id = org
      AND deleted_at IS NULL
  )
  SELECT EXISTS (
    SELECT 1
    FROM u
    WHERE u.role IN ('OWNER', 'DIRECTOR')
       OR u.id = target_member
       OR u.alcance = 'TODOS'
       OR (u.alcance = 'EQUIPO'
           AND u.equipo_id = (SELECT equipo_id FROM member WHERE id = target_member))
       OR (u.alcance = 'LISTA_PROFESIONALES'
           AND target_member::text = ANY(u.profesionales_gestionados))
  )
$$;

-- ─── Helpers de utilidad ──────────────────────────────────────────────────

-- HMAC determinístico para "blind indexes". Toma un texto + una key y
-- devuelve un hash hex. Se usa para crear índices sobre datos cifrados:
-- `nombre_hash` se calcula en la app, se guarda, y la búsqueda por nombre
-- usa `WHERE nombre_hash = hmac_blind(query, key)`. La key vive en
-- pgsodium key store; en local se hardcodea con un placeholder.
CREATE OR REPLACE FUNCTION public.hmac_blind(plain text, key_id uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw_key bytea;
BEGIN
  IF plain IS NULL THEN
    RETURN NULL;
  END IF;
  -- En F4 reemplazamos por `pgsodium.crypto_auth_hmacsha512(plain, key_from_kms)`.
  -- Hasta entonces, hmac determinístico con sha256 + key fija de desarrollo.
  raw_key := COALESCE(
    (SELECT raw_key FROM pgsodium.key WHERE id = key_id LIMIT 1),
    '\xdeadbeef0000000000000000folio-dev-only-key-rotate-on-prod-launch'::bytea
  );
  RETURN encode(hmac(lower(trim(plain)), raw_key, 'sha256'), 'hex');
EXCEPTION
  WHEN OTHERS THEN
    -- Si pgsodium aún no tiene la key (primer boot), usar key default.
    RETURN encode(
      hmac(
        lower(trim(plain)),
        '\xdeadbeef0000000000000000folio-dev-only-key-rotate-on-prod-launch'::bytea,
        'sha256'
      ),
      'hex'
    );
END
$$;

-- Comentario para auditoría y onboarding del próximo dev.
COMMENT ON FUNCTION public.user_org_ids() IS
  'Folio · helper RLS · devuelve organization_ids del auth.uid() del JWT actual';
COMMENT ON FUNCTION public.can_read_clinical(uuid) IS
  'Folio · helper RLS · true si el usuario puede leer PHI en la org (OWNER + PROFESIONAL + DIRECTOR colegiado)';
COMMENT ON FUNCTION public.hmac_blind(text, uuid) IS
  'Folio · blind index · genera hmac determinístico para búsqueda sobre columnas cifradas con pgsodium';
