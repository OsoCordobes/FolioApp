-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M88 spec · paciente_cuenta_ensure() — provisioning de primera sesión 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- Prueba el provisioning de la identidad del portal (fix del bloqueante: nada
-- creaba filas paciente_cuenta ⇒ ningún paciente entraba jamás). La función es
-- SECURITY DEFINER y toma TODO de la sesión (auth.uid() → auth.users), así que
-- se la LLAMA bajo `SET LOCAL ROLE authenticated` con auth.uid() overrideado
-- (patrón M87). Las verificaciones de efecto se leen como SUPERUSER (RESET
-- ROLE): la unidad bajo prueba es la FUNCIÓN, no la RLS de lectura.
--
--   N0. Sin sesión (auth.uid() NULL, default del CI) → NULL y 0 filas creadas.
--   P1. Con sesión → crea EXACTAMENTE 1 fila: auth_user_id correcto, email
--       LOWERCASED del auth.users del PROPIO uid (verdad del server),
--       email_verificado_en copiado de email_confirmed_at.
--   P2. Idempotente: 2da llamada devuelve el MISMO id; sigue habiendo 1 fila.
--   N1. Soft-deleted: con la cuenta dada de baja (deleted_at) → NULL, NO la
--       resucita ni crea una segunda fila.
--   N2. ACL: anon SIN EXECUTE (y PUBLIC revocado — anon sólo hereda de PUBLIC);
--       authenticated CON EXECUTE.
--
-- UUIDs fijos (bloque …88x):
--   user titular = …88a1 (email MiXeD-CaSe para probar el lower())
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Fixtures (superuser → bypass RLS) ──────────────────────────────────────
DO $$
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('a1880000-0000-4000-8000-0000000088a1', 'M88-Titular@Spec.Test', now())
  ON CONFLICT (id) DO NOTHING;
  RAISE NOTICE 'M88 spec · fixtures listos';
END $$;

GRANT USAGE ON SCHEMA public TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- N0. Sin sesión (auth.uid() NULL — default del stub CI) → NULL y 0 filas.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_id uuid; v_count int;
BEGIN
  SET LOCAL ROLE authenticated;
  v_id := public.paciente_cuenta_ensure();
  RESET ROLE;
  IF v_id IS NOT NULL THEN
    RAISE EXCEPTION 'M88 FAIL N0: sin auth.uid() debió devolver NULL (id=%)', v_id;
  END IF;
  SELECT count(*) INTO v_count FROM paciente_cuenta WHERE email LIKE 'm88-%';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'M88 FAIL N0: sin auth.uid() no debió crear filas (count=%)', v_count;
  END IF;
  RAISE NOTICE 'M88 spec · N0 OK: sin sesión → NULL, sin filas';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- P1. Con sesión → crea 1 fila con el email lowercased del auth.users correcto.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1880000-0000-4000-8000-0000000088a1'::uuid $$;

DO $$
DECLARE v_id uuid; v_count int; v_email text; v_auth uuid; v_verif timestamptz;
BEGIN
  SET LOCAL ROLE authenticated;
  v_id := public.paciente_cuenta_ensure();
  RESET ROLE;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'M88 FAIL P1: con sesión debió crear/devolver una cuenta (NULL)';
  END IF;

  SELECT count(*) INTO v_count
    FROM paciente_cuenta
   WHERE auth_user_id = 'a1880000-0000-4000-8000-0000000088a1';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'M88 FAIL P1: debió existir EXACTAMENTE 1 fila (count=%)', v_count;
  END IF;

  SELECT email, auth_user_id, email_verificado_en INTO v_email, v_auth, v_verif
    FROM paciente_cuenta WHERE id = v_id;
  IF v_auth <> 'a1880000-0000-4000-8000-0000000088a1' THEN
    RAISE EXCEPTION 'M88 FAIL P1: auth_user_id incorrecto (%)', v_auth;
  END IF;
  IF v_email <> 'm88-titular@spec.test' THEN
    RAISE EXCEPTION 'M88 FAIL P1: email debió ser el de auth.users LOWERCASED (email=%)', v_email;
  END IF;
  IF v_verif IS NULL THEN
    RAISE EXCEPTION 'M88 FAIL P1: email_verificado_en debió copiarse de email_confirmed_at';
  END IF;
  RAISE NOTICE 'M88 spec · P1 OK: primera sesión crea la cuenta (email server-truth, lowercased)';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- P2. Idempotente: 2da llamada devuelve el MISMO id; sigue habiendo 1 fila.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_first uuid; v_second uuid; v_count int;
