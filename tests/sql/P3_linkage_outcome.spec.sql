-- ════════════════════════════════════════════════════════════════════════════
-- Folio · P3 spec · linkage outcome del portal (auth + matcher · Fase 3) 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- P3 NO trae migración (es auth + código: /portal, middleware, matcher). Pero el
-- matcher (lib/portal/link-actions.ts, service_role AUDITADO) se apoya en un
-- CONTRATO de la DB que sí es verificable en pgtap: el efecto de sus ESCRITURAS.
--
-- Este spec prueba, corriendo como el rol `authenticated` con auth.uid() = una
-- cuenta de paciente (la RLS con FORCE no aplica a superusers), el OUTCOME que el
-- matcher produce:
--
--   L1 (AUTO-LINK visible): una ficha SIN cuenta (cuenta_id NULL) es INVISIBLE
--      para la cuenta del paciente (RLS M71). Cuando el matcher setea
--      paciente.cuenta_id = <mi cuenta> (lo que hace en auto-link de alta
--      confianza), la MISMA ficha pasa a ser VISIBLE. Esto valida que el efecto
--      del matcher se materializa exactamente en el fan-out de M71.
--
--   L2 (CLAIM self-insert): el paciente puede ENCOLAR un claim A SU PROPIA cuenta
--      en estado 'pendiente' (policy paciente_claim_insert_portal, M71) — es el
--      camino por el que un ambiguo pide vinculación.
--
--   L3 (CLAIM no self-approve / no otra-cuenta): el paciente NO puede insertar un
--      claim a la cuenta de OTRO (WITH CHECK exige paciente_cuenta_id = la suya),
--      ni encolarlo ya 'aprobado' (WITH CHECK exige 'pendiente'): el auto-aprobado
--      queda estructuralmente fuera de su alcance (gate anti-impersonación).
--
--   L4 (matcher NUNCA mergea): sanity de que el link es sólo un UPDATE de
--      cuenta_id (no se tocó identidad_id ni se creó/borró fila paciente) — el
--      matcher linkea, no mergea. Se comprueba como superuser tras el auto-link.
--
-- Mecánica CI (pgtap.yml): igual que M51/M65/M71 — fixtures como superuser →
-- override de auth.uid() → GRANTs mínimos a `authenticated` → SET ROLE. Los
-- helpers paciente_cuenta_actual()/paciente_owns() son SECURITY DEFINER ⇒
-- funcionan bajo el rol bajado. Se restaura auth.uid() a NULL al final.
--
-- Nota honesta: el matcher en sí (recompute de blind indexes por org, decisión
-- auto-link vs claim) se testea en unit puro (tests/unit/portal-matcher.test.ts) —
-- no toca DB. Este spec cubre el CONTRATO DB del que depende el matcher (que su
-- UPDATE de cuenta_id cambia el fan-out RLS, y que el paciente no puede
-- auto-aprobarse). El E2E de auto-link real (magic-link → callback → matcher con
-- JWTs reales) NO es autónomo acá y queda declarado en caveats.
--
-- UUIDs fijos (prefijo p3…):
--   Org A = …0a1        auth cuenta X = …0a2 · cuenta X = …0c2
--   auth cuenta Z = …0a4 · cuenta Z = …0c4 (segundo paciente, para el negativo L3)
--   ficha a auto-linkear (arranca cuenta_id NULL) = …0d1 · identidad = …0e1
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Fixtures (superuser → bypass RLS) ──────────────────────────────────────
DO $$
BEGIN
  -- limpieza idempotente
  DELETE FROM paciente_claim WHERE paciente_cuenta_id IN (
    'c3000000-0000-4000-8000-0000000000c2', 'c3000000-0000-4000-8000-0000000000c4');
  DELETE FROM paciente          WHERE id = 'd3000000-0000-4000-8000-0000000000d1';
  DELETE FROM paciente_identidad WHERE id = 'e3000000-0000-4000-8000-0000000000e1';

  INSERT INTO auth.users (id, email) VALUES
    ('a3000000-0000-4000-8000-0000000000a2', 'p3-pac-x@spec.test'),
    ('a3000000-0000-4000-8000-0000000000a4', 'p3-pac-z@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization (id, slug, nombre, tipo) VALUES
    ('a3000000-0000-4000-8000-0000000000a1', 'p3-org-a', 'P3 Org A', 'INDEPENDIENTE')
  ON CONFLICT (id) DO NOTHING;

  -- Dos cuentas portal: X (la que se auto-linkea) y Z (para el negativo de claim
  -- cross-cuenta).
  INSERT INTO paciente_cuenta (id, auth_user_id, email) VALUES
    ('c3000000-0000-4000-8000-0000000000c2', 'a3000000-0000-4000-8000-0000000000a2', 'p3-pac-x@spec.test'),
    ('c3000000-0000-4000-8000-0000000000c4', 'a3000000-0000-4000-8000-0000000000a4', 'p3-pac-z@spec.test')
  ON CONFLICT (id) DO NOTHING;

  -- Identidad + ficha de X en A, ARRANCA SIN cuenta linkeada (cuenta_id NULL):
  -- ése es el estado "pre auto-link" que el matcher va a resolver.
  INSERT INTO paciente_identidad
    (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado,
     dni_hash, nombre_hash, telefono_hash, email_hash) VALUES
    ('e3000000-0000-4000-8000-0000000000e1', 'a3000000-0000-4000-8000-0000000000a1',
     '\x01'::bytea, '\x02'::bytea, '\x03'::bytea,
     repeat('1', 64), repeat('a', 64), repeat('b', 64), repeat('c', 64))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente (id, organization_id, identidad_id, cuenta_id) VALUES
    ('d3000000-0000-4000-8000-0000000000d1', 'a3000000-0000-4000-8000-0000000000a1',
     'e3000000-0000-4000-8000-0000000000e1', NULL)
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'P3 spec · fixtures listos';
END $$;

-- Grants mínimos para ejercer RLS como `authenticated` (en Supabase real ya
-- existen; en CI vanilla el rol nace sin nada).
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON paciente, paciente_identidad TO authenticated;
GRANT SELECT, INSERT ON paciente_claim TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- L1 · PRE auto-link: la ficha (cuenta_id NULL) es INVISIBLE para la cuenta X
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a3000000-0000-4000-8000-0000000000a2'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int;
BEGIN
  -- La cuenta se resuelve por auth.uid().
  IF public.paciente_cuenta_actual() <> 'c3000000-0000-4000-8000-0000000000c2'::uuid THEN
    RAISE EXCEPTION 'P3 FAIL L1: paciente_cuenta_actual() no resolvió la cuenta X';
  END IF;

  -- Ficha SIN link → invisible (RLS M71: cuenta_id = paciente_cuenta_actual()).
  SELECT count(*) INTO v FROM paciente WHERE id = 'd3000000-0000-4000-8000-0000000000d1';
  IF v <> 0 THEN
    RAISE EXCEPTION 'P3 FAIL L1: la ficha sin link ya era visible (count=%) — debería ser invisible pre auto-link', v;
  END IF;
  IF public.paciente_owns('d3000000-0000-4000-8000-0000000000d1') THEN
    RAISE EXCEPTION 'P3 FAIL L1: paciente_owns(ficha sin link) = true (debería ser false)';
  END IF;

  RAISE NOTICE 'P3 spec · L1 OK: ficha sin cuenta invisible para el paciente (pre auto-link)';
END $$;

RESET ROLE;

-- ── El matcher (service_role) setea cuenta_id = cuenta X. Acá lo simulamos como
--    superuser (BYPASSRLS), que es lo que hace el orchestrator con el service
--    client. Guard cuenta_id IS NULL espeja el UPDATE real (no pisa un link de
--    carrera).
UPDATE paciente
   SET cuenta_id = 'c3000000-0000-4000-8000-0000000000c2'
 WHERE id = 'd3000000-0000-4000-8000-0000000000d1'
   AND cuenta_id IS NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- L1 (cont.) · POST auto-link: la MISMA ficha ahora es VISIBLE para la cuenta X
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a3000000-0000-4000-8000-0000000000a2'::uuid $$;

SET ROLE authenticated;

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM paciente WHERE id = 'd3000000-0000-4000-8000-0000000000d1';
  IF v <> 1 THEN
    RAISE EXCEPTION 'P3 FAIL L1: la ficha auto-linkeada NO es visible (count=%) — el UPDATE de cuenta_id debe cambiar el fan-out', v;
  END IF;
  -- Y su identidad también (M71 paciente_identidad_select_portal cuelga de la
  -- ficha ya visible).
  SELECT count(*) INTO v FROM paciente_identidad WHERE id = 'e3000000-0000-4000-8000-0000000000e1';
  IF v <> 1 THEN
    RAISE EXCEPTION 'P3 FAIL L1: la identidad de la ficha auto-linkeada NO es visible (count=%)', v;
  END IF;
  IF NOT public.paciente_owns('d3000000-0000-4000-8000-0000000000d1') THEN
    RAISE EXCEPTION 'P3 FAIL L1: paciente_owns(ficha auto-linkeada) = false';
  END IF;

  RAISE NOTICE 'P3 spec · L1 OK: auto-link (UPDATE cuenta_id) vuelve la ficha visible por RLS';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- L2 · CLAIM self-insert (pendiente, a mi cuenta) — permitido por M71
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v int;
BEGIN
  -- El paciente encola un claim propio (mismo paciente, otra vez, no importa: es
  -- el path de "pedime vinculación"). paciente_cuenta_id = su cuenta, pendiente.
  INSERT INTO paciente_claim (organization_id, paciente_cuenta_id, paciente_id)
    VALUES ('a3000000-0000-4000-8000-0000000000a1',
            'c3000000-0000-4000-8000-0000000000c2',
            'd3000000-0000-4000-8000-0000000000d1');
  SELECT count(*) INTO v FROM paciente_claim
   WHERE paciente_cuenta_id = 'c3000000-0000-4000-8000-0000000000c2'
     AND paciente_id = 'd3000000-0000-4000-8000-0000000000d1'
     AND estado = 'pendiente';
  IF v <> 1 THEN
    RAISE EXCEPTION 'P3 FAIL L2: el self-insert de claim pendiente no quedó (count=%)', v;
  END IF;
  RAISE NOTICE 'P3 spec · L2 OK: el paciente puede encolar un claim propio pendiente';
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- L3 · CLAIM negativo: NO a la cuenta de OTRO, NO ya 'aprobado'
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_caught boolean;
BEGIN
  -- (a) claim a la cuenta de Z (no la mía) → WITH CHECK
  --     (paciente_cuenta_id = paciente_cuenta_actual()) lo rechaza.
  v_caught := false;
  BEGIN
    INSERT INTO paciente_claim (organization_id, paciente_cuenta_id, paciente_id)
      VALUES ('a3000000-0000-4000-8000-0000000000a1',
              'c3000000-0000-4000-8000-0000000000c4',   -- cuenta de Z
              'd3000000-0000-4000-8000-0000000000d1');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'P3 FAIL L3: el paciente encoló un claim a la cuenta de OTRO (impersonación)';
  END IF;

  -- (b) claim ya 'aprobado' (auto-aprobado) → WITH CHECK (estado = 'pendiente')
  --     lo rechaza.
  v_caught := false;
  BEGIN
    INSERT INTO paciente_claim (organization_id, paciente_cuenta_id, paciente_id, estado)
      VALUES ('a3000000-0000-4000-8000-0000000000a1',
              'c3000000-0000-4000-8000-0000000000c2',
              'd3000000-0000-4000-8000-0000000000d1',
              'aprobado');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'P3 FAIL L3: el paciente encoló un claim ya aprobado (auto-aprobación prohibida)';
  END IF;

  RAISE NOTICE 'P3 spec · L3 OK: el paciente no encola claims de otra cuenta ni auto-aprobados';
END $$;

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- L4 · el matcher NUNCA mergea: el auto-link fue sólo UPDATE de cuenta_id
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_cnt      int;
  v_ident    uuid;
  v_cuenta   uuid;
BEGIN
  -- Sigue existiendo EXACTAMENTE UNA fila paciente (no se creó/borró/mergeó).
  SELECT count(*) INTO v_cnt FROM paciente WHERE id = 'd3000000-0000-4000-8000-0000000000d1';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'P3 FAIL L4: la fila paciente no es única tras el auto-link (count=%)', v_cnt;
  END IF;
  -- identidad_id intacto (no se tocó la PII) y cuenta_id apunta a X.
  SELECT identidad_id, cuenta_id INTO v_ident, v_cuenta
    FROM paciente WHERE id = 'd3000000-0000-4000-8000-0000000000d1';
  IF v_ident <> 'e3000000-0000-4000-8000-0000000000e1'::uuid THEN
    RAISE EXCEPTION 'P3 FAIL L4: el auto-link tocó identidad_id (merge indebido)';
  END IF;
  IF v_cuenta <> 'c3000000-0000-4000-8000-0000000000c2'::uuid THEN
    RAISE EXCEPTION 'P3 FAIL L4: cuenta_id no quedó apuntando a la cuenta X';
  END IF;
  RAISE NOTICE 'P3 spec · L4 OK: el auto-link es un UPDATE de cuenta_id (no mergea filas)';
END $$;

-- Restaurar auth.uid() a NULL para no contaminar specs posteriores (patrón M71).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULL::uuid $$;

DO $$ BEGIN RAISE NOTICE 'P3 spec · TODO OK (L1-L4)'; END $$;
