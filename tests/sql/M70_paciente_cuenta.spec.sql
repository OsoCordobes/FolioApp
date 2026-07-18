-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M70 spec · paciente_cuenta + cuenta_id + email_hash + paciente_claim
-- ════════════════════════════════════════════════════════════════════════════
-- Verifica (estructura + replay; el aislamiento RLS dos-pacientes/dos-tenant real
-- necesita `supabase start` con JWTs y llega en P2/M71 · CI-gated):
--   1. Columnas/tablas nuevas existen: paciente_cuenta(*), paciente.cuenta_id,
--      paciente_identidad.email_hash, paciente_claim(*).
--   2. CHECKs: paciente_cuenta.email debe ser lowercase; telefono_hash/email_hash
--      deben ser 64-hex si no NULL; paciente_claim.estado ∈ {pendiente,aprobado,
--      rechazado}.
--   3. FK 1:1: auth_user_id UNIQUE (segunda cuenta con el mismo user auth →
--      unique_violation).
--   4. same-org guard de paciente_claim: paciente de otra org → el trigger
--      rechaza.
--   5. RLS FORCE + estado FINAL de policies del stack (post-M71..M87):
--      paciente_cuenta sigue CERRADA (CERO policies — el acceso sancionado es
--      SOLO vía funciones DEFINER: paciente_cuenta_actual M70,
--      listar_paciente_claims_pendientes M87); paciente_claim tiene EXACTAMENTE
--      las 4 policies de M71 (self-select/self-insert del paciente +
--      select/update del clínico), PERMISSIVE sobre public, y NINGUNA de
--      DELETE/ALL (cola append-only).
--   5b. paciente_cuenta NO tiene audit trigger (es cross-org, sin
--      organization_id → el trigger genérico de M12 abortaría con 42703, el bug
--      de M48/`pago`). paciente_claim SÍ lo tiene (tiene organization_id).
--   6. Helper paciente_cuenta_actual() existe, es SECURITY DEFINER + STABLE, y
--      devuelve NULL cuando auth.uid() es NULL (CI sin JWT).
--   7. Erasure: pseudonimizar_paciente (service_role) DESVINCULA cuenta_id (lo
--      pone NULL) y lo reporta en el jsonb; el resto de la cadena sigue intacto.
--
-- Fixtures como superuser (bypass RLS), patrón M60/M63/M72/M73 specs. auth.uid() =
-- NULL en este CI ⇒ la rama de erasure testeable es la service_role (set_config
-- del GUC de rol, como en M63/M73).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. columnas/tablas existen ───────────────────────────────────────────────
DO $$
DECLARE
  cuenta_cols text[] := ARRAY[
    'id','auth_user_id','email','email_verificado_en','telefono_hash',
    'telefono_verificado_en','deleted_at','created_at','updated_at'
  ];
  claim_cols text[] := ARRAY[
    'id','organization_id','paciente_cuenta_id','paciente_id','estado',
    'resolved_by','resolved_at','created_at','updated_at'
  ];
  c text;
BEGIN
  FOREACH c IN ARRAY cuenta_cols LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name = 'paciente_cuenta' AND column_name = c) THEN
      RAISE EXCEPTION 'M70 spec FAIL: columna paciente_cuenta.% ausente', c;
    END IF;
  END LOOP;
  FOREACH c IN ARRAY claim_cols LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name = 'paciente_claim' AND column_name = c) THEN
      RAISE EXCEPTION 'M70 spec FAIL: columna paciente_claim.% ausente', c;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'paciente' AND column_name = 'cuenta_id') THEN
    RAISE EXCEPTION 'M70 spec FAIL: paciente.cuenta_id ausente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'paciente_identidad' AND column_name = 'email_hash') THEN
    RAISE EXCEPTION 'M70 spec FAIL: paciente_identidad.email_hash ausente';
  END IF;
  RAISE NOTICE 'M70 spec OK (1/7): columnas/tablas presentes';
END $$;

