-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M51 spec · tier seat gate en member_invitation
-- ════════════════════════════════════════════════════════════════════════════
-- Verifica, CORRIENDO COMO ROL `authenticated` (no superuser — la RLS no
-- aplica a superusers ni con FORCE):
--   1. Org INDEPENDIENTE: ni siquiera su OWNER puede insertar una invitación
--      (la policy M51 exige tipo = CLINICA) → 42501 insufficient_privilege.
--   2. Org CLINICA: su OWNER inserta normalmente (regresión del WITH CHECK
--      heredado de M49: org propia + rol admin + invited_by coherente).
--   3. Regresión de la policy de SELECT (M49, sin cambios): el OWNER de la
--      CLINICA ve su invitación; el OWNER de la otra org NO la ve.
--
-- Mecánica CI (pgtap.yml): los specs corren como postgres sobre vanilla
-- postgres:16. Para ejercer RLS de verdad: fixtures como superuser →
-- override de auth.uid() → GRANTs mínimos al rol `authenticated` (en CI
-- vanilla no existen; en Supabase real ya están) → SET ROLE authenticated.
-- Los helpers user_org_ids()/user_role_in()/user_member_id_in() son
-- SECURITY DEFINER (M01) así que funcionan bajo el rol bajado.
--
-- UUIDs fijos para compartirlos entre bloques (cada DO es independiente).
-- Restaura auth.uid() a NULL al final para no contaminar specs posteriores.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Fixtures (superuser → bypass RLS) ──────────────────────────────────────

-- Idempotente (ON CONFLICT DO NOTHING + limpieza de invitaciones previas):
-- en CI la DB siempre nace fresca, pero un dev puede correr el spec dos veces
-- contra su Postgres local.
DO $$
BEGIN
  DELETE FROM member_invitation
   WHERE token_hash IN (
     encode(digest('m51-token-ind', 'sha256'), 'hex'),
     encode(digest('m51-token-cli', 'sha256'), 'hex')
   );

  INSERT INTO auth.users (id, email) VALUES
    ('a51a0000-0000-4000-8000-000000000001', 'owner-ind-m51@spec.test'),
    ('a51a0000-0000-4000-8000-000000000002', 'owner-cli-m51@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization (id, slug, nombre, tipo) VALUES
    ('a51a0000-0000-4000-8000-000000000011', 'm51-ind-spec', 'M51 Independiente Spec', 'INDEPENDIENTE'),
    ('a51a0000-0000-4000-8000-000000000012', 'm51-cli-spec', 'M51 Clínica Spec', 'CLINICA')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version) VALUES
    ('a51a0000-0000-4000-8000-000000000001', 'owner-ind-m51@spec.test', now(), 'v1'),
    ('a51a0000-0000-4000-8000-000000000002', 'owner-cli-m51@spec.test', now(), 'v1')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at) VALUES
    ('a51a0000-0000-4000-8000-000000000021', 'a51a0000-0000-4000-8000-000000000011',
     'a51a0000-0000-4000-8000-000000000001', 'OWNER', true, now()),
    ('a51a0000-0000-4000-8000-000000000022', 'a51a0000-0000-4000-8000-000000000012',
     'a51a0000-0000-4000-8000-000000000002', 'OWNER', true, now())
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'M51 spec · fixtures listos';
END $$;

-- ─── Grants mínimos para ejercer RLS como `authenticated` ───────────────────
-- En Supabase real estos privilegios ya existen (default grants del proyecto).
-- En el CI vanilla el rol nace sin nada; sin esto el test fallaría por falta
-- de privilegio de TABLA, no por RLS (que es lo que queremos medir).

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON member_invitation TO authenticated;
GRANT SELECT ON organization TO authenticated;

-- ─── 1. INDEPENDIENTE: OWNER bloqueado por la policy M51 ────────────────────

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a51a0000-0000-4000-8000-000000000001'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE
  v_caught boolean := false;
BEGIN
  BEGIN
    INSERT INTO member_invitation (organization_id, email, role, token_hash, invited_by_member_id)
    VALUES ('a51a0000-0000-4000-8000-000000000011', 'inv-ind-m51@spec.test', 'ASISTENTE',
            encode(digest('m51-token-ind', 'sha256'), 'hex'),
            'a51a0000-0000-4000-8000-000000000021');
  EXCEPTION
    WHEN insufficient_privilege THEN v_caught := true; -- 42501: RLS WITH CHECK
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M51 spec FAIL: org INDEPENDIENTE pudo insertar una invitación (el gate de tier no aplica)';
  END IF;
  RAISE NOTICE 'M51 spec · 1/3 OK: INDEPENDIENTE bloqueada';
END $$;

RESET ROLE;

-- ─── 2. CLINICA: OWNER inserta + ve su invitación (SELECT regresión) ────────

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a51a0000-0000-4000-8000-000000000002'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE
  v_count int;
BEGIN
  INSERT INTO member_invitation (organization_id, email, role, token_hash, invited_by_member_id)
  VALUES ('a51a0000-0000-4000-8000-000000000012', 'inv-cli-m51@spec.test', 'PROFESIONAL',
          encode(digest('m51-token-cli', 'sha256'), 'hex'),
          'a51a0000-0000-4000-8000-000000000022');

  SELECT count(*) INTO v_count
    FROM member_invitation
   WHERE organization_id = 'a51a0000-0000-4000-8000-000000000012'
     AND lower(email) = 'inv-cli-m51@spec.test';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'M51 spec FAIL: el OWNER CLINICA no ve su invitación recién creada (count=%)', v_count;
  END IF;
  RAISE NOTICE 'M51 spec · 2/3 OK: CLINICA inserta y ve su invitación';
END $$;

RESET ROLE;

-- ─── 3. Aislamiento cross-tenant del SELECT (policy M49 intacta) ────────────

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a51a0000-0000-4000-8000-000000000001'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
    FROM member_invitation
   WHERE organization_id = 'a51a0000-0000-4000-8000-000000000012';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'M51 spec FAIL: un OWNER ajeno ve invitaciones de otra org (count=%)', v_count;
  END IF;
  RAISE NOTICE 'M51 spec · 3/3 OK: SELECT no filtra cross-tenant';
END $$;

RESET ROLE;

-- Sanity como superuser: la fila de la CLINICA realmente existe (el 0 de
-- arriba fue RLS, no ausencia de datos).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM member_invitation
    WHERE organization_id = 'a51a0000-0000-4000-8000-000000000012'
      AND lower(email) = 'inv-cli-m51@spec.test'
  ) THEN
    RAISE EXCEPTION 'M51 spec FAIL: la invitación CLINICA no quedó persistida';
  END IF;
  RAISE NOTICE 'M51 spec OK';
END $$;

-- Restaurar auth.uid() a NULL (estado de CI) para specs posteriores.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
