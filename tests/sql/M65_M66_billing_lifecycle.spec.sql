-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M65+M66 spec · email_notificacion + organization_tipo_cambio
-- ════════════════════════════════════════════════════════════════════════════
-- Verifica:
--   1. Existencia de tablas/columnas (email_notificacion, suscripcion.
--      morosa_desde, organization_tipo_cambio con de_tipo/a_tipo enum).
--   2. RLS ENABLE + FORCE en ambas tablas.
--   3. UNIQUE(dedupe_key) real: el segundo INSERT con la misma key → 23505.
--   4. Trigger append-only de M66 rechaza UPDATE y DELETE (incluso como
--      superuser — el trigger no es RLS).
--   5. Deny-by-default para `authenticated`: email_notificacion no se lee ni
--      se escribe; organization_tipo_cambio solo la SELECTea el OWNER de la
--      org (y no cross-tenant), y ni el OWNER puede INSERTar.
--
-- Mecánica CI (pgtap.yml): corre como postgres sobre vanilla postgres:16.
-- Para ejercer RLS: fixtures como superuser → override de auth.uid() →
-- GRANTs mínimos a `authenticated` (en Supabase real ya existen) →
-- SET ROLE authenticated. Restaura auth.uid() a NULL al final.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Existencia de tablas y columnas ──────────────────────────────────────

DO $$
BEGIN
  IF to_regclass('public.email_notificacion') IS NULL THEN
    RAISE EXCEPTION 'M65 spec FAIL: falta la tabla email_notificacion';
  END IF;
  IF to_regclass('public.organization_tipo_cambio') IS NULL THEN
    RAISE EXCEPTION 'M66 spec FAIL: falta la tabla organization_tipo_cambio';
  END IF;

  -- Columnas de email_notificacion.
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'email_notificacion'
         AND column_name IN ('id', 'organization_id', 'tipo', 'dedupe_key',
                             'destinatario', 'enviado_ts', 'meta')) <> 7 THEN
    RAISE EXCEPTION 'M65 spec FAIL: email_notificacion no tiene las 7 columnas esperadas';
  END IF;

  -- suscripcion.morosa_desde (timestamptz, nullable).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'suscripcion'
       AND column_name = 'morosa_desde' AND data_type = 'timestamp with time zone'
  ) THEN
    RAISE EXCEPTION 'M65 spec FAIL: falta suscripcion.morosa_desde timestamptz';
  END IF;

  -- de_tipo/a_tipo usan el MISMO tipo que organization.tipo (enum organizacion_tipo).
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'organization_tipo_cambio'
         AND column_name IN ('de_tipo', 'a_tipo') AND udt_name = 'organizacion_tipo') <> 2 THEN
    RAISE EXCEPTION 'M66 spec FAIL: de_tipo/a_tipo no son enum organizacion_tipo';
  END IF;

  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'organization_tipo_cambio'
         AND column_name IN ('id', 'organization_id', 'changed_by', 'monto_antes_cents',
                             'monto_despues_cents', 'created_at')) <> 6 THEN
    RAISE EXCEPTION 'M66 spec FAIL: organization_tipo_cambio no tiene las columnas esperadas';
  END IF;

  RAISE NOTICE 'M65/M66 spec · 1/5 OK: tablas y columnas existen';
END $$;

-- ─── 2. RLS ENABLE + FORCE ───────────────────────────────────────────────────

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
     WHERE oid IN ('public.email_notificacion'::regclass,
                   'public.organization_tipo_cambio'::regclass)
  LOOP
    IF NOT r.relrowsecurity OR NOT r.relforcerowsecurity THEN
      RAISE EXCEPTION 'M65/M66 spec FAIL: % sin RLS ENABLE+FORCE (enable=%, force=%)',
        r.relname, r.relrowsecurity, r.relforcerowsecurity;
    END IF;
  END LOOP;
  RAISE NOTICE 'M65/M66 spec · 2/5 OK: RLS habilitada y forzada';