-- ─── 2. CHECKs (email lowercase, hex de hashes, estado del claim) ─────────────
DO $$
DECLARE
  v_uid    uuid := gen_random_uuid();
  v_caught boolean;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_uid, 'M70-Check@Example.com');

  -- email en mayúsculas → CHECK paciente_cuenta_email_lower falla.
  v_caught := false;
  BEGIN
    INSERT INTO paciente_cuenta (auth_user_id, email) VALUES (v_uid, 'M70-Check@Example.com');
  EXCEPTION WHEN check_violation THEN v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M70 spec FAIL: email no-lowercase no fue bloqueado';
  END IF;

  -- lowercase OK.
  INSERT INTO paciente_cuenta (auth_user_id, email) VALUES (v_uid, 'm70-check@example.com');

  -- telefono_hash no-hex → CHECK falla.
  v_caught := false;
  BEGIN
    UPDATE paciente_cuenta SET telefono_hash = 'no-es-hex' WHERE auth_user_id = v_uid;
  EXCEPTION WHEN check_violation THEN v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M70 spec FAIL: telefono_hash no-hex no fue bloqueado';
  END IF;

  -- telefono_hash hex de 64 chars OK.
  UPDATE paciente_cuenta SET telefono_hash = repeat('a', 64) WHERE auth_user_id = v_uid;

  RAISE NOTICE 'M70 spec OK (2/7): CHECKs de email/hex';
END $$;

-- estado del claim inválido → CHECK falla.
DO $$
DECLARE
  v_org   uuid := gen_random_uuid();
  v_uid   uuid := gen_random_uuid();
  v_cta   uuid := gen_random_uuid();
  v_pac   uuid := gen_random_uuid();
  v_caught boolean;
BEGIN
  INSERT INTO organization (id, slug, nombre)
    VALUES (v_org, 'm70-estado-' || substr(md5(random()::text), 1, 12), 'M70 Estado');
  INSERT INTO auth.users (id, email) VALUES (v_uid, 'm70-estado@example.com');
  INSERT INTO paciente_cuenta (id, auth_user_id, email) VALUES (v_cta, v_uid, 'm70-estado@example.com');
  INSERT INTO paciente (id, organization_id) VALUES (v_pac, v_org);

  v_caught := false;
  BEGIN
    INSERT INTO paciente_claim (organization_id, paciente_cuenta_id, paciente_id, estado)
      VALUES (v_org, v_cta, v_pac, 'quiensabe');
  EXCEPTION WHEN check_violation THEN v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M70 spec FAIL: estado de claim inválido no fue bloqueado';
  END IF;

  -- estado válido OK (default pendiente y explícito aprobado).
  INSERT INTO paciente_claim (organization_id, paciente_cuenta_id, paciente_id)
    VALUES (v_org, v_cta, v_pac);

  RAISE NOTICE 'M70 spec OK (3/7): CHECK de estado del claim';
END $$;

-- ─── 4. FK 1:1 (auth_user_id UNIQUE) ──────────────────────────────────────────
DO $$
DECLARE
  v_uid    uuid := gen_random_uuid();
  v_caught boolean;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_uid, 'm70-uniq@example.com');
  INSERT INTO paciente_cuenta (auth_user_id, email) VALUES (v_uid, 'm70-uniq@example.com');

  v_caught := false;
  BEGIN
    INSERT INTO paciente_cuenta (auth_user_id, email) VALUES (v_uid, 'm70-uniq2@example.com');
  EXCEPTION WHEN unique_violation THEN v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M70 spec FAIL: segunda cuenta con el mismo auth_user_id no fue bloqueada';
  END IF;

  RAISE NOTICE 'M70 spec OK (4/7): auth_user_id UNIQUE (1:1 con auth.users)';
END $$;

-- ─── 5. same-org guard de paciente_claim ──────────────────────────────────────
DO $$
DECLARE
  v_orgA   uuid := gen_random_uuid();
  v_orgB   uuid := gen_random_uuid();
  v_uid    uuid := gen_random_uuid();
  v_cta    uuid := gen_random_uuid();
  v_pacB   uuid := gen_random_uuid();
  v_caught boolean;