BEGIN
  SELECT id INTO v_first
    FROM paciente_cuenta
   WHERE auth_user_id = 'a1880000-0000-4000-8000-0000000088a1';

  SET LOCAL ROLE authenticated;
  v_second := public.paciente_cuenta_ensure();
  RESET ROLE;

  IF v_second IS DISTINCT FROM v_first THEN
    RAISE EXCEPTION 'M88 FAIL P2: la 2da llamada devolvió otro id (% ≠ %)', v_second, v_first;
  END IF;
  SELECT count(*) INTO v_count
    FROM paciente_cuenta
   WHERE auth_user_id = 'a1880000-0000-4000-8000-0000000088a1';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'M88 FAIL P2: no debió crear una 2da fila (count=%)', v_count;
  END IF;
  RAISE NOTICE 'M88 spec · P2 OK: idempotente (mismo id, 1 sola fila)';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- N1. Soft-deleted: la baja explícita NO se resucita → NULL, sigue 1 sola fila.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_id uuid; v_count int; v_deleted timestamptz;
BEGIN
  UPDATE paciente_cuenta SET deleted_at = now()
   WHERE auth_user_id = 'a1880000-0000-4000-8000-0000000088a1';

  SET LOCAL ROLE authenticated;
  v_id := public.paciente_cuenta_ensure();
  RESET ROLE;

  IF v_id IS NOT NULL THEN
    RAISE EXCEPTION 'M88 FAIL N1: una cuenta soft-deleted no debe resucitar (id=%)', v_id;
  END IF;
  SELECT count(*) INTO v_count
    FROM paciente_cuenta
   WHERE auth_user_id = 'a1880000-0000-4000-8000-0000000088a1';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'M88 FAIL N1: no debió crearse una fila nueva junto a la dada de baja (count=%)', v_count;
  END IF;
  SELECT deleted_at INTO v_deleted
    FROM paciente_cuenta
   WHERE auth_user_id = 'a1880000-0000-4000-8000-0000000088a1';
  IF v_deleted IS NULL THEN
    RAISE EXCEPTION 'M88 FAIL N1: la baja no debió revertirse (deleted_at quedó NULL)';
  END IF;
  RAISE NOTICE 'M88 spec · N1 OK: la cuenta dada de baja no se resucita ni se duplica';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- N2. ACL: anon SIN EXECUTE (PUBLIC revocado ⇒ anon no hereda); authenticated SÍ.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.paciente_cuenta_ensure()', 'EXECUTE') THEN
    RAISE EXCEPTION 'M88 FAIL N2: anon NO debe tener EXECUTE sobre paciente_cuenta_ensure';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.paciente_cuenta_ensure()', 'EXECUTE') THEN
    RAISE EXCEPTION 'M88 FAIL N2: authenticated DEBE tener EXECUTE sobre paciente_cuenta_ensure';
  END IF;
  RAISE NOTICE 'M88 spec · N2 OK: EXECUTE sólo authenticated (anon/PUBLIC revocados)';
END $$;

-- ─── Restaurar auth.uid() a NULL (estado de CI) ─────────────────────────────
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

DO $$ BEGIN RAISE NOTICE 'M88 spec PASS · provisioning de primera sesión verificado (server-truth email + idempotencia + no-resurrección + ACL)'; END $$;