END $$;

-- ─── Fixtures (superuser → bypass RLS) ───────────────────────────────────────

DO $$
BEGIN
  -- Limpieza idempotente para reruns locales. organization_tipo_cambio NO se
  -- limpia (el trigger append-only bloquea DELETE incluso a superuser): sus
  -- fixtures usan ids fijos + ON CONFLICT DO NOTHING.
  DELETE FROM email_notificacion WHERE dedupe_key LIKE 'm65-spec:%';

  INSERT INTO auth.users (id, email) VALUES
    ('a65a0000-0000-4000-8000-000000000001', 'owner-a-m65@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization (id, slug, nombre, tipo) VALUES
    ('a65a0000-0000-4000-8000-000000000011', 'm65-org-a-spec', 'M65 Org A Spec', 'CLINICA'),
    ('a65a0000-0000-4000-8000-000000000012', 'm65-org-b-spec', 'M65 Org B Spec', 'CLINICA')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version) VALUES
    ('a65a0000-0000-4000-8000-000000000001', 'owner-a-m65@spec.test', now(), 'v1')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at) VALUES
    ('a65a0000-0000-4000-8000-000000000021', 'a65a0000-0000-4000-8000-000000000011',
     'a65a0000-0000-4000-8000-000000000001', 'OWNER', true, now())
  ON CONFLICT (id) DO NOTHING;

  -- Un cambio de tipo por org (como lo insertaría service_role).
  INSERT INTO organization_tipo_cambio
    (id, organization_id, de_tipo, a_tipo, changed_by, monto_antes_cents, monto_despues_cents)
  VALUES
    ('a65a0000-0000-4000-8000-000000000031', 'a65a0000-0000-4000-8000-000000000011',
     'INDEPENDIENTE', 'CLINICA', 'a65a0000-0000-4000-8000-000000000001', 3000000, 10000000),
    ('a65a0000-0000-4000-8000-000000000032', 'a65a0000-0000-4000-8000-000000000012',
     'INDEPENDIENTE', 'CLINICA', 'a65a0000-0000-4000-8000-000000000001', 3000000, 10000000)
  ON CONFLICT (id) DO NOTHING;

  -- Un email registrado (como lo insertaría recordEmailOnce via service_role).
  INSERT INTO email_notificacion (organization_id, tipo, dedupe_key, destinatario, meta)
  VALUES ('a65a0000-0000-4000-8000-000000000011', 'pago_fallido',
          'm65-spec:pago-fallido:1', 'owner-a-m65@spec.test', '{"monto_cents":3000000}'::jsonb);

  RAISE NOTICE 'M65/M66 spec · fixtures listos';
END $$;

-- ─── 3. UNIQUE(dedupe_key): segundo INSERT con la misma key → 23505 ─────────

DO $$
DECLARE
  v_caught boolean := false;
BEGIN
  BEGIN
    INSERT INTO email_notificacion (organization_id, tipo, dedupe_key, destinatario)
    VALUES ('a65a0000-0000-4000-8000-000000000011', 'pago_fallido',
            'm65-spec:pago-fallido:1', 'owner-a-m65@spec.test');
  EXCEPTION
    WHEN unique_violation THEN v_caught := true; -- 23505: idempotencia real
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M65 spec FAIL: dedupe_key duplicada no tiró unique_violation';
  END IF;
  RAISE NOTICE 'M65/M66 spec · 3/5 OK: UNIQUE(dedupe_key) enforced';
END $$;

-- ─── 4. Append-only M66: UPDATE y DELETE rechazados por trigger ─────────────

DO $$
DECLARE
  v_caught boolean := false;