BEGIN
  INSERT INTO organization (id, slug, nombre)
    VALUES (v_orgA, 'm70-a-' || substr(md5(random()::text), 1, 12), 'M70 Org A'),
           (v_orgB, 'm70-b-' || substr(md5(random()::text), 1, 12), 'M70 Org B');
  INSERT INTO auth.users (id, email) VALUES (v_uid, 'm70-sameorg@example.com');
  INSERT INTO paciente_cuenta (id, auth_user_id, email) VALUES (v_cta, v_uid, 'm70-sameorg@example.com');
  INSERT INTO paciente (id, organization_id) VALUES (v_pacB, v_orgB);

  -- claim con org A pero paciente de B → same_org_guard falla.
  v_caught := false;
  BEGIN
    INSERT INTO paciente_claim (organization_id, paciente_cuenta_id, paciente_id)
      VALUES (v_orgA, v_cta, v_pacB);
  EXCEPTION WHEN others THEN
    v_caught := true;
    IF sqlerrm NOT LIKE '%debe coincidir en org%' THEN
      RAISE EXCEPTION 'M70 spec FAIL: mensaje inesperado en same-org guard: %', sqlerrm;
    END IF;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M70 spec FAIL: claim con paciente de otra org no fue rechazado';
  END IF;

  RAISE NOTICE 'M70 spec OK (5/7): same-org guard de paciente_claim';
END $$;

-- ─── 6. RLS FORCE + policies del estado FINAL + helper SECURITY DEFINER STABLE ─
-- El CI replaya TODA la cadena de migraciones antes de correr los specs, así que
-- acá se asevera el estado FINAL post-M71..M87 (no el estado intermedio de M70):
--   · paciente_cuenta sigue CERRADA (0 policies): es la identidad de LOGIN
--     cross-org; nadie la lee por RLS. El único acceso sancionado es vía
--     funciones SECURITY DEFINER (paciente_cuenta_actual M70,
--     listar_paciente_claims_pendientes M87).
--   · paciente_claim tiene EXACTAMENTE las 4 policies que define M71 —
--     self-select/self-insert del paciente (self-scope por
--     paciente_cuenta_actual()) + select/update del clínico (gate
--     can_read_clinical) — todas PERMISSIVE sobre public. M84-M87 no agregan
--     ninguna, y NUNCA debe existir DELETE/ALL (cola append-only: los claims se
--     resuelven por estado, no se borran).
DO $$
DECLARE
  t     text;
  v_cnt int;
