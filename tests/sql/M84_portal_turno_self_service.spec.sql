-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M84 spec · self-service de turnos del portal (P4) 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- Prueba la frontera de P4 CORRIENDO COMO `authenticated` con auth.uid() = una
-- cuenta de paciente (no superuser — la RLS FORCE no aplica a superusers):
--
--   POSITIVAS (el paciente SÍ puede su self-service acotado):
--     P1. X cancela SU turno CONFIRMADO bien fuera de la ventana (>cutoff) → CANCELADO.
--     P2. X inserta un `pedido` PENDIENTE (reagenda) atado a SU ficha, canal PORTAL.
--
--   NEGATIVAS (la frontera — el paciente NO puede nada más):
--     N1. X NO cancela un turno DENTRO de la ventana de corte (guard 42501).
--     N2. X NO cancela el turno de Y (no es dueño → 0 filas por RLS).
--     N3. X NO puede tocar OTRA columna al "cancelar" (mover inicio → guard 42501).
--     N3a. X NO puede soft-deletear (deleted_at) al cancelar FUERA de la ventana —
--          el exploit del audit: esconder la cancelación de las vistas del staff.
--          Corre ANTES de P1 (necesita f1 vivo y cancelable; sobre un turno dentro
--          de la ventana el bloqueo vendría por la ventana y no ejercería esto).
--     N3b. X NO puede escribir nota_reserva_cifrado (PHI) ni gcal_event_id al
--          cancelar fuera de la ventana (misma fila-completa del guard).
--     N4. X NO puede llevar su turno a un estado != CANCELADO (p.ej. EN_SALA).
--     N5. X NO puede insertar un `pedido` para la ficha de Y (WITH CHECK falla).
--     N6. X NO puede cancelar un turno EN_SALA aunque esté lejísimos (guard: origen).
--
--   REGRESIÓN STAFF:
--     C1. El clínico (member) sigue pudiendo cancelar/reagendar sin que el guard lo
--         toque (early-return por ser member).
--
-- Mecánica CI: fixtures como superuser → override auth.uid() → GRANTs mínimos a
-- `authenticated` → SET ROLE. Los helpers (paciente_owns/paciente_cuenta_actual de
-- M70/M71, portal_cancel_cutoff/user_member_id_in DEFINER) funcionan bajo el rol
-- bajado. Restaura auth.uid() a NULL al final. Honesto: el E2E con JWTs reales
-- sigue siendo la fuente última; este spec ejerce la lógica de las policies M84.
--
-- UUIDs fijos:
--   Org A = …8a1   auth X = …8a2 · cuenta X = …8c2   auth Y = …8a3 · cuenta Y = …8c3
--   auth clínico A = …8aa · member A = …8a5 · servicio A = …8e5
--   pac X en A = …8d1 · identidad …8e1     pac Y en A = …8d3 · identidad …8e3
--   turno X lejano = …8f1 · turno X cercano = …8f2 · turno X EN_SALA = …8f4 · turno Y = …8f3
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Fixtures (superuser → bypass RLS) ──────────────────────────────────────
DO $$
BEGIN
  DELETE FROM pedido WHERE organization_id = 'a1840000-0000-4000-8000-0000000008a1';
  DELETE FROM turno  WHERE id IN (
    'f1840000-0000-4000-8000-0000000008f1','f1840000-0000-4000-8000-0000000008f2',
    'f1840000-0000-4000-8000-0000000008f3','f1840000-0000-4000-8000-0000000008f4');

  INSERT INTO auth.users (id, email) VALUES
    ('a1840000-0000-4000-8000-0000000008a2', 'm84-pac-x@spec.test'),
    ('a1840000-0000-4000-8000-0000000008a3', 'm84-pac-y@spec.test'),
    ('a1840000-0000-4000-8000-0000000008aa', 'm84-clin-a@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO organization (id, slug, nombre, tipo, portal_cancel_cutoff_horas) VALUES
    ('a1840000-0000-4000-8000-0000000008a1', 'm84-org-a', 'M84 Org A', 'INDEPENDIENTE', 24)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente_cuenta (id, auth_user_id, email) VALUES
    ('c1840000-0000-4000-8000-0000000008c2', 'a1840000-0000-4000-8000-0000000008a2', 'm84-pac-x@spec.test'),
    ('c1840000-0000-4000-8000-0000000008c3', 'a1840000-0000-4000-8000-0000000008a3', 'm84-pac-y@spec.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO profile (id, email, consent_pii_signed_at, consent_pii_text_version) VALUES
    ('a1840000-0000-4000-8000-0000000008aa', 'm84-clin-a@spec.test', now(), 'v1')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO member (id, organization_id, profile_id, role, es_colegiado, accepted_at) VALUES
    ('a1840000-0000-4000-8000-0000000008a5', 'a1840000-0000-4000-8000-0000000008a1',
     'a1840000-0000-4000-8000-0000000008aa', 'OWNER', true, now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO servicio (id, organization_id, nombre, tipo_canonico, duracion_min, precio_cents) VALUES
    ('a1840000-0000-4000-8000-0000000008e5', 'a1840000-0000-4000-8000-0000000008a1',
     'Consulta', 'CONSULTA_INICIAL', 30, 100000)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO paciente_identidad
    (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash, nombre_hash) VALUES
    ('e1840000-0000-4000-8000-0000000008e1', 'a1840000-0000-4000-8000-0000000008a1',
     '\x01'::bytea, '\x02'::bytea, '\x03'::bytea, repeat('3', 64), repeat('c', 64)),
    ('e1840000-0000-4000-8000-0000000008e3', 'a1840000-0000-4000-8000-0000000008a1',
     '\x04'::bytea, '\x05'::bytea, '\x06'::bytea, repeat('4', 64), repeat('d', 64))
  ON CONFLICT (id) DO NOTHING;

  -- Pacientes: X linkeado a cuenta X, Y linkeado a cuenta Y (ambos en A).
  INSERT INTO paciente (id, organization_id, identidad_id, cuenta_id) VALUES
    ('d1840000-0000-4000-8000-0000000008d1', 'a1840000-0000-4000-8000-0000000008a1',
     'e1840000-0000-4000-8000-0000000008e1', 'c1840000-0000-4000-8000-0000000008c2'),
    ('d1840000-0000-4000-8000-0000000008d3', 'a1840000-0000-4000-8000-0000000008a1',
     'e1840000-0000-4000-8000-0000000008e3', 'c1840000-0000-4000-8000-0000000008c3')
  ON CONFLICT (id) DO NOTHING;

  -- Turnos de X:
  --   f1 = LEJANO (+3 días, fuera del cutoff 24h) · CONFIRMADO → cancelable.
  --   f2 = CERCANO (+2 horas, dentro del cutoff) · CONFIRMADO → NO cancelable.
  --   f4 = LEJANO (+4 días) pero EN_SALA → NO cancelable (origen no permitido).
  -- Turno de Y:
  --   f3 = LEJANO (+5 días) · CONFIRMADO (X no debe poder tocarlo). Horario distinto
  --        de f1 (+3d) para NO colisionar con el EXCLUDE M40 (turno_no_overlap_excl es
  --        per-profesional e ignora el paciente; f1 y f3 comparten profesional …8a5).
  INSERT INTO turno (id, organization_id, paciente_id, servicio_id, profesional_id, inicio, duracion_min, precio_cents, estado) VALUES
    ('f1840000-0000-4000-8000-0000000008f1', 'a1840000-0000-4000-8000-0000000008a1',
     'd1840000-0000-4000-8000-0000000008d1', 'a1840000-0000-4000-8000-0000000008e5',
     'a1840000-0000-4000-8000-0000000008a5', now() + interval '3 day', 30, 100000, 'CONFIRMADO'),
    ('f1840000-0000-4000-8000-0000000008f2', 'a1840000-0000-4000-8000-0000000008a1',
     'd1840000-0000-4000-8000-0000000008d1', 'a1840000-0000-4000-8000-0000000008e5',
     'a1840000-0000-4000-8000-0000000008a5', now() + interval '2 hour', 30, 100000, 'CONFIRMADO'),
    ('f1840000-0000-4000-8000-0000000008f4', 'a1840000-0000-4000-8000-0000000008a1',
     'd1840000-0000-4000-8000-0000000008d1', 'a1840000-0000-4000-8000-0000000008e5',
     'a1840000-0000-4000-8000-0000000008a5', now() + interval '4 day', 30, 100000, 'EN_SALA'),
    ('f1840000-0000-4000-8000-0000000008f3', 'a1840000-0000-4000-8000-0000000008a1',
     'd1840000-0000-4000-8000-0000000008d3', 'a1840000-0000-4000-8000-0000000008e5',
     'a1840000-0000-4000-8000-0000000008a5', now() + interval '5 day', 30, 100000, 'CONFIRMADO')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'M84 spec · fixtures listos';
END $$;

-- ─── Grants mínimos para ejercer RLS como `authenticated` ───────────────────
-- En prod, Supabase concede SELECT sobre todo `public` a authenticated por default;
-- el CI vanilla no, así que acá replicamos los grants que el path del portal toca.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, UPDATE ON turno TO authenticated;
GRANT SELECT, INSERT ON pedido TO authenticated;
GRANT SELECT ON paciente TO authenticated;
-- pedido.profesional_id es FK → member(id): al insertar un pedido con profesional,
-- la validación de la FK corre como el que inserta y necesita SELECT sobre member
-- (la verificación de FK no atraviesa RLS; sólo requiere el privilegio de tabla).
GRANT SELECT ON member TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- PACIENTE X (auth.uid() = cuenta X)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1840000-0000-4000-8000-0000000008a2'::uuid $$;

SET ROLE authenticated;

-- ── N3a. X NO puede soft-deletear su turno al "cancelar" (anti-tampering) ────
-- Exploit del audit adversarial: sobre el turno LEJANO f1 (fuera de la ventana →
-- la policy SÍ deja pasar el UPDATE), emitir `SET estado='CANCELADO',
-- deleted_at=now()` — cancela Y esconde la fila de las vistas del consultorio
-- (filtran deleted_at IS NULL). Con el denylist viejo esto PASABA (deleted_at no
-- estaba enumerada); la comparación de fila completa del guard debe abortar 42501.
-- DEBE correr ANTES de P1: necesita a f1 vivo y cancelable — dentro de la ventana
-- el bloqueo vendría por la ventana/policy y el test no ejercería el anti-tampering.
DO $$
DECLARE v int; v_blocked boolean := false;
BEGIN
  BEGIN
    UPDATE turno SET estado = 'CANCELADO', deleted_at = now()
     WHERE id = 'f1840000-0000-4000-8000-0000000008f1';
    GET DIAGNOSTICS v = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true; v := 0;
  END;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M84 FAIL N3a: X soft-deleteó su turno al cancelar (rows=%) — deleted_at no está protegida', v;
  END IF;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M84 FAIL N3a: el guard no abortó 42501 (bloqueo vino de otra capa — revisar)';
  END IF;
  RAISE NOTICE 'M84 spec · N3a OK: no se puede soft-deletear al cancelar (fila completa protegida)';
END $$;

-- ── N3b. X NO puede escribir PHI/integraciones al "cancelar" ─────────────────
-- Mismo vector sobre columnas NO enumeradas por el denylist viejo:
-- nota_reserva_cifrado (motivo de consulta, PHI — M56) y gcal_event_id (M09).
DO $$
DECLARE v int; v_blocked boolean := false;
BEGIN
  BEGIN
    UPDATE turno SET estado = 'CANCELADO',
                     nota_reserva_cifrado = '\xdeadbeef'::bytea,
                     gcal_event_id = 'tampered-event'
     WHERE id = 'f1840000-0000-4000-8000-0000000008f1';
    GET DIAGNOSTICS v = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true; v := 0;
  END;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M84 FAIL N3b: X escribió nota_reserva_cifrado/gcal_event_id al cancelar (rows=%)', v;
  END IF;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M84 FAIL N3b: el guard no abortó 42501 (bloqueo vino de otra capa — revisar)';
  END IF;
  RAISE NOTICE 'M84 spec · N3b OK: PHI e integraciones protegidas al cancelar';
END $$;

-- ── P1. X cancela su turno LEJANO (fuera de la ventana) ─────────────────────
DO $$
DECLARE v int;
BEGIN
  UPDATE turno SET estado = 'CANCELADO'
   WHERE id = 'f1840000-0000-4000-8000-0000000008f1' AND estado IN ('AGENDADO','CONFIRMADO');
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v <> 1 THEN RAISE EXCEPTION 'M84 FAIL P1: X no pudo cancelar su turno lejano (rows=%)', v; END IF;
  RAISE NOTICE 'M84 spec · P1 OK: X canceló su turno fuera de la ventana';
END $$;

-- ── N1. X NO cancela un turno DENTRO de la ventana de corte ─────────────────
DO $$
DECLARE v int; v_blocked boolean := false;
BEGIN
  BEGIN
    UPDATE turno SET estado = 'CANCELADO'
     WHERE id = 'f1840000-0000-4000-8000-0000000008f2';
    GET DIAGNOSTICS v = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true; v := 0;  -- guard RAISE 42501
  END;
  -- Bloqueo válido de dos maneras: el guard RAISE (42501) o la policy USING que
  -- deja la fila fuera del target (0 filas). En cualquier caso NO se canceló.
  IF v <> 0 THEN
    RAISE EXCEPTION 'M84 FAIL N1: X canceló un turno dentro de la ventana (rows=%)', v;
  END IF;
  RAISE NOTICE 'M84 spec · N1 OK: turno dentro de ventana no cancelable (blocked=%)', v_blocked;
END $$;

-- ── N2. X NO cancela el turno de Y (no es dueño) ────────────────────────────
DO $$
DECLARE v int;
BEGIN
  UPDATE turno SET estado = 'CANCELADO'
   WHERE id = 'f1840000-0000-4000-8000-0000000008f3';
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v <> 0 THEN RAISE EXCEPTION 'M84 FAIL N2: X canceló/tocó el turno de Y (rows=%)', v; END IF;
  RAISE NOTICE 'M84 spec · N2 OK: X no puede tocar el turno de Y';
END $$;

-- ── N3. X NO puede mover el horario mientras "cancela" (anti-tampering) ──────
-- Usamos el turno cercano f2 (aún CONFIRMADO). Intentar cambiar `inicio` +
-- estado=CANCELADO debe abortar por el guard (o quedar fuera de la policy).
DO $$
DECLARE v int; v_blocked boolean := false;
BEGIN
  BEGIN
    UPDATE turno SET estado = 'CANCELADO', inicio = now() + interval '10 day'
     WHERE id = 'f1840000-0000-4000-8000-0000000008f2';
    GET DIAGNOSTICS v = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true; v := 0;
  END;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M84 FAIL N3: X movió el horario del turno al cancelar (rows=%)', v;
  END IF;
  RAISE NOTICE 'M84 spec · N3 OK: no se puede tocar otra columna al cancelar (blocked=%)', v_blocked;
END $$;

-- ── N4. X NO puede escalar su turno a un estado != CANCELADO ────────────────
-- Sobre el turno lejano f4-equivalente… usamos otro turno lejano no cancelado.
-- (f1 ya está CANCELADO; probamos escalar f4 EN_SALA a ATENDIENDO — debe fallar.)
DO $$
DECLARE v int; v_blocked boolean := false;
BEGIN
  BEGIN
    UPDATE turno SET estado = 'ATENDIENDO'
     WHERE id = 'f1840000-0000-4000-8000-0000000008f4';
    GET DIAGNOSTICS v = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true; v := 0;
  END;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M84 FAIL N4: X escaló un turno a ATENDIENDO (rows=%)', v;
  END IF;
  RAISE NOTICE 'M84 spec · N4 OK: el paciente no puede escalar el estado (blocked=%)', v_blocked;
END $$;

-- ── N6. X NO puede cancelar un turno EN_SALA (origen no permitido) ──────────
DO $$
DECLARE v int; v_blocked boolean := false;
BEGIN
  BEGIN
    UPDATE turno SET estado = 'CANCELADO'
     WHERE id = 'f1840000-0000-4000-8000-0000000008f4';
    GET DIAGNOSTICS v = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true; v := 0;
  END;
  IF v <> 0 THEN
    RAISE EXCEPTION 'M84 FAIL N6: X canceló un turno EN_SALA (rows=%)', v;
  END IF;
  RAISE NOTICE 'M84 spec · N6 OK: no se puede cancelar un turno en curso (blocked=%)', v_blocked;
END $$;

-- ── P2. X inserta un pedido PENDIENTE (reagenda) para SU ficha ──────────────
-- Verificamos con GET DIAGNOSTICS (ROW_COUNT del propio INSERT), NO con un SELECT:
-- el paciente NO tiene policy de lectura sobre `pedido` (por diseño — ver M84 §3),
-- así que un `SELECT count(*)` acá devolvería 0 aunque el INSERT sí haya entrado.
-- El ROW_COUNT refleja la escritura efectiva del propio actor sin tocar la RLS de
-- lectura. Si el WITH CHECK de pedido_insert_portal fallara, el INSERT abortaría con
-- 42501 (no llegaríamos a la aserción).
DO $$
DECLARE v int;
BEGIN
  INSERT INTO pedido (organization_id, canal, estado, paciente_id, nombre_cifrado,
                      fecha_propuesta, duracion_min, servicio_id, profesional_id)
  VALUES ('a1840000-0000-4000-8000-0000000008a1', 'PORTAL', 'PENDIENTE',
          'd1840000-0000-4000-8000-0000000008d1', '\x07'::bytea,
          now() + interval '5 day', 30, 'a1840000-0000-4000-8000-0000000008e5',
          'a1840000-0000-4000-8000-0000000008a5');
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v <> 1 THEN RAISE EXCEPTION 'M84 FAIL P2: no se insertó el pedido del portal (rows=%)', v; END IF;
  RAISE NOTICE 'M84 spec · P2 OK: X encoló un pedido PORTAL para su ficha';
END $$;

-- ── N5. X NO puede insertar un pedido para la ficha de Y ────────────────────
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  BEGIN
    INSERT INTO pedido (organization_id, canal, estado, paciente_id, nombre_cifrado,
                        fecha_propuesta, duracion_min, servicio_id, profesional_id)
    VALUES ('a1840000-0000-4000-8000-0000000008a1', 'PORTAL', 'PENDIENTE',
            'd1840000-0000-4000-8000-0000000008d3', '\x08'::bytea,
            now() + interval '5 day', 30, 'a1840000-0000-4000-8000-0000000008e5',
            'a1840000-0000-4000-8000-0000000008a5');
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;  -- WITH CHECK violation → 42501
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'M84 FAIL N5: X insertó un pedido para la ficha de Y (WITH CHECK debió fallar)';
  END IF;
  RAISE NOTICE 'M84 spec · N5 OK: X no puede encolar un pedido para la ficha de Y';
END $$;

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- REGRESIÓN STAFF: el clínico (member) cancela sin que el guard lo toque.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT 'a1840000-0000-4000-8000-0000000008aa'::uuid $$;

SET ROLE authenticated;

-- El clínico cancela el turno CERCANO de X (f2) — para él NO hay ventana de corte
-- (el guard early-returns por ser member; la máquina M09 permite CONFIRMADO→CANCELADO).
DO $$
DECLARE v int;
BEGIN
  UPDATE turno SET estado = 'CANCELADO'
   WHERE id = 'f1840000-0000-4000-8000-0000000008f2';
  GET DIAGNOSTICS v = ROW_COUNT;
  IF v <> 1 THEN
    RAISE EXCEPTION 'M84 FAIL C1: el clínico no pudo cancelar el turno cercano de X (rows=%) — el guard no debe tocar a staff', v;
  END IF;
  RAISE NOTICE 'M84 spec · C1 OK: el staff cancela sin la ventana de corte del portal';
END $$;

RESET ROLE;

-- ─── Restaurar auth.uid() a NULL (estado de CI) ─────────────────────────────
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

DO $$ BEGIN RAISE NOTICE 'M84 spec PASS · self-service del portal verificado (cancel acotado + reagenda-pedido + anti-tampering + aislamiento)'; END $$;