BEGIN
  BEGIN
    UPDATE organization_tipo_cambio
       SET monto_despues_cents = 99999999
     WHERE id = 'a65a0000-0000-4000-8000-000000000031';
  EXCEPTION
    WHEN raise_exception THEN v_caught := true; -- P0001 del trigger
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M66 spec FAIL: UPDATE a organization_tipo_cambio no fue bloqueado';
  END IF;

  v_caught := false;
  BEGIN
    DELETE FROM organization_tipo_cambio
     WHERE id = 'a65a0000-0000-4000-8000-000000000031';
  EXCEPTION
    WHEN raise_exception THEN v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M66 spec FAIL: DELETE a organization_tipo_cambio no fue bloqueado';
  END IF;

  RAISE NOTICE 'M65/M66 spec · 4/5 OK: append-only enforced (UPDATE/DELETE bloqueados)';
END $$;

-- ─── 5. RLS como `authenticated` ─────────────────────────────────────────────
-- Grants mínimos (en Supabase real ya existen; en CI vanilla el rol nace sin
-- nada — sin esto fallaría por privilegio de TABLA, no por RLS).

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT ON email_notificacion TO authenticated;
GRANT SELECT, INSERT ON organization_tipo_cambio TO authenticated;
GRANT SELECT ON organization TO authenticated;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a65a0000-0000-4000-8000-000000000001'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE
  v_count int;
  v_caught boolean := false;
BEGIN
  -- 5a. email_notificacion: deny-all incluso para el OWNER (service-only).
  SELECT count(*) INTO v_count FROM email_notificacion;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'M65 spec FAIL: authenticated lee email_notificacion (count=%)', v_count;
  END IF;

  BEGIN
    INSERT INTO email_notificacion (organization_id, tipo, dedupe_key, destinatario)
    VALUES ('a65a0000-0000-4000-8000-000000000011', 'x', 'm65-spec:hack', 'a@b.c');
  EXCEPTION
    WHEN insufficient_privilege THEN v_caught := true; -- 42501: RLS deny
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M65 spec FAIL: authenticated pudo INSERTar en email_notificacion';
  END IF;

  -- 5b. organization_tipo_cambio: el OWNER ve SU historial, no el ajeno.
  SELECT count(*) INTO v_count FROM organization_tipo_cambio
   WHERE organization_id = 'a65a0000-0000-4000-8000-000000000011';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'M66 spec FAIL: el OWNER no ve el cambio de tipo de su org (count=%)', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM organization_tipo_cambio
   WHERE organization_id = 'a65a0000-0000-4000-8000-000000000012';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'M66 spec FAIL: el OWNER ve cambios de tipo de otra org (count=%)', v_count;
  END IF;

  -- 5c. INSERT bloqueado también para el OWNER (write = solo service_role).
  v_caught := false;
  BEGIN
    INSERT INTO organization_tipo_cambio
      (organization_id, de_tipo, a_tipo, changed_by)
    VALUES ('a65a0000-0000-4000-8000-000000000011', 'CLINICA', 'INDEPENDIENTE',
            'a65a0000-0000-4000-8000-000000000001');
  EXCEPTION
    WHEN insufficient_privilege THEN v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M66 spec FAIL: authenticated pudo INSERTar en organization_tipo_cambio';
  END IF;

  RAISE NOTICE 'M65/M66 spec · 5/5 OK: RLS deny-all / select-owner correctas';
END $$;

RESET ROLE;

-- Sanity como superuser: las filas realmente existen (los 0 de arriba fueron
-- RLS, no ausencia de datos).
DO $$
BEGIN
  IF (SELECT count(*) FROM email_notificacion WHERE dedupe_key = 'm65-spec:pago-fallido:1') <> 1 THEN
    RAISE EXCEPTION 'M65 spec FAIL: la fila de email_notificacion no quedó persistida';
  END IF;
  IF (SELECT count(*) FROM organization_tipo_cambio
       WHERE organization_id = 'a65a0000-0000-4000-8000-000000000012') <> 1 THEN
    RAISE EXCEPTION 'M66 spec FAIL: la fila cross-tenant no quedó persistida';
  END IF;
  RAISE NOTICE 'M65/M66 spec OK';
END $$;

-- Restaurar auth.uid() a NULL (estado de CI) para specs posteriores.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