BEGIN
  FOREACH t IN ARRAY ARRAY['paciente_cuenta','paciente_claim'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class
      WHERE relname = t AND relrowsecurity = true AND relforcerowsecurity = true
    ) THEN
      RAISE EXCEPTION 'M70 spec FAIL: RLS no está ENABLE + FORCE en %', t;
    END IF;
  END LOOP;

  -- paciente_cuenta: CERRADA también en el estado final (M71..M87 no le agregan
  -- policies a propósito).
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'paciente_cuenta') THEN
    RAISE EXCEPTION 'M70 spec FAIL: paciente_cuenta tiene policies (debe seguir cerrada; el acceso sancionado es sólo vía funciones DEFINER)';
  END IF;

  -- paciente_claim: exactamente las 4 policies de M71, con nombre + comando +
  -- PERMISSIVE + rol public + la guarda medular en su expresión.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'paciente_claim'
      AND policyname = 'paciente_claim_select_portal' AND cmd = 'SELECT'
      AND permissive = 'PERMISSIVE' AND array_to_string(roles, ',') = 'public'
      AND qual LIKE '%paciente_cuenta_actual%'
  ) THEN
    RAISE EXCEPTION 'M70 spec FAIL: falta paciente_claim_select_portal (SELECT, self-scope por paciente_cuenta_actual) — M71';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'paciente_claim'
      AND policyname = 'paciente_claim_insert_portal' AND cmd = 'INSERT'
      AND permissive = 'PERMISSIVE' AND array_to_string(roles, ',') = 'public'
      AND with_check LIKE '%paciente_cuenta_actual%'
      AND with_check LIKE '%pendiente%'
  ) THEN
    RAISE EXCEPTION 'M70 spec FAIL: falta paciente_claim_insert_portal (INSERT, self-scope + estado pendiente) — M71';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'paciente_claim'
      AND policyname = 'paciente_claim_select_clinical' AND cmd = 'SELECT'
      AND permissive = 'PERMISSIVE' AND array_to_string(roles, ',') = 'public'
      AND qual LIKE '%can_read_clinical%'
  ) THEN
    RAISE EXCEPTION 'M70 spec FAIL: falta paciente_claim_select_clinical (SELECT, gate can_read_clinical) — M71';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'paciente_claim'
      AND policyname = 'paciente_claim_update_clinical' AND cmd = 'UPDATE'
      AND permissive = 'PERMISSIVE' AND array_to_string(roles, ',') = 'public'
      AND qual LIKE '%can_read_clinical%'
      AND with_check LIKE '%can_read_clinical%'
  ) THEN
    RAISE EXCEPTION 'M70 spec FAIL: falta paciente_claim_update_clinical (UPDATE, gate can_read_clinical en USING y WITH CHECK) — M71';
  END IF;

  -- Ni una policy más que esas 4 (una quinta = superficie no revisada).
  SELECT count(*) INTO v_cnt FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'paciente_claim';
  IF v_cnt <> 4 THEN
    RAISE EXCEPTION 'M70 spec FAIL: paciente_claim tiene % policies (esperadas EXACTAMENTE las 4 de M71)', v_cnt;
  END IF;

  -- Y NUNCA DELETE/ALL: la cola de claims es append-only (se resuelve por estado).
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'paciente_claim' AND cmd IN ('DELETE','ALL')
  ) THEN
    RAISE EXCEPTION 'M70 spec FAIL: paciente_claim tiene una policy DELETE/ALL (cola append-only: prohibido)';
  END IF;

  -- Helper existe, SECURITY DEFINER (prosecdef) + STABLE (provolatile='s').
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'paciente_cuenta_actual'
      AND pronamespace = 'public'::regnamespace
      AND prosecdef = true
      AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION 'M70 spec FAIL: paciente_cuenta_actual() no es SECURITY DEFINER + STABLE';
  END IF;

  -- Sin JWT (auth.uid() NULL en CI) devuelve NULL.
  IF public.paciente_cuenta_actual() IS NOT NULL THEN
    RAISE EXCEPTION 'M70 spec FAIL: paciente_cuenta_actual() no devolvió NULL sin auth.uid()';
  END IF;

  RAISE NOTICE 'M70 spec OK (6/7): RLS FORCE + paciente_cuenta cerrada + las 4 policies M71 de paciente_claim + helper DEFINER/STABLE';
END $$;

-- ─── 6b. paciente_cuenta NO tiene audit trigger; el ciclo de vida no aborta ───
-- Regresión del bug [fase3-P1-review]: el trigger genérico audit_log_trigger()
-- lee NEW.organization_id, que paciente_cuenta NO tiene (cross-org) → 42703 en
-- cada INSERT/UPDATE/DELETE (el bug de M48/`pago`). El fix es NO colgar el
-- trigger genérico. Verificamos: (a) paciente_cuenta no tiene trigger de audit;
-- (b) INSERT + UPDATE + DELETE completos NO abortan; (c) paciente_claim SÍ tiene
-- su trigger (tiene organization_id, es org-scoped).
DO $$
DECLARE
  v_uid  uuid := gen_random_uuid();
  v_cnt  int;
