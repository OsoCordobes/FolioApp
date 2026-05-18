-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M01 · Extensiones + helpers SQL globales
-- ════════════════════════════════════════════════════════════════════════════
-- Bootstrap minimal de la base. Habilita las extensiones críticas y declara
-- las funciones helper que el resto de migrations referencian para RLS:
--
--   - pgcrypto:  hashing (HMAC para blind indexes sobre PII cifrada),
--                gen_random_uuid(), pgp_sym_encrypt como fallback.
--   - pg_cron:   schedules de mantenimiento (refresh analytics, vacuum,
--                expiración de RecordatorioJob). Solo Supabase hosted Pro;
--                en Free se usa Vercel Cron equivalente (F9).
--   - pgsodium:  OPCIONAL. Si está disponible (Pro o local Docker) lo
--                cargamos para futuras key-management features, pero NO lo
--                usamos para TCE — la encriptación es app-side (AES-256-GCM
--                en Server Actions, key en Vercel env). Ver
--                memory/decision_supabase_free_pgcrypto.md.
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

-- pgsodium y pg_cron son opt-in (disponibles condicionalmente):
--   - pgsodium se carga si está; no se usa para TCE pero queda disponible
--     para futuras features (key vault, signatures).
--   - pg_cron solo en Supabase hosted (Pro). En Free usamos Vercel Cron.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pgsodium') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pgsodium';
  END IF;
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

-- HMAC determinístico para "blind indexes" sobre columnas cifradas app-side.
-- Uso: `WHERE nombre_hash = $1` donde `$1` es el HMAC del query precomputado
-- en Node.js con la misma key (`FOLIO_ENC_HMAC_KEY`).
--
-- ESTA función NO se invoca en queries normales — la app calcula el HMAC
-- antes de hablar con la DB usando `lib/crypto.ts`. Sirve como referencia
-- legible para auditoría y para scripts de migración / re-encrypt.
--
-- La key default es solo para desarrollo local SIN env var seteada. En prod
-- el cálculo lo hace el servidor con la key real (no se invoca esta función).
CREATE OR REPLACE FUNCTION public.hmac_blind(plain text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN plain IS NULL THEN NULL
    ELSE encode(
      hmac(
        lower(trim(plain)),
        coalesce(
          current_setting('folio.hmac_key', true),
          'folio-dev-only-key-rotate-on-prod-launch'
        )::bytea,
        'sha256'
      ),
      'hex'
    )
  END
$$;

-- Comentario para auditoría y onboarding del próximo dev.
COMMENT ON FUNCTION public.user_org_ids() IS
  'Folio · helper RLS · devuelve organization_ids del auth.uid() del JWT actual';
COMMENT ON FUNCTION public.can_read_clinical(uuid) IS
  'Folio · helper RLS · true si el usuario puede leer PHI en la org (OWNER + PROFESIONAL + DIRECTOR colegiado)';
COMMENT ON FUNCTION public.hmac_blind(text) IS
  'Folio · blind index · referencia de cómputo HMAC para búsqueda sobre columnas cifradas app-side. En prod la app computa el hash en Node.js con FOLIO_ENC_HMAC_KEY.';