BEGIN
  -- (a) ningún trigger que ejecute audit_log_trigger() sobre paciente_cuenta.
  SELECT count(*) INTO v_cnt
    FROM pg_trigger tg
    JOIN pg_class c   ON c.oid = tg.tgrelid
    JOIN pg_proc  p   ON p.oid = tg.tgfoid
   WHERE c.relname = 'paciente_cuenta'
     AND NOT tg.tgisinternal
     AND p.proname = 'audit_log_trigger';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'M70 spec FAIL (6b): paciente_cuenta tiene el trigger genérico audit_log_trigger() (% ) — abortaría con 42703 (bug M48)', v_cnt;
  END IF;

  -- (b) el ciclo de vida completo NO aborta (sin el trigger no hay 42703).
  INSERT INTO auth.users (id, email) VALUES (v_uid, 'm70-audit@example.com');
  INSERT INTO paciente_cuenta (auth_user_id, email) VALUES (v_uid, 'm70-audit@example.com');
  UPDATE paciente_cuenta SET email_verificado_en = now() WHERE auth_user_id = v_uid;
  DELETE FROM paciente_cuenta WHERE auth_user_id = v_uid;

  -- (c) paciente_claim SÍ conserva su trigger genérico (tiene organization_id).
  SELECT count(*) INTO v_cnt
    FROM pg_trigger tg
    JOIN pg_class c   ON c.oid = tg.tgrelid
    JOIN pg_proc  p   ON p.oid = tg.tgfoid
   WHERE c.relname = 'paciente_claim'
     AND NOT tg.tgisinternal
     AND p.proname = 'audit_log_trigger';
  IF v_cnt < 1 THEN
    RAISE EXCEPTION 'M70 spec FAIL (6b): paciente_claim perdió su trigger de audit (tiene organization_id, debe auditarse)';
  END IF;

  RAISE NOTICE 'M70 spec OK (6b): paciente_cuenta sin audit trigger (ciclo de vida no aborta); paciente_claim conserva el suyo';
END $$;

-- ─── 7. erasure: pseudonimizar_paciente DESVINCULA cuenta_id ──────────────────
DO $$
DECLARE
  v_org    uuid := gen_random_uuid();
  v_ident  uuid := gen_random_uuid();
  v_pac    uuid := gen_random_uuid();
  v_uid    uuid := gen_random_uuid();
  v_cta    uuid := gen_random_uuid();
  v_res    jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  INSERT INTO organization (id, slug, nombre)
    VALUES (v_org, 'm70-erase-' || substr(md5(random()::text), 1, 12), 'M70 Erase Spec');
  INSERT INTO auth.users (id, email) VALUES (v_uid, 'm70-erase@example.com');
  INSERT INTO paciente_cuenta (id, auth_user_id, email) VALUES (v_cta, v_uid, 'm70-erase@example.com');
  INSERT INTO paciente_identidad
    (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash, nombre_hash, email_hash)
    VALUES (v_ident, v_org, '\x01'::bytea, '\x02'::bytea, '\x03'::bytea,
            repeat('e', 64), repeat('f', 64), repeat('a', 64));
  -- paciente linkeado a la cuenta portal.
  INSERT INTO paciente (id, organization_id, identidad_id, cuenta_id)
    VALUES (v_pac, v_org, v_ident, v_cta);

  -- dry-run reporta el link a desvincular.
  v_res := public.pseudonimizar_paciente(v_pac, 'M70 spec erasure dry-run', true);
  IF (v_res ->> 'cuenta_link_a_desvincular')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'M70 spec FAIL: dry_run cuenta_link_a_desvincular = % (esperado true)',
      v_res ->> 'cuenta_link_a_desvincular';
  END IF;

  -- ejecución real: nullea cuenta_id y lo reporta.
  v_res := public.pseudonimizar_paciente(v_pac, 'M70 spec erasure real', false);
  IF (v_res ->> 'cuenta_link_desvinculado')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'M70 spec FAIL: cuenta_link_desvinculado = % (esperado true)',
      v_res ->> 'cuenta_link_desvinculado';
  END IF;
  IF (SELECT cuenta_id FROM paciente WHERE id = v_pac) IS NOT NULL THEN
    RAISE EXCEPTION 'M70 spec FAIL: cuenta_id no quedó NULL tras la erasure';
  END IF;
  -- La cuenta portal NO se borra (es cross-org).
  IF NOT EXISTS (SELECT 1 FROM paciente_cuenta WHERE id = v_cta) THEN
    RAISE EXCEPTION 'M70 spec FAIL: la paciente_cuenta se borró (no debe: es cross-org)';
  END IF;
  -- La identidad sí se borró (cadena existente intacta).
  IF EXISTS (SELECT 1 FROM paciente_identidad WHERE id = v_ident) THEN
    RAISE EXCEPTION 'M70 spec FAIL: paciente_identidad no se borró (cadena de erasure rota)';
  END IF;

  RAISE NOTICE 'M70 spec OK (7/7): erasure desvincula cuenta_id sin borrar la cuenta';
END $$;
